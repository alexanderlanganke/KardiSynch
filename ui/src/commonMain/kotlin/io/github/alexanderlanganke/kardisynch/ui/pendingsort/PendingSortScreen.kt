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
import androidx.compose.material3.Checkbox
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
import io.github.alexanderlanganke.kardisynch.ui.detail.PatientInfoEditDialog
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog

/**
 * Reviews the manual-sort queue (issue #172/#173) — every file the
 * import-identity ladder wasn't confident enough to attach automatically.
 * A task with a suggested patient can be Approved (attached to that
 * patient) or Dismissed (moved to `_unmatched`); every task can also be
 * assigned to an arbitrary OTHER patient via [PatientPickerDialog] (issue
 * #178). Upgraded from single-task-at-a-time to also support (parity plan
 * Phase 10, toward `PatientAssignmentModal.tsx`/`DeviceSelectionModal.tsx`):
 * multi-select bulk assign/dismiss, creating a brand-new patient right from
 * a task instead of requiring one to already exist, and fully manual
 * device-identity entry (with a live file preview) for a file the parser
 * couldn't read at all — previously such a file could only be dismissed,
 * never actually filed. Not ported: duplicate-file detection badges
 * (a real capability gap, but a much smaller one than the manual-entry
 * escape hatch — left for a follow-up).
 *
 * Not reactive (no `observe*` query backs this list, unlike the dashboard)
 * — [onApprove]/[onDismiss]/[onCreateNewPatient]/[onManualAssign] are
 * expected to trigger a reload via changing [refreshKey] once the
 * platform-side action completes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PendingSortScreen(
    repository: KardiSynchRepository,
    refreshKey: Any,
    onBack: () -> Unit,
    onApprove: (taskId: String, patientId: String) -> Unit,
    onDismiss: (taskId: String) -> Unit,
    onCreateNewPatient: ((taskId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)? = null,
    onManualAssign: ((taskId: String, patientId: String, manufacturer: String, deviceType: String, deviceModel: String, deviceSerial: String, interrogationDate: String) -> Unit)? = null,
    onReadStagedFileBytes: (suspend (stagedFilePath: String) -> ByteArray?)? = null,
    onReadStagedFileText: (suspend (stagedFilePath: String) -> String?)? = null,
) {
    var tasks by remember { mutableStateOf<List<PendingSortTasks>?>(null) }
    var pickerForTaskId by remember { mutableStateOf<String?>(null) }
    var newPatientForTaskId by remember { mutableStateOf<String?>(null) }
    var manualEntryForTaskId by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var bulkPickerOpen by remember { mutableStateOf(false) }

    LaunchedEffect(refreshKey) {
        tasks = repository.getPendingSortTasks()
        selected = emptySet()
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

    if (bulkPickerOpen) {
        PatientPickerDialog(
            repository = repository,
            title = "Assign ${selected.size} file(s) to which patient?",
            onDismiss = { bulkPickerOpen = false },
            onPicked = { patientId ->
                bulkPickerOpen = false
                selected.forEach { onApprove(it, patientId) }
            },
        )
    }

    newPatientForTaskId?.let { taskId ->
        PatientInfoEditDialog(
            initialFirstName = "",
            initialLastName = "",
            initialDob = "",
            initialHospitalPatientId = null,
            title = "New patient",
            onDismiss = { newPatientForTaskId = null },
            onSave = { firstName, lastName, dob, hospitalPatientId ->
                newPatientForTaskId = null
                onCreateNewPatient?.invoke(taskId, firstName, lastName, dob, hospitalPatientId)
            },
        )
    }

    if (manualEntryForTaskId != null && onManualAssign != null && onReadStagedFileBytes != null && onReadStagedFileText != null) {
        val task = tasks?.firstOrNull { it.id == manualEntryForTaskId }
        if (task != null) {
            ManualTranscriptionDialog(
                task = task,
                repository = repository,
                onReadBytes = onReadStagedFileBytes,
                onReadText = onReadStagedFileText,
                onDismiss = { manualEntryForTaskId = null },
                onSave = { patientId, manufacturer, deviceType, deviceModel, deviceSerial, interrogationDate ->
                    manualEntryForTaskId = null
                    onManualAssign(task.id, patientId, manufacturer, deviceType, deviceModel, deviceSerial, interrogationDate)
                },
            )
        }
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

            else -> Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                if (selected.isNotEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${selected.size} selected", style = MaterialTheme.typography.bodyMedium)
                        Row {
                            TextButton(onClick = { selected.forEach(onDismiss); selected = emptySet() }) { Text("Dismiss selected") }
                            TextButton(onClick = { bulkPickerOpen = true }) { Text("Assign selected to…") }
                        }
                    }
                }
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(current, key = { it.id }) { task ->
                        Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
                            Row(modifier = Modifier.padding(16.dp)) {
                                Checkbox(
                                    checked = task.id in selected,
                                    onCheckedChange = { checked -> selected = if (checked) selected + task.id else selected - task.id },
                                )
                                Column {
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
                                    Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.End) {
                                        if (onCreateNewPatient != null) {
                                            TextButton(onClick = { newPatientForTaskId = task.id }) { Text("New patient…") }
                                        }
                                        if (onManualAssign != null && onReadStagedFileBytes != null && onReadStagedFileText != null) {
                                            TextButton(onClick = { manualEntryForTaskId = task.id }) { Text("Manual entry…") }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
