package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PulseWidthTest {
    @Test fun `splits unit and pulse width`() {
        assertEquals(UnitAndPulse("V", 0.4), splitPulseUnit("V @ 0.4ms"))
        assertEquals(UnitAndPulse("V", 1.0), splitPulseUnit("V @ 1 ms"))
        assertEquals(UnitAndPulse("V", 0.5), splitPulseUnit("V @ 0,5ms"))
    }

    @Test fun `plain and broken units have no pulse width`() {
        assertEquals(UnitAndPulse("V", null), splitPulseUnit("V"))
        assertEquals(UnitAndPulse("V", null), splitPulseUnit("V @ ms"))
        assertEquals(UnitAndPulse("", null), splitPulseUnit(null))
        assertNull(splitPulseUnit("Ohms").pulseWidthMs)
    }
}
