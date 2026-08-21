package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.aliases.ConnectorFlag
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.getConnectorFlag
import io.github.alexanderlanganke.kardisynch.core.mri.ManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.util.ageInYears
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports

/** A patient hasn't been seen recently enough to be worth flagging — matches the Dashboard's own threshold (issue #197). */
private const val NOTABLE_DAYS_SINCE_VISIT = 180

/**
 * The expandable patient header from `PatientDetail.tsx` (UI-parity
 * follow-up): a single dense always-visible summary row — name, DOB/age,
 * device+lead-count summary, MRI-check link, warning badge, last-visit
 * date/days-ago, visit count — that expands on tap into a two-column
 * devices/leads breakdown.
 *
 * Two adaptations from the original, both preserving already-working,
 * separately-tested dialogs rather than merging them:
 * - Electron's single "Edit Patient & Devices" dialog covers demographics
 *   and devices/leads together. This port already has two separate,
 *   working dialogs for those ([PatientInfoEditDialog], per Phase 1;
 *   [DeviceLeadEditorDialog], per Phase 8) — both are offered from the
 *   expanded area instead of merging them into one.
 * - "Devices"/"leads" here means the *latest visit's* rows, not a
 *   separately maintained patient-level roster — this port's Decision 3
 *   (see [KardiSynchRepository]'s doc comments): "current" devices/leads
 *   are always derived from the most recent report, never a persisted
 *   device/lead history. No explanted-status badge follows for the same
 *   reason: nothing here tracks device status across visits.
 */
@Composable
fun PatientHeaderSection(
    patient: Patients,
    reports: List<Reports>,
    latestDevice: Devices?,
    latestLeads: List<Leads>?,
    todayIso: String?,
    onOpenUrl: ((String) -> Unit)?,
    onEditPatientInfo: (() -> Unit)?,
    onEditDeviceAndLeads: (() -> Unit)?,
    onExportLatestVisitQr: (() -> Unit)?,
    deviceTypeAliases: List<DeviceTypeAlias> = emptyList(),
) {
    var expanded by remember { mutableStateOf(false) }
    val mostRecent = reports.maxByOrNull { it.interrogationDate }
    val age = todayIso?.let { ageInYears(patient.dob, it) }
    val daysSinceLastVisit = todayIso?.let { today -> mostRecent?.let { daysBetweenIsoDates(it.interrogationDate, today) } }
    val warning = parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
        ?.takeIf { it.status == "advisory" || it.status == "recall" }

    Card(modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp), shape = MaterialTheme.shapes.small) {
        Column(modifier = Modifier.padding(4.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("${patient.lastName}, ${patient.firstName.orEmpty()}", style = MaterialTheme.typography.titleSmall)
                Text(patient.dob + (age?.let { " (${it}y)" } ?: ""), style = MaterialTheme.typography.labelSmall)
                HeaderDivider()
                Text(deviceLeadSummary(latestDevice, latestLeads), style = MaterialTheme.typography.labelSmall)
                if (onOpenUrl != null) {
                    mriCheckUrl(mostRecent?.manufacturer)?.let { url ->
                        AssistChip(onClick = { onOpenUrl(url) }, label = { Text("Check MRI", style = MaterialTheme.typography.labelSmall) })
                    }
                }
                if (warning != null) {
                    AssistChip(
                        onClick = { warning.link?.let { onOpenUrl?.invoke(it) } },
                        label = { Text(if (warning.status == "recall") "⚠ Recall" else "⚠ Advisory", style = MaterialTheme.typography.labelSmall) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            labelColor = MaterialTheme.colorScheme.onErrorContainer,
                        ),
                    )
                }
                HeaderDivider()
                Text(
                    mostRecent?.let { "${isoDateOnly(it.interrogationDate)}${daysSinceLastVisit?.let { d -> " (${d}d)" } ?: ""}" } ?: "No visits",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (daysSinceLastVisit != null && daysSinceLastVisit > NOTABLE_DAYS_SINCE_VISIT) {
                        Color(0xFF9A6700)
                    } else {
                        Color.Unspecified
                    },
                )
                AssistChip(onClick = {}, label = { Text("${reports.size} visit${if (reports.size == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall) })
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "▲ Details" else "▼ Details") }
            }

            if (expanded) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                        if (onEditPatientInfo != null) TextButton(onClick = onEditPatientInfo) { Text("Edit patient info") }
                        if (onEditDeviceAndLeads != null) TextButton(onClick = onEditDeviceAndLeads) { Text("Edit device & leads") }
                        if (onExportLatestVisitQr != null) TextButton(onClick = onExportLatestVisitQr) { Text("Export QR") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("DEVICE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (latestDevice != null) {
                                Text("${latestDevice.model} · ${latestDevice.type}", style = MaterialTheme.typography.bodySmall)
                                Text("SN: ${latestDevice.serialNumber}", style = MaterialTheme.typography.bodySmall)
                                latestDevice.implantDate?.let { Text("Implanted: $it", style = MaterialTheme.typography.bodySmall) }
                            } else {
                                Text("No device recorded", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text("LEADS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            val leads = latestLeads.orEmpty()
                            if (leads.isEmpty()) {
                                Text("No leads recorded", style = MaterialTheme.typography.bodySmall)
                            } else {
                                leads.forEach { l ->
                                    val flag = getConnectorFlag(l.manufacturer, l.model, deviceTypeAliases)
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(
                                            "${l.model ?: l.name}${l.anatomicLocation?.let { " · $it" } ?: ""} — SN: ${l.serial ?: "Unknown"}",
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                        if (flag != null) {
                                            ConnectorFlagBadge(flag)
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

    if (warning != null) {
        WarningBanner(warning, onOpenUrl)
    }
    if (daysSinceLastVisit != null && daysSinceLastVisit > NOTABLE_DAYS_SINCE_VISIT) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Text(
                "Last interrogation $daysSinceLastVisit days ago",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(10.dp),
            )
        }
    }
}

@Composable
private fun WarningBanner(warning: ManufacturerWarningStatus, onOpenUrl: ((String) -> Unit)?) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Row(modifier = Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    if (warning.status == "recall") "Manufacturer recall posted" else "Manufacturer advisory posted",
                    style = MaterialTheme.typography.titleSmall,
                )
                if (warning.details.isNotBlank()) Text(warning.details, style = MaterialTheme.typography.bodySmall)
            }
            val link = warning.link
            if (link != null && onOpenUrl != null) {
                TextButton(onClick = { onOpenUrl(link) }) { Text("View details") }
            }
        }
    }
}

/**
 * The DF-1 / IS-1-in-LV-port highlight from `PatientDetail.tsx`'s per-lead
 * amber card+badge (issue #198's connector-flag gap) — condensed to just
 * the badge here since this row is already a single dense line rather than
 * per-lead cards. A trailing "?" marks a seeded-but-not-clinician-confirmed
 * connector, matching the original's differing tooltip copy for that case.
 */
@Composable
private fun ConnectorFlagBadge(flag: ConnectorFlag) {
    val amber = Color(0xFF9A6700)
    val label = if (flag.connector == "IS-1") "IS-1 (LV)" else flag.connector
    AssistChip(
        onClick = {},
        label = { Text(if (flag.confirmed) label else "$label ?", style = MaterialTheme.typography.labelSmall) },
        colors = AssistChipDefaults.assistChipColors(containerColor = amber.copy(alpha = 0.15f), labelColor = amber),
        border = AssistChipDefaults.assistChipBorder(enabled = true, borderColor = amber),
    )
}

/** A thin vertical separator between header segments — mirrors `PatientDetail.tsx`'s `w-px h-4 bg-border/60` bars, which broke the compact row into readable groups instead of a wall of unrelated text. */
@Composable
private fun HeaderDivider() {
    Box(Modifier.height(16.dp).width(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
}

private fun deviceLeadSummary(device: Devices?, leads: List<Leads>?): String {
    val parts = mutableListOf<String>()
    if (device != null) parts += device.model
    val leadCount = leads?.size ?: 0
    if (leadCount > 0) parts += "$leadCount lead${if (leadCount == 1) "" else "s"}"
    return if (parts.isEmpty()) "No device history" else parts.joinToString(" + ")
}
