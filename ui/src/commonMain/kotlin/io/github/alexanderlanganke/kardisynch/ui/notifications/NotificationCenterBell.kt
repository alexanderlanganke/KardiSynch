package io.github.alexanderlanganke.kardisynch.ui.notifications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.ImportSessions
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks

/** A currently-running platform operation (reindex/reparse/dedup) surfaced on the Activity tab. */
data class ActivityTask(val id: String, val title: String)

private enum class NotificationTab(val label: String) {
    NOTIFICATIONS("Alerts"),
    SORTING("Sorting"),
    ACTIVITY("Activity"),
    IMPORTS("Imports"),
}

/**
 * The persistent bell/activity popover from `NotificationCenter.tsx` (UI-
 * parity plan Phase 13) — 4 tabs: notifications, the manual-sort queue,
 * running background tasks, and recent import sessions. Lives in
 * [io.github.alexanderlanganke.kardisynch.ui.dashboard.PatientDashboardScreen]'s
 * top bar rather than Electron's literal `position: fixed` overlay: every
 * screen in this port already has its own [androidx.compose.material3.TopAppBar]
 * (with its own actions, e.g. Dashboard's "Settings"/"Device News"), unlike
 * Electron's single persistent sidebar shell, so floating a bell on top of
 * those would collide visually — the Dashboard is this port's actual
 * persistent home, so that's where it lives instead.
 *
 * Two more scope reductions from the original, both because the cost of
 * doing it "properly" is disproportionate to the clinical value here (a
 * records-review tool, not a live-monitoring dashboard) — see the plan's
 * Phase 13 entry:
 * - **Activity tab**: [activityTasks] is derived straight from the
 *   `isReindexing`/`isReparsing`/`isDeduping` booleans the app shell
 *   already tracks, shown as indeterminate progress bars. A true live
 *   per-item feed (Electron's `onProcessStatus` with numeric progress)
 *   would mean adding `StateFlow<Progress?>` plumbing to every long-running
 *   repository operation — backend churn well out of proportion to what a
 *   clinician actually needs from this tab (confirmation that *something*
 *   is running), so it isn't built.
 * - **Sorting tab**: lists the queue read-only (with per-item/bulk dismiss,
 *   which is cheap — it's just [onDismissPendingSort] in a loop) but
 *   "Sort"/"Sort Selected" just opens [onOpenPendingSortQueue] (the full
 *   `PendingSortScreen`, already multi-select-capable per Phase 10) rather
 *   than re-embedding a second copy of that picker/manual-transcription
 *   flow inside a small popover.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationCenterBell(
    repository: KardiSynchRepository,
    notificationState: NotificationCenterState,
    activityTasks: List<ActivityTask>,
    pendingSortCount: Int,
    onDismissPendingSort: ((taskId: String) -> Unit)?,
    onOpenPendingSortQueue: (() -> Unit)?,
    onOpenImportHistory: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf(NotificationTab.NOTIFICATIONS) }
    val unreadCount = notificationState.notifications.count { !it.read }
    val attentionCount = unreadCount + pendingSortCount

    Box {
        TextButton(
            onClick = {
                tab = when {
                    pendingSortCount > 0 -> NotificationTab.SORTING
                    activityTasks.isNotEmpty() -> NotificationTab.ACTIVITY
                    else -> NotificationTab.NOTIFICATIONS
                }
                expanded = true
                notificationState.markAllRead()
            },
        ) {
            Text(if (activityTasks.isNotEmpty()) "⏳" else "🔔")
            if (attentionCount > 0) Text(" $attentionCount")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Column(Modifier.width(380.dp)) {
                TabRow(selectedTabIndex = tab.ordinal) {
                    NotificationTab.values().forEach { t ->
                        Tab(selected = tab == t, onClick = { tab = t }, text = { Text(t.label) })
                    }
                }
                when (tab) {
                    NotificationTab.NOTIFICATIONS -> NotificationsTabContent(notificationState)
                    NotificationTab.SORTING -> SortingTabContent(
                        repository = repository,
                        expanded = expanded,
                        pendingSortCount = pendingSortCount,
                        onDismissPendingSort = onDismissPendingSort,
                        onOpenPendingSortQueue = onOpenPendingSortQueue,
                        closePopover = { expanded = false },
                    )
                    NotificationTab.ACTIVITY -> ActivityTabContent(activityTasks)
                    NotificationTab.IMPORTS -> ImportsTabContent(
                        repository = repository,
                        expanded = expanded,
                        onOpenImportHistory = onOpenImportHistory,
                        closePopover = { expanded = false },
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyTabMessage(text: String) {
    Box(Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun NotificationsTabContent(state: NotificationCenterState) {
    val notifications = state.notifications
    if (notifications.isEmpty()) {
        EmptyTabMessage("No notifications")
        return
    }
    Column {
        Row(Modifier.fillMaxWidth().padding(8.dp, 4.dp), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { state.clearAll() }) { Text("Clear all") }
        }
        LazyColumn(Modifier.heightIn(max = 300.dp)) {
            items(notifications, key = { it.id }) { notification ->
                Card(modifier = Modifier.fillMaxWidth().padding(8.dp, 4.dp)) {
                    Row(Modifier.padding(12.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(notification.message, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { state.remove(notification.id) }) { Text("Dismiss") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SortingTabContent(
    repository: KardiSynchRepository,
    expanded: Boolean,
    pendingSortCount: Int,
    onDismissPendingSort: ((String) -> Unit)?,
    onOpenPendingSortQueue: (() -> Unit)?,
    closePopover: () -> Unit,
) {
    var tasks by remember { mutableStateOf<List<PendingSortTasks>?>(null) }
    LaunchedEffect(expanded, pendingSortCount) {
        if (expanded) tasks = repository.getPendingSortTasks()
    }
    val current = tasks
    when {
        current == null -> Box(Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        current.isEmpty() -> EmptyTabMessage("Nothing to sort")
        else -> Column {
            LazyColumn(Modifier.heightIn(max = 260.dp)) {
                items(current, key = { it.id }) { task ->
                    Card(modifier = Modifier.fillMaxWidth().padding(8.dp, 4.dp)) {
                        Row(Modifier.padding(12.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(task.originalFileName, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    task.suggestedPatientName?.let { "$it${task.manufacturer?.let { m -> " · $m" } ?: ""}" } ?: "Unknown patient",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            if (onDismissPendingSort != null) {
                                TextButton(onClick = { onDismissPendingSort(task.id) }) { Text("Dismiss") }
                            }
                        }
                    }
                }
            }
            if (onOpenPendingSortQueue != null) {
                TextButton(
                    onClick = { closePopover(); onOpenPendingSortQueue() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Open sorting queue →") }
            }
        }
    }
}

@Composable
private fun ActivityTabContent(tasks: List<ActivityTask>) {
    if (tasks.isEmpty()) {
        EmptyTabMessage("No active tasks")
        return
    }
    Column {
        tasks.forEach { task ->
            Card(modifier = Modifier.fillMaxWidth().padding(8.dp, 4.dp)) {
                Column(Modifier.padding(12.dp, 8.dp)) {
                    Text(task.title, style = MaterialTheme.typography.bodySmall)
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun ImportsTabContent(
    repository: KardiSynchRepository,
    expanded: Boolean,
    onOpenImportHistory: () -> Unit,
    closePopover: () -> Unit,
) {
    var sessions by remember { mutableStateOf<List<ImportSessions>?>(null) }
    LaunchedEffect(expanded) {
        if (expanded) sessions = repository.getImportHistory(limit = 5)
    }
    val current = sessions
    when {
        current == null -> Box(Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        current.isEmpty() -> EmptyTabMessage("No import history")
        else -> Column {
            current.forEach { session ->
                Card(modifier = Modifier.fillMaxWidth().padding(8.dp, 4.dp)) {
                    Column(Modifier.padding(12.dp, 8.dp)) {
                        Text(session.status ?: "Unknown status", style = MaterialTheme.typography.bodySmall)
                        session.summary?.let {
                            Text(it, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            TextButton(
                onClick = { closePopover(); onOpenImportHistory() },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("View full history →") }
        }
    }
}
