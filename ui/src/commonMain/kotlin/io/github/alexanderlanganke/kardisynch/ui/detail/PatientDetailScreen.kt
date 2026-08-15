package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.util.ageInYears
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog

private sealed interface DetailLoadState<out T> {
    data object Loading : DetailLoadState<Nothing>
    data class Loaded<T>(val value: T) : DetailLoadState<T>
    data class Failed(val error: Throwable) : DetailLoadState<Nothing>
}

/**
 * Patient identity + reports (each expandable to its device/leads) — the
 * Phase 1 read-only detail screen. [onExportQr] is desktop-only (issue
 * #199 — Android only scans/imports a follow-up QR, it doesn't render one)
 * — pass null to hide the export action. [onOpenUrl] is likewise
 * platform-specific (issue #175's "MRI check" link, opened in the system
 * browser) — pass null to hide that action too. [onEditPatientInfo]/
 * [onMoveReport] wire up backends that already existed (issue #177) but
 * had no UI before issue #178 — pass null to hide either action. [todayIso]
 * drives the age chip and (like the Dashboard's own use of it, issue #197)
 * is supplied by the platform layer since commonMain has no clock — pass
 * null to hide the age chip.
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
) {
    var retryToken by remember(patientId) { mutableStateOf(0) }
    val patientState = rememberLoadState(key = patientId to retryToken) { repository.getPatientById(patientId) }
    val reports by repository.observeReportsForPatient(patientId).collectAsState(initial = null)
    var showEditDialog by remember { mutableStateOf(false) }

    val loadedPatient = (patientState as? DetailLoadState.Loaded)?.value

    if (showEditDialog && loadedPatient != null) {
        PatientInfoEditDialog(
            initialFirstName = loadedPatient.firstName.orEmpty(),
            initialLastName = loadedPatient.lastName,
            initialDob = loadedPatient.dob,
            initialHospitalPatientId = loadedPatient.hospitalPatientId,
            onDismiss = { showEditDialog = false },
            onSave = { firstName, lastName, dob, hospitalPatientId ->
                showEditDialog = false
                onEditPatientInfo?.invoke(firstName, lastName, dob, hospitalPatientId)
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(loadedPatient?.let { "${it.lastName}, ${it.firstName ?: ""}" } ?: "Patient") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = {
                    if (onEditPatientInfo != null && loadedPatient != null) {
                        TextButton(onClick = { showEditDialog = true }) { Text("Edit") }
                    }
                },
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
) {
    // Read-only display of whatever's cached in patient.xml — this app
    // (KMP or the original Electron one) never computes this itself, see
    // core.mri.ManufacturerWarningStatus's doc comment.
    parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
        ?.takeIf { it.status == "advisory" || it.status == "recall" }
        ?.let { warning ->
            Card(
                modifier = Modifier.fillMaxWidth().padding(12.dp, 8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        if (warning.status == "recall") "Manufacturer recall posted" else "Manufacturer advisory posted",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    if (warning.details.isNotBlank()) Text(warning.details, style = MaterialTheme.typography.bodySmall)
                    val warningLink = warning.link
                    if (warningLink != null && onOpenUrl != null) {
                        TextButton(onClick = { onOpenUrl(warningLink) }) { Text("View details") }
                    }
                }
            }
        }

    when {
        reports == null -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) { CircularProgressIndicator() }

        reports.isEmpty() -> {
            PatientSummaryChip(patient, reports, todayIso)
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text("No visits on record for this patient.") }
        }

        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            item { PatientSummaryChip(patient, reports, todayIso) }
            item {
                val trendPoints = reports
                    .filter { it.batteryVoltageValue != null }
                    .sortedBy { it.interrogationDate }
                    .map { BatteryTrendPoint(it.interrogationDate, it.batteryVoltageValue!!, it.deviceSerialNumber) }
                BatteryTrendChart(trendPoints)
            }
            items(reports, key = { it.id }) { report ->
                ReportCard(repository, report, patientId, onExportQr, onOpenUrl, onMoveReport)
            }
        }
    }
}

@Composable
private fun PatientSummaryChip(patient: Patients, reports: List<Reports>, todayIso: String?) {
    val mostRecent = reports.maxByOrNull { it.interrogationDate }
    val age = todayIso?.let { ageInYears(patient.dob, it) }
    val bits = listOfNotNull(
        age?.let { "$it y" },
        "${reports.size} visit${if (reports.size == 1) "" else "s"}",
        mostRecent?.let { "${it.deviceModel ?: "Unknown device"} (${it.deviceSerialNumber ?: "?"})" },
    )
    if (bits.isNotEmpty()) {
        Text(bits.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    }
}

@Composable
private fun ReportCard(
    repository: KardiSynchRepository,
    report: Reports,
    currentPatientId: String,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)?,
) {
    var devices by remember(report.id) { mutableStateOf<List<Devices>?>(null) }
    var leads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
    var showMovePicker by remember(report.id) { mutableStateOf(false) }
    LaunchedEffect(report.id) {
        devices = repository.getDevicesForReport(report.id)
        leads = repository.getLeadsForReport(report.id)
    }

    if (showMovePicker && onMoveReport != null) {
        PatientPickerDialog(
            repository = repository,
            title = "Move this visit to which patient?",
            onDismiss = { showMovePicker = false },
            onPicked = { targetPatientId ->
                showMovePicker = false
                onMoveReport(report.id, currentPatientId, targetPatientId)
            },
        )
    }

    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(report.interrogationDate, style = MaterialTheme.typography.titleMedium)
            Text("${report.manufacturer ?: "Unknown"} · ${report.deviceModel ?: "Unknown"}", style = MaterialTheme.typography.bodyMedium)
            devices?.forEach { d ->
                Text("Device: ${d.model} (${d.serialNumber}) — ${d.type}", style = MaterialTheme.typography.bodySmall)
            }
            leads?.forEach { l ->
                val bits = listOfNotNull(
                    l.anatomicLocation,
                    l.impedanceValue?.let { "Imp ${it}${l.impedanceUnit ?: ""}" },
                    l.sensingValue?.let { "Sens ${it}${l.sensingUnit ?: ""}" },
                    l.pacingThresholdValue?.let { "Thresh ${it}${l.pacingThresholdUnit ?: ""}" },
                ).joinToString(" · ")
                Text("Lead ${l.name}: $bits", style = MaterialTheme.typography.bodySmall)
            }
            if (onExportQr != null) {
                TextButton(onClick = { onExportQr(report, devices ?: emptyList(), leads ?: emptyList()) }) {
                    Text("Export QR")
                }
            }
            if (onOpenUrl != null) {
                mriCheckUrl(report.manufacturer)?.let { url ->
                    TextButton(onClick = { onOpenUrl(url) }) { Text("Check MRI compatibility") }
                }
            }
            if (onMoveReport != null) {
                TextButton(onClick = { showMovePicker = true }) { Text("Move to another patient") }
            }
        }
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
