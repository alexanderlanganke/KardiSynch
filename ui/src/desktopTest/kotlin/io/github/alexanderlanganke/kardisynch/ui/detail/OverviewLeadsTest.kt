package io.github.alexanderlanganke.kardisynch.ui.detail

import kotlin.test.Test
import kotlin.test.assertEquals

/** A CRT's left-ventricular lead must get its own group on the overview, in a stable order. */
class OverviewLeadsTest {
    @Test
    fun `a CRT lists atrium, right ventricle and left ventricle`() =
        assertEquals(listOf("RA", "RV", "LV"), orderOverviewLeads(listOf("LV", "RV", "RA")))

    @Test
    fun `a spelled-out left ventricle is not mistaken for the right one`() =
        assertEquals(listOf("Right Ventricle", "Left Ventricle"), orderOverviewLeads(listOf("Left Ventricle", "Right Ventricle")))

    @Test
    fun `a single lead is listed once and unknown locations are kept last`() {
        assertEquals(listOf("RV"), orderOverviewLeads(listOf("RV", "RV")))
        assertEquals(listOf("RV", "Coil"), orderOverviewLeads(listOf("Coil", "RV")))
    }

    @Test
    fun `substernal, leadless and conduction-system leads are all kept after the classic chambers`() {
        val all = listOf("Substernal", "Leadless", "LV", "Sternal", "RA", "RV")
        assertEquals(listOf("RA", "RV", "LV"), orderOverviewLeads(all).take(3))
        assertEquals(setOf("Substernal", "Leadless", "Sternal"), orderOverviewLeads(all).drop(3).toSet())
    }
}
