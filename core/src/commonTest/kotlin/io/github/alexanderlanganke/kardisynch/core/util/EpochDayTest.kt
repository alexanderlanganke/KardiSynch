package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class EpochDayTest {
    @Test
    fun `epoch day of the unix epoch itself is zero`() {
        assertEquals(0L, epochDay(1970, 1, 1))
    }

    @Test
    fun `daysBetweenIsoDates computes a simple same-year difference`() {
        assertEquals(30, daysBetweenIsoDates("2024-01-01", "2024-01-31"))
    }

    @Test
    fun `daysBetweenIsoDates handles a leap year correctly`() {
        assertEquals(366, daysBetweenIsoDates("2024-01-01", "2025-01-01"))
    }

    @Test
    fun `daysBetweenIsoDates is negative when to is before from`() {
        assertEquals(-10, daysBetweenIsoDates("2024-01-11", "2024-01-01"))
    }

    @Test
    fun `an unparseable date yields null`() {
        assertNull(daysBetweenIsoDates("not a date", "2024-01-01"))
        assertNull(daysBetweenIsoDates("2024-01-01", "also not a date"))
    }
}
