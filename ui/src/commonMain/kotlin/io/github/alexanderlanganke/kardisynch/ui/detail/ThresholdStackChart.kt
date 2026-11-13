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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import io.github.alexanderlanganke.kardisynch.ui.format.displayNumber
import kotlin.math.roundToInt

/**
 * True when the line between two threshold readings must be dashed: a new generator, a different pulse width, or a
 * reading with a known pulse width next to one without (the two are then not known to be comparable). Two readings
 * that BOTH lack a pulse width stay joined; the chart says so in its legend.
 */
internal fun isThresholdBreak(a: TrendPoint, b: TrendPoint): Boolean =
    isBreak(a, b) || ((a.pulseWidthMs == null) != (b.pulseWidthMs == null))

/** The distinct pulse widths of a series, ascending: they define the rows of the pulse-width strip and the marker colours. */
internal fun pulseLevels(points: List<TrendPoint>): List<Double> = points.mapNotNull { it.pulseWidthMs }.distinct().sorted()

private val THRESHOLD_PANEL_HEIGHT = 110.dp
private val OUTPUT_PANEL_HEIGHT = 52.dp
private val PW_ROW_HEIGHT = 16.dp
private val HEADER_HEIGHT = 16.dp
private val PANEL_GAP = 6.dp
private val AXIS_HEIGHT = 18.dp

/**
 * The pacing-threshold trend as stacked panels on ONE shared time axis:
 *  1. the measured threshold (V), markers coloured by the pulse width it was measured at, the line dashed where two
 *     neighbouring readings are not comparable;
 *  2. the pulse width per visit as a strip (one row per distinct value, plus "?" for unknown);
 *  3. the programmed output (V) as a step line, so the safety margin to the threshold is visible at a glance.
 * Nothing is converted or estimated: every value is shown as the device reported it. Panels 2 and 3 appear only when
 * the series has that information.
 */
@Composable
fun ThresholdStackChart(title: String, unit: String, points: List<TrendPoint>) {
    if (points.size < 2) return

    val textMeasurer = rememberTextMeasurer()
    val axisColor = MaterialTheme.colorScheme.onSurfaceVariant
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val outputColor = MaterialTheme.colorScheme.secondary
    val surfaceColor = MaterialTheme.colorScheme.surface
    val palette = listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.tertiary, MaterialTheme.colorScheme.error, MaterialTheme.colorScheme.secondary)
    val labelStyle = TextStyle(fontSize = 11.sp, color = axisColor)
    val headerStyle = TextStyle(fontSize = 11.sp, color = axisColor)

    val levels = remember(points) { pulseLevels(points) }
    val anyUnknown = remember(points) { points.any { it.pulseWidthMs == null } }
    val pwRows = levels.size + if (anyUnknown && levels.isNotEmpty()) 1 else 0
    val showPulse = levels.isNotEmpty()
    val showOutput = remember(points) { points.any { it.outputValue != null } }
    fun colorOf(pw: Double?) = if (pw == null) axisColor else palette[levels.indexOf(pw).coerceAtLeast(0) % palette.size]

    val totalHeight = HEADER_HEIGHT + THRESHOLD_PANEL_HEIGHT +
        (if (showPulse) PANEL_GAP + HEADER_HEIGHT + PW_ROW_HEIGHT * pwRows else 0.dp) +
        (if (showOutput) PANEL_GAP + HEADER_HEIGHT + OUTPUT_PANEL_HEIGHT else 0.dp) +
        AXIS_HEIGHT

    var canvasSize by remember(points) { mutableStateOf(IntSize.Zero) }
    var selectedIndex by remember(points) { mutableStateOf<Int?>(null) }
    // The shared X positions: the same time-proportional layout the single-metric chart uses.
    val layout = remember(points, canvasSize) { ChartLayout(points, canvasSize) }

    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        if (title.isNotBlank()) Text(title, style = MaterialTheme.typography.titleSmall)

        Box {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(totalHeight)
                    .padding(top = 8.dp)
                    .onSizeChanged { canvasSize = it }
                    .pointerInput(points) {
                        detectTapGestures { tap ->
                            val nearest = layout.positions.indices.minByOrNull { i -> kotlin.math.abs(layout.positions[i].x - tap.x) }
                            selectedIndex = if (nearest != null && kotlin.math.abs(layout.positions[nearest].x - tap.x) <= 40f) {
                                if (selectedIndex == nearest) null else nearest
                            } else {
                                null
                            }
                        }
                    },
            ) {
                val xs = layout.positions.map { it.x }
                val right = size.width
                var y = 0f

                // --- Panel 1: measured threshold --------------------------------------------------------------
                drawText(textMeasurer, "${tr("Pacing threshold")} [$unit]", Offset(0f, y), headerStyle)
                y += HEADER_HEIGHT.toPx()
                val panel1Top = y
                val panel1H = THRESHOLD_PANEL_HEIGHT.toPx()
                val minV = points.minOf { it.value }
                val maxV = points.maxOf { it.value }
                val range = (maxV - minV).takeIf { it > 0.0 } ?: 1.0
                val pad = 8f
                fun yOf(v: Double) = panel1Top + pad + (1.0 - (v - minV) / range).toFloat() * (panel1H - 2 * pad)
                drawLine(axisColor, Offset(LEFT_PAD, panel1Top), Offset(LEFT_PAD, panel1Top + panel1H), strokeWidth = 1f)
                drawLine(gridColor, Offset(LEFT_PAD, panel1Top + panel1H), Offset(right, panel1Top + panel1H), strokeWidth = 1f)
                drawText(textMeasurer, displayNumber(maxV), Offset(0f, yOf(maxV) - 7f), labelStyle)
                if (maxV != minV) drawText(textMeasurer, displayNumber(minV), Offset(0f, yOf(minV) - 7f), labelStyle)
                for (i in 0 until points.size - 1) {
                    drawLine(
                        color = axisColor,
                        start = Offset(xs[i], yOf(points[i].value)),
                        end = Offset(xs[i + 1], yOf(points[i + 1].value)),
                        strokeWidth = 3f,
                        pathEffect = if (isThresholdBreak(points[i], points[i + 1])) PathEffect.dashPathEffect(floatArrayOf(10f, 8f)) else null,
                    )
                }
                points.forEachIndexed { i, p ->
                    val c = Offset(xs[i], yOf(p.value))
                    val r = if (i == selectedIndex) 7f else 5f
                    if (p.pulseWidthMs == null) {
                        drawCircle(surfaceColor, radius = r, center = c)
                        drawCircle(axisColor, radius = r, center = c, style = Stroke(width = 2f))
                    } else {
                        drawCircle(colorOf(p.pulseWidthMs), radius = r, center = c)
                    }
                }
                y = panel1Top + panel1H

                // --- Panel 2: pulse width strip ---------------------------------------------------------------
                if (showPulse) {
                    y += PANEL_GAP.toPx()
                    drawText(textMeasurer, "${tr("Pulse width")} [ms]", Offset(0f, y), headerStyle)
                    y += HEADER_HEIGHT.toPx()
                    val rowH = PW_ROW_HEIGHT.toPx()
                    val rowOf = levels.associateWith { levels.indexOf(it) } // 0 = shortest, drawn on top
                    levels.forEach { lv ->
                        val ry = y + rowOf.getValue(lv) * rowH + rowH / 2
                        drawLine(gridColor, Offset(LEFT_PAD, ry), Offset(right, ry), strokeWidth = 1f)
                        drawText(textMeasurer, displayNumber(lv), Offset(0f, ry - 7f), labelStyle)
                    }
                    val unknownRowY = y + levels.size * rowH + rowH / 2
                    if (anyUnknown) drawText(textMeasurer, "?", Offset(0f, unknownRowY - 7f), labelStyle)
                    points.forEachIndexed { i, p ->
                        val ry = if (p.pulseWidthMs == null) unknownRowY else y + rowOf.getValue(p.pulseWidthMs) * rowH + rowH / 2
                        val x0 = xs[i]
                        val x1 = if (i + 1 < xs.size) xs[i + 1] else minOf(right, x0 + 12f)
                        drawRect(
                            color = colorOf(p.pulseWidthMs),
                            topLeft = Offset(x0, ry - 3f),
                            size = Size((x1 - x0).coerceAtLeast(4f), 6f),
                            alpha = if (p.pulseWidthMs == null) 0.35f else 0.85f,
                        )
                    }
                    y += pwRows * rowH
                }

                // --- Panel 3: programmed output -----------------------------------------------------------------
                if (showOutput) {
                    y += PANEL_GAP.toPx()
                    drawText(textMeasurer, "${tr("Programmed output")} [V]", Offset(0f, y), headerStyle)
                    y += HEADER_HEIGHT.toPx()
                    val top = y
                    val h = OUTPUT_PANEL_HEIGHT.toPx()
                    val known = points.indices.filter { points[it].outputValue != null }
                    val minO = known.minOf { points[it].outputValue!! }
                    val maxO = known.maxOf { points[it].outputValue!! }
                    val rangeO = (maxO - minO).takeIf { it > 0.0 } ?: 1.0
                    fun yo(v: Double) = if (maxO == minO) top + h / 2 else top + pad + (1.0 - (v - minO) / rangeO).toFloat() * (h - 2 * pad)
                    drawLine(axisColor, Offset(LEFT_PAD, top), Offset(LEFT_PAD, top + h), strokeWidth = 1f)
                    drawLine(gridColor, Offset(LEFT_PAD, top + h), Offset(right, top + h), strokeWidth = 1f)
                    drawText(textMeasurer, displayNumber(maxO), Offset(0f, yo(maxO) - 7f), labelStyle)
                    if (maxO != minO) drawText(textMeasurer, displayNumber(minO), Offset(0f, yo(minO) - 7f), labelStyle)
                    val path = Path()
                    var prevY = 0f
                    known.forEachIndexed { k, i ->
                        val py = yo(points[i].outputValue!!)
                        if (k == 0) path.moveTo(xs[i], py) else { path.lineTo(xs[i], prevY); path.lineTo(xs[i], py) }
                        prevY = py
                    }
                    path.lineTo(right, yo(points[known.last()].outputValue!!))
                    drawPath(path, outputColor, style = Stroke(width = 3f))
                    y = top + h
                }

                // --- Shared time axis ---------------------------------------------------------------------------
                drawText(textMeasurer, points.first().date, Offset(LEFT_PAD, y + 4f), labelStyle)
                val lastLabel = textMeasurer.measure(points.last().date, labelStyle)
                drawText(textMeasurer, points.last().date, Offset(size.width - lastLabel.size.width, y + 4f), labelStyle)
                selectedIndex?.let { i -> drawLine(axisColor, Offset(xs[i], panel1Top), Offset(xs[i], y), strokeWidth = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 4f))) }
            }

            selectedIndex?.let { i ->
                val p = points[i]
                val pos = layout.positions[i]
                val valueText = "${displayNumber(p.value)} $unit" + (p.pulseWidthMs?.let { " @ ${displayNumber(it)} ms" } ?: " (${tr("pulse width unknown")})")
                val outputText = p.outputValue?.let { "\n${tr("Programmed output")}: ${displayNumber(it)} V" }.orEmpty()
                Box(
                    modifier = Modifier
                        .offset { IntOffset((pos.x.roundToInt() - 60).coerceAtLeast(0), 0) }
                        .background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text("${p.date}\n$valueText$outputText", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.inverseOnSurface)
                }
            }
        }

        val anyBreak = remember(points) { (0 until points.size - 1).any { isThresholdBreak(points[it], points[it + 1]) } }
        val legend = buildString {
            append(if (anyBreak) tr("Solid = same device and pulse width · Dashed = generator change or changed pulse width") else tr("{unit} across all visits with a reading", "unit" to unit))
            if (anyUnknown && showPulse) append(" · ").append(tr("Hollow = pulse width unknown"))
        }
        Text(legend, style = MaterialTheme.typography.labelSmall)
    }
}
