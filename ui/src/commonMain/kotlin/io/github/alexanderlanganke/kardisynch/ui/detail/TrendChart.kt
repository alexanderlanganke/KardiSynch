package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.alexanderlanganke.kardisynch.core.util.parseIsoEpochDay
import kotlin.math.roundToInt

/** One reading for [TrendChart] — chronologically ascending order is the caller's responsibility. */
data class TrendPoint(val date: String, val value: Double, val deviceSerial: String?)

private const val LEFT_PAD = 44f
private const val BOTTOM_PAD = 20f
private const val TOP_PAD = 8f
private const val TAP_HIT_RADIUS = 40f

/** Pure pixel-space layout for [points] within a [canvasSize] — shared by hit-testing and drawing so both agree on exactly where each point sits. Internal (not private) so [TrendChart]'s desktopTest can verify the time-proportional-spacing math directly, without a full Compose test harness. */
internal class ChartLayout(points: List<TrendPoint>, canvasSize: IntSize) {
    val minValue = points.minOf { it.value }
    val maxValue = points.maxOf { it.value }
    val range = (maxValue - minValue).takeIf { it > 0.0 } ?: 1.0
    val plotWidth = (canvasSize.width - LEFT_PAD).coerceAtLeast(0f)
    val plotHeight = (canvasSize.height - BOTTOM_PAD - TOP_PAD).coerceAtLeast(0f)

    // Time-proportional X (issue #198's follow-up: two visits a week apart
    // and two a year apart used to look the same width). Falls back to
    // even index spacing if any date fails to parse, or every point falls
    // on the same day (zero span) — same degrade-gracefully approach as
    // the rest of this port's date handling.
    private val epochDays = points.map { parseIsoEpochDay(it.date) }
    private val firstDay = epochDays.firstOrNull()
    private val span = epochDays.lastOrNull()?.let { last -> firstDay?.let { first -> last - first } }
    private val timeProportional = epochDays.all { it != null } && span != null && span > 0

    val positions: List<Offset> = points.indices.map { i ->
        val x = if (timeProportional) {
            LEFT_PAD + plotWidth * (epochDays[i]!! - firstDay!!).toFloat() / span!!.toFloat()
        } else {
            val stepX = if (points.size > 1) plotWidth / (points.size - 1) else 0f
            LEFT_PAD + stepX * i
        }
        val y = TOP_PAD + (1.0 - (points[i].value - minValue) / range).toFloat() * plotHeight
        Offset(x, y)
    }
}

/**
 * A single-metric-over-time line chart — ported from `TrendChart.tsx`
 * (issue #198), including its "break the line across a generator change"
 * behavior (a device replacement means fresh hardware — one continuous
 * line across that boundary would misread as physically impossible
 * continuity, whether that's a voltage jump or an implausible
 * lead-impedance discontinuity), its time-proportional X axis, and a
 * tap-to-pin tooltip (the original's hover tooltip has no direct
 * equivalent on a touch target, so tap-to-toggle covers both desktop and
 * Android with one gesture). Originally battery-voltage-only
 * (`BatteryTrendChart`); generalized here so the per-lead impedance/
 * sensing/pacing-threshold trends (issue #198's follow-up UI-parity plan,
 * Phase 5) reuse the same drawing code instead of duplicating it three
 * times.
 *
 * Draws nothing (not even the frame) when [points] has fewer than 2
 * readings — a single point has no "trend" to show.
 */
@Composable
fun TrendChart(title: String, unit: String, points: List<TrendPoint>) {
    if (points.size < 2) return

    val textMeasurer = rememberTextMeasurer()
    val lineColor = MaterialTheme.colorScheme.primary
    val axisColor = MaterialTheme.colorScheme.onSurfaceVariant
    val labelStyle = TextStyle(fontSize = 11.sp, color = axisColor)

    var canvasSize by remember(points) { mutableStateOf(IntSize.Zero) }
    var selectedIndex by remember(points) { mutableStateOf<Int?>(null) }
    val layout = remember(points, canvasSize) { ChartLayout(points, canvasSize) }

    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)

        Box {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .padding(top = 8.dp)
                    .onSizeChanged { canvasSize = it }
                    .pointerInput(points) {
                        detectTapGestures { tapOffset ->
                            val nearest = layout.positions.indices.minByOrNull { i -> (layout.positions[i] - tapOffset).getDistanceSquared() }
                            selectedIndex = if (nearest != null && (layout.positions[nearest] - tapOffset).getDistance() <= TAP_HIT_RADIUS) {
                                if (selectedIndex == nearest) null else nearest
                            } else {
                                null
                            }
                        }
                    },
            ) {
                // Axis line + min/max value labels.
                drawLine(axisColor, Offset(LEFT_PAD, TOP_PAD), Offset(LEFT_PAD, TOP_PAD + layout.plotHeight), strokeWidth = 1f)
                drawLine(axisColor, Offset(LEFT_PAD, TOP_PAD + layout.plotHeight), Offset(size.width, TOP_PAD + layout.plotHeight), strokeWidth = 1f)
                drawText(textMeasurer, "%.2f".format(layout.maxValue), Offset(0f, TOP_PAD), labelStyle)
                drawText(textMeasurer, "%.2f".format(layout.minValue), Offset(0f, TOP_PAD + layout.plotHeight - 14f), labelStyle)

                // One line segment per consecutive pair — dashed instead of solid
                // when the device serial changed between them (a generator change).
                for (i in 0 until points.size - 1) {
                    val from = points[i]
                    val to = points[i + 1]
                    val isGeneratorChange = from.deviceSerial != null && to.deviceSerial != null && from.deviceSerial != to.deviceSerial
                    drawLine(
                        color = lineColor,
                        start = layout.positions[i],
                        end = layout.positions[i + 1],
                        strokeWidth = 3f,
                        pathEffect = if (isGeneratorChange) PathEffect.dashPathEffect(floatArrayOf(10f, 8f)) else null,
                    )
                }
                layout.positions.forEachIndexed { i, p -> drawCircle(lineColor, radius = if (i == selectedIndex) 6f else 4f, center = p) }

                drawText(textMeasurer, points.first().date, Offset(LEFT_PAD, TOP_PAD + layout.plotHeight + 4f), labelStyle)
                val lastLabel = textMeasurer.measure(points.last().date, labelStyle)
                drawText(textMeasurer, points.last().date, Offset(size.width - lastLabel.size.width, TOP_PAD + layout.plotHeight + 4f), labelStyle)
            }

            selectedIndex?.let { i ->
                val point = points[i]
                val pos = layout.positions[i]
                Box(
                    modifier = Modifier
                        .offset { IntOffset(pos.x.roundToInt() - 60, (pos.y - 44f).roundToInt()) }
                        .background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        "${point.date}\n${"%.2f".format(point.value)} $unit",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.inverseOnSurface,
                    )
                }
            }
        }

        val hasGeneratorChange = remember(points) {
            (0 until points.size - 1).any { i -> points[i].deviceSerial != null && points[i + 1].deviceSerial != null && points[i].deviceSerial != points[i + 1].deviceSerial }
        }
        Text(
            if (hasGeneratorChange) "Solid = same device · Dashed = across a generator change" else "$unit across all visits with a reading",
            style = MaterialTheme.typography.labelSmall,
        )
    }
}
