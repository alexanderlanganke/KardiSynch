package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients

/**
 * Confirms which freshly re-scanned sections should overwrite what's
 * currently stored for a visit — ported from `DataMergeModal.tsx` (parity
 * plan Phase 9), shown after the "Rescan" action re-parses a visit's raw
 * files still on disk (see [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.rescanVisit]).
 * Collapsed from Electron's 3 independently-checkable rows (demographics/
 * device/leads) to 2 — device and leads always merge together here since
 * both apply through the same [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.updateReportDeviceAndLeads]
 * write path (Phase 8), so splitting them wouldn't let the user do
 * anything the underlying write path can't already do atomically.
 */
@Composable
fun RescanDiffDialog(
    currentPatient: Patients,
    currentDevices: List<Devices>,
    currentLeads: List<Leads>,
    scanned: UnifiedReport,
    onDismiss: () -> Unit,
    onConfirm: (applyDemographics: Boolean, applyDeviceLeads: Boolean) -> Unit,
) {
    val currentDemographics = "${currentPatient.lastName}, ${currentPatient.firstName.orEmpty()} · DOB ${currentPatient.dob}" +
        (currentPatient.hospitalPatientId?.let { " · MRN $it" } ?: "")
    val scannedDemographics = "${scanned.patient.lastName}, ${scanned.patient.firstName} · DOB ${scanned.patient.dob}" +
        (scanned.patient.hospitalPatientId?.let { " · MRN $it" } ?: "")
    val demographicsDiffer = currentDemographics != scannedDemographics

    val currentDevice = currentDevices.firstOrNull()
    val currentDeviceLeadsText = buildString {
        append(currentDevice?.let { "${it.type} ${it.model} (${it.serialNumber})" } ?: "No device on file")
        append(" · ${currentLeads.size} lead(s)")
        if (currentLeads.isNotEmpty()) append(": ${currentLeads.joinToString { it.name }}")
    }
    val scannedDeviceLeadsText = buildString {
        append("${scanned.device.type} ${scanned.device.model} (${scanned.device.serialNumber})")
        append(" · ${scanned.leads.size} lead(s)")
        if (scanned.leads.isNotEmpty()) append(": ${scanned.leads.joinToString { it.name }}")
    }
    val deviceLeadsDiffer = currentDeviceLeadsText != scannedDeviceLeadsText

    var applyDemographics by remember { mutableStateOf(demographicsDiffer) }
    var applyDeviceLeads by remember { mutableStateOf(deviceLeadsDiffer) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Merge rescanned data?") },
        text = {
            Column {
                DiffRow("Demographics", currentDemographics, scannedDemographics, demographicsDiffer, applyDemographics) { applyDemographics = it }
                DiffRow("Device & leads", currentDeviceLeadsText, scannedDeviceLeadsText, deviceLeadsDiffer, applyDeviceLeads) { applyDeviceLeads = it }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(applyDemographics, applyDeviceLeads) },
                enabled = applyDemographics || applyDeviceLeads,
            ) { Text("Merge selected") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DiffRow(label: String, current: String, scanned: String, differs: Boolean, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.Top) {
            Checkbox(checked = checked, onCheckedChange = onCheckedChange)
            Column {
                Text("$label ${if (differs) "(differs)" else "(same)"}", style = MaterialTheme.typography.titleSmall)
                Text("Current: $current", style = MaterialTheme.typography.bodySmall)
                Text("New: $scanned", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
