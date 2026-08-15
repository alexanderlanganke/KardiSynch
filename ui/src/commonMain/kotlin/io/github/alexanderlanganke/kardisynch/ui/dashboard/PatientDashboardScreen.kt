package io.github.alexanderlanganke.kardisynch.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.matching.PatientSummary
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Patients

private const val NOTABLE_DAYS_SINCE_VISIT = 180

/**
 * Patient list — search, sort, and per-patient stats ported from
 * `PatientDashboard.tsx` (issue #197). Scoped down from the original:
 * search is by name/hospital ID only (the original's DOB/manufacturer
 * filter panel isn't ported — small, but a separate UI surface, deferred);
 * sort is a 2-way Name/Last-visit toggle rather than 7 clickable column
 * headers with a warning-status rank (the underlying data — every column
 * value — is all still shown per row, just not literally sortable by every
 * field); and search/sort state isn't persisted across navigation (the
 * original keeps it in `sessionStorage`) since this port has no
 * equivalent scoped storage yet — a real but minor UX regression, not a
 * missing capability.
 *
 * [todayIso] (`YYYY-MM-DD`) drives the "N days ago" / notable-staleness
 * highlight — commonMain has no platform clock, so the platform layer
 * supplies it (same pattern as [io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates]'s
 * other callers elsewhere in this port). Passing null hides that line
 * entirely rather than guessing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDashboardScreen(
    repository: KardiSynchRepository,
    onOpenPatient: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenDeviceNews: (() -> Unit)? = null,
    onOpenPatientFolder: ((patientId: String) -> Unit)? = null,
    todayIso: String? = null,
) {
    val patients by repository.observePatients().collectAsState(initial = null)
    var summaries by remember { mutableStateOf<List<PatientSummary>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var sortByLastVisit by remember { mutableStateOf(false) }

    LaunchedEffect(patients) {
        if (patients != null) summaries = repository.getPatientsWithSerials()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("KardiSynch") },
                actions = {
                    if (onOpenDeviceNews != null) {
                        TextButton(onClick = onOpenDeviceNews) { Text("Device News") }
                    }
                    TextButton(onClick = onOpenSettings) { Text("Settings") }
                },
            )
        },
    ) { padding ->
        val current = patients
        when {
            current == null -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }

            current.isEmpty() -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("No patients yet — set a _DATA root and reindex in Settings.", style = MaterialTheme.typography.bodyMedium)
            }

            else -> Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                Column(modifier = Modifier.fillMaxWidth().padding(12.dp, 8.dp)) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        label = { Text("Search by name or hospital ID") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !sortByLastVisit, onClick = { sortByLastVisit = false }, label = { Text("Sort: Name") })
                        FilterChip(selected = sortByLastVisit, onClick = { sortByLastVisit = true }, label = { Text("Sort: Last visit") })
                    }
                }

                val bySummaryId = summaries.associateBy { it.id }
                val q = query.trim().lowercase()
                val filtered = current.filter { p ->
                    q.isEmpty() ||
                        "${p.lastName} ${p.firstName.orEmpty()}".lowercase().contains(q) ||
                        p.hospitalPatientId?.lowercase()?.contains(q) == true
                }
                val sorted = if (sortByLastVisit) {
                    filtered.sortedByDescending { bySummaryId[it.id]?.lastReportDate.orEmpty() }
                } else {
                    filtered.sortedWith(compareBy({ it.lastName.lowercase() }, { it.firstName.orEmpty().lowercase() }))
                }

                if (sorted.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { Text("No patients match \"$query\".", style = MaterialTheme.typography.bodyMedium) }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(sorted, key = { it.id }) { patient ->
                            PatientRow(
                                patient = patient,
                                summary = bySummaryId[patient.id],
                                todayIso = todayIso,
                                onClick = { onOpenPatient(patient.id) },
                                onOpenFolder = onOpenPatientFolder?.let { { it(patient.id) } },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PatientRow(
    patient: Patients,
    summary: PatientSummary?,
    todayIso: String?,
    onClick: () -> Unit,
    onOpenFolder: (() -> Unit)?,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        onClick = onClick,
    ) {
        Row(modifier = Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("${patient.lastName}, ${patient.firstName ?: ""}", style = MaterialTheme.typography.titleMedium)
                Text("DOB: ${patient.dob}", style = MaterialTheme.typography.bodySmall)

                val reportCount = summary?.reportCount ?: 0
                val lastReportDate = summary?.lastReportDate
                val daysSince = if (todayIso != null && lastReportDate != null) daysBetweenIsoDates(lastReportDate, todayIso) else null
                val statsLine = buildString {
                    append(if (reportCount == 1) "1 report" else "$reportCount reports")
                    if (daysSince != null) append(" · last visit ${daysSince}d ago") else if (lastReportDate == null) append(" · no visits on file")
                }
                Text(
                    statsLine,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (daysSince != null && daysSince > NOTABLE_DAYS_SINCE_VISIT) Color(0xFF9A6700) else Color.Unspecified,
                )

                // Read-only display of whatever's cached in patient.xml — see
                // core.mri.ManufacturerWarningStatus's doc comment (issue #175).
                parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
                    ?.takeIf { it.status == "advisory" || it.status == "recall" }
                    ?.let { warning ->
                        Text(
                            if (warning.status == "recall") "Manufacturer recall posted" else "Manufacturer advisory posted",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFB3261E),
                        )
                    }
            }
            if (onOpenFolder != null) {
                TextButton(onClick = onOpenFolder) { Text("Open Folder") }
            }
        }
    }
}
