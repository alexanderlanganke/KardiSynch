package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Patient identity edit form — ported from the "Patient Information"
 * section embedded in `DeviceLeadEditor.tsx` (issue #178), broken out into
 * its own dialog here since this port's data model doesn't carry the
 * curated device/lead history that editor also managed (Decision 3;
 * issue #176). Wraps [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.updatePatientInfo],
 * already built (issue #177) but never wired to a UI form before this.
 *
 * DOB is a plain `YYYY-MM-DD`-hinted text field, same as the original —
 * neither app validates its format beyond that hint.
 */
@Composable
fun PatientInfoEditDialog(
    initialFirstName: String,
    initialLastName: String,
    initialDob: String,
    initialHospitalPatientId: String?,
    onDismiss: () -> Unit,
    onSave: (firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit,
) {
    var firstName by remember { mutableStateOf(initialFirstName) }
    var lastName by remember { mutableStateOf(initialLastName) }
    var dob by remember { mutableStateOf(initialDob) }
    var hospitalPatientId by remember { mutableStateOf(initialHospitalPatientId.orEmpty()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit patient information") },
        text = {
            Column {
                OutlinedTextField(value = firstName, onValueChange = { firstName = it }, label = { Text("First name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = lastName, onValueChange = { lastName = it }, label = { Text("Last name") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(value = dob, onValueChange = { dob = it }, label = { Text("DOB (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(value = hospitalPatientId, onValueChange = { hospitalPatientId = it }, label = { Text("Hospital patient ID") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(firstName, lastName, dob, hospitalPatientId.trim().takeIf { it.isNotEmpty() }) },
                enabled = lastName.isNotBlank() && dob.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
