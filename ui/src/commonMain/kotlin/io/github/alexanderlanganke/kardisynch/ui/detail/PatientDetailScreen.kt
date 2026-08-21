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
import androidx.compose.material3.Scaffold
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
 * Patient identity, an expandable device/leads header, a two-pane report
 * viewer, and a horizontal visit timeline — ported from `PatientDetail.tsx`
 * (UI-parity follow-up; supersedes the earlier Phase 1 single-scrolling-list
 * layout). See [PatientHeaderSection], [TwoPaneViewer], and
 * [VisitTimelineRow]'s doc comments for the header/pane/timeline pieces and
 * their scope adaptations. [onExportQr] is desktop-only (issue #199 —
 * Android only scans/imports a follow-up QR, it doesn't render one) — pass
 * null to hide the export action. [onOpenUrl] is likewise platform-specific
 * (issue #175's "MRI check" link, opened in the system browser) — pass null
 * to hide that action too. [onEditPatientInfo]/[onMoveReport] wire up
 * backends that already existed (issue #177) but had no UI before issue
 * #178 — pass null to hide either action. [todayIso] drives the age chip
 * and "days since last visit" banner and (like the Dashboard's own use of
 * it, issue #197) is supplied by the platform layer since commonMain has no
 * clock — pass null to hide both.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDetailScreen(
    repository: KardiSynchRepository,
    patientId: String,
    onBack: () -> Unit,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
    onOpenUrl: ((String) -> Unit)? = null,
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

    val loadedPatient = (patientState as? DetailLoadState.Loaded)?.value

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(loadedPatient?.let { "${it.lastName}, ${it.firstName ?: ""}" } ?: "Patient") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val state = patientState) {
                is DetailLoadState.Loading -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) { CircularProgressIndicator() }

                is DetailLoadState.Failed -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text("Couldn't load this patient.", style = MaterialTheme.typography.titleMedium)
                    Text(state.error.message ?: "Unknown error", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { retryToken++ }) { Text("Retry") }
                }

                is DetailLoadState.Loaded -> {
                    val patient = state.value
                    if (patient == null) {
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) { Text("Patient not found.") }
                    } else {
                        PatientDetailContent(
                            repository = repository,
                            patient = patient,
                            reports = reports,
                            patientId = patientId,
                            todayIso = todayIso,
                            onExportQr = onExportQr,
                            onOpenUrl = onOpenUrl,
                            onMoveReport = onMoveReport,
                            onDeleteReport = onDeleteReport,
                            onEditReportDevicesAndLeads = onEditReportDevicesAndLeads,
                            onListDeviceTypeAliases = onListDeviceTypeAliases,
                            onEditPatientInfo = onEditPatientInfo,
                            onRescanVisit = onRescanVisit,
                            onGetVisitFiles = onGetVisitFiles,
                            onReadVisitFileBytes = onReadVisitFileBytes,
                            onReadVisitFileText = onReadVisitFileText,
                            onGetMergedAdditionalFields = onGetMergedAdditionalFields,
                        )
                    }
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
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
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

    // Two panes, defaulting to the two most recent visits side by side —
    // deliberately diverging from Electron's `PatientDetail.tsx` (both
    // panes there start on the pinned Summary pseudo-report) per explicit
    // request. Seeded once `reports` first loads for this patient (it's
    // null until the reactive query emits) and never re-seeded afterward,
    // so it doesn't fight whatever the user picks afterward. Falls back to
    // Summary in a pane if there's no second (or first) visit to show.
    var paneSelections by remember(patientId) { mutableStateOf<List<PaneSelection?>>(listOf(PaneSelection.Summary, PaneSelection.Summary)) }
    var paneSelectionsSeeded by remember(patientId) { mutableStateOf(false) }
    LaunchedEffect(patientId, reports) {
        if (!paneSelectionsSeeded && reports != null) {
            paneSelectionsSeeded = true
            val defaults = reports.take(2).map { PaneSelection.Visit(it.id) }
            paneSelections = listOf(defaults.getOrNull(0) ?: PaneSelection.Summary, defaults.getOrNull(1) ?: PaneSelection.Summary)
        }
    }
    var paneBounds by remember { mutableStateOf<List<Rect?>>(listOf(null, null)) }
    var draggedReport by remember { mutableStateOf<Reports?>(null) }
    var dragPositionInRoot by remember { mutableStateOf<Offset?>(null) }
    val dragOverPaneIndex = dragPositionInRoot?.let { pos -> paneBounds.indexOfFirst { it?.contains(pos) == true }.takeIf { it >= 0 } }

    fun assignToPane(index: Int, report: Reports) {
        paneSelections = paneSelections.toMutableList().also { it[index] = PaneSelection.Visit(report.id) }
    }

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
            DeviceLeadEditorDialog(
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

    Column(modifier = Modifier.fillMaxSize()) {
        PatientHeaderSection(
            patient = patient,
            reports = reports.orEmpty(),
            latestDevice = latestDevice,
            latestLeads = latestLeads,
            todayIso = todayIso,
            onOpenUrl = onOpenUrl,
            onEditPatientInfo = if (onEditPatientInfo != null) { { showEditPatientInfo = true } } else null,
            onEditDeviceAndLeads = if (onEditReportDevicesAndLeads != null) {
                { reports?.maxByOrNull { it.interrogationDate }?.let { editDeviceLeadsReport = it } }
            } else {
                null
            },
            onExportLatestVisitQr = if (onExportQr != null) {
                {
                    reports?.maxByOrNull { it.interrogationDate }?.let { latest ->
                        coroutineScope.launch {
                            val devices = repository.getDevicesForReport(latest.id)
                            val leads = repository.getLeadsForReport(latest.id)
                            onExportQr(latest, devices, leads)
                        }
                    }
                }
            } else {
                null
            },
            deviceTypeAliases = aliases,
        )

        rescanMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp)) }

        when {
            reports == null -> Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }

            reports.isEmpty() -> Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text("No visits on record for this patient.") }

            else -> {
                // Neither Modifier.weight(1f) NOR a bare Modifier.fillMaxSize()
                // reliably sizes this pane area in this exact position (a
                // Scaffold content slot, itself SubcomposeLayout-based,
                // several Columns/Boxes down) — both reproducibly measured to
                // zero size, while a hardcoded Modifier.height(300.dp) in the
                // very same spot rendered correctly. So: BoxWithConstraints
                // to read the real available height once, then apply it as
                // an explicit dp value everywhere below — the one sizing
                // strategy actually proven to work here.
                BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
                    val paneHeight = (maxHeight - TIMELINE_RESERVED_HEIGHT).coerceAtLeast(0.dp)
                    Column(modifier = Modifier.fillMaxSize()) {
                        Box(modifier = Modifier.height(paneHeight).fillMaxWidth()) {
                            TwoPaneViewer(
                                repository = repository,
                                reports = reports,
                                patientId = patientId,
                                paneSelections = paneSelections,
                                onPaneSelectionChange = { index, selection ->
                                    paneSelections = paneSelections.toMutableList().also { it[index] = selection }
                                },
                                dragOverPaneIndex = dragOverPaneIndex,
                                onPaneBoundsChanged = { index, rect -> paneBounds = paneBounds.toMutableList().also { it[index] = rect } },
                                onGetVisitFiles = onGetVisitFiles,
                                onReadVisitFileBytes = onReadVisitFileBytes,
                                onReadVisitFileText = onReadVisitFileText,
                                onGetMergedAdditionalFields = onGetMergedAdditionalFields,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }

                        VisitTimelineRow(
                        reports = reports,
                        patientId = patientId,
                        onVisitClick = { report ->
                            val emptyIndex = paneSelections.indexOfFirst { it == null }
                            assignToPane(if (emptyIndex >= 0) emptyIndex else 0, report)
                        },
                        onDragTo = { report, startPos -> draggedReport = report; dragPositionInRoot = startPos },
                        onDragMove = { delta -> dragPositionInRoot = (dragPositionInRoot ?: Offset.Zero) + delta },
                        onDragEnd = {
                            val pos = dragPositionInRoot
                            val report = draggedReport
                            if (pos != null && report != null) {
                                val target = paneBounds.indexOfFirst { it?.contains(pos) == true }
                                if (target >= 0) assignToPane(target, report)
                            }
                            draggedReport = null
                            dragPositionInRoot = null
                        },
                        onRescanVisit = if (onRescanVisit != null) { { report -> rescanningReportId = report.id; rescanMessage = null } } else null,
                        onMoveVisit = if (onMoveReport != null) { { report -> moveReport = report } } else null,
                        onDeleteVisit = if (onDeleteReport != null) { { report -> deleteConfirmReport = report } } else null,
                        onEditDeviceAndLeads = if (onEditReportDevicesAndLeads != null) { { report -> editDeviceLeadsReport = report } } else null,
                        onExportQr = onExportQr,
                        repository = repository,
                        onGetVisitFiles = onGetVisitFiles,
                        modifier = Modifier.height(TIMELINE_RESERVED_HEIGHT).fillMaxWidth(),
                    )
                    }
                }
            }
        }
    }
}

/** Header text row (~30dp) + the fixed-height LazyRow (130dp, see [VisitTimelineRow]) + a little breathing room. */
private val TIMELINE_RESERVED_HEIGHT = 172.dp

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
