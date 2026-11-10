package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PatientAttentionTest {
    @Test
    fun `an advisory or recall is an alert`() {
        assertEquals(AttentionLevel.ALERT, patientAttention("advisory", null, 10).level)
        assertEquals(AttentionLevel.ALERT, patientAttention("recall", "OK", 10).level)
    }

    @Test
    fun `ERI, EOS and EOL battery statuses need attention, a healthy one does not`() {
        assertEquals(setOf(AttentionReason.BATTERY), patientAttention("safe", "ERI - Replace Now", 10).reasons)
        assertTrue(patientAttention(null, "EOS", null).needsAttention)
        assertFalse(patientAttention("safe", "Good", 10).needsAttention)
    }

    @Test
    fun `a visit older than the threshold is overdue, exactly at it is not`() {
        assertTrue(AttentionReason.OVERDUE in patientAttention(null, null, 181).reasons)
        assertFalse(patientAttention(null, null, 180).needsAttention)
        assertFalse(patientAttention(null, null, null).needsAttention, "unknown age is not flagged")
    }

    @Test
    fun `an unchecked patient is neither safe nor flagged`() {
        val a = patientAttention(null, null, 5)
        assertFalse(a.warningSafe)
        assertEquals(AttentionLevel.NONE, a.level)
        assertTrue(patientAttention("safe", null, 5).warningSafe)
    }

    @Test
    fun `reasons combine and the advisory wins the level`() {
        val a = patientAttention("advisory", "ERI", 400)
        assertEquals(setOf(AttentionReason.ADVISORY, AttentionReason.BATTERY, AttentionReason.OVERDUE), a.reasons)
        assertEquals(AttentionLevel.ALERT, a.level)
        assertEquals(AttentionLevel.ATTENTION, patientAttention("safe", "ERI", 400).level)
    }
}
