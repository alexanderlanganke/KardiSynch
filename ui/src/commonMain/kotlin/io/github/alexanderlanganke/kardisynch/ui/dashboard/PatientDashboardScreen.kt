package io.github.alexanderlanganke.kardisynch.ui.dashboard

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import io.github.alexanderlanganke.kardisynch.core.i18n.trn
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.matching.PatientSummary
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.warningUrgencyRank
import io.github.alexanderlanganke.kardisynch.core.util.AttentionReason
import io.github.alexanderlanganke.kardisynch.core.util.PatientAttention
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.core.util.patientAttention
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.ManufacturerWordmark
import io.github.alexanderlanganke.kardisynch.ui.theme.manufacturerDot
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors
import kotlinx.coroutines.launch

/** Matches the manufacturer set Electron's dashboard filter and Settings' automation cards both use. */
private val KNOWN_MANUFACTURERS = listOf("Medtronic", "Biotronik", "Abbott", "Boston Scientific", "Impulse Dynamics", "MicroPort")

private data class RowData(
    val patient: Patients,
    val summary: PatientSummary?,
    val device: KardiSynchRepository.PatientDeviceSummary?,
    val attention: PatientAttention,
    val daysSince: Int?,
)

/**
 * Patient list. A "needs attention" strip (advisories, batteries at ERI,
 * overdue follow-ups) sits above filter chips and the list; each row shows its
 * status as an icon AND a word, never colour alone. [filterState] is hoisted to
 * the app shell so it survives opening a patient and coming back. The top-level
 * navigation (Inbox, Device news, Settings) lives in the shell, not here.
 *
 * [todayIso] (`YYYY-MM-DD`) drives "days since last visit" and the overdue
 * flag — commonMain has no platform clock, so the platform layer supplies it;
 * null hides both rather than guessing. [selectedPatientId] highlights the open
 * patient in the two-pane desktop layout.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDashboardScreen(
    repository: KardiSynchRepository,
    onOpenPatient: (String) -> Unit,
    filterState: DashboardFilterState,
    onFilterStateChange: (DashboardFilterState) -> Unit,
    selectedPatientId: String? = null,
    onOpenPatientFolder: ((patientId: String) -> Unit)? = null,
    onOpenUrl: ((String) -> Unit)? = null,
    todayIso: String? = null,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
) {
    val patients by repository.observePatients().collectAsState(initial = null)
    var summaries by remember { mutableStateOf<List<PatientSummary>>(emptyList()) }
    var deviceInfo by remember { mutableStateOf<Map<String, KardiSynchRepository.PatientDeviceSummary>>(emptyMap()) }
    var sortMenuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(patients) {
        if (patients != null) {
            summaries = repository.getPatientsWithSerials()
            deviceInfo = repository.getPatientsLatestDeviceInfo().associateBy { it.patientId }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tr("Patients")) },
                actions = {
                    Box {
                        IconButton(onClick = { sortMenuOpen = true }) { Icon(Icons.Filled.Sort, contentDescription = tr("Sort patients")) }
                        DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                            sortOptions().forEach { (label, field) ->
                                val active = filterState.sortField == field
                                DropdownMenuItem(
                                    text = { Text(if (active) "$label ${if (filterState.sortAscending) "▲" else "▼"}" else label) },
                                    onClick = {
                                        sortMenuOpen = false
                                        onFilterStateChange(
                                            if (active) filterState.copy(sortAscending = !filterState.sortAscending)
                                            else filterState.copy(sortField = field, sortAscending = true),
                                        )
                                    },
                                )
                            }
                        }
                    }
                    IconButton(onClick = { onFilterStateChange(filterState.copy(filterPanelExpanded = !filterState.filterPanelExpanded)) }) {
                        Icon(Icons.Filled.Tune, contentDescription = if (filterState.filterPanelExpanded) tr("Hide filters") else tr("Show filters"))
                    }
                },
            )
        },
    ) { padding ->
        val current = patients
        when {
            current == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

            current.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding).padding(24.dp), contentAlignment = Alignment.Center) {
                Text(tr("No patients yet. Set a _DATA root and reindex in Settings."), style = MaterialTheme.typography.bodyMedium)
            }

            else -> {
                val bySummaryId = summaries.associateBy { it.id }
                val rows = current.map { p ->
                    val summary = bySummaryId[p.id]
                    val device = deviceInfo[p.id]
                    val days = if (todayIso != null && summary?.lastReportDate != null) daysBetweenIsoDates(summary.lastReportDate!!, todayIso) else null
                    val warning = parseManufacturerWarningStatus(p.manufacturerWarningStatus)
                    RowData(p, summary, device, patientAttention(warning?.status, device?.batteryStatus, days), days)
                }
                val advisoryCount = rows.count { AttentionReason.ADVISORY in it.attention.reasons }
                val batteryCount = rows.count { AttentionReason.BATTERY in it.attention.reasons }
                val overdueCount = rows.count { AttentionReason.OVERDUE in it.attention.reasons }

                val q = filterState.query.trim().lowercase()
                val filtered = rows.filter { r ->
                    val p = r.patient
                    (q.isEmpty() ||
                        "${p.lastName} ${p.firstName.orEmpty()}".lowercase().contains(q) ||
                        p.hospitalPatientId?.lowercase()?.contains(q) == true) &&
                        (filterState.dobFilter.isBlank() || p.dob == filterState.dobFilter.trim()) &&
                        (filterState.patientIdFilter.isBlank() || p.id.contains(filterState.patientIdFilter.trim(), ignoreCase = true)) &&
                        (filterState.hospitalMrnFilter.isBlank() || p.hospitalPatientId?.contains(filterState.hospitalMrnFilter.trim(), ignoreCase = true) == true) &&
                        (filterState.manufacturerFilter == null || r.device?.manufacturer == filterState.manufacturerFilter) &&
                        when (filterState.attentionFilter) {
                            null -> true
                            AttentionFilter.ANY -> r.attention.needsAttention
                            AttentionFilter.ADVISORY -> AttentionReason.ADVISORY in r.attention.reasons
                            AttentionFilter.BATTERY -> AttentionReason.BATTERY in r.attention.reasons
                            AttentionFilter.OVERDUE -> AttentionReason.OVERDUE in r.attention.reasons
                        }
                }
                val comparator: Comparator<RowData> = when (filterState.sortField) {
                    DashboardSortField.NAME -> compareBy({ it.patient.lastName.lowercase() }, { it.patient.firstName.orEmpty().lowercase() })
                    DashboardSortField.DOB -> compareBy { it.patient.dob }
                    DashboardSortField.HOSPITAL_ID -> compareBy { it.patient.hospitalPatientId.orEmpty().lowercase() }
                    DashboardSortField.MANUFACTURER -> compareBy { it.device?.manufacturer.orEmpty().lowercase() }
                    DashboardSortField.MODEL -> compareBy { it.device?.deviceModel.orEmpty().lowercase() }
                    DashboardSortField.LAST_VISIT -> compareBy { it.summary?.lastReportDate.orEmpty() }
                    DashboardSortField.WARNING_URGENCY -> compareBy { warningUrgencyRank(it.patient.manufacturerWarningStatus) }
                }
                val sorted = filtered.sortedWith(if (filterState.sortAscending) comparator else comparator.reversed())

                Column(Modifier.fillMaxSize().padding(padding)) {
                    SearchField(filterState.query) { onFilterStateChange(filterState.copy(query = it)) }

                    if (filterState.filterPanelExpanded) AdvancedFilters(filterState, onFilterStateChange)

                    Row(
                        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        val needs = rows.count { it.attention.needsAttention }
                        fun attentionChip(filter: AttentionFilter, label: String, count: Int) = filter to (if (count > 0) "$label · $count" else label)
                        listOf(
                            attentionChip(AttentionFilter.ANY, tr("Needs attention"), needs),
                            attentionChip(AttentionFilter.ADVISORY, tr("Advisory"), advisoryCount),
                            attentionChip(AttentionFilter.BATTERY, tr("Battery at ERI"), batteryCount),
                            attentionChip(AttentionFilter.OVERDUE, tr("Overdue"), overdueCount),
                        ).forEach { (filter, label) ->
                            val on = filterState.attentionFilter == filter
                            FilterChip(
                                selected = on,
                                onClick = { onFilterStateChange(filterState.copy(attentionFilter = if (on) null else filter)) },
                                label = { Text(label) },
                                leadingIcon = if (on) { { Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp)) } } else null,
                            )
                        }
                        KNOWN_MANUFACTURERS.forEach { m ->
                            val on = filterState.manufacturerFilter == m
                            FilterChip(
                                selected = on,
                                onClick = { onFilterStateChange(filterState.copy(manufacturerFilter = if (on) null else m)) },
                                label = { Text(m) },
                                leadingIcon = {
                                    Box(Modifier.size(8.dp).background(manufacturerDot(m), CircleShape))
                                },
                            )
                        }
                    }

                    Text(
                        tr("{n} OF {m} PATIENTS", "n" to sorted.size, "m" to rows.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    )

                    if (sorted.isEmpty()) {
                        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                            Text(tr("No patients match the current search and filters."), style = MaterialTheme.typography.bodyMedium)
                        }
                    } else {
                        LazyColumn(Modifier.fillMaxSize()) {
                            items(sorted, key = { it.patient.id }) { row ->
                                PatientRow(
                                    repository = repository,
                                    data = row,
                                    selected = row.patient.id == selectedPatientId,
                                    onClick = { onOpenPatient(row.patient.id) },
                                    onOpenFolder = onOpenPatientFolder?.let { { it(row.patient.id) } },
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
}

private fun sortOptions() = listOf(
    tr("Name") to DashboardSortField.NAME,
    tr("Date of birth") to DashboardSortField.DOB,
    tr("Hospital ID") to DashboardSortField.HOSPITAL_ID,
    tr("Manufacturer") to DashboardSortField.MANUFACTURER,
    tr("Model") to DashboardSortField.MODEL,
    tr("Last visit") to DashboardSortField.LAST_VISIT,
    tr("Warning urgency") to DashboardSortField.WARNING_URGENCY,
)

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    TextField(
        value = query,
        onValueChange = onChange,
        placeholder = { Text(tr("Name, hospital ID")) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) {
            { IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Clear, contentDescription = tr("Clear search")) } }
        } else null,
        singleLine = true,
        shape = RoundedCornerShape(28.dp),
        colors = TextFieldDefaults.colors(
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun AdvancedFilters(filterState: DashboardFilterState, onChange: (DashboardFilterState) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = filterState.dobFilter, onValueChange = { onChange(filterState.copy(dobFilter = it)) },
                label = { Text(tr("Date of birth (YYYY-MM-DD)")) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            )
            OutlinedTextField(
                value = filterState.hospitalMrnFilter, onValueChange = { onChange(filterState.copy(hospitalMrnFilter = it)) },
                label = { Text(tr("Hospital MRN")) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            )
            OutlinedTextField(
                value = filterState.patientIdFilter, onValueChange = { onChange(filterState.copy(patientIdFilter = it)) },
                label = { Text(tr("Internal patient ID")) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            )
            TextButton(onClick = { onChange(filterState.copy(dobFilter = "", patientIdFilter = "", hospitalMrnFilter = "", manufacturerFilter = null, attentionFilter = null)) }) {
                Text(tr("Clear filters"))
            }
        }
    }
}

/** One patient: avatar, name, device with a manufacturer dot, last visit, and a status with icon and word. */
@Composable
private fun PatientRow(
    repository: KardiSynchRepository,
    data: RowData,
    selected: Boolean,
    onClick: () -> Unit,
    onOpenFolder: (() -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
) {
    val patient = data.patient
    val reportCount = data.summary?.reportCount ?: 0
    val lastReportDate = data.summary?.lastReportDate
    val warning = parseManufacturerWarningStatus(patient.manufacturerWarningStatus)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(44.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${patient.lastName.take(1)}${patient.firstName.orEmpty().take(1)}".uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "${patient.lastName}, ${patient.firstName.orEmpty()}",
                    style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusChip(data.attention, onClick = warning?.link?.takeIf { AttentionReason.ADVISORY in data.attention.reasons }?.let { link -> onOpenUrl?.let { open -> { open(link) } } })
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (data.device?.manufacturer != null) ManufacturerWordmark(data.device.manufacturer)
                Text(
                    data.device?.deviceModel?.takeIf { it.isNotBlank() } ?: if (data.device?.manufacturer == null) tr("No device on file") else "",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                buildString {
                    append(tr("Born {date}", "date" to displayDate(patient.dob)))
                    append(" · " + trn(reportCount, "{n} visit", "{n} visits"))
                    if (data.daysSince != null) append(" · " + tr("last {n} d ago", "n" to data.daysSince)) else if (lastReportDate == null) append(" · " + tr("no visits yet"))
                },
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }

    }
}

/** The one-word status on a row: advisory > battery > overdue > "No advisory" (only when positively checked safe). */
@Composable
private fun StatusChip(attention: PatientAttention, onClick: (() -> Unit)?) {
    val (status, text) = when {
        AttentionReason.ADVISORY in attention.reasons -> Status.ALERT to tr("Advisory")
        AttentionReason.BATTERY in attention.reasons -> Status.ATTENTION to tr("Battery at ERI")
        AttentionReason.OVERDUE in attention.reasons -> Status.ATTENTION to tr("Follow-up overdue")
        attention.warningSafe -> Status.OK to tr("No advisory")
        else -> return
    }
    val palette = statusColors()
    val chip = @Composable {
        Row(
            Modifier.padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(status.icon, contentDescription = null, modifier = Modifier.size(16.dp), tint = palette.content(status))
            Text(text, style = MaterialTheme.typography.labelMedium, color = palette.content(status))
        }
    }
    if (onClick != null) {
        Surface(onClick = onClick, shape = RoundedCornerShape(8.dp), color = palette.container(status), content = chip)
    } else {
        Surface(shape = RoundedCornerShape(8.dp), color = palette.container(status), content = chip)
    }
}
