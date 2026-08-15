package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
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
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.lookupDeviceAlias
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads

private data class LeadFormRow(
    val key: Int,
    val name: String,
    val manufacturer: String,
    val model: String,
    val anatomicLocation: String,
    val serial: String,
    val implantDate: String,
    val preserved: LeadData?,
)

private fun String.blankToNull() = ifBlank { null }

/**
 * Manually corrects a visit's device identity and lead roster — ported
 * from `DeviceLeadEditor.tsx`, adapted to what this port's data model
 * actually supports (parity plan Phase 8): [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.updateReportDeviceAndLeads]'s
 * doc comment has the full detail on the two things NOT ported —
 * multiple current/explanted devices per patient, and a lead connector
 * field — both would need real data-model changes first, not just UI
 * work. Suggests a device type from the learned alias store
 * ([aliases]) when the manufacturer+model match one, same as the
 * automatic import path already does — purely informational here,
 * doesn't overwrite a value the user already typed.
 */
@Composable
fun DeviceLeadEditorDialog(
    manufacturer: String,
    device: Devices?,
    leads: List<Leads>,
    aliases: List<DeviceTypeAlias>,
    onDismiss: () -> Unit,
    onSave: (manufacturer: String, device: DeviceInfo, leads: List<LeadData>) -> Unit,
) {
    var manufacturerField by remember { mutableStateOf(manufacturer) }
    var deviceType by remember { mutableStateOf(device?.type.orEmpty()) }
    var deviceModel by remember { mutableStateOf(device?.model.orEmpty()) }
    var deviceSerial by remember { mutableStateOf(device?.serialNumber.orEmpty()) }
    var deviceImplantDate by remember { mutableStateOf(device?.implantDate.orEmpty()) }

    var nextKey by remember { mutableStateOf(leads.size) }
    var leadRows by remember {
        mutableStateOf(
            leads.mapIndexed { i, l ->
                LeadFormRow(
                    key = i,
                    name = l.name,
                    manufacturer = l.manufacturer.orEmpty(),
                    model = l.model.orEmpty(),
                    anatomicLocation = l.anatomicLocation.orEmpty(),
                    serial = l.serial.orEmpty(),
                    implantDate = l.implantDate.orEmpty(),
                    // Preserved verbatim — this dialog only edits identity fields, never the device readout's measurement values.
                    preserved = LeadData(
                        name = l.name,
                        pacingThreshold = l.pacingThresholdValue?.let { v -> Measurement(v, l.pacingThresholdUnit.orEmpty()) },
                        pacingAmplitude = l.pacingAmplitudeValue?.let { v -> Measurement(v, l.pacingAmplitudeUnit.orEmpty()) },
                        sensing = l.sensingValue?.let { v -> Measurement(v, l.sensingUnit.orEmpty()) },
                        impedance = l.impedanceValue?.let { v -> Measurement(v, l.impedanceUnit.orEmpty()) },
                        shockImpedance = l.shockImpedanceValue?.let { v -> Measurement(v, l.shockImpedanceUnit.orEmpty()) },
                    ),
                )
            },
        )
    }

    val suggestedType = remember(manufacturerField, deviceModel, aliases) {
        lookupDeviceAlias(aliases, manufacturerField, deviceModel)?.takeIf { deviceType.isBlank() }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit device & leads") },
        text = {
            Column(modifier = Modifier.heightIn(max = 480.dp)) {
                LazyColumn(modifier = Modifier.weight(1f, fill = false)) {
                    item {
                        Text("Device", style = MaterialTheme.typography.titleSmall)
                        OutlinedTextField(manufacturerField, { manufacturerField = it }, label = { Text("Manufacturer") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                        OutlinedTextField(deviceType, { deviceType = it }, label = { Text("Type") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                        suggestedType?.let { suggestion ->
                            TextButton(onClick = { deviceType = suggestion }) { Text("Suggested: $suggestion (unverified)", style = MaterialTheme.typography.labelSmall) }
                        }
                        OutlinedTextField(deviceModel, { deviceModel = it }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                        OutlinedTextField(deviceSerial, { deviceSerial = it }, label = { Text("Serial") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                        OutlinedTextField(deviceImplantDate, { deviceImplantDate = it }, label = { Text("Implant date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)

                        Text("Leads", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
                    }

                    items(leadRows, key = { it.key }) { row ->
                        Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(row.name.ifBlank { "Lead" }, style = MaterialTheme.typography.bodyMedium)
                                    TextButton(onClick = { leadRows = leadRows - row }) { Text("Remove") }
                                }
                                OutlinedTextField(row.name, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(name = v) else it } }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                OutlinedTextField(row.anatomicLocation, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(anatomicLocation = v) else it } }, label = { Text("Anatomic location") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), singleLine = true)
                                OutlinedTextField(row.manufacturer, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(manufacturer = v) else it } }, label = { Text("Manufacturer") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), singleLine = true)
                                OutlinedTextField(row.model, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(model = v) else it } }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), singleLine = true)
                                OutlinedTextField(row.serial, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(serial = v) else it } }, label = { Text("Serial") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), singleLine = true)
                                OutlinedTextField(row.implantDate, { v -> leadRows = leadRows.map { if (it.key == row.key) it.copy(implantDate = v) else it } }, label = { Text("Implant date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), singleLine = true)
                            }
                        }
                    }

                    item {
                        TextButton(
                            onClick = {
                                leadRows = leadRows + LeadFormRow(nextKey, "", "", "", "", "", "", null)
                                nextKey++
                            },
                            modifier = Modifier.padding(top = 8.dp),
                        ) { Text("Add lead") }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val editedDevice = DeviceInfo(
                        type = deviceType.ifBlank { "Unknown" },
                        model = deviceModel.ifBlank { "Unknown" },
                        serialNumber = deviceSerial.ifBlank { "Unknown" },
                        implantDate = deviceImplantDate.blankToNull(),
                    )
                    val editedLeads = leadRows.map { row ->
                        val base = row.preserved ?: LeadData(name = row.name)
                        base.copy(
                            name = row.name,
                            manufacturer = row.manufacturer.blankToNull(),
                            model = row.model.blankToNull(),
                            serial = row.serial.blankToNull(),
                            anatomicLocation = row.anatomicLocation.blankToNull(),
                            implantDate = row.implantDate.blankToNull(),
                        )
                    }
                    onSave(manufacturerField.ifBlank { "Unknown" }, editedDevice, editedLeads)
                },
                enabled = manufacturerField.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
