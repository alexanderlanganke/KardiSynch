package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One battery-voltage reading for [BatteryTrendChart] — chronologically ascending order is the caller's responsibility. */
data class BatteryTrendPoint(val date: String, val voltage: Double, val deviceSerial: String?)

/**
 * A battery-voltage-over-time line chart — ported from `TrendChart.tsx`
 * (issue #198), specifically its "break the line across a generator
 * change" behavior (a device replacement means a fresh battery — one
 * continuous line across that boundary would read as a physically
 * impossible voltage jump/recovery). Scoped down from the original in two
 * ways: only battery voltage is charted, not the original's additional
 * per-lead impedance/sensing/pacing-threshold trends (a separate,
 * larger follow-up); and points are evenly spaced by visit order rather
 * than scaled by actual elapsed calendar time (a real simplification —
 * two visits a week apart and two a year apart look the same width here).
 *
 * Draws nothing (not even the frame) when [points] has fewer than 2
 * voltage readings — a single point has no "trend" to show.
 */
@Composable
fun BatteryTrendChart(points: List<BatteryTrendPoint>) {
    if (points.size < 2) return

    val textMeasurer = rememberTextMeasurer()
    val lineColor = MaterialTheme.colorScheme.primary
    val axisColor = MaterialTheme.colorScheme.onSurfaceVariant
    val labelStyle = TextStyle(fontSize = 11.sp, color = axisColor)

    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Text("Battery voltage trend", style = MaterialTheme.typography.titleSmall)

        val minVoltage = points.minOf { it.voltage }
        val maxVoltage = points.maxOf { it.voltage }
        val range = (maxVoltage - minVoltage).takeIf { it > 0.0 } ?: 1.0

        Canvas(modifier = Modifier.fillMaxWidth().height(180.dp).padding(top = 8.dp)) {
            val leftPad = 44f
            val bottomPad = 20f
            val topPad = 8f
            val plotWidth = size.width - leftPad
            val plotHeight = size.height - bottomPad - topPad
            val stepX = if (points.size > 1) plotWidth / (points.size - 1) else 0f

            fun xOf(index: Int) = leftPad + stepX * index
            fun yOf(voltage: Double) = topPad + (1.0 - (voltage - minVoltage) / range).toFloat() * plotHeight

            // Axis line + min/max voltage labels.
            drawLine(axisColor, Offset(leftPad, topPad), Offset(leftPad, topPad + plotHeight), strokeWidth = 1f)
            drawLine(axisColor, Offset(leftPad, topPad + plotHeight), Offset(size.width, topPad + plotHeight), strokeWidth = 1f)
            drawText(textMeasurer, "%.2f".format(maxVoltage), Offset(0f, topPad), labelStyle)
            drawText(textMeasurer, "%.2f".format(minVoltage), Offset(0f, topPad + plotHeight - 14f), labelStyle)

            // One line segment per consecutive pair — dashed instead of solid
            // when the device serial changed between them (a generator change).
            for (i in 0 until points.size - 1) {
                val from = points[i]
                val to = points[i + 1]
                val isGeneratorChange = from.deviceSerial != null && to.deviceSerial != null && from.deviceSerial != to.deviceSerial
                drawLine(
                    color = lineColor,
                    start = Offset(xOf(i), yOf(from.voltage)),
                    end = Offset(xOf(i + 1), yOf(to.voltage)),
                    strokeWidth = 3f,
                    pathEffect = if (isGeneratorChange) PathEffect.dashPathEffect(floatArrayOf(10f, 8f)) else null,
                )
            }
            points.forEachIndexed { i, p -> drawCircle(lineColor, radius = 4f, center = Offset(xOf(i), yOf(p.voltage))) }

            drawText(textMeasurer, points.first().date, Offset(leftPad, topPad + plotHeight + 4f), labelStyle)
            val lastLabel = textMeasurer.measure(points.last().date, labelStyle)
            drawText(textMeasurer, points.last().date, Offset(size.width - lastLabel.size.width, topPad + plotHeight + 4f), labelStyle)
        }

        val hasGeneratorChange = remember(points) {
            (0 until points.size - 1).any { i -> points[i].deviceSerial != null && points[i + 1].deviceSerial != null && points[i].deviceSerial != points[i + 1].deviceSerial }
        }
        Text(
            if (hasGeneratorChange) "Solid = same device · Dashed = across a generator change" else "Voltage (V) across all visits with a reading",
            style = MaterialTheme.typography.labelSmall,
        )
    }
}
