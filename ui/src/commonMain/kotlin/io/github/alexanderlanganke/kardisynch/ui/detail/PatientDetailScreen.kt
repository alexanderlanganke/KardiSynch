package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog
import kotlinx.coroutines.launch

private sealed interface DetailLoadState<out T> {
    data object Loading : DetailLoadState<Nothing>
    data class Loaded<T>(val value: T) : DetailLoadState<T>
    data class Failed(val error: Throwable) : DetailLoadState<Nothing>
}

/**
 * One patient: the overview page (identity, battery alert, trends, leads, visits)
 * or, when [visitId] is set, one visit on its own page with Formatted, Raw file
 * and PDF views and an optional split pane. Both share the edit, move, delete and
 * rescan dialogs. [onExportQr] is desktop-only (Android only scans a follow-up
 * QR), [onOpenUrl] opens the manufacturer MRI/advisory links in the system
 * browser; pass null to hide either action. [todayIso] drives the age and the
 * overdue banner and comes from the platform layer, which has the clock.
 */
@Composable
fun PatientDetailScreen(
    repository: KardiSynchRepository,
    patientId: String,
    onBack: (() -> Unit)?,
    visitId: String? = null,
    onOpenVisit: (reportId: String) -> Unit = {},
    onCloseVisit: () -> Unit = {},
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
    onOpenUrl: ((String) -> Unit)? = null,
    onOpenPatientFolder: (() -> Unit)? = null,
    onEditPatientInfo: ((firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)? = null,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)? = null,
    todayIso: String? = null,
    onDeleteReport: ((reportId: String) -> Unit)? = null,
    onEditReportDevicesAndLeads: ((reportId: String, patientId: String, manufacturer: String, device: DeviceInfo, leads: List<LeadData>) -> Unit)? = null,
    onListDeviceTypeAliases: (suspend () -> List<DeviceTypeAlias>)? = null,
    onRescanVisit: (suspend (patientId: String, reportId: String) -> UnifiedReport?)? = null,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)? = null,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)? = null,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)? = null,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)? = null,
) {
    var retryToken by remember(patientId) { mutableStateOf(0) }
    val patientState = rememberLoadState(key = patientId to retryToken) { repository.getPatientById(patientId) }
    val reports by repository.observeReportsForPatient(patientId).collectAsState(initial = null)

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val state = patientState) {
            is DetailLoadState.Loading -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }

            is DetailLoadState.Failed -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("Couldn't load this patient.", style = MaterialTheme.typography.titleMedium)
                Text(state.error.message ?: "Unknown error", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { retryToken++ }) { Text("Retry") }
            }

            is DetailLoadState.Loaded -> {
                // Follow the live row so an edit (or a rescan merge) shows up in the header and in the next edit form.
                val livePatients by repository.observePatients().collectAsState(initial = null)
                val patient = livePatients?.firstOrNull { it.id == patientId } ?: state.value
                if (patient == null) {
                    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { Text("Patient not found.") }
                } else {
                    PatientDetailContent(
                        repository = repository, patient = patient, reports = reports, patientId = patientId, todayIso = todayIso,
                        onBack = onBack, visitId = visitId, onOpenVisit = onOpenVisit, onCloseVisit = onCloseVisit,
                        onExportQr = onExportQr, onOpenUrl = onOpenUrl, onOpenPatientFolder = onOpenPatientFolder, onMoveReport = onMoveReport, onDeleteReport = onDeleteReport,
                        onEditReportDevicesAndLeads = onEditReportDevicesAndLeads, onListDeviceTypeAliases = onListDeviceTypeAliases,
                        onEditPatientInfo = onEditPatientInfo, onRescanVisit = onRescanVisit, onGetVisitFiles = onGetVisitFiles,
                        onReadVisitFileBytes = onReadVisitFileBytes, onReadVisitFileText = onReadVisitFileText,
                        onGetMergedAdditionalFields = onGetMergedAdditionalFields,
                    )
                }
            }
        }
    }
}

@Composable
private fun PatientDetailContent(
    repository: KardiSynchRepository,
    patient: Patients,
    reports: List<Reports>?,
    patientId: String,
    todayIso: String?,
    onBack: (() -> Unit)?,
    visitId: String?,
    onOpenVisit: (reportId: String) -> Unit,
    onCloseVisit: () -> Unit,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
    onOpenPatientFolder: (() -> Unit)?,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)?,
    onDeleteReport: ((reportId: String) -> Unit)?,
    onEditReportDevicesAndLeads: ((reportId: String, patientId: String, manufacturer: String, device: DeviceInfo, leads: List<LeadData>) -> Unit)?,
    onListDeviceTypeAliases: (suspend () -> List<DeviceTypeAlias>)?,
    onEditPatientInfo: ((firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)?,
    onRescanVisit: (suspend (patientId: String, reportId: String) -> UnifiedReport?)?,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
) {
    val coroutineScope = rememberCoroutineScope()

    // Bumped after any device/lead edit or rescan-merge so the header and
    // whichever pane(s) show the affected visit reload — those edits land
    // on the Devices/Leads tables (and sometimes the Reports row's
    // denormalized device columns), which a plain `LaunchedEffect(report.id)`
    // wouldn't notice since the id itself never changes.
    var reloadKey by remember(patientId) { mutableStateOf(0) }

    var latestDevice by remember(patientId) { mutableStateOf<Devices?>(null) }
    var latestLeads by remember(patientId) { mutableStateOf<List<Leads>?>(null) }
    LaunchedEffect(patientId, reloadKey) {
        val device = repository.getLatestDeviceForPatient(patientId)
        latestDevice = device
        latestLeads = device?.let { repository.getLeadsForReport(it.reportId) }
    }

    var showEditPatientInfo by remember { mutableStateOf(false) }
    var editDeviceLeadsReport by remember { mutableStateOf<Reports?>(null) }
    var moveReport by remember { mutableStateOf<Reports?>(null) }
    var deleteConfirmReport by remember { mutableStateOf<Reports?>(null) }
    var aliases by remember { mutableStateOf<List<DeviceTypeAlias>>(emptyList()) }
    var rescanningReportId by remember { mutableStateOf<String?>(null) }
    var rescanTargetReportId by remember { mutableStateOf<String?>(null) }
    var rescanResult by remember { mutableStateOf<UnifiedReport?>(null) }
    var rescanMessage by remember { mutableStateOf<String?>(null) }

    if (showEditPatientInfo && onEditPatientInfo != null) {
        PatientInfoEditDialog(
            initialFirstName = patient.firstName.orEmpty(),
            initialLastName = patient.lastName,
            initialDob = patient.dob,
            initialHospitalPatientId = patient.hospitalPatientId,
            onDismiss = { showEditPatientInfo = false },
            onSave = { firstName, lastName, dob, hospitalPatientId ->
                showEditPatientInfo = false
                onEditPatientInfo(firstName, lastName, dob, hospitalPatientId)
            },
        )
    }

    editDeviceLeadsReport?.let { report ->
        if (onEditReportDevicesAndLeads != null) {
            var devices by remember(report.id) { mutableStateOf<List<Devices>?>(null) }
            var leads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
            LaunchedEffect(report.id) {
                devices = repository.getDevicesForReport(report.id)
                leads = repository.getLeadsForReport(report.id)
                aliases = onListDeviceTypeAliases?.invoke() ?: emptyList()
            }
            // The form copies its starting values once, so it must not open before the saved device and
            // leads have loaded: it would show empty fields that don't match what is on file.
            if (devices != null && leads != null) DeviceLeadEditorDialog(
                manufacturer = report.manufacturer.orEmpty(),
                device = devices?.firstOrNull(),
                leads = leads.orEmpty(),
                aliases = aliases,
                onDismiss = { editDeviceLeadsReport = null },
                onSave = { manufacturer, device, editedLeads ->
                    editDeviceLeadsReport = null
                    onEditReportDevicesAndLeads(report.id, patientId, manufacturer, device, editedLeads)
                    reloadKey++
                },
            )
        }
    }

    moveReport?.let { report ->
        if (onMoveReport != null) {
            PatientPickerDialog(
                repository = repository,
                title = "Move this visit to which patient?",
                onDismiss = { moveReport = null },
                onPicked = { targetPatientId ->
                    moveReport = null
                    onMoveReport(report.id, patientId, targetPatientId)
                },
            )
        }
    }

    deleteConfirmReport?.let { report ->
        if (onDeleteReport != null) {
            AlertDialog(
                onDismissRequest = { deleteConfirmReport = null },
                title = { Text("Delete this visit?") },
                text = { Text("Removes the ${isoDateOnly(report.interrogationDate)} visit and its files. This can't be undone.") },
                confirmButton = {
                    TextButton(onClick = { deleteConfirmReport = null; onDeleteReport(report.id) }) { Text("Delete") }
                },
                dismissButton = {
                    TextButton(onClick = { deleteConfirmReport = null }) { Text("Cancel") }
                },
            )
        }
    }

    rescanResult?.let { scanned ->
        val targetReportId = rescanTargetReportId
        if (targetReportId != null) {
            var devices by remember(targetReportId) { mutableStateOf<List<Devices>?>(null) }
            var leads by remember(targetReportId) { mutableStateOf<List<Leads>?>(null) }
            LaunchedEffect(targetReportId) {
                devices = repository.getDevicesForReport(targetReportId)
                leads = repository.getLeadsForReport(targetReportId)
            }
            RescanDiffDialog(
                currentPatient = patient,
                currentDevices = devices.orEmpty(),
                currentLeads = leads.orEmpty(),
                scanned = scanned,
                onDismiss = { rescanResult = null; rescanTargetReportId = null },
                onConfirm = { applyDemographics, applyDeviceLeads ->
                    if (applyDemographics) {
                        onEditPatientInfo?.invoke(scanned.patient.firstName, scanned.patient.lastName, scanned.patient.dob, scanned.patient.hospitalPatientId)
                    }
                    if (applyDeviceLeads) {
                        onEditReportDevicesAndLeads?.invoke(targetReportId, patientId, scanned.manufacturer, scanned.device, scanned.leads)
                    }
                    rescanResult = null
                    rescanTargetReportId = null
                    reloadKey++
                },
            )
        }
    }

    val rescanningId = rescanningReportId
    if (rescanningId != null && onRescanVisit != null) {
        LaunchedEffect(rescanningId) {
            val scanned = onRescanVisit(patientId, rescanningId)
            rescanningReportId = null
            if (scanned == null) {
                rescanMessage = "No parseable files found in this visit's folder."
            } else {
                rescanTargetReportId = rescanningId
                rescanResult = scanned
            }
        }
    }

    fun exportQr(report: Reports) {
        val export = onExportQr ?: return
        coroutineScope.launch { export(report, repository.getDevicesForReport(report.id), repository.getLeadsForReport(report.id)) }
    }

    val list = reports
    val openReport = visitId?.let { id -> list?.firstOrNull { it.id == id } }
    when {
        list == null -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }

        openReport != null -> VisitView(
            repository = repository, reports = list, patientId = patientId, patientName = "${patient.lastName}, ${patient.firstName.orEmpty()}".trim().trimEnd(','), report = openReport, onBack = onCloseVisit,
            onRescan = if (onRescanVisit != null) { r -> rescanningReportId = r.id; rescanMessage = null } else null,
            onMove = if (onMoveReport != null) { r -> moveReport = r } else null,
            onDelete = if (onDeleteReport != null) { r -> deleteConfirmReport = r } else null,
            onEditDevice = if (onEditReportDevicesAndLeads != null) { r -> editDeviceLeadsReport = r } else null,
            onQr = if (onExportQr != null) { r -> exportQr(r) } else null,
            onGetVisitFiles = onGetVisitFiles, onReadVisitFileBytes = onReadVisitFileBytes, onReadVisitFileText = onReadVisitFileText,
        )

        else -> PatientOverview(
            repository = repository, patient = patient, reports = list, patientId = patientId,
            latestDevice = latestDevice, latestLeads = latestLeads, deviceTypeAliases = aliases, todayIso = todayIso, reloadKey = reloadKey,
            onBack = onBack, onOpenVisit = { onOpenVisit(it.id) }, onOpenUrl = onOpenUrl, onOpenPatientFolder = onOpenPatientFolder,
            onEditPatientInfo = if (onEditPatientInfo != null) { { showEditPatientInfo = true } } else null,
            onEditDeviceAndLeads = if (onEditReportDevicesAndLeads != null) { r -> (r ?: list.maxByOrNull { it.interrogationDate })?.let { editDeviceLeadsReport = it } } else null,
            onExportLatestVisitQr = if (onExportQr != null) { { list.maxByOrNull { it.interrogationDate }?.let { exportQr(it) } } } else null,
            onRescanVisit = if (onRescanVisit != null) { r -> rescanningReportId = r.id; rescanMessage = null } else null,
            onMoveVisit = if (onMoveReport != null) { r -> moveReport = r } else null,
            onDeleteVisit = if (onDeleteReport != null) { r -> deleteConfirmReport = r } else null,
            onExportVisitQr = if (onExportQr != null) { r -> exportQr(r) } else null,
            onRescanMessage = rescanMessage, onGetVisitFiles = onGetVisitFiles, onGetMergedAdditionalFields = onGetMergedAdditionalFields,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * One-shot async loader distinguishing loading/loaded/failed — this module
 * has no ViewModel layer yet, kept intentionally simple for the Phase 1
 * read screens. Change [key] (e.g. an incrementing retry counter) to
 * re-run [loader].
 */
@Composable
private fun <T> rememberLoadState(key: Any?, loader: suspend () -> T): DetailLoadState<T> {
    var state by remember(key) { mutableStateOf<DetailLoadState<T>>(DetailLoadState.Loading) }
    LaunchedEffect(key) {
        state = try {
            DetailLoadState.Loaded(loader())
        } catch (e: Exception) {
            DetailLoadState.Failed(e)
        }
    }
    return state
}
