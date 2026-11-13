package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository

/** Which visit a pane of the split view shows. */
sealed interface PaneSelection {
    data object Summary : PaneSelection
    data class Visit(val reportId: String) : PaneSelection
}

/**
 * Manufacturer-specific fields not in the standard schema (EF, NYHA class,
 * etc.), merged across every visit — Electron's `SummaryReport.tsx`
 * "Additional Data" card (parity plan Phase 12). Loaded lazily and only
 * when [onGetMergedAdditionalFields] is supplied — unlike almost
 * everything else on this screen, this re-reads every visit.xml from disk
 * (see [KardiSynchRepository.getMergedAdditionalFields]'s doc comment).
 */
@Composable
internal fun AdditionalDataCard(patientId: String, onGetMergedAdditionalFields: suspend (String) -> Map<String, KardiSynchRepository.MergedAdditionalField>) {
    var fields by remember(patientId) { mutableStateOf<Map<String, KardiSynchRepository.MergedAdditionalField>?>(null) }
    LaunchedEffect(patientId) { fields = onGetMergedAdditionalFields(patientId) }

    val current = fields
    if (current.isNullOrEmpty()) return

    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(tr("Additional data"), style = MaterialTheme.typography.titleSmall)
            current.entries.sortedBy { it.key }.forEach { (key, field) ->
                Text(tr("{key}: {value} (as of {date})", "key" to additionalFieldLabel(key), "value" to field.value, "date" to displayDate(field.lastSeenDate)), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * A readable, translated name for the known additional fields; an unknown key is shown as it is. The two sensing
 * values are different things and are named so: the programmed threshold is a SETTING ("Wahrnehmungsschwelle"), the
 * measured signal amplitude is "Wahrnehmung" (see LeadData.sensing).
 */
internal fun additionalFieldLabel(key: String): String = when (key) {
    "rv_sensing_threshold" -> tr("RV sensing threshold (programmed)")
    "ra_sensing_threshold" -> tr("RA sensing threshold (programmed)")
    "ejection_fraction" -> tr("Ejection fraction")
    "nyha_class" -> tr("NYHA class")
    "indications_for_implant" -> tr("Indications for implant")
    else -> key
}

/**
 * Per-lead-location impedance/sensing/pacing-threshold trend charts. A
 * patient can have multiple lead locations (e.g. RA/RV/LV for a CRT
 * device); the chip row picks which one the three charts below plot.
 * Renders nothing if the patient has no lead readings on file at all.
 */
@Composable
internal fun LeadTrendSection(repository: KardiSynchRepository, patientId: String) {
    var locations by remember(patientId) { mutableStateOf<List<String>>(emptyList()) }
    var selectedLocation by remember(patientId) { mutableStateOf<String?>(null) }
    var leadPoints by remember { mutableStateOf<List<KardiSynchRepository.LeadTrendPoint>>(emptyList()) }

    LaunchedEffect(patientId) {
        locations = repository.getLeadLocationsForPatient(patientId)
        selectedLocation = locations.firstOrNull()
    }
    LaunchedEffect(selectedLocation) {
        val location = selectedLocation
        leadPoints = if (location != null) repository.getLeadTrendByLocation(patientId, location) else emptyList()
    }

    if (locations.isEmpty()) return

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(tr("Lead trends"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            locations.forEach { location ->
                FilterChip(selected = selectedLocation == location, onClick = { selectedLocation = location }, label = { Text(location) })
            }
        }

        fun pointsFor(unit: (KardiSynchRepository.LeadTrendPoint) -> String?, value: (KardiSynchRepository.LeadTrendPoint) -> Double?) =
            leadPoints.mapNotNull { p -> value(p)?.let { TrendPoint(isoDateOnly(p.interrogationDate), it, p.deviceSerialNumber) } } to
                (leadPoints.firstNotNullOfOrNull(unit) ?: "")

        val (impedancePoints, impedanceUnit) = pointsFor({ it.impedanceUnit }, { it.impedanceValue })
        TrendChart(tr("Impedance trend"), impedanceUnit, impedancePoints)
        val (sensingPoints, sensingUnit) = pointsFor({ it.sensingUnit }, { it.sensingValue })
        TrendChart(tr("Sensing trend"), sensingUnit, sensingPoints)
        val thresholdUnit = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(leadPoints.firstNotNullOfOrNull { it.pacingThresholdUnit }).unit
        val thresholdPoints = leadPoints.mapNotNull { p ->
            p.pacingThresholdValue?.let { TrendPoint(isoDateOnly(p.interrogationDate), it, p.deviceSerialNumber, io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(p.pacingThresholdUnit).pulseWidthMs, p.pacingAmplitudeValue) }
        }
        ThresholdStackChart(tr("Pacing threshold trend"), thresholdUnit, thresholdPoints)
    }
}
