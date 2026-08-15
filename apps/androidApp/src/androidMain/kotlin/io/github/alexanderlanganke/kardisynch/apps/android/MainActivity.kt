package io.github.alexanderlanganke.kardisynch.apps.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.github.alexanderlanganke.kardisynch.core.news.CachedDeviceNewsService
import io.github.alexanderlanganke.kardisynch.core.news.DeviceNewsFetcher
import io.github.alexanderlanganke.kardisynch.core.news.createDeviceNewsHttpClient
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportLead
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportPatient
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpExportReport
import io.github.alexanderlanganke.kardisynch.core.qrimport.buildFollowUpQrPayload
import io.github.alexanderlanganke.kardisynch.core.qrimport.parseFollowUpQrPayload
import io.github.alexanderlanganke.kardisynch.data.AndroidDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DatabaseDriverFactory
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.resolveReportsRootHandle
import io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp
import io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode
import io.github.alexanderlanganke.kardisynch.ui.theme.parseThemeMode
import io.github.alexanderlanganke.kardisynch.ui.theme.toSettingValue
import kotlinx.coroutines.launch

private const val SETTING_DATA_ROOT = "dataRootPath"
private const val SETTING_ONBOARDING_COMPLETED = "onboardingCompleted"
private const val SETTING_THEME_MODE = "themeMode"

/** Kept in sync by hand with the desktop actual's own `APP_VERSION` — see its doc comment for why there's no build-time injection wired up yet. */
private const val APP_VERSION = "0.1.0"

/**
 * Wires up the optional [KardiSynchApp] capabilities that were previously
 * left `null` here — edit/move/delete-report, duplicate/orphan review,
 * device-lead alias management, QR export, device news, onboarding,
 * `onOpenUrl`, and `todayIso` (parity plan Phase 2). `AndroidDataRootReader`
 * already implements both `DataRootReader` and `DataRootWriter`, so every
 * repository call below passes [reader] for both parameters — no separate
 * writer class was needed.
 *
 * Deliberately still left unwired: the import-folder/USB-watcher/pending-sort/
 * reparse-all family (`onPickImportDir`, `onReprocessUnmatched`,
 * `onReparseAll`, `onApprovePendingSort`, `onDismissPendingSort`, USB source/
 * target dirs). Desktop's versions depend on `ImportWatcher`/`UsbWatcher`
 * (filesystem-watch-based background services with no SAF equivalent yet)
 * or, for `onReparseAll`, on `ReparseService`, which is currently written
 * directly against `java.io.File` rather than the `DataRootReader`
 * abstraction and so isn't portable as-is. Wiring these needs real new
 * platform work, not just callback plumbing — left for a follow-up phase.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val repository = KardiSynchRepository(DatabaseDriverFactory(applicationContext).createDriver())
        val reader = AndroidDataRootReader(applicationContext)
        val deviceNewsService = CachedDeviceNewsService(DeviceNewsFetcher(createDeviceNewsHttpClient()))

        setContent {
            val scope = rememberCoroutineScope()
            var dataRoot by remember { mutableStateOf<String?>(null) }
            var isReindexing by remember { mutableStateOf(false) }
            var lastReindexSummary by remember { mutableStateOf<String?>(null) }
            var showScanner by remember { mutableStateOf(false) }
            var showOnboarding by remember { mutableStateOf(false) }
            var duplicatesRefreshTrigger by remember { mutableStateOf(0) }
            var isDeduping by remember { mutableStateOf(false) }
            var qrDialogImage by remember { mutableStateOf<ImageBitmap?>(null) }
            var themeMode by remember { mutableStateOf(ThemeMode.DARK) }
            val todayIso = remember { java.time.LocalDate.now().toString() }
            var hasCameraPermission by remember {
                mutableStateOf(ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            }

            LaunchedEffect(Unit) {
                dataRoot = repository.getSetting(SETTING_DATA_ROOT)
                showOnboarding = repository.getSetting(SETTING_ONBOARDING_COMPLETED) != "true"
                themeMode = parseThemeMode(repository.getSetting(SETTING_THEME_MODE))
            }

            fun runReindex(root: String) {
                scope.launch {
                    isReindexing = true
                    val reportsRoot = resolveReportsRootHandle(reader, root)
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found under the selected location yet — nothing to index."
                    } else {
                        repository.reindexFrom(reader, reportsRoot)
                        "Reindexed successfully."
                    }
                    isReindexing = false
                }
            }

            val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                hasCameraPermission = granted
                if (granted) showScanner = true
            }

            val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
                if (uri != null) {
                    contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                    val root = uri.toString()
                    dataRoot = root
                    scope.launch { repository.setSetting(SETTING_DATA_ROOT, root) }
                    runReindex(root)
                }
            }

            MaterialTheme {
                if (showScanner) {
                    QrScanScreen(
                        onDecoded = { text ->
                            showScanner = false
                            val import = parseFollowUpQrPayload(text)
                            val root = dataRoot
                            when {
                                import == null -> lastReindexSummary = "That QR code wasn't a recognized follow-up export."
                                root == null -> lastReindexSummary = "Set a _DATA folder in Settings before importing."
                                else -> scope.launch {
                                    val reportsRoot = resolveReportsRootHandle(reader, root)
                                    if (reportsRoot == null) {
                                        lastReindexSummary = "No \"Reports\" folder found under the selected location."
                                    } else {
                                        val result = repository.importFollowUp(reader, reader, reportsRoot, import)
                                        lastReindexSummary = if (result.isSuccess) {
                                            "Imported ${import.patientLastName}, ${import.patientFirstName}'s visit."
                                        } else {
                                            "Import failed: ${result.exceptionOrNull()?.message}"
                                        }
                                    }
                                }
                            }
                        },
                        onCancel = { showScanner = false },
                    )
                } else {
                    Box(modifier = Modifier.fillMaxSize()) {
                        KardiSynchApp(
                            repository = repository,
                            dataRootLabel = dataRoot,
                            isReindexing = isReindexing,
                            lastReindexSummary = lastReindexSummary,
                            onPickDataRoot = { folderPicker.launch(null) },
                            onReindex = { dataRoot?.let(::runReindex) },
                            onClearLocalIndex = {
                                scope.launch {
                                    repository.clearLocalIndex()
                                    lastReindexSummary = "Local index cleared."
                                }
                            },
                            onOpenUrl = { url ->
                                try {
                                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                } catch (e: Exception) {
                                    lastReindexSummary = "Couldn't open $url: ${e.message}"
                                }
                            },
                            onOpenPatientFolder = { patientId ->
                                val root = dataRoot
                                scope.launch {
                                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                                    val patientDir = reportsRoot?.let { repository.findPatientDirectoryHandle(reader, it, patientId) }
                                    if (patientDir == null) {
                                        lastReindexSummary = "Couldn't find this patient's folder."
                                    } else {
                                        try {
                                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                                setDataAndType(Uri.parse(patientDir), DocumentsContract.Document.MIME_TYPE_DIR)
                                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                            }
                                            startActivity(intent)
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
                                        repository.updatePatientInfo(reader, reader, reportsRoot, patientId, firstName, lastName, dob, hospitalPatientId).fold(
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
                                        repository.moveReport(reader, reader, reportsRoot, reportId, fromPatientId, toPatientId).fold(
                                            onSuccess = { "Visit moved." },
                                            onFailure = { e -> "Failed to move visit: ${e.message}" },
                                        )
                                    }
                                }
                            },
                            onDeleteReport = { reportId ->
                                val root = dataRoot
                                scope.launch {
                                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                                    lastReindexSummary = if (reportsRoot == null) {
                                        "No \"Reports\" folder found — nothing to delete."
                                    } else {
                                        repository.deleteReport(reader, reader, reportsRoot, reportId).fold(
                                            onSuccess = { "Visit deleted." },
                                            onFailure = { e -> "Failed to delete visit: ${e.message}" },
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
                                        val result = repository.mergePatients(reader, reader, reportsRoot, keeperId, loserIds)
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
                                    val result = repository.moveOrphanedVisits(reader, reader, reportsRoot, reportIds)
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
                                    repository.upsertDeviceTypeAlias(reader, reader, root, manufacturer, model, type, java.time.Instant.now().toString())
                                }
                            },
                            onUpsertLeadTypeAlias = { manufacturer, model, attrs ->
                                val root = dataRoot
                                if (root == null) {
                                    Result.failure(IllegalStateException("No _DATA folder set."))
                                } else {
                                    repository.upsertLeadTypeAlias(reader, reader, root, manufacturer, model, attrs, java.time.Instant.now().toString())
                                }
                            },
                            onDeleteDeviceTypeAlias = { manufacturer, model, kind ->
                                val root = dataRoot
                                if (root == null) {
                                    Result.failure(IllegalStateException("No _DATA folder set."))
                                } else {
                                    repository.deleteDeviceTypeAlias(reader, reader, root, manufacturer, model, kind)
                                }
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
                                    qrDialogImage = renderQrCodeBitmap(payload).asImageBitmap()
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
                            isDeduping = isDeduping,
                            onDedupReports = {
                                val root = dataRoot
                                scope.launch {
                                    val reportsRoot = root?.let { resolveReportsRootHandle(reader, it) }
                                    if (reportsRoot == null) {
                                        lastReindexSummary = "No \"Reports\" folder found — nothing to deduplicate."
                                    } else {
                                        isDeduping = true
                                        val result = repository.dedupReports(reader, reader, reportsRoot)
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
                                        repository.updateReportDeviceAndLeads(reader, reader, reportsRoot, patientId, reportId, manufacturer, device, leads).fold(
                                            onSuccess = { "Device & leads updated." },
                                            onFailure = { e -> "Failed to update device & leads: ${e.message}" },
                                        )
                                    }
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
                        if (dataRoot != null) {
                            FloatingActionButton(
                                onClick = {
                                    if (hasCameraPermission) showScanner = true else permissionLauncher.launch(Manifest.permission.CAMERA)
                                },
                                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                            ) { Text("QR") }
                        }
                    }
                }
            }
        }
    }
}
