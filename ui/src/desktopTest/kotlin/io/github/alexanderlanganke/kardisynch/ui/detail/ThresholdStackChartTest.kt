package io.github.alexanderlanganke.kardisynch.ui.detail

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The comparability rules behind the stacked threshold chart: nothing is converted, unclear pairs are not joined. */
class ThresholdStackChartTest {
    private fun p(pw: Double?, serial: String? = "PZK123456P") = TrendPoint("2025-01-01", 0.75, serial, pw)

    @Test
    fun `same pulse width and device stay joined`() = assertFalse(isThresholdBreak(p(0.4), p(0.4)))

    @Test
    fun `a changed pulse width breaks the line`() = assertTrue(isThresholdBreak(p(0.4), p(0.5)))

    @Test
    fun `a generator change breaks the line`() = assertTrue(isThresholdBreak(p(0.4, "PZK123456P"), p(0.4, "PZK654321P")))

    @Test
    fun `known next to unknown pulse width breaks the line`() {
        assertTrue(isThresholdBreak(p(0.4), p(null)))
        assertTrue(isThresholdBreak(p(null), p(0.4)))
    }

    @Test
    fun `two unknown pulse widths stay joined`() = assertFalse(isThresholdBreak(p(null), p(null)))

    @Test
    fun `pulse levels are distinct and ascending`() =
        assertEquals(listOf(0.4, 0.5), pulseLevels(listOf(p(0.5), p(0.4), p(null), p(0.4))))
}
