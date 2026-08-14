package io.github.alexanderlanganke.kardisynch.core.matching

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OrphanVisitDetectionTest {
    @Test
    fun `patientIdForDir matches a bare ID or an ID with a name suffix`() {
        val ids = listOf("abc-123", "def-456")
        assertEquals("abc-123", patientIdForDir("abc-123", ids))
        assertEquals("abc-123", patientIdForDir("abc-123_DoeJane", ids))
        assertNull(patientIdForDir("unrelated-dir", ids))
    }

    @Test
    fun `patientIdForDir does not false-positive on a prefix collision`() {
        // "abc-1" must not match a directory actually owned by "abc-123".
        assertNull(patientIdForDir("abc-123_Name", listOf("abc-1")))
    }

    @Test
    fun `visitDatePrefix extracts and reformats the date, or null without one`() {
        assertEquals("2026-07-21", visitDatePrefix("2026_07_21_report-id-here"))
        assertNull(visitDatePrefix("Unknown_report-id-here"))
        assertNull(visitDatePrefix("not-a-visit-dir"))
    }

    @Test
    fun `reportIdFromDirName strips a date or Unknown prefix`() {
        assertEquals("report-id-here", reportIdFromDirName("2026_07_21_report-id-here"))
        assertEquals("report-id-here", reportIdFromDirName("Unknown_report-id-here"))
        assertNull(reportIdFromDirName("no-prefix-at-all"))
    }
}
