package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
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
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports

/**
 * Patient identity + reports (each expandable to its device/leads) — the
 * Phase 1 read-only detail screen. [onExportQr] is desktop-only (issue
 * #199 — Android only scans/imports a follow-up QR, it doesn't render one)
 * — pass null to hide the export action.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDetailScreen(
    repository: KardiSynchRepository,
    patientId: String,
    onBack: () -> Unit,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
) {
    val patient by produceStateOrNull { repository.getPatientById(patientId) }
    val reports by repository.observeReportsForPatient(patientId).collectAsState(initial = null)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(patient?.let { "${it.lastName}, ${it.firstName ?: ""}" } ?: "Patient") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        val currentReports = reports
        when {
            currentReports == null -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }

            currentReports.isEmpty() -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text("No visits on record for this patient.") }

            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(currentReports, key = { it.id }) { report -> ReportCard(repository, report, onExportQr) }
            }
        }
    }
}

@Composable
private fun ReportCard(
    repository: KardiSynchRepository,
    report: Reports,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
) {
    var devices by remember(report.id) { mutableStateOf<List<Devices>?>(null) }
    var leads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
    LaunchedEffect(report.id) {
        devices = repository.getDevicesForReport(report.id)
        leads = repository.getLeadsForReport(report.id)
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
