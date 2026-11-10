package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.ui.format.displayNumber
import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.util.isCriticalBatteryStatus
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors

/** What the banner says, or null when there is nothing to flag. Pure so it can be tested without a screen. */
internal fun batteryConcernText(reports: List<Reports>): String? {
    val sorted = reports.sortedBy { it.interrogationDate }
    val latest = sorted.lastOrNull() ?: return null
    if (!isCriticalBatteryStatus(latest.batteryStatus)) return null
    val previous = sorted.dropLast(1).lastOrNull { it.batteryVoltageValue != null }
    val trend = if (previous != null && latest.batteryVoltageValue != null) {
        " " + tr("Voltage {a} V on {date}, {b} V now.", "a" to displayNumber(previous.batteryVoltageValue!!), "date" to displayDate(previous.interrogationDate), "b" to displayNumber(latest.batteryVoltageValue!!))
    } else {
        ""
    }
    return tr("The {date} visit reports battery status \"{status}\".", "date" to displayDate(latest.interrogationDate), "status" to latest.batteryStatus) + trend
}

/** A screening cue, not a medical assessment: shown above the visits when the latest report says ERI, EOS or EOL. */
@Composable
fun ConcernBanner(reports: List<Reports>, modifier: Modifier = Modifier) {
    val text = batteryConcernText(reports) ?: return
    val palette = statusColors()
    Surface(modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = palette.attentionContainer) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Status.ATTENTION.icon, contentDescription = tr("Needs attention"), tint = palette.onAttention, modifier = Modifier.size(24.dp))
            Text(
                tr("Battery at replacement threshold.") + " " + text,
                style = MaterialTheme.typography.bodyMedium, color = palette.onAttention, fontWeight = FontWeight.Normal,
            )
        }
    }
}

internal fun hasBatteryConcern(reports: List<Reports>?): Boolean = reports != null && batteryConcernText(reports) != null
