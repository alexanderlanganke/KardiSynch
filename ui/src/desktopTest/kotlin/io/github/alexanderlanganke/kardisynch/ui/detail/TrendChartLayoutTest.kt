package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.ui.unit.IntSize
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

private const val CANVAS_WIDTH = 644
private const val CANVAS_HEIGHT = 208
private const val LEFT_PAD = 44f
private const val TOP_PAD = 8f
private const val PLOT_WIDTH = 600f // CANVAS_WIDTH - LEFT_PAD
private const val PLOT_HEIGHT = 180f // CANVAS_HEIGHT - BOTTOM_PAD(20) - TOP_PAD(8)
private val CANVAS_SIZE = IntSize(CANVAS_WIDTH, CANVAS_HEIGHT)

/** [ChartLayout]'s pixel-position math (issue #198's follow-up: time-proportional X + tap-to-pin tooltips). */
class TrendChartLayoutTest {
    private fun assertNear(expected: Float, actual: Float, message: String) {
        assertTrue(abs(expected - actual) < 0.5f, "$message: expected $expected, was $actual")
    }

    @Test
    fun `x positions are proportional to elapsed calendar time, not point index`() {
        // Day 0, day 1, day 10 — an even-index layout would put the middle
        // point at the midpoint; a time-proportional one puts it 1/10 across.
        val points = listOf(
            TrendPoint("2024-01-01", 1.0, null),
            TrendPoint("2024-01-02", 2.0, null),
            TrendPoint("2024-01-11", 3.0, null),
        )
        val positions = ChartLayout(points, CANVAS_SIZE).positions
        assertNear(LEFT_PAD, positions[0].x, "first point at left edge")
        assertNear(LEFT_PAD + PLOT_WIDTH * 1 / 10f, positions[1].x, "middle point 1/10 of the way across")
        assertNear(LEFT_PAD + PLOT_WIDTH, positions[2].x, "last point at right edge")
    }

    @Test
    fun `unparseable dates fall back to even index spacing`() {
        val points = listOf(
            TrendPoint("not-a-date", 1.0, null),
            TrendPoint("also-not-a-date", 2.0, null),
        )
        val positions = ChartLayout(points, CANVAS_SIZE).positions
        assertNear(LEFT_PAD, positions[0].x, "first point")
        assertNear(LEFT_PAD + PLOT_WIDTH, positions[1].x, "second point evenly spaced, not overlapping the first")
    }

    @Test
    fun `every point on the same calendar day falls back to even index spacing`() {
        val points = listOf(
            TrendPoint("2024-01-01", 1.0, null),
            TrendPoint("2024-01-01", 2.0, null),
            TrendPoint("2024-01-01", 3.0, null),
        )
        val positions = ChartLayout(points, CANVAS_SIZE).positions
        assertNear(LEFT_PAD, positions[0].x, "first point")
        assertNear(LEFT_PAD + PLOT_WIDTH / 2f, positions[1].x, "middle point evenly spaced (zero time span would otherwise divide by zero)")
        assertNear(LEFT_PAD + PLOT_WIDTH, positions[2].x, "last point")
    }

    @Test
    fun `y positions map value range to the plot, min at the bottom`() {
        val points = listOf(TrendPoint("2024-01-01", 0.0, null), TrendPoint("2024-01-02", 10.0, null))
        val positions = ChartLayout(points, CANVAS_SIZE).positions
        assertNear(TOP_PAD + PLOT_HEIGHT, positions[0].y, "min value sits at the bottom of the plot")
        assertNear(TOP_PAD, positions[1].y, "max value sits at the top of the plot")
    }
}
