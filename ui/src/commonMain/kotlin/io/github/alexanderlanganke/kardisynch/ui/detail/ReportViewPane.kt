package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.util.formatDelta
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports

/** Which pseudo-/real report a pane is showing — mirrors `ViewPane.tsx`'s `SUMMARY_REPORT` sentinel, as a proper sealed type instead of a magic id string. */
sealed interface PaneSelection {
    data object Summary : PaneSelection
    data class Visit(val reportId: String) : PaneSelection
}

private enum class ViewMode { RAW, FORMATTED }

/** Fixed height for [ReportViewPaneSlot]'s own selector/toggle row — see its doc comment on why this is a hardcoded dp, not Modifier.weight(). */
private val PANE_HEADER_HEIGHT = 48.dp

/**
 * The two-pane report viewer from `ViewPane.tsx` — each pane independently
 * shows either the cross-visit Summary or one visit's Raw/Formatted view,
 * picked via its own dropdown, a click on a [VisitTimelineRow] card
 * (assigns to the first empty pane, else pane 0 — see the caller), or a
 * drag from that same timeline (assigns to whichever pane the pointer is
 * over at release).
 *
 * The drag itself is a custom in-app gesture, not OS-level drag-and-drop:
 * [VisitTimelineRow] tracks the pointer in *root* coordinates via
 * `pointerInput`/`detectDragGestures`, and each pane reports its own
 * [Rect] here via [onPaneBoundsChanged] (captured with `onGloballyPositioned`
 * + `boundsInRoot()`) so the caller can hit-test the drop point against
 * both panes' bounds. This was a deliberate simplification when the raw
 * document viewer first landed (`RawFileViewer`'s doc comment used to note
 * "this port has no fixed dual-pane layout to drag into" — no longer
 * true); it avoids Compose Multiplatform's newer, more version-sensitive
 * `dragAndDropSource`/`Target` platform APIs (oriented at OS-level
 * drag-in/out, e.g. from a file manager) in favor of a portable primitive
 * that's been stable since Compose 1.0 and behaves identically on desktop
 * and Android. There's no floating "ghost" following the cursor during the
 * drag — the source card dims and the target pane under the pointer gets a
 * highlighted border instead, which needed no cross-container coordinate
 * conversion beyond the hit-test itself.
 */
@Composable
fun TwoPaneViewer(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    paneSelections: List<PaneSelection?>,
    onPaneSelectionChange: (index: Int, PaneSelection?) -> Unit,
    dragOverPaneIndex: Int?,
    onPaneBoundsChanged: (index: Int, Rect) -> Unit,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
    modifier: Modifier = Modifier,
) {
    // Not RowScope.weight(1f) on the panes: reproducibly zero-sized in this
    // composition, same as every other weight() usage on the path down from
    // this screen's Scaffold (see the caller's doc comment). A plain 50%
    // fillMaxWidth(0.5f) fraction *also* reproducibly zero-sized the SECOND
    // pane specifically (first pane rendered real content; second stayed
    // blank) — so, same fix as the outer container: measure the real width
    // with BoxWithConstraints and apply it as a hardcoded dp, the one
    // sizing strategy proven to actually work in this composition.
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val paneWidth = ((maxWidth - 1.dp) / 2).coerceAtLeast(0.dp)
        Row(Modifier.fillMaxSize()) {
            for (index in 0 until 2) {
                if (index == 1) {
                    Box(Modifier.fillMaxHeight().width(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
                }
                ReportViewPaneSlot(
                    repository = repository,
                    reports = reports,
                    patientId = patientId,
                    selection = paneSelections.getOrNull(index),
                    onSelectionChange = { onPaneSelectionChange(index, it) },
                    isDragOver = dragOverPaneIndex == index,
                    onGetVisitFiles = onGetVisitFiles,
                    onReadVisitFileBytes = onReadVisitFileBytes,
                    onReadVisitFileText = onReadVisitFileText,
                    onGetMergedAdditionalFields = onGetMergedAdditionalFields,
                    modifier = Modifier
                        .width(paneWidth)
                        .fillMaxHeight()
                        .onGloballyPositioned { onPaneBoundsChanged(index, it.boundsInRoot()) },
                )
            }
        }
    }
}

@Composable
private fun ReportViewPaneSlot(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    selection: PaneSelection?,
    onSelectionChange: (PaneSelection?) -> Unit,
    isDragOver: Boolean,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
    modifier: Modifier = Modifier,
) {
    var viewMode by remember(selection) { mutableStateOf(ViewMode.RAW) }
    var selectorExpanded by remember { mutableStateOf(false) }
    val selectedReport = (selection as? PaneSelection.Visit)?.let { sel -> reports.firstOrNull { it.id == sel.reportId } }

    // No Modifier.weight() anywhere in here either (see TwoPaneViewer's doc
    // comment) — Arrangement.SpaceBetween replaces the weighted spacer in
    // the header row, and BoxWithConstraints replaces the weighted content
    // area below it.
    BoxWithConstraints(
        modifier
            .background(if (isDragOver) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else Color.Transparent)
            .border(if (isDragOver) 2.dp else 0.dp, MaterialTheme.colorScheme.primary),
    ) {
        val contentHeight = (maxHeight - PANE_HEADER_HEIGHT).coerceAtLeast(0.dp)
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().height(PANE_HEADER_HEIGHT).padding(8.dp, 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    TextButton(onClick = { selectorExpanded = true }) {
                        Text(
                            when {
                                selection is PaneSelection.Summary -> "Summary"
                                selectedReport != null -> "${isoDateOnly(selectedReport.interrogationDate)} · ${selectedReport.manufacturer ?: "Unknown"}"
                                selection is PaneSelection.Visit -> "Visit removed"
                                else -> "Select…"
                            },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    DropdownMenu(expanded = selectorExpanded, onDismissRequest = { selectorExpanded = false }) {
                        DropdownMenuItem(text = { Text("Summary") }, onClick = { selectorExpanded = false; onSelectionChange(PaneSelection.Summary) })
                        reports.forEach { r ->
                            DropdownMenuItem(
                                text = { Text("${isoDateOnly(r.interrogationDate)} · ${r.manufacturer ?: "Unknown"}") },
                                onClick = { selectorExpanded = false; onSelectionChange(PaneSelection.Visit(r.id)) },
                            )
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (selectedReport != null) {
                        FilterChip(selected = viewMode == ViewMode.RAW, onClick = { viewMode = ViewMode.RAW }, label = { Text("Raw") })
                        FilterChip(selected = viewMode == ViewMode.FORMATTED, onClick = { viewMode = ViewMode.FORMATTED }, label = { Text("Formatted") })
                    }
                    if (selection != null) {
                        TextButton(onClick = { onSelectionChange(null) }) { Text("Clear") }
                    }
                }
            }
            Box(Modifier.height(contentHeight).fillMaxWidth()) {
                when {
                    selection == null -> PaneEmptyHint()
                    selection is PaneSelection.Summary -> SummaryPaneContent(repository, reports, patientId, onGetMergedAdditionalFields)
                    selectedReport == null -> PaneEmptyHint()
                    viewMode == ViewMode.RAW && onGetVisitFiles != null && onReadVisitFileBytes != null && onReadVisitFileText != null ->
                        RawPaneContent(selectedReport, patientId, onGetVisitFiles, onReadVisitFileBytes, onReadVisitFileText)
                    else -> {
                        val idx = reports.indexOfFirst { it.id == selectedReport.id }
                        val previousReport = if (idx >= 0) reports.getOrNull(idx + 1) else null
                        FormattedVisitContent(repository, selectedReport, previousReport)
                    }
                }
            }
        }
    }
}

@Composable
private fun PaneEmptyHint() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            "Drag a visit here or use the selector above",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RawPaneContent(
    report: Reports,
    patientId: String,
    onGetVisitFiles: suspend (String, String) -> List<DataEntry>,
    onReadVisitFileBytes: suspend (String) -> ByteArray?,
    onReadVisitFileText: suspend (String) -> String?,
) {
    var files by remember(report.id) { mutableStateOf<List<DataEntry>?>(null) }
    LaunchedEffect(report.id) { files = onGetVisitFiles(patientId, report.id) }
    val current = files
    if (current == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    } else {
        // No verticalScroll wrapper here — RawFileViewer's own per-file-type
        // content (PdfFileContent especially) already scrolls internally.
        // Wrapping it in a second verticalScroll nests two scrollables on the
        // same axis, which measures the inner one with an infinite max
        // height and crashes (`IllegalStateException: Vertically scrollable
        // component was measured with an infinity maximum height
        // constraints`) — reproduced on every visit click since every visit
        // here has a PDF.
        Box(Modifier.fillMaxSize().padding(8.dp)) {
            RawFileViewer(current, onReadVisitFileBytes, onReadVisitFileText)
        }
    }
}

/** Per-field values with deltas against [previousReport] — Electron's `FormattedReport.tsx`, extracted here from the old per-visit list card so a pane can render it directly. */
@Composable
private fun FormattedVisitContent(repository: KardiSynchRepository, report: Reports, previousReport: Reports?) {
    var devices by remember(report.id) { mutableStateOf<List<Devices>?>(null) }
    var leads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
    var previousLeads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
    LaunchedEffect(report.id) {
        devices = repository.getDevicesForReport(report.id)
        leads = repository.getLeadsForReport(report.id)
        previousLeads = previousReport?.let { repository.getLeadsForReport(it.id) }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)) {
        Text(isoDateOnly(report.interrogationDate), style = MaterialTheme.typography.titleSmall)
        Text("${report.manufacturer ?: "Unknown"} · ${report.deviceModel ?: "Unknown"}", style = MaterialTheme.typography.bodyMedium)
        devices?.forEach { d ->
            Text("Device: ${d.model} (${d.serialNumber}) — ${d.type}", style = MaterialTheme.typography.bodySmall)
        }
        formatDelta(report.batteryVoltageValue, previousReport?.batteryVoltageValue, report.batteryVoltageUnit.orEmpty(), "Battery")?.let {
            Text(it, style = MaterialTheme.typography.bodySmall)
        }
        leads?.forEach { l ->
            // Matched to the previous visit's same-location lead — this port
            // doesn't guarantee stable lead ordering across visits the way
            // Electron's same-index comparison assumes, so location is the
            // more reliable match key.
            val previous = previousLeads?.firstOrNull { it.anatomicLocation != null && it.anatomicLocation == l.anatomicLocation }
            val bits = listOfNotNull(
                l.anatomicLocation,
                formatDelta(l.impedanceValue, previous?.impedanceValue, l.impedanceUnit.orEmpty(), "Imp"),
                formatDelta(l.sensingValue, previous?.sensingValue, l.sensingUnit.orEmpty(), "Sens"),
                formatDelta(l.pacingThresholdValue, previous?.pacingThresholdValue, l.pacingThresholdUnit.orEmpty(), "Thresh"),
            ).joinToString(" · ")
            Text("Lead ${l.name}: $bits", style = MaterialTheme.typography.bodySmall)
        }
    }
}

/**
 * A quick-glance snapshot of the most recent visit's device and per-lead
 * readings — the "latest values" half of Electron's pinned "Summary"
 * pseudo-report (`SummaryReport.tsx`, parity plan Phase 12), plus the
 * per-lead-location trend charts (Phase 5) and merged additional-data card
 * (also Phase 12) — everything a pane shows when set to "Summary".
 */
@Composable
private fun SummaryPaneContent(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        LatestValuesCard(repository, reports)
        if (onGetMergedAdditionalFields != null) {
            AdditionalDataCard(patientId, onGetMergedAdditionalFields)
        }
        val trendPoints = reports
            .filter { it.batteryVoltageValue != null }
            .sortedBy { it.interrogationDate }
            .map { TrendPoint(isoDateOnly(it.interrogationDate), it.batteryVoltageValue!!, it.deviceSerialNumber) }
        TrendChart("Battery voltage trend", "V", trendPoints)
        LeadTrendSection(repository, patientId)
    }
}

@Composable
private fun LatestValuesCard(repository: KardiSynchRepository, reports: List<Reports>) {
    val latest = reports.maxByOrNull { it.interrogationDate } ?: return
    var latestLeads by remember(latest.id) { mutableStateOf<List<Leads>?>(null) }
    LaunchedEffect(latest.id) { latestLeads = repository.getLeadsForReport(latest.id) }

    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Latest values (${isoDateOnly(latest.interrogationDate)})", style = MaterialTheme.typography.titleSmall)
            Text("${latest.manufacturer ?: "Unknown"} ${latest.deviceModel ?: "Unknown"} (${latest.deviceSerialNumber ?: "?"})", style = MaterialTheme.typography.bodyMedium)
            if (latest.batteryVoltageValue != null) {
                Text("Battery: ${latest.batteryVoltageValue} ${latest.batteryVoltageUnit.orEmpty()}", style = MaterialTheme.typography.bodySmall)
            }
            latestLeads?.forEach { l ->
                val bits = listOfNotNull(
                    l.impedanceValue?.let { "Imp $it${l.impedanceUnit.orEmpty()}" },
                    l.sensingValue?.let { "Sens $it${l.sensingUnit.orEmpty()}" },
                    l.pacingThresholdValue?.let { "Thresh $it${l.pacingThresholdUnit.orEmpty()}" },
                ).joinToString(" · ")
                Text("${l.anatomicLocation ?: l.name}: $bits", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * Manufacturer-specific fields not in the standard schema (EF, NYHA class,
 * etc.), merged across every visit — Electron's `SummaryReport.tsx`
 * "Additional Data" card (parity plan Phase 12). Loaded lazily and only
 * when [onGetMergedAdditionalFields] is supplied — unlike almost
 * everything else on this screen, this re-reads every visit.xml from disk
 * (see [KardiSynchRepository.getMergedAdditionalFields]'s doc comment).
 */
@Composable
private fun AdditionalDataCard(patientId: String, onGetMergedAdditionalFields: suspend (String) -> Map<String, KardiSynchRepository.MergedAdditionalField>) {
    var fields by remember(patientId) { mutableStateOf<Map<String, KardiSynchRepository.MergedAdditionalField>?>(null) }
    LaunchedEffect(patientId) { fields = onGetMergedAdditionalFields(patientId) }

    val current = fields
    if (current.isNullOrEmpty()) return

    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Additional data", style = MaterialTheme.typography.titleSmall)
            current.entries.sortedBy { it.key }.forEach { (key, field) ->
                Text("$key: ${field.value} (as of ${field.lastSeenDate})", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * Per-lead-location impedance/sensing/pacing-threshold trend charts. A
 * patient can have multiple lead locations (e.g. RA/RV/LV for a CRT
 * device); the chip row picks which one the three charts below plot.
 * Renders nothing if the patient has no lead readings on file at all.
 */
@Composable
private fun LeadTrendSection(repository: KardiSynchRepository, patientId: String) {
    var locations by remember(patientId) { mutableStateOf<List<String>>(emptyList()) }
    var selectedLocation by remember(patientId) { mutableStateOf<String?>(null) }
    var leadPoints by remember { mutableStateOf<List<KardiSynchRepository.LeadTrendPoint>>(emptyList()) }

    LaunchedEffect(patientId) {
        locations = repository.getLeadLocationsForPatient(patientId)
        selectedLocation = locations.firstOrNull()
    }
    LaunchedEffect(selectedLocation) {
        val location = selectedLocation
        leadPoints = if (location != null) repository.getLeadTrendByLocation(patientId, location) else emptyList()
    }

    if (locations.isEmpty()) return

    Column(modifier = Modifier.fillMaxWidth()) {
        Text("Lead trends", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            locations.forEach { location ->
                FilterChip(selected = selectedLocation == location, onClick = { selectedLocation = location }, label = { Text(location) })
            }
        }

        fun pointsFor(unit: (KardiSynchRepository.LeadTrendPoint) -> String?, value: (KardiSynchRepository.LeadTrendPoint) -> Double?) =
            leadPoints.mapNotNull { p -> value(p)?.let { TrendPoint(isoDateOnly(p.interrogationDate), it, p.deviceSerialNumber) } } to
                (leadPoints.firstNotNullOfOrNull(unit) ?: "")

        val (impedancePoints, impedanceUnit) = pointsFor({ it.impedanceUnit }, { it.impedanceValue })
        TrendChart("Impedance trend", impedanceUnit, impedancePoints)
        val (sensingPoints, sensingUnit) = pointsFor({ it.sensingUnit }, { it.sensingValue })
        TrendChart("Sensing trend", sensingUnit, sensingPoints)
        val (thresholdPoints, thresholdUnit) = pointsFor({ it.pacingThresholdUnit }, { it.pacingThresholdValue })
        TrendChart("Pacing threshold trend", thresholdUnit, thresholdPoints)
    }
}
