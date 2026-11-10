package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrendDeltaTest {
    @Test
    fun `no current value yields null`() {
        assertNull(formatDelta(null, 500.0, "Ω", "Impedance"))
    }

    @Test
    fun `no previous value shows only the current reading`() {
        assertEquals("Impedance: 500 Ω", formatDelta(500.0, null, "Ω", "Impedance"))
    }

    @Test
    fun `both values present shows the delta with a sign and rounds to one decimal`() {
        assertEquals("Impedance: 500 -> 520 Ω (+20)", formatDelta(520.0, 500.0, "Ω", "Impedance"))
        assertEquals("Voltage: 2.85 -> 2.7 V (-0.1)", formatDelta(2.7, 2.85, "V", "Voltage"))
    }

    @Test
    fun `an unchanged value shows a zero delta with no sign`() {
        assertEquals("Impedance: 500 -> 500 Ω (0)", formatDelta(500.0, 500.0, "Ω", "Impedance"))
    }
}

class IsCriticalBatteryStatusTest {
    @Test
    fun `flags ERI, EOS, and EOL case-insensitively`() {
        assertTrue(isCriticalBatteryStatus("ERI - Replace Now"))
        assertTrue(isCriticalBatteryStatus("eos"))
        assertTrue(isCriticalBatteryStatus("Approaching EOL"))
    }

    @Test
    fun `normal status is not critical`() {
        assertFalse(isCriticalBatteryStatus("Normal"))
        assertFalse(isCriticalBatteryStatus("OK"))
    }

    @Test
    fun `null or blank status is not critical`() {
        assertFalse(isCriticalBatteryStatus(null))
        assertFalse(isCriticalBatteryStatus(""))
        assertFalse(isCriticalBatteryStatus("   "))
    }
}
