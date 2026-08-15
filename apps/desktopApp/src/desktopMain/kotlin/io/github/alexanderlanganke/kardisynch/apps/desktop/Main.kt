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
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import io.github.alexanderlanganke.kardisynch.core.news.CachedDeviceNewsService
import io.github.alexanderlanganke.kardisynch.core.news.DeviceNewsFetcher
import io.github.alexanderlanganke.kardisynch.core.news.createDeviceNewsHttpClient
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
import io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode
import io.github.alexanderlanganke.kardisynch.ui.theme.parseThemeMode
import io.github.alexanderlanganke.kardisynch.ui.theme.toSettingValue
import kotlinx.coroutines.launch
import java.io.File
import javax.swing.JFileChooser

private const val SETTING_DATA_ROOT = "dataRootPath"
private const val SETTING_IMPORT_DIR = "importDirPath"
private const val SETTING_USB_SOURCE_DIRS = "usbSourceDirs"
private const val SETTING_USB_TARGET_DIR = "usbTargetDir"
private const val SETTING_WINDOW_WIDTH = "windowWidth"
private const val SETTING_WINDOW_HEIGHT = "windowHeight"
private const val SETTING_WINDOW_X = "windowX"
private const val SETTING_WINDOW_Y = "windowY"
private const val SETTING_ONBOARDING_COMPLETED = "onboardingCompleted"
private const val SETTING_THEME_MODE = "themeMode"

/** Kept in sync with `nativeDistributions.packageVersion` in apps/desktopApp/build.gradle.kts (issue #196's "About" section — no build-time BuildConfig injection wired up yet, so this is a second source of truth to update by hand). */
private const val APP_VERSION = "0.1.0"

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

/**
 * A background-coroutine or non-Compose-thread exception used to just crash
 * the JVM with a stack trace on stderr and no other trace — this at least
 * logs where before that happens (issue #196; Electron's equivalent,
 * `showCrashDialog`, additionally shows a native dialog and offers to file
 * a GitHub issue — not ported, no GitHub-posting capability from inside
 * this app either).
 */
private fun installUncaughtExceptionHandler() {
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
        System.err.println("[KardiSynch] Uncaught exception on thread ${thread.name}:")
        throwable.printStackTrace()
    }
}

fun main() {
    installUncaughtExceptionHandler()
    startApp()
}

private fun startApp() = application {
    val repository = remember { KardiSynchRepository(DatabaseDriverFactory().createDriver()) }
    val reader = remember { DesktopDataRootReader() }
    val writer = remember { DesktopDataRootWriter() }
    val lock = remember { DesktopDirectoryLock() }
    val scope = rememberCoroutineScope()
    val deviceNewsService = remember { CachedDeviceNewsService(DeviceNewsFetcher(createDeviceNewsHttpClient())) }

    var dataRoot by remember { mutableStateOf<String?>(null) }
    var isReindexing by remember { mutableStateOf(false) }
    var lastReindexSummary by remember { mutableStateOf<String?>(null) }
    var importDirPath by remember { mutableStateOf(defaultImportDir().absolutePath) }
    var qrDialogImage by remember { mutableStateOf<ImageBitmap?>(null) }
    var usbSourceDirs by remember { mutableStateOf<List<String>>(emptyList()) }
    var usbTargetDirPath by remember { mutableStateOf<String?>(null) }
    var isReparsing by remember { mutableStateOf(false) }
    var isDeduping by remember { mutableStateOf(false) }
    var pendingSortRefreshTrigger by remember { mutableStateOf(0) }
    var pendingSortCount by remember { mutableStateOf(0) }
    var duplicatesRefreshTrigger by remember { mutableStateOf(0) }
    var showOnboarding by remember { mutableStateOf(false) }
    var themeMode by remember { mutableStateOf(ThemeMode.DARK) }
    val todayIso = remember { java.time.LocalDate.now().toString() }
    val windowState = rememberWindowState(size = DpSize(1200.dp, 800.dp))

    // Window size/position persistence (issue #196 — Electron's version has
    // none either, it always opens at a hardcoded size; this is a real
    // improvement over the original, not a strict port). Loaded once
    // settings are available, then any later drag/resize is saved back.
    LaunchedEffect(Unit) {
        val width = repository.getSetting(SETTING_WINDOW_WIDTH)?.toFloatOrNull()
        val height = repository.getSetting(SETTING_WINDOW_HEIGHT)?.toFloatOrNull()
        if (width != null && height != null) windowState.size = DpSize(width.dp, height.dp)
        val x = repository.getSetting(SETTING_WINDOW_X)?.toFloatOrNull()
        val y = repository.getSetting(SETTING_WINDOW_Y)?.toFloatOrNull()
        if (x != null && y != null) windowState.position = WindowPosition(x.dp, y.dp)
    }
    LaunchedEffect(windowState.size, windowState.position) {
        repository.setSetting(SETTING_WINDOW_WIDTH, windowState.size.width.value.toString())
        repository.setSetting(SETTING_WINDOW_HEIGHT, windowState.size.height.value.toString())
        val position = windowState.position
        if (position is WindowPosition.Absolute) {
            repository.setSetting(SETTING_WINDOW_X, position.x.value.toString())
            repository.setSetting(SETTING_WINDOW_Y, position.y.value.toString())
        }
    }

    LaunchedEffect(Unit) {
        dataRoot = repository.getSetting(SETTING_DATA_ROOT)
        importDirPath = repository.getSetting(SETTING_IMPORT_DIR) ?: defaultImportDir().absolutePath
        usbSourceDirs = decodeUsbSourceDirs(repository.getSetting(SETTING_USB_SOURCE_DIRS))
        usbTargetDirPath = repository.getSetting(SETTING_USB_TARGET_DIR)
        showOnboarding = repository.getSetting(SETTING_ONBOARDING_COMPLETED) != "true"
        themeMode = parseThemeMode(repository.getSetting(SETTING_THEME_MODE))
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

    Window(onCloseRequest = ::exitApplication, title = "KardiSynch", state = windowState) {
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
            onCreateNewPatientFromPendingSort = { taskId, firstName, lastName, dob, hospitalPatientId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to assign."
                    } else {
                        resolvePendingSortTaskAsNewPatient(repository, reader, writer, reportsRoot, taskId, firstName, lastName, dob, hospitalPatientId, lock).fold(
                            onSuccess = { "Filed under a new patient." },
                            onFailure = { e -> "Failed to file: ${e.message}" },
                        )
                    }
                    pendingSortRefreshTrigger++
                }
            },
            onManualAssignPendingSort = { taskId, patientId, manufacturer, deviceType, deviceModel, deviceSerial, interrogationDate ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to assign."
                    } else {
                        resolvePendingSortTaskManually(repository, reader, writer, reportsRoot, taskId, patientId, manufacturer, deviceType, deviceModel, deviceSerial, interrogationDate, lock).fold(
                            onSuccess = { "Filed with manually-entered device info." },
                            onFailure = { e -> "Failed to file: ${e.message}" },
                        )
                    }
                    pendingSortRefreshTrigger++
                }
            },
            onReadPendingSortFileBytes = { path -> File(path).takeIf { it.isFile }?.readBytes() },
            onReadPendingSortFileText = { path -> File(path).takeIf { it.isFile }?.readText() },
            onOpenUrl = { url ->
                try {
                    java.awt.Desktop.getDesktop().browse(java.net.URI(url))
                } catch (e: Exception) {
                    lastReindexSummary = "Couldn't open $url: ${e.message}"
                }
            },
            appVersion = APP_VERSION,
            notificationMessage = lastReindexSummary,
            notificationKey = lastReindexSummary,
            deviceNewsService = deviceNewsService,
            showOnboarding = showOnboarding,
            onOnboardingFinish = {
                showOnboarding = false
                scope.launch { repository.setSetting(SETTING_ONBOARDING_COMPLETED, "true") }
            },
            onOnboardingSkip = {
                showOnboarding = false
                scope.launch { repository.setSetting(SETTING_ONBOARDING_COMPLETED, "true") }
            },
            todayIso = todayIso,
            onOpenPatientFolder = { patientId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    val patientDir = reportsRoot?.let { repository.findPatientDirectoryHandle(reader, it, patientId) }
                    if (patientDir == null) {
                        lastReindexSummary = "Couldn't find this patient's folder."
                    } else {
                        try {
                            java.awt.Desktop.getDesktop().open(File(patientDir))
                        } catch (e: Exception) {
                            lastReindexSummary = "Couldn't open the folder: ${e.message}"
                        }
                    }
                }
            },
            onEditPatientInfo = { patientId, firstName, lastName, dob, hospitalPatientId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to edit."
                    } else {
                        repository.updatePatientInfo(reader, writer, reportsRoot, patientId, firstName, lastName, dob, hospitalPatientId, lock).fold(
                            onSuccess = { "Patient info updated." },
                            onFailure = { e -> "Failed to update patient info: ${e.message}" },
                        )
                    }
                }
            },
            onMoveReport = { reportId, fromPatientId, toPatientId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to move."
                    } else {
                        repository.moveReport(reader, writer, reportsRoot, reportId, fromPatientId, toPatientId, lock).fold(
                            onSuccess = { "Visit moved." },
                            onFailure = { e -> "Failed to move visit: ${e.message}" },
                        )
                    }
                }
            },
            duplicatesRefreshKey = duplicatesRefreshTrigger,
            onMergeDuplicates = { keeperId, loserIds ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to merge."
                    } else {
                        val result = repository.mergePatients(reader, writer, reportsRoot, keeperId, loserIds, lock)
                        result.getOrNull()?.let { if (it.patientsDeleted > 0) repository.reindexFrom(reader, reportsRoot) }
                        result.fold(
                            onSuccess = { r ->
                                "Merged ${r.patientsDeleted} patient(s), moved ${r.reportsMoved} visit(s)." +
                                    if (r.errors.isNotEmpty()) " Errors: ${r.errors.joinToString("; ")}" else ""
                            },
                            onFailure = { e -> "Merge failed: ${e.message}" },
                        )
                    }
                    duplicatesRefreshTrigger++
                }
            },
            onFindOrphanedVisits = {
                val root = dataRoot
                val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                if (reportsRoot == null) emptyList() else repository.findOrphanedVisits(reader, reportsRoot)
            },
            onMoveOrphanedVisits = { reportIds ->
                val root = dataRoot
                val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                if (reportsRoot == null) {
                    KardiSynchRepository.OrphanMoveResult(0, listOf("No \"Reports\" folder found."))
                } else {
                    val result = repository.moveOrphanedVisits(reader, writer, reportsRoot, reportIds, lock)
                    if (result.moved > 0) repository.reindexFrom(reader, reportsRoot)
                    result
                }
            },
            onListDeviceTypeAliases = {
                val root = dataRoot
                if (root == null) emptyList() else repository.listDeviceTypeAliases(reader, root)
            },
            onUpsertDeviceTypeAlias = { manufacturer, model, type ->
                val root = dataRoot
                if (root == null) {
                    Result.failure(IllegalStateException("No _DATA folder set."))
                } else {
                    repository.upsertDeviceTypeAlias(reader, writer, root, manufacturer, model, type, java.time.Instant.now().toString())
                }
            },
            onUpsertLeadTypeAlias = { manufacturer, model, attrs ->
                val root = dataRoot
                if (root == null) {
                    Result.failure(IllegalStateException("No _DATA folder set."))
                } else {
                    repository.upsertLeadTypeAlias(reader, writer, root, manufacturer, model, attrs, java.time.Instant.now().toString())
                }
            },
            onDeleteDeviceTypeAlias = { manufacturer, model, kind ->
                val root = dataRoot
                if (root == null) {
                    Result.failure(IllegalStateException("No _DATA folder set."))
                } else {
                    repository.deleteDeviceTypeAlias(reader, writer, root, manufacturer, model, kind)
                }
            },
            onDeleteReport = { reportId ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to delete."
                    } else {
                        repository.deleteReport(reader, writer, reportsRoot, reportId, lock).fold(
                            onSuccess = { "Visit deleted." },
                            onFailure = { e -> "Failed to delete visit: ${e.message}" },
                        )
                    }
                }
            },
            isDeduping = isDeduping,
            onDedupReports = {
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    if (reportsRoot == null) {
                        lastReindexSummary = "No \"Reports\" folder found — nothing to deduplicate."
                    } else {
                        isDeduping = true
                        val result = repository.dedupReports(reader, writer, reportsRoot)
                        isDeduping = false
                        lastReindexSummary = if (result.groupsFound == 0) {
                            "No duplicates found."
                        } else {
                            "Deduplicated ${result.groupsFound} group(s), removed ${result.reportsRemoved} duplicate visit(s)." +
                                if (result.errors.isNotEmpty()) " ${result.errors.size} couldn't be fully merged." else ""
                        }
                    }
                }
            },
            themeMode = themeMode,
            onThemeModeChange = { mode ->
                themeMode = mode
                scope.launch { repository.setSetting(SETTING_THEME_MODE, mode.toSettingValue()) }
            },
            onEditReportDevicesAndLeads = { reportId, patientId, manufacturer, device, leads ->
                val root = dataRoot
                scope.launch {
                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found — nothing to edit."
                    } else {
                        repository.updateReportDeviceAndLeads(reader, writer, reportsRoot, patientId, reportId, manufacturer, device, leads, lock).fold(
                            onSuccess = { "Device & leads updated." },
                            onFailure = { e -> "Failed to update device & leads: ${e.message}" },
                        )
                    }
                }
            },
            onRescanVisit = { patientId, reportId ->
                val root = dataRoot
                val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                if (reportsRoot == null) {
                    null
                } else {
                    repository.rescanVisit(reader, reportsRoot, patientId, reportId).getOrElse { e ->
                        lastReindexSummary = "Rescan failed: ${e.message}"
                        null
                    }
                }
            },
            onGetVisitFiles = { patientId, reportId ->
                val root = dataRoot
                val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                if (reportsRoot == null) emptyList() else repository.getVisitFiles(reader, reportsRoot, patientId, reportId)
            },
            onReadVisitFileBytes = { fileHandle -> reader.readBytes(fileHandle) },
            onReadVisitFileText = { fileHandle -> reader.readText(fileHandle) },
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
