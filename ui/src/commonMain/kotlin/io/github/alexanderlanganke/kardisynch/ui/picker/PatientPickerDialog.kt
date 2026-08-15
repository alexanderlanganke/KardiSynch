package io.github.alexanderlanganke.kardisynch.ui.picker

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository

/**
 * Reusable "find an existing patient" search dialog — ported from
 * `PatientAssignmentModal.tsx`'s "Find Existing" tab (issue #178): a
 * plain, case-insensitive substring filter over the full local patient
 * list, not a fuzzy search. Backs the "assign to a different patient"
 * action on the pending-sort queue (#172/#173) and "move to a different
 * patient" on a report (#177) — both already had a backend, neither had a
 * way to pick an arbitrary target patient before this.
 */
@Composable
fun PatientPickerDialog(
    repository: KardiSynchRepository,
    title: String,
    onDismiss: () -> Unit,
    onPicked: (patientId: String) -> Unit,
) {
    val patients by repository.observePatients().collectAsState(initial = emptyList())
    var query by remember { mutableStateOf("") }

    val filtered = remember(patients, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) {
            patients
        } else {
            patients.filter { p ->
                "${p.lastName} ${p.firstName.orEmpty()}".lowercase().contains(q) ||
                    p.hospitalPatientId?.lowercase()?.contains(q) == true
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Search by name or hospital ID") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                if (filtered.isEmpty()) {
                    Text(
                        "No matching patients.",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                } else {
                    LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).padding(top = 8.dp)) {
                        items(filtered, key = { it.id }) { patient ->
                            TextButton(onClick = { onPicked(patient.id) }, modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.fillMaxWidth()) {
                                    Text("${patient.lastName}, ${patient.firstName.orEmpty()}", style = MaterialTheme.typography.bodyMedium)
                                    Text("DOB ${patient.dob}", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
