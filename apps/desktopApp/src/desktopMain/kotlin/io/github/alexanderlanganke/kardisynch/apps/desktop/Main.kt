package io.github.alexanderlanganke.kardisynch.apps.desktop

import androidx.compose.foundation.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportLead
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportPatient
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportReport
import io.github.alexanderlanganke.kardisynch.core.qrimport.buildFollowUpQrPayload
import io.github.alexanderlanganke.kardisynch.data.DatabaseDriverFactory
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.DesktopDirectoryLock
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.resolveReportsRootHandle
import io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp
import kotlinx.coroutines.launch
import java.io.File
import javax.swing.JFileChooser

private const val SETTING_DATA_ROOT = "dataRootPath"
private const val SETTING_IMPORT_DIR = "importDirPath"
private const val SETTING_USB_SOURCE_DIRS = "usbSourceDirs"
private const val SETTING_USB_TARGET_DIR = "usbTargetDir"

/** Newline-joined, since a file path can't itself contain a newline on any target platform. */
private fun encodeUsbSourceDirs(dirs: List<String>): String = dirs.joinToString("\n")
private fun decodeUsbSourceDirs(raw: String?): List<String> = raw?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()

private fun usbManifestFile() = File(File(System.getProperty("user.home"), ".kardisynch"), "usb_target_manifest.json")

/**
 * Local per-device staging folder (like `database.db`, alongside it under
 * `~/.kardisynch`) — never on the shared `_DATA` root, since it only ever
 * holds files mid-way through being filed away. This is only a *default*:
 * [SETTING_IMPORT_DIR] lets it be relocated (issue #194), e.g. to point at
 * wherever a device programmer or USB-transfer workflow already drops files.
 */
private fun defaultImportDir() = File(File(System.getProperty("user.home"), ".kardisynch"), "_IMPORT")

fun main() = application {
    val repository = remember { KardiSynchRepository(DatabaseDriverFactory().createDriver()) }
    val reader = remember { DesktopDataRootReader() }
    val writer = remember { DesktopDataRootWriter() }
    val lock = remember { DesktopDirectoryLock() }
    val scope = rememberCoroutineScope()

    var dataRoot by remember { mutableStateOf<String?>(null) }
    var isReindexing by remember { mutableStateOf(false) }
    var lastReindexSummary by remember { mutableStateOf<String?>(null) }
    var importDirPath by remember { mutableStateOf(defaultImportDir().absolutePath) }
    var qrDialogImage by remember { mutableStateOf<ImageBitmap?>(null) }
    var usbSourceDirs by remember { mutableStateOf<List<String>>(emptyList()) }
    var usbTargetDirPath by remember { mutableStateOf<String?>(null) }
    var isReparsing by remember { mutableStateOf(false) }
    var pendingSortRefreshTrigger by remember { mutableStateOf(0) }
    var pendingSortCount by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        dataRoot = repository.getSetting(SETTING_DATA_ROOT)
        importDirPath = repository.getSetting(SETTING_IMPORT_DIR) ?: defaultImportDir().absolutePath
        usbSourceDirs = decodeUsbSourceDirs(repository.getSetting(SETTING_USB_SOURCE_DIRS))
        usbTargetDirPath = repository.getSetting(SETTING_USB_TARGET_DIR)
    }

    fun runReindex(root: String) {
        scope.launch {
            isReindexing = true
            try {
                val reportsRoot = resolveReportsRootHandle(reader, root)
                if (reportsRoot == null) {
                    lastReindexSummary = "No \"Reports\" folder found under $root yet — nothing to index."
                } else {
                    repository.reindexFrom(reader, reportsRoot)
                    lastReindexSummary = "Reindexed successfully."
                }
            } catch (e: Exception) {
                lastReindexSummary = "Reindex failed: ${e.message}"
            } finally {
                isReindexing = false
            }
        }
    }

    // Idempotent/additive (issue #184) — safe to run every time the app
    // (re-)points at a _DATA root, mirrors Electron's initializeStorage.
    LaunchedEffect(dataRoot) {
        val root = dataRoot ?: return@LaunchedEffect
        repository.seedDeviceTypeAliasesIfNeeded(reader, writer, root, java.time.Instant.now().toString())
    }

    LaunchedEffect(pendingSortRefreshTrigger) {
        pendingSortCount = repository.getPendingSortTasks().size
    }

    fun runReparseAll() {
        val root = dataRoot ?: return
        scope.launch {
            isReparsing = true
            try {
                val reportsRoot = resolveReportsRootHandle(reader, root)
                lastReindexSummary = if (reportsRoot == null) {
                    "No \"Reports\" folder found under $root yet — nothing to reparse."
                } else {
                    reparseAllVisits(repository, reader, writer, reportsRoot).message()
                }
            } catch (e: Exception) {
                lastReindexSummary = "Reparse failed: ${e.message}"
            } finally {
                isReparsing = false
            }
        }
    }

    DisposableEffect(dataRoot, importDirPath) {
        val root = dataRoot
        val watcher = if (root != null) {
            val reportsRoot = resolveReportsRootHandle(reader, root)
            if (reportsRoot != null) {
                ImportWatcher(File(importDirPath), reportsRoot, repository, reader, writer, scope, lock, dataRootHandle = root) { message ->
                    lastReindexSummary = message
                    pendingSortRefreshTrigger++
                }.also { it.start() }
            } else null
        } else null
        onDispose { watcher?.stop() }
    }

    // "Always restart the watcher on settings change" (mirrors main.ts) — a
    // new UsbWatcher is constructed and started whenever any of its three
    // inputs change, rather than mutating an existing instance in place.
    DisposableEffect(usbSourceDirs, usbTargetDirPath, importDirPath) {
        val watcher = UsbWatcher(
            sourceDirs = usbSourceDirs.map { File(it) },
            targetDir = usbTargetDirPath?.let { File(it) },
            importDir = File(importDirPath),
            manifestFile = usbManifestFile(),
            scope = scope,
        ) { message -> lastReindexSummary = message }
        watcher.start()
        onDispose { watcher.stop() }
    }

    Window(onCloseRequest = ::exitApplication, title = "KardiSynch") {
        KardiSynchApp(
            repository = repository,
            dataRootLabel = dataRoot,
            isReindexing = isReindexing,
            lastReindexSummary = lastReindexSummary,
            onPickDataRoot = {
                val chooser = JFileChooser().apply {
                    fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
                    dialogTitle = "Choose the _DATA folder"
                }
                if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
                    val picked = chooser.selectedFile.absolutePath
                    dataRoot = picked
                    scope.launch { repository.setSetting(SETTING_DATA_ROOT, picked) }
                    runReindex(picked)
                }
            },
            onReindex = { dataRoot?.let(::runReindex) },
            onClearLocalIndex = {
                scope.launch {
                    repository.clearLocalIndex()
                    lastReindexSummary = "Local index cleared."
                }
            },
            importDirLabel = importDirPath,
            onPickImportDir = {
                val chooser = JFileChooser().apply {
                    fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
                    dialogTitle = "Choose the import folder"
                }
                if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
                    val picked = chooser.selectedFile.absolutePath
                    importDirPath = picked
                    scope.launch { repository.setSetting(SETTING_IMPORT_DIR, picked) }
                }
            },
            onReprocessUnmatched = {
                val moved = reprocessUnmatchedFiles(File(importDirPath))
                lastReindexSummary = if (moved > 0) "Moved $moved file(s) from _unmatched back into _IMPORT." else "No unmatched files to reprocess."
            },
            onExportQr = { report, devices, leads ->
                scope.launch {
                    val patient = repository.getPatientById(report.patientId)
                    val exportReport = FollowUpExportReport(
                        interrogationDate = report.interrogationDate,
                        manufacturer = report.manufacturer,
                        deviceType = report.deviceType,
                        deviceModel = report.deviceModel,
                        deviceSerial = report.deviceSerialNumber,
                        deviceImplantDate = devices.firstOrNull()?.implantDate,
                        leads = leads.map { l ->
                            FollowUpExportLead(
                                location = l.anatomicLocation,
                                type = l.name,
                                impedance = l.impedanceValue,
                                sensing = l.sensingValue,
                                threshold = l.pacingThresholdValue,
                            )
                        },
                    )
                    val payload = buildFollowUpQrPayload(
                        FollowUpExportPatient(patient?.firstName, patient?.lastName, patient?.dob),
                        exportReport,
                        System.currentTimeMillis() / 1000,
                    )
                    qrDialogImage = renderQrCodeImage(payload).toComposeImageBitmap()
                }
            },
            usbSourceDirs = usbSourceDirs,
            onAddUsbSourceDir = {
                val chooser = JFileChooser().apply {
                    fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
                    dialogTitle = "Choose a USB source folder"
                }
                if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
                    val picked = chooser.selectedFile.absolutePath
                    if (picked !in usbSourceDirs) {
                        usbSourceDirs = usbSourceDirs + picked
                        scope.launch { repository.setSetting(SETTING_USB_SOURCE_DIRS, encodeUsbSourceDirs(usbSourceDirs)) }
                    }
                }
            },
            onRemoveUsbSourceDir = { dir ->
                usbSourceDirs = usbSourceDirs - dir
                scope.launch { repository.setSetting(SETTING_USB_SOURCE_DIRS, encodeUsbSourceDirs(usbSourceDirs)) }
            },
            usbTargetDirLabel = usbTargetDirPath,
            onPickUsbTargetDir = {
                val chooser = JFileChooser().apply {
                    fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
                    dialogTitle = "Choose the USB target folder"
                }
                if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
                    val picked = chooser.selectedFile.absolutePath
                    usbTargetDirPath = picked
                    scope.launch { repository.setSetting(SETTING_USB_TARGET_DIR, picked) }
                }
            },
            isReparsing = isReparsing,
            onReparseAll = { runReparseAll() },
            pendingSortCount = pendingSortCount,
            pendingSortRefreshKey = pendingSortRefreshTrigger,
            onApprovePendingSort = { taskId, patientId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to attach this to."
                    } else {
                        resolvePendingSortTask(repository, reader, writer, reportsRoot, taskId, patientId, lock).fold(
                            onSuccess = { "Attached to the selected patient." },
                            onFailure = { e -> "Failed to attach: ${e.message}" },
                        )
                    }
                    pendingSortRefreshTrigger++
                }
            },
            onDismissPendingSort = { taskId ->
                scope.launch {
                    lastReindexSummary = dismissPendingSortTask(repository, File(importDirPath), taskId).fold(
                        onSuccess = { "Moved to _unmatched." },
                        onFailure = { e -> "Failed to dismiss: ${e.message}" },
                    )
                    pendingSortRefreshTrigger++
                }
            },
        )

        qrDialogImage?.let { bitmap ->
            AlertDialog(
                onDismissRequest = { qrDialogImage = null },
                confirmButton = { TextButton(onClick = { qrDialogImage = null }) { Text("Close") } },
                title = { Text("Follow-up QR code") },
                text = { Image(bitmap = bitmap, contentDescription = "Follow-up QR code") },
            )
        }
    }
}
