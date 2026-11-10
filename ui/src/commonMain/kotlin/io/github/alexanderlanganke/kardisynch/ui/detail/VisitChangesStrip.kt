package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.util.LeadSnapshot
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.core.util.VisitChange
import io.github.alexanderlanganke.kardisynch.core.util.VisitSnapshot
import io.github.alexanderlanganke.kardisynch.core.util.diffVisits
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Reports

private suspend fun snapshot(repository: KardiSynchRepository, report: Reports): VisitSnapshot =
    VisitSnapshot(
        batteryVoltage = report.batteryVoltageValue,
        batteryStatus = report.batteryStatus,
        leads = repository.getLeadsForReport(report.id).map {
            LeadSnapshot(it.name, impedance = it.impedanceValue, threshold = it.pacingThresholdValue, sensing = it.sensingValue)
        },
    )

/**
 * Under the two-pane viewer: what changed between the two visits on show
 * (earlier to later, whichever pane each is in) and the "Scroll together"
 * switch that links the panes' PDF scrolling. Only appears when both panes
 * show a visit.
 */
@Composable
fun VisitChangesStrip(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    selections: List<PaneSelection?>,
    scrollTogether: Boolean,
    onScrollTogetherChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shown = selections.mapNotNull { (it as? PaneSelection.Visit)?.reportId }.mapNotNull { id -> reports.firstOrNull { it.id == id } }
    if (shown.size != 2 || shown[0].id == shown[1].id) return
    val (earlier, later) = shown.sortedBy { it.interrogationDate }

    var changes by remember(earlier.id, later.id) { mutableStateOf<List<VisitChange>?>(null) }
    LaunchedEffect(earlier.id, later.id) {
        changes = diffVisits(snapshot(repository, earlier), snapshot(repository, later))
    }

    Surface(modifier = modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val list = changes
            Text(
                when {
                    list == null -> tr("Comparing…")
                    list.isEmpty() -> tr("No measurable change between {a} and {b}", "a" to displayDate(earlier.interrogationDate), "b" to displayDate(later.interrogationDate))
                    list.size == 1 -> tr("1 change since {date}", "date" to displayDate(earlier.interrogationDate))
                    else -> tr("{n} changes since {date}", "n" to list.size, "date" to displayDate(earlier.interrogationDate))
                },
                style = MaterialTheme.typography.labelLarge,
            )
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val all = list.orEmpty()
                (all.take(2).map { it.text } + listOfNotNull(if (all.size > 2) tr("+{n} more", "n" to (all.size - 2)) else null)).forEach { text ->
                    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, maxLines = 1, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp))
                    }
                }
            }
            Text(tr("Scroll together"), style = MaterialTheme.typography.labelLarge)
            Switch(
                checked = scrollTogether,
                onCheckedChange = onScrollTogetherChange,
                modifier = Modifier.semantics { contentDescription = tr("Scroll the two reports together") },
            )
        }
    }
}
