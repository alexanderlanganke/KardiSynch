package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals

class DatesTest {
    @Test
    fun `parses ISO date and datetime`() {
        assertEquals("2023-01-05", normalizeDate("2023-01-05"))
        assertEquals("2023-01-05", normalizeDate("2023-01-05T13:45:00.000Z"))
    }

    @Test
    fun `parses EU dotted and dashed forms`() {
        assertEquals("1952-09-25", normalizeDate("25.09.1952"))
        assertEquals("1952-09-25", normalizeDate("25-09-1952"))
    }

    @Test
    fun `parses US slashed form via hint`() {
        assertEquals("2024-03-07", normalizeDate("03/07/2024", DateLocaleHint.US))
    }

    @Test
    fun `defaults slashes to US, dots and dashes to EU when hint is auto`() {
        assertEquals("2024-03-07", normalizeDate("03/07/2024"))
        assertEquals("2024-07-03", normalizeDate("03-07-2024"))
    }

    @Test
    fun `disambiguates unambiguous numeric forms regardless of hint`() {
        // day=25 can't be a month, so this is unambiguous even with hint=US.
        assertEquals("1952-09-25", normalizeDate("25/09/1952", DateLocaleHint.US))
    }

    @Test
    fun `parses month-name forms including German abbreviations`() {
        assertEquals("1952-09-25", normalizeDate("25 Sep 1952"))
        assertEquals("1952-09-25", normalizeDate("Sep 25, 1952"))
        assertEquals("1952-03-25", normalizeDate("25 Mär 1952"))
        assertEquals("1952-10-25", normalizeDate("25 Okt 1952"))
    }

    @Test
    fun `windows two-digit years relative to the assumed current year`() {
        assertEquals("1952-09-25", normalizeDate("25.09.52", assumedCurrentYear = 2026))
        assertEquals("2005-09-25", normalizeDate("25.09.05", assumedCurrentYear = 2026))
    }

    @Test
    fun `rejects invalid calendar dates instead of silently overflowing`() {
        assertEquals("", normalizeDate("30.02.2023")) // Feb 30 doesn't exist
        assertEquals("", normalizeDate("31.04.2023")) // April has 30 days
    }

    @Test
    fun `accepts Feb 29 only on leap years`() {
        assertEquals("2024-02-29", normalizeDate("29.02.2024"))
        assertEquals("", normalizeDate("29.02.2023"))
    }

    @Test
    fun `returns empty string for null, blank, or unparseable input`() {
        assertEquals("", normalizeDate(null))
        assertEquals("", normalizeDate(""))
        assertEquals("", normalizeDate("   "))
        assertEquals("", normalizeDate("not a date"))
    }
}
