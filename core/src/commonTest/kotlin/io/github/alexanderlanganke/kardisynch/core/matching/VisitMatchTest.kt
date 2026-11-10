package io.github.alexanderlanganke.kardisynch.core.matching

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun visit(
    id: String = "existing-1",
    interrogationDate: String = "2026-07-21T09:30:00",
    deviceSerialNumber: String? = "ABC123",
) = ReportMatchCandidate(id, interrogationDate, deviceSerialNumber)

class VisitMatchTest {
    // --- auto / non-explicit mode ---

    @Test
    fun `reuses a same-day visit when nothing contradicts it (the #140 dedup)`() {
        val candidates = listOf(visit())
        assertEquals(candidates[0], pickSameDayReport(candidates, "2026-07-21", "ABC123", false))
    }

    @Test
    fun `reuses when the incoming file is unparseable`() {
        val candidates = listOf(visit())
        assertEquals(candidates[0], pickSameDayReport(candidates, null, null, false))
    }

    @Test
    fun `does not reuse a visit from a different device (dedupService serial invariant)`() {
        val candidates = listOf(visit(deviceSerialNumber = "OTHER999"))
        assertNull(pickSameDayReport(candidates, "2026-07-21", "ABC123", false))
    }

    @Test
    fun `does not merge two same-day interrogations hours apart (issue #145, pre_post MRI)`() {
        val preMri = visit(interrogationDate = "2026-07-21T09:30:00")
        assertNull(pickSameDayReport(listOf(preMri), "2026-07-21T14:05:00", "ABC123", false))
    }

    @Test
    fun `treats timestamps a few minutes apart as the same session (XML vs printed PDF)`() {
        val candidates = listOf(visit(interrogationDate = "2026-07-21T09:30:00"))
        assertEquals(candidates[0], pickSameDayReport(candidates, "2026-07-21T09:34:12", "ABC123", false))
    }

    @Test
    fun `picks the compatible candidate among several same-day visits`() {
        val preMri = visit(id = "pre", interrogationDate = "2026-07-21T09:30:00")
        val postMri = visit(id = "post", interrogationDate = "2026-07-21T14:00:00")
        assertEquals(postMri, pickSameDayReport(listOf(preMri, postMri), "2026-07-21T14:02:00", "ABC123", false))
    }

    @Test
    fun `matches when serials are missing on either side`() {
        val candidates = listOf(visit(deviceSerialNumber = null))
        assertEquals(candidates[0], pickSameDayReport(candidates, "2026-07-21", null, false))
    }

    // --- explicit "Create New Visit" mode ---

    @Test
    fun `honors the choice for a date-only file even when a same-day visit exists (issue #145)`() {
        val candidates = listOf(visit())
        assertNull(pickSameDayReport(candidates, "2026-07-21", "ABC123", true))
    }

    @Test
    fun `honors the choice when the file is unparseable`() {
        assertNull(pickSameDayReport(listOf(visit()), null, null, true))
    }

    @Test
    fun `still dedups a provably identical interrogation (the #140 auto-import race)`() {
        val candidates = listOf(visit(interrogationDate = "2026-07-21T09:30:00"))
        assertEquals(candidates[0], pickSameDayReport(candidates, "2026-07-21T09:30:00", "ABC123", true))
    }

    @Test
    fun `does not dedup a same-day interrogation hours later`() {
        val candidates = listOf(visit(interrogationDate = "2026-07-21T09:30:00"))
        assertNull(pickSameDayReport(candidates, "2026-07-21T14:05:00", "ABC123", true))
    }

    @Test
    fun `does not dedup across different device serials even at the same time`() {
        val candidates = listOf(visit(deviceSerialNumber = "OTHER999"))
        assertNull(pickSameDayReport(candidates, "2026-07-21T09:30:00", "ABC123", true))
    }

    @Test
    fun `returns null for no candidates`() {
        assertNull(pickSameDayReport(emptyList(), "2026-07-21", null, false))
    }
}
