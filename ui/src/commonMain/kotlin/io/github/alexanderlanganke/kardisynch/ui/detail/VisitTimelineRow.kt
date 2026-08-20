package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import kotlinx.coroutines.launch
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports

/**
 * The horizontal per-visit card strip from `VisitTimeline.tsx` — one card
 * per visit, click-to-select and drag-to-a-pane (see
 * [io.github.alexanderlanganke.kardisynch.ui.detail.TwoPaneViewer]'s doc
 * comment for how the drag is implemented and why it isn't OS-level
 * drag-and-drop).
 *
 * Electron reveals a card's Rescan/Move/Export/QR actions on hover; touch
 * platforms (Android) have no hover, so those — plus this port's own
 * per-visit additions (Delete, Edit device & leads — the latter a Phase 8
 * scope adaptation, see [PatientHeaderSection]'s doc comment) — live behind
 * a single "⋮" overflow menu instead of a row of always-visible icons,
 * which also keeps a 150dp-wide card readable with six actions instead of
 * Electron's four.
 *
 * Not ported: `visit_type`/`source_domain` (Remote/Intraoperative badges) —
 * this port's `Reports` table has no such column; every visit here came
 * from a parsed file, never a live remote-monitoring or intraop feed
 * distinction, so there is nothing to badge. Same-day-visit grouping
 * (`sameDayCounts`) *is* ported — it only needs `interrogationDate`, which
 * this port already has.
 */
@Composable
fun VisitTimelineRow(
    reports: List<Reports>,
    patientId: String,
    onVisitClick: (Reports) -> Unit,
    onDragTo: (Reports, Offset) -> Unit,
    onDragMove: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onRescanVisit: ((Reports) -> Unit)?,
    onMoveVisit: ((Reports) -> Unit)?,
    onDeleteVisit: ((Reports) -> Unit)?,
    onEditDeviceAndLeads: ((Reports) -> Unit)?,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    repository: KardiSynchRepository,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    modifier: Modifier = Modifier,
) {
    val sameDayCounts = remember(reports) {
        reports.groupingBy { it.interrogationDate.take(10) }.eachCount()
    }

    Column(modifier = modifier.background(MaterialTheme.colorScheme.surface).padding(top = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
            Text("Visit timeline", style = MaterialTheme.typography.titleSmall)
            Text(" (${reports.size})", style = MaterialTheme.typography.labelSmall)
        }
        if (reports.isEmpty()) {
            Text("No visits found", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            return
        }
        // Explicit height, not wrap-content: this LazyRow sits as a
        // non-weighted sibling of TwoPaneViewer's Modifier.weight(1f) Row in
        // the parent Column. Without a fixed height here, the Column's
        // weight-distribution measure pass intermittently either throws
        // ("Asking for intrinsic measurements of SubcomposeLayout layouts is
        // not supported" — LazyRow is SubcomposeLayout-based) or silently
        // collapses the weighted sibling to zero height instead of crashing.
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.height(130.dp).padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            items(reports, key = { it.id }) { report ->
                VisitCard(
                    report = report,
                    sameDayCount = sameDayCounts[report.interrogationDate.take(10)] ?: 1,
                    patientId = patientId,
                    onClick = { onVisitClick(report) },
                    onDragTo = onDragTo,
                    onDragMove = onDragMove,
                    onDragEnd = onDragEnd,
                    onRescanVisit = onRescanVisit,
                    onMoveVisit = onMoveVisit,
                    onDeleteVisit = onDeleteVisit,
                    onEditDeviceAndLeads = onEditDeviceAndLeads,
                    onExportQr = onExportQr,
                    repository = repository,
                    onGetVisitFiles = onGetVisitFiles,
                )
            }
        }
    }
}

@Composable
private fun VisitCard(
    report: Reports,
    sameDayCount: Int,
    patientId: String,
    onClick: () -> Unit,
    onDragTo: (Reports, Offset) -> Unit,
    onDragMove: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onRescanVisit: ((Reports) -> Unit)?,
    onMoveVisit: ((Reports) -> Unit)?,
    onDeleteVisit: ((Reports) -> Unit)?,
    onEditDeviceAndLeads: ((Reports) -> Unit)?,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    repository: KardiSynchRepository,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
) {
    var cardTopLeftInRoot by remember { mutableStateOf(Offset.Zero) }
    var isDragging by remember { mutableStateOf(false) }
    var menuExpanded by remember { mutableStateOf(false) }
    var fileCount by remember(report.id) { mutableStateOf<Int?>(null) }
    val coroutineScope = rememberCoroutineScope()

    if (onGetVisitFiles != null) {
        LaunchedEffect(report.id) { fileCount = onGetVisitFiles(patientId, report.id).size }
    }

    Card(
        modifier = Modifier
            .widthIn(min = 150.dp)
            .alpha(if (isDragging) 0.4f else 1f)
            .onGloballyPositioned { cardTopLeftInRoot = it.positionInRoot() }
            .pointerInput(report.id) {
                detectDragGestures(
                    onDragStart = { offset ->
                        isDragging = true
                        onDragTo(report, cardTopLeftInRoot + offset)
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        onDragMove(dragAmount)
                    },
                    onDragEnd = {
                        isDragging = false
                        onDragEnd()
                    },
                    onDragCancel = {
                        isDragging = false
                        onDragEnd()
                    },
                )
            },
        onClick = onClick,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(isoDateOnly(report.interrogationDate), style = MaterialTheme.typography.labelMedium)
                Box(modifier = Modifier.weight(1f))
                if (onRescanVisit != null || onMoveVisit != null || onDeleteVisit != null || onEditDeviceAndLeads != null || onExportQr != null) {
                    Box {
                        TextButton(onClick = { menuExpanded = true }, contentPadding = PaddingValues(0.dp)) { Text("⋮") }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            if (onRescanVisit != null) {
                                DropdownMenuItem(text = { Text("Rescan") }, onClick = { menuExpanded = false; onRescanVisit(report) })
                            }
                            if (onMoveVisit != null) {
                                DropdownMenuItem(text = { Text("Move to another patient") }, onClick = { menuExpanded = false; onMoveVisit(report) })
                            }
                            if (onEditDeviceAndLeads != null) {
                                DropdownMenuItem(text = { Text("Edit device & leads") }, onClick = { menuExpanded = false; onEditDeviceAndLeads(report) })
                            }
                            if (onExportQr != null) {
                                DropdownMenuItem(
                                    text = { Text("Export QR") },
                                    onClick = {
                                        menuExpanded = false
                                        // Loaded on click rather than kept in per-card state —
                                        // QR export is a one-shot action, not a value this card
                                        // needs to re-render around.
                                        coroutineScope.launch {
                                            val devices = repository.getDevicesForReport(report.id)
                                            val leads = repository.getLeadsForReport(report.id)
                                            onExportQr(report, devices, leads)
                                        }
                                    },
                                )
                            }
                            if (onDeleteVisit != null) {
                                DropdownMenuItem(text = { Text("Delete") }, onClick = { menuExpanded = false; onDeleteVisit(report) })
                            }
                        }
                    }
                }
            }
            if (sameDayCount > 1) {
                Text("$sameDayCount visits this day", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
            }
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    report.manufacturer ?: "Unknown",
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                fileCount?.let { Text("$it file${if (it == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall) }
            }
        }
    }
}
