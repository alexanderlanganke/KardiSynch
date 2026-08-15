package io.github.alexanderlanganke.kardisynch.ui.pendingsort

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
import io.github.alexanderlanganke.kardisynch.ui.detail.RawFileViewer
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog

/**
 * Manually types in device identity for a pending-sort file the parser
 * couldn't read at all — ported from `DeviceSelectionModal.tsx` (parity
 * plan Phase 10), the escape hatch that previously didn't exist here: such
 * a file could only be Dismissed to `_unmatched`, never actually filed.
 * Reuses [RawFileViewer] for the live preview by wrapping the task's plain
 * staged-file path as a single-item [DataEntry] list — [onReadBytes]/
 * [onReadText] just need to resolve that path, no `DataRootReader`
 * involved (a pending-sort task's staged file lives outside `_DATA`
 * entirely, in the import folder). No lead fields — matching the
 * original's own scope, this only captures device identity.
 */
@Composable
fun ManualTranscriptionDialog(
    task: PendingSortTasks,
    repository: KardiSynchRepository,
    onReadBytes: suspend (String) -> ByteArray?,
    onReadText: suspend (String) -> String?,
    onDismiss: () -> Unit,
    onSave: (patientId: String, manufacturer: String, deviceType: String, deviceModel: String, deviceSerial: String, interrogationDate: String) -> Unit,
) {
    var patientId by remember { mutableStateOf<String?>(null) }
    var patientLabel by remember { mutableStateOf<String?>(null) }
    var showPicker by remember { mutableStateOf(false) }
    var manufacturer by remember { mutableStateOf(task.manufacturer.orEmpty()) }
    var deviceType by remember { mutableStateOf("") }
    var deviceModel by remember { mutableStateOf(task.deviceModel.orEmpty()) }
    var deviceSerial by remember { mutableStateOf(task.deviceSerial.orEmpty()) }
    var interrogationDate by remember { mutableStateOf(task.interrogationDate.orEmpty()) }

    if (showPicker) {
        PatientPickerDialog(
            repository = repository,
            title = "Which patient does this file belong to?",
            onDismiss = { showPicker = false },
            onPicked = { pickedId ->
                patientId = pickedId
                showPicker = false
            },
        )
    }
    LaunchedEffect(patientId) {
        val id = patientId
        patientLabel = id?.let { repository.getPatientById(it) }?.let { "${it.lastName}, ${it.firstName.orEmpty()}" }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Manual entry: ${task.originalFileName}") },
        text = {
            Column(modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                RawFileViewer(
                    files = listOf(DataEntry(name = task.originalFileName, handle = task.stagedFilePath, isDirectory = false)),
                    onReadBytes = onReadBytes,
                    onReadText = onReadText,
                )
                Text("Patient", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
                TextButton(onClick = { showPicker = true }) { Text(patientLabel ?: "Choose patient…") }
                Text("Device", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                OutlinedTextField(manufacturer, { manufacturer = it }, label = { Text("Manufacturer") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(deviceType, { deviceType = it }, label = { Text("Type (Pacemaker/ICD/…)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(deviceModel, { deviceModel = it }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(deviceSerial, { deviceSerial = it }, label = { Text("Serial") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(interrogationDate, { interrogationDate = it }, label = { Text("Interrogation date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val id = patientId
                    if (id != null) onSave(id, manufacturer.ifBlank { "Unknown" }, deviceType.ifBlank { "Unknown" }, deviceModel.ifBlank { "Unknown" }, deviceSerial.ifBlank { "Unknown" }, interrogationDate)
                },
                enabled = patientId != null && interrogationDate.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
