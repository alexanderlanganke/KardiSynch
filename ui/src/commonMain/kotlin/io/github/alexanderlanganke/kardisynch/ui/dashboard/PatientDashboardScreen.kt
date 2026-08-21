package io.github.alexanderlanganke.kardisynch.ui.dashboard

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GppBad
import androidx.compose.material.icons.filled.GppGood
import androidx.compose.material.icons.filled.GppMaybe
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.matching.PatientSummary
import io.github.alexanderlanganke.kardisynch.core.mri.ManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.warningUrgencyRank
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import kotlinx.coroutines.launch

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
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
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
                                repository = repository,
                                patient = patient,
                                summary = bySummaryId[patient.id],
                                device = deviceInfo[patient.id],
                                todayIso = todayIso,
                                onClick = { onOpenPatient(patient.id) },
                                onOpenFolder = onOpenPatientFolder?.let { { it(patient.id) } },
                                onOpenUrl = onOpenUrl,
                                onExportQr = onExportQr,
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
    repository: KardiSynchRepository,
    patient: Patients,
    summary: PatientSummary?,
    device: KardiSynchRepository.PatientDeviceSummary?,
    todayIso: String?,
    onClick: () -> Unit,
    onOpenFolder: (() -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
) {
    val warning = parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
    val reportCount = summary?.reportCount ?: 0
    val lastReportDate = summary?.lastReportDate
    val daysSince = if (todayIso != null && lastReportDate != null) daysBetweenIsoDates(lastReportDate, todayIso) else null
    val coroutineScope = rememberCoroutineScope()

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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (onExportQr != null) {
                        IconButton(onClick = {
                            coroutineScope.launch {
                                val latest = repository.getLatestReportForPatient(patient.id) ?: return@launch
                                val devices = repository.getDevicesForReport(latest.id)
                                val leads = repository.getLeadsForReport(latest.id)
                                onExportQr(latest, devices, leads)
                            }
                        }) {
                            Icon(Icons.Filled.QrCode, contentDescription = "Export QR")
                        }
                    }
                    if (onOpenFolder != null) {
                        TextButton(onClick = onOpenFolder) { Text("Open Folder") }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val brand = manufacturerBrand(device?.manufacturer)
                Text(
                    brand?.label ?: device?.manufacturer ?: "Unknown manufacturer",
                    style = MaterialTheme.typography.titleSmall,
                    color = brand?.color ?: MaterialTheme.colorScheme.onSurfaceVariant,
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
                    WarningShieldIcon(warning, onOpenUrl)
                }
            }
        }
    }
}

/**
 * The shield icon from `PatientDashboard.tsx`'s `WarningBadge` (issue #197):
 * green "GppGood" for safe, red "GppBad" (pulsing) for advisory/recall,
 * gray "GppMaybe" for manual_check or any other/unrecognized status value —
 * clicking opens [warning]'s advisory link, same as the original.
 */
@Composable
private fun WarningShieldIcon(warning: ManufacturerWarningStatus, onOpenUrl: ((String) -> Unit)?) {
    val (icon, tint) = when (warning.status) {
        "safe" -> Icons.Filled.GppGood to Color(0xFF2E7D32)
        "recall", "advisory" -> Icons.Filled.GppBad to MaterialTheme.colorScheme.error
        else -> Icons.Filled.GppMaybe to MaterialTheme.colorScheme.onSurfaceVariant
    }
    val pulse = warning.status == "recall" || warning.status == "advisory"
    val alpha = if (pulse) {
        val transition = rememberInfiniteTransition(label = "warning-shield-pulse")
        val value by transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.4f,
            animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse),
            label = "warning-shield-pulse-alpha",
        )
        value
    } else {
        1f
    }
    IconButton(
        onClick = { warning.link?.let { onOpenUrl?.invoke(it) } },
        modifier = Modifier.size(32.dp),
    ) {
        Icon(icon, contentDescription = warning.status, tint = tint, modifier = Modifier.alpha(alpha))
    }
}

private data class ManufacturerBrand(val label: String, val color: Color)

/**
 * The manufacturer "logo" column from `PatientDashboard.tsx`'s
 * `MANUFACTURER_LOGOS` (issue #197). Those assets (`assets/logos`, one SVG
 * file per manufacturer) are placeholder text-on-color SVGs, not real
 * trademarked artwork — a
 * `<text fill="#004B87">Medtronic</text>`, not a logo image — so this
 * reproduces the same visual (brand-colored name) directly as styled
 * `Text` rather than standing up a Compose Resources/SVG pipeline to
 * render seven files that are text already. Matched the same way the
 * original's `getManufacturerLogo` did: case-insensitive substring
 * match against the parsed manufacturer string, first match wins.
 */
private val MANUFACTURER_BRANDS: List<Pair<String, ManufacturerBrand>> = listOf(
    "Medtronic" to ManufacturerBrand("Medtronic", Color(0xFF004B87)),
    "Biotronik" to ManufacturerBrand("BIOTRONIK", Color(0xFF5F212D)),
    "Abbott" to ManufacturerBrand("Abbott", Color(0xFF000000)),
    "Boston Scientific" to ManufacturerBrand("Boston Scientific", Color(0xFF003C71)),
    "Impulse Dynamics" to ManufacturerBrand("IMPULSE DYNAMICS", Color(0xFF333333)),
    "Microport" to ManufacturerBrand("MicroPort", Color(0xFF0099CC)),
)

private fun manufacturerBrand(name: String?): ManufacturerBrand? {
    if (name.isNullOrBlank()) return null
    val lower = name.lowercase()
    return MANUFACTURER_BRANDS.firstOrNull { (key, _) -> lower.contains(key.lowercase()) }?.second
}
