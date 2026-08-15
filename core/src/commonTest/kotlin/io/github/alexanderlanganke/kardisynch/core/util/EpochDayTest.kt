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

    @Test
    fun `ageInYears counts a full year once the birthday has passed`() {
        assertEquals(6, ageInYears("2020-08-14", "2026-08-15"))
    }

    @Test
    fun `ageInYears does not count the year until the birthday arrives`() {
        assertEquals(5, ageInYears("2020-08-14", "2026-08-13"))
    }

    @Test
    fun `ageInYears counts the birthday itself as the new age`() {
        assertEquals(6, ageInYears("2020-08-14", "2026-08-14"))
    }

    @Test
    fun `ageInYears yields null for an unparseable date`() {
        assertNull(ageInYears("not a date", "2026-08-13"))
    }
}
