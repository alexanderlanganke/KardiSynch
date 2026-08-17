package io.github.alexanderlanganke.kardisynch.ui.dashboard

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
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
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.warningUrgencyRank
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Patients

private const val NOTABLE_DAYS_SINCE_VISIT = 180

/** Matches the manufacturer set Electron's dashboard filter and Settings' automation cards both use. */
private val KNOWN_MANUFACTURERS = listOf("Medtronic", "Biotronik", "Abbott", "Boston Scientific", "Impulse Dynamics", "MicroPort")

/**
 * Patient list — search, filter, sort, and per-patient stats ported from
 * `PatientDashboard.tsx` (issues #197 and, for the advanced filter panel/
 * urgency sort/state persistence, the follow-up UI-parity plan's Phase 4).
 * Sort is exposed as a horizontally-scrollable row of clickable field chips
 * rather than literal clickable table-column headers (this screen is a
 * card list, not a grid) — same 7 sortable fields as the original,
 * including the warning-status urgency rank. [filterState]/[onFilterStateChange]
 * are hoisted to the app shell so this state survives navigating to Patient
 * Detail and back, mirroring Electron's `sessionStorage` persistence.
 *
 * [todayIso] (`YYYY-MM-DD`) drives the "N days ago" / notable-staleness
 * highlight — commonMain has no platform clock, so the platform layer
 * supplies it. Passing null hides that line entirely rather than guessing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDashboardScreen(
    repository: KardiSynchRepository,
    onOpenPatient: (String) -> Unit,
    onOpenSettings: () -> Unit,
    filterState: DashboardFilterState,
    onFilterStateChange: (DashboardFilterState) -> Unit,
    onOpenDeviceNews: (() -> Unit)? = null,
    onOpenPatientFolder: ((patientId: String) -> Unit)? = null,
    onOpenUrl: ((String) -> Unit)? = null,
    todayIso: String? = null,
    notificationCenter: (@Composable () -> Unit)? = null,
) {
    val patients by repository.observePatients().collectAsState(initial = null)
    var summaries by remember { mutableStateOf<List<PatientSummary>>(emptyList()) }
    var deviceInfo by remember { mutableStateOf<Map<String, KardiSynchRepository.PatientDeviceSummary>>(emptyMap()) }

    LaunchedEffect(patients) {
        if (patients != null) {
            summaries = repository.getPatientsWithSerials()
            deviceInfo = repository.getPatientsLatestDeviceInfo().associateBy { it.patientId }
        }
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
                    notificationCenter?.invoke()
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
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = filterState.query,
                            onValueChange = { onFilterStateChange(filterState.copy(query = it)) },
                            label = { Text("Search by name or hospital ID") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                        TextButton(onClick = { onFilterStateChange(filterState.copy(filterPanelExpanded = !filterState.filterPanelExpanded)) }) {
                            Text(if (filterState.filterPanelExpanded) "Hide filters" else "Filters")
                        }
                    }

                    if (filterState.filterPanelExpanded) {
                        Card(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                OutlinedTextField(
                                    value = filterState.dobFilter,
                                    onValueChange = { onFilterStateChange(filterState.copy(dobFilter = it)) },
                                    label = { Text("Date of birth (exact, YYYY-MM-DD)") },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                )
                                OutlinedTextField(
                                    value = filterState.patientIdFilter,
                                    onValueChange = { onFilterStateChange(filterState.copy(patientIdFilter = it)) },
                                    label = { Text("Patient ID (internal)") },
                                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                    singleLine = true,
                                )
                                OutlinedTextField(
                                    value = filterState.hospitalMrnFilter,
                                    onValueChange = { onFilterStateChange(filterState.copy(hospitalMrnFilter = it)) },
                                    label = { Text("Hospital MRN") },
                                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                    singleLine = true,
                                )
                                Text("Device manufacturer", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp))
                                Row(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    FilterChip(
                                        selected = filterState.manufacturerFilter == null,
                                        onClick = { onFilterStateChange(filterState.copy(manufacturerFilter = null)) },
                                        label = { Text("All") },
                                    )
                                    KNOWN_MANUFACTURERS.forEach { manufacturer ->
                                        FilterChip(
                                            selected = filterState.manufacturerFilter == manufacturer,
                                            onClick = { onFilterStateChange(filterState.copy(manufacturerFilter = manufacturer)) },
                                            label = { Text(manufacturer) },
                                        )
                                    }
                                }
                                TextButton(
                                    onClick = { onFilterStateChange(filterState.copy(dobFilter = "", patientIdFilter = "", hospitalMrnFilter = "", manufacturerFilter = null)) },
                                    modifier = Modifier.padding(top = 8.dp),
                                ) { Text("Clear filters") }
                            }
                        }
                    }

                    Row(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SortFieldChip("Name", DashboardSortField.NAME, filterState, onFilterStateChange)
                        SortFieldChip("DOB", DashboardSortField.DOB, filterState, onFilterStateChange)
                        SortFieldChip("Hospital ID", DashboardSortField.HOSPITAL_ID, filterState, onFilterStateChange)
                        SortFieldChip("Manufacturer", DashboardSortField.MANUFACTURER, filterState, onFilterStateChange)
                        SortFieldChip("Model", DashboardSortField.MODEL, filterState, onFilterStateChange)
                        SortFieldChip("Last visit", DashboardSortField.LAST_VISIT, filterState, onFilterStateChange)
                        SortFieldChip("Warning", DashboardSortField.WARNING_URGENCY, filterState, onFilterStateChange)
                    }
                }

                val bySummaryId = summaries.associateBy { it.id }
                val q = filterState.query.trim().lowercase()
                val filtered = current.filter { p ->
                    (q.isEmpty() ||
                        "${p.lastName} ${p.firstName.orEmpty()}".lowercase().contains(q) ||
                        p.hospitalPatientId?.lowercase()?.contains(q) == true) &&
                        (filterState.dobFilter.isBlank() || p.dob == filterState.dobFilter.trim()) &&
                        (filterState.patientIdFilter.isBlank() || p.id.contains(filterState.patientIdFilter.trim(), ignoreCase = true)) &&
                        (filterState.hospitalMrnFilter.isBlank() || p.hospitalPatientId?.contains(filterState.hospitalMrnFilter.trim(), ignoreCase = true) == true) &&
                        (filterState.manufacturerFilter == null || deviceInfo[p.id]?.manufacturer == filterState.manufacturerFilter)
                }
                val comparator: Comparator<Patients> = when (filterState.sortField) {
                    DashboardSortField.NAME -> compareBy({ it.lastName.lowercase() }, { it.firstName.orEmpty().lowercase() })
                    DashboardSortField.DOB -> compareBy { it.dob }
                    DashboardSortField.HOSPITAL_ID -> compareBy { it.hospitalPatientId.orEmpty().lowercase() }
                    DashboardSortField.MANUFACTURER -> compareBy { deviceInfo[it.id]?.manufacturer.orEmpty().lowercase() }
                    DashboardSortField.MODEL -> compareBy { deviceInfo[it.id]?.deviceModel.orEmpty().lowercase() }
                    DashboardSortField.LAST_VISIT -> compareBy { bySummaryId[it.id]?.lastReportDate.orEmpty() }
                    DashboardSortField.WARNING_URGENCY -> compareBy { warningUrgencyRank(it.manufacturerWarningStatus) }
                }
                val sorted = filtered.sortedWith(if (filterState.sortAscending) comparator else comparator.reversed())

                if (sorted.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { Text("No patients match the current search/filters.", style = MaterialTheme.typography.bodyMedium) }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(sorted, key = { it.id }) { patient ->
                            PatientRow(
                                patient = patient,
                                summary = bySummaryId[patient.id],
                                device = deviceInfo[patient.id],
                                todayIso = todayIso,
                                onClick = { onOpenPatient(patient.id) },
                                onOpenFolder = onOpenPatientFolder?.let { { it(patient.id) } },
                                onOpenUrl = onOpenUrl,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SortFieldChip(
    label: String,
    field: DashboardSortField,
    filterState: DashboardFilterState,
    onFilterStateChange: (DashboardFilterState) -> Unit,
) {
    val isActive = filterState.sortField == field
    FilterChip(
        selected = isActive,
        onClick = {
            onFilterStateChange(
                if (isActive) {
                    filterState.copy(sortAscending = !filterState.sortAscending)
                } else {
                    filterState.copy(sortField = field, sortAscending = true)
                },
            )
        },
        label = { Text(if (isActive) "$label ${if (filterState.sortAscending) "▲" else "▼"}" else label) },
    )
}

/**
 * One patient row — ported from `PatientDashboard.tsx`'s `renderPatientCard`
 * (its 7-column table layout, minus the manufacturer *logo image*: this
 * port has no SVG brand-logo assets, so a text/chip badge carries the same
 * information — device manufacturer, model, warning status, and an MRI
 * compatibility check, none of which rendered here before even though the
 * data (`device`) was already being loaded per-patient at the screen level).
 */
@Composable
private fun PatientRow(
    patient: Patients,
    summary: PatientSummary?,
    device: KardiSynchRepository.PatientDeviceSummary?,
    todayIso: String?,
    onClick: () -> Unit,
    onOpenFolder: (() -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
) {
    val warning = parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
        ?.takeIf { it.status != "safe" }
    val reportCount = summary?.reportCount ?: 0
    val lastReportDate = summary?.lastReportDate
    val daysSince = if (todayIso != null && lastReportDate != null) daysBetweenIsoDates(lastReportDate, todayIso) else null

    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        onClick = onClick,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("${patient.lastName}, ${patient.firstName ?: ""}", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "DOB: ${patient.dob}" + (patient.hospitalPatientId?.let { " · ID: $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (onOpenFolder != null) {
                    TextButton(onClick = onOpenFolder) { Text("Open Folder") }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AssistChip(
                    onClick = {},
                    label = { Text(device?.manufacturer ?: "Unknown manufacturer") },
                    colors = AssistChipDefaults.assistChipColors(),
                )
                Text(
                    device?.deviceModel ?: "Unknown model",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val statsLine = buildString {
                        append(if (reportCount == 1) "1 report" else "$reportCount reports")
                        if (daysSince != null) append(" · last visit ${daysSince}d ago") else if (lastReportDate == null) append(" · no visits on file")
                    }
                    Text(
                        statsLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (daysSince != null && daysSince > NOTABLE_DAYS_SINCE_VISIT) Color(0xFF9A6700) else Color.Unspecified,
                    )
                    if (onOpenUrl != null) {
                        mriCheckUrl(device?.manufacturer)?.let { url ->
                            TextButton(onClick = { onOpenUrl(url) }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                                Text("Check MRI", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
                if (warning != null) {
                    val label = when (warning.status) {
                        "recall" -> "⚠ Recall"
                        "advisory" -> "⚠ Advisory"
                        "manual_check" -> "? Manual check"
                        else -> "? Unknown"
                    }
                    AssistChip(
                        onClick = { warning.link?.let { onOpenUrl?.invoke(it) } },
                        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = if (warning.status == "recall" || warning.status == "advisory") {
                                MaterialTheme.colorScheme.errorContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                            labelColor = if (warning.status == "recall" || warning.status == "advisory") {
                                MaterialTheme.colorScheme.onErrorContainer
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        ),
                    )
                }
            }
        }
    }
}
