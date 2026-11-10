package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VisitDiffTest {
    @Test
    fun `battery and lead changes are reported from left to right`() {
        val a = VisitSnapshot(2.88, "OK", listOf(LeadSnapshot("RV", impedance = 509.0, threshold = 0.88, sensing = 12.4)))
        val b = VisitSnapshot(2.81, "OK", listOf(LeadSnapshot("RV", impedance = 512.0, threshold = 0.75, sensing = 12.4)))
        val texts = diffVisits(a, b).map { it.text }
        assertEquals(listOf("Battery 2.88 → 2.81 V", "RV impedance 509 → 512 Ω", "RV threshold 0.88 → 0.75 V"), texts)
    }

    @Test
    fun `rounding noise is not a change`() {
        val a = VisitSnapshot(2.810, leads = listOf(LeadSnapshot("RA", impedance = 438.0, sensing = 3.20)))
        val b = VisitSnapshot(2.812, leads = listOf(LeadSnapshot("RA", impedance = 438.4, sensing = 3.24)))
        assertTrue(diffVisits(a, b).isEmpty())
    }

    @Test
    fun `a lead on one side only is skipped and missing numbers are not compared`() {
        val a = VisitSnapshot(null, null, listOf(LeadSnapshot("LV", impedance = 600.0)))
        val b = VisitSnapshot(2.8, null, listOf(LeadSnapshot("RV", impedance = 500.0)))
        assertTrue(diffVisits(a, b).isEmpty())
    }

    @Test
    fun `a battery status change is reported`() {
        val changes = diffVisits(VisitSnapshot(batteryStatus = "OK"), VisitSnapshot(batteryStatus = "ERI"))
        assertEquals("Battery status OK → ERI", changes.single().text)
    }
}
