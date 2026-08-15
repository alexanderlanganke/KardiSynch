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
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog

/**
 * Patient identity + reports (each expandable to its device/leads) — the
 * Phase 1 read-only detail screen. [onExportQr] is desktop-only (issue
 * #199 — Android only scans/imports a follow-up QR, it doesn't render one)
 * — pass null to hide the export action. [onOpenUrl] is likewise
 * platform-specific (issue #175's "MRI check" link, opened in the system
 * browser) — pass null to hide that action too. [onEditPatientInfo]/
 * [onMoveReport] wire up backends that already existed (issue #177) but
 * had no UI before issue #178 — pass null to hide either action.
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
) {
    val patient by produceStateOrNull { repository.getPatientById(patientId) }
    val reports by repository.observeReportsForPatient(patientId).collectAsState(initial = null)
    var showEditDialog by remember { mutableStateOf(false) }

    if (showEditDialog && patient != null) {
        val current = patient!!
        PatientInfoEditDialog(
            initialFirstName = current.firstName.orEmpty(),
            initialLastName = current.lastName,
            initialDob = current.dob,
            initialHospitalPatientId = current.hospitalPatientId,
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
                title = { Text(patient?.let { "${it.lastName}, ${it.firstName ?: ""}" } ?: "Patient") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = {
                    if (onEditPatientInfo != null && patient != null) {
                        TextButton(onClick = { showEditDialog = true }) { Text("Edit") }
                    }
                },
            )
        },
    ) { padding ->
        val currentReports = reports
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // Read-only display of whatever's cached in patient.xml — this
            // app (KMP or the original Electron one) never computes this
            // itself, see core.mri.ManufacturerWarningStatus's doc comment.
            parseManufacturerWarningStatus(patient?.manufacturerWarningStatus)
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
                currentReports == null -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) { CircularProgressIndicator() }

                currentReports.isEmpty() -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) { Text("No visits on record for this patient.") }

                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(currentReports, key = { it.id }) { report ->
                        ReportCard(repository, report, patientId, onExportQr, onOpenUrl, onMoveReport)
                    }
                }
            }
        }
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

/** Minimal one-shot async loader — this module has no ViewModel layer yet, kept intentionally simple for the Phase 1 read screens. */
@Composable
private fun <T> produceStateOrNull(loader: suspend () -> T): androidx.compose.runtime.State<T?> {
    val state = remember { mutableStateOf<T?>(null) }
    LaunchedEffect(Unit) { state.value = loader() }
    return state
}
