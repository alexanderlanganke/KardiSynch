package io.github.alexanderlanganke.kardisynch.ui.inbox

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Usb
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.intake.EvidenceStrength
import io.github.alexanderlanganke.kardisynch.core.intake.parseEvidence
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.IntakeFiles
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
import io.github.alexanderlanganke.kardisynch.ui.notifications.ActivityTask
import io.github.alexanderlanganke.kardisynch.ui.notifications.NotificationCenterState
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors

enum class SourceKind { USB, SHARE, FOLDER }

/** One place files come from, with whether it is currently reachable. Supplied by the platform shell. */
data class IntakeSource(val label: String, val detail: String, val healthy: Boolean, val kind: SourceKind)

/** The files of one interrogation that are waiting for a clinician. Legacy tasks without a bundle id form a bundle of one. */
internal data class QueuedBundle(val key: String, val bundleId: String?, val tasks: List<PendingSortTasks>) {
    val first: PendingSortTasks get() = tasks.first()
    val title: String get() = tasks.firstNotNullOfOrNull { it.suggestedPatientName } ?: tr("No suggestion")
    val reason: String get() = tasks.map { it.note }.distinct().joinToString(" ")
}

internal fun groupQueue(tasks: List<PendingSortTasks>): List<QueuedBundle> =
    tasks.groupBy { it.bundleId ?: "task-${it.id}" }.map { (key, list) ->
        QueuedBundle(key, list.first().bundleId, list.sortedBy { it.originalFileName })
    }.sortedByDescending { it.first.createdAt }

private enum class InboxTab(private val en: String) { INTAKE("Intake"), ALERTS("Alerts"), ACTIVITY("Activity"), HISTORY("History");
    val label: String get() = tr(en)
}
private enum class IntakeSegment(private val en: String) { NEEDS_YOU("Needs you"), IMPORTED("Imported"), SKIPPED("Skipped");
    val label: String get() = tr(en)
}

/**
 * The Inbox: where files that arrived from USB drives, network shares and the
 * import folder become visits, and where anything that needs a person lands.
 * The unit is a bundle (one interrogation, possibly several files), not a
 * file; every file the importer has looked at appears here, so nothing is
 * invisible. Replaces the old bell popup (which also crashed on its tab row).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    repository: KardiSynchRepository,
    notificationState: NotificationCenterState,
    activityTasks: List<ActivityTask>,
    refreshKey: Any,
    sources: List<IntakeSource>,
    onOpenBundle: (key: String) -> Unit,
    onOpenImportHistory: () -> Unit,
    onReprocessUnmatched: (() -> Unit)?,
) {
    var tab by remember { mutableStateOf(InboxTab.INTAKE) }
    var segment by remember { mutableStateOf(IntakeSegment.NEEDS_YOU) }
    var queue by remember { mutableStateOf<List<QueuedBundle>>(emptyList()) }
    var unrecognised by remember { mutableStateOf<List<IntakeFiles>>(emptyList()) }
    var recent by remember { mutableStateOf<List<IntakeFiles>>(emptyList()) }
    var counts by remember { mutableStateOf<Map<String, Long>>(emptyMap()) }

    LaunchedEffect(refreshKey) {
        queue = groupQueue(repository.getPendingSortTasks())
        unrecognised = repository.getIntakeFilesByState("unrecognised")
        recent = repository.getRecentIntakeFiles(150)
        counts = repository.countIntakeFilesByState()
    }

    val needsYou = queue.size + unrecognised.size
    val alerts = notificationState.notifications.count { !it.read }

    Scaffold(topBar = { TopAppBar(title = { Text(tr("Inbox")) }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab.ordinal) {
                InboxTab.entries.forEach { t ->
                    val badge = when (t) {
                        InboxTab.INTAKE -> needsYou
                        InboxTab.ALERTS -> alerts
                        InboxTab.ACTIVITY -> activityTasks.size
                        InboxTab.HISTORY -> 0
                    }
                    Tab(selected = tab == t, onClick = { tab = t }, text = { Text(if (badge > 0) "${t.label} $badge" else t.label) })
                }
            }
            when (tab) {
                InboxTab.INTAKE -> IntakeTab(
                    sources = sources, segment = segment, onSegment = { segment = it },
                    queue = queue, unrecognised = unrecognised, recent = recent, counts = counts,
                    onOpenBundle = onOpenBundle, onReprocessUnmatched = onReprocessUnmatched,
                )
                InboxTab.ALERTS -> AlertsTab(notificationState)
                InboxTab.ACTIVITY -> ActivityTab(activityTasks)
                InboxTab.HISTORY -> HistoryTab(recent, onOpenImportHistory)
            }
        }
    }
}

@Composable
private fun IntakeTab(
    sources: List<IntakeSource>,
    segment: IntakeSegment,
    onSegment: (IntakeSegment) -> Unit,
    queue: List<QueuedBundle>,
    unrecognised: List<IntakeFiles>,
    recent: List<IntakeFiles>,
    counts: Map<String, Long>,
    onOpenBundle: (String) -> Unit,
    onReprocessUnmatched: (() -> Unit)?,
) {
    val imported = recent.filter { it.state == "committed" || it.state == "attached" }
    val skipped = recent.filter { it.state == "duplicate" || it.state == "ignored" || it.state == "error" }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
        item {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) { sources.forEach { SourceCard(it) } }
            if (sources.isEmpty()) {
                Text(
                    tr("No import source is set up. Choose an import folder in Settings."),
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IntakeSegment.entries.forEach { s ->
                    val n = when (s) {
                        IntakeSegment.NEEDS_YOU -> queue.size + unrecognised.size
                        IntakeSegment.IMPORTED -> (counts["committed"] ?: 0L).toInt() + (counts["attached"] ?: 0L).toInt()
                        IntakeSegment.SKIPPED -> (counts["duplicate"] ?: 0L).toInt() + (counts["ignored"] ?: 0L).toInt() + (counts["error"] ?: 0L).toInt()
                    }
                    FilterChip(selected = segment == s, onClick = { onSegment(s) }, label = { Text("${s.label} $n") })
                }
            }
            Text(
                tr("One row per interrogation, not per file"),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        when (segment) {
            IntakeSegment.NEEDS_YOU -> {
                if (queue.isEmpty() && unrecognised.isEmpty()) item { EmptyNote(tr("Nothing needs you. New files are imported automatically when they can be matched with confidence.")) }
                items(queue, key = { it.key }) { BundleRow(it, onOpenBundle) }
                if (unrecognised.isNotEmpty()) {
                    item {
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(tr("Files that were not recognised"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            if (onReprocessUnmatched != null) TextButton(onClick = onReprocessUnmatched) { Text(tr("Try them again")) }
                        }
                    }
                    items(unrecognised, key = { it.id }) { UnrecognisedRow(it) }
                }
            }
            IntakeSegment.IMPORTED -> {
                if (imported.isEmpty()) item { EmptyNote(tr("Nothing imported yet.")) }
                items(imported, key = { it.id }) { LedgerRow(it) }
            }
            IntakeSegment.SKIPPED -> {
                if (skipped.isEmpty()) item { EmptyNote(tr("Nothing was skipped.")) }
                items(skipped, key = { it.id }) { LedgerRow(it) }
            }
        }
    }
}

@Composable
private fun EmptyNote(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
}

@Composable
private fun SourceCard(source: IntakeSource) {
    val palette = statusColors()
    val status = if (source.healthy) Status.OK else Status.ATTENTION
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.size(width = 260.dp, height = 104.dp),
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(
                when (source.kind) { SourceKind.USB -> Icons.Filled.Usb; SourceKind.SHARE -> Icons.Filled.Dns; SourceKind.FOLDER -> Icons.Filled.Folder },
                contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(source.label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(source.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Surface(shape = RoundedCornerShape(8.dp), color = palette.container(status)) {
                    Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(status.icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = palette.content(status))
                        Text(if (source.healthy) tr("Reachable") else tr("Not reachable"), style = MaterialTheme.typography.labelSmall, color = palette.content(status))
                    }
                }
            }
        }
    }
}

@Composable
internal fun KindChip(fileName: String, kind: String?, confidence: Int?, strengthHint: EvidenceStrength? = null) {
    val label = kind?.lowercase()?.replace('_', ' ') ?: "unknown"
    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Filled.InsertDriveFile, contentDescription = null, modifier = Modifier.size(14.dp))
            Text(
                buildString { append(fileName.takeLast(28)); append(" · "); append(label); if (confidence != null) append(" $confidence%") },
                style = MaterialTheme.typography.labelMedium, maxLines = 1,
            )
        }
    }
}

@Composable
private fun BundleRow(bundle: QueuedBundle, onOpen: (String) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(bundle.title, style = MaterialTheme.typography.titleMedium)
                    Text(
                        listOfNotNull(bundle.first.manufacturer, bundle.first.deviceSerial?.let { tr("SN {sn}", "sn" to it) }, bundle.first.interrogationDate?.substringBefore('T')).joinToString(" · ").ifEmpty { tr("No details read") },
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                FilledTonalButton(onClick = { onOpen(bundle.key) }) { Text(tr("Review")) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                bundle.tasks.forEach { KindChip(it.originalFileName, it.fileKind, it.confidence?.toInt()) }
            }
            Text(bundle.reason, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun UnrecognisedRow(file: IntakeFiles) {
    val weakest = parseEvidence(file.evidence).firstOrNull { it.strength == EvidenceStrength.AGAINST }?.text
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(file.fileName, style = MaterialTheme.typography.titleSmall)
        Text(weakest ?: file.message.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(file.sourceLabel.orEmpty(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LedgerRow(file: IntakeFiles) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(file.fileName, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(file.state, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary)
        }
        Text(file.message.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(file.seenAt.substringBefore('.').replace('T', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AlertsTab(state: NotificationCenterState) {
    LaunchedEffect(Unit) { state.markAllRead() }
    val list = state.notifications
    if (list.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(tr("No alerts"), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { state.clearAll() }) { Text(tr("Clear all")) }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(list, key = { it.id }) { n ->
                Card(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                ) {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(n.message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        TextButton(onClick = { state.remove(n.id) }) { Text(tr("Dismiss")) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityTab(tasks: List<ActivityTask>) {
    if (tasks.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(tr("Nothing is running"), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        return
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        tasks.forEach { t ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(t.title, style = MaterialTheme.typography.bodyMedium)
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun HistoryTab(recent: List<IntakeFiles>, onOpenImportHistory: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onOpenImportHistory) { Text(tr("Import sessions")) }
            }
        }
        if (recent.isEmpty()) item { EmptyNote(tr("No files have been seen yet.")) }
        items(recent, key = { it.id }) { LedgerRow(it) }
    }
}
