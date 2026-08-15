package io.github.alexanderlanganke.kardisynch.ui.pendingsort

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog

/**
 * Reviews the manual-sort queue (issue #172/#173) — every file the
 * import-identity ladder wasn't confident enough to attach automatically.
 * A task with a suggested patient can be Approved (attached to that
 * patient) or Dismissed (moved to `_unmatched`); every task can also be
 * assigned to an arbitrary OTHER patient via [PatientPickerDialog] (issue
 * #178 — this used to need a patient-search component this app didn't
 * have anywhere yet).
 *
 * Not reactive (no `observe*` query backs this list, unlike the dashboard)
 * — [onApprove]/[onDismiss] are expected to trigger a reload via changing
 * [refreshKey] once the platform-side action completes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PendingSortScreen(
    repository: KardiSynchRepository,
    refreshKey: Any,
    onBack: () -> Unit,
    onApprove: (taskId: String, patientId: String) -> Unit,
    onDismiss: (taskId: String) -> Unit,
) {
    var tasks by remember { mutableStateOf<List<PendingSortTasks>?>(null) }
    var pickerForTaskId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(refreshKey) {
        tasks = repository.getPendingSortTasks()
    }

    pickerForTaskId?.let { taskId ->
        PatientPickerDialog(
            repository = repository,
            title = "Assign this file to which patient?",
            onDismiss = { pickerForTaskId = null },
            onPicked = { patientId ->
                pickerForTaskId = null
                onApprove(taskId, patientId)
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pending sort") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        val current = tasks
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
            ) { Text("Nothing waiting for review.", style = MaterialTheme.typography.bodyMedium) }

            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(current, key = { it.id }) { task ->
                    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(task.originalFileName, style = MaterialTheme.typography.titleMedium)
                            listOfNotNull(task.manufacturer, task.deviceModel, task.interrogationDate)
                                .takeIf { it.isNotEmpty() }
                                ?.let { Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall) }
                            Text(task.note, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))

                            Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.End) {
                                OutlinedButton(onClick = { onDismiss(task.id) }) { Text("Dismiss") }
                                OutlinedButton(
                                    onClick = { pickerForTaskId = task.id },
                                    modifier = Modifier.padding(start = 8.dp),
                                ) { Text("Assign to...") }
                                task.suggestedPatientId?.let { suggestedId ->
                                    Button(
                                        onClick = { onApprove(task.id, suggestedId) },
                                        modifier = Modifier.padding(start = 8.dp),
                                    ) { Text("Approve: ${task.suggestedPatientName ?: "suggested patient"}") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
