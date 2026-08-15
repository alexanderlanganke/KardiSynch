package io.github.alexanderlanganke.kardisynch.core.dedup

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReportDedupTest {
    private fun bareReport(rawText: String? = null, hasDevice: Boolean = false, hasLeads: Boolean = false) = ReportRichness(
        manufacturer = null,
        deviceType = null,
        deviceModel = null,
        deviceSerialNumber = null,
        hospitalVisitId = null,
        rawText = rawText,
        hasDevice = hasDevice,
        hasLeads = hasLeads,
    )

    @Test
    fun `a report with nothing populated scores zero`() {
        assertEquals(0.0, scoreReport(bareReport()))
    }

    @Test
    fun `each identity field present adds one point`() {
        val richer = ReportRichness(
            manufacturer = "Medtronic",
            deviceType = "ICD",
            deviceModel = "Model1",
            deviceSerialNumber = "S1",
            hospitalVisitId = "V1",
            rawText = null,
            hasDevice = false,
            hasLeads = false,
        )
        assertEquals(5.0, scoreReport(richer))
    }

    @Test
    fun `raw text length contributes up to 5 points, capped`() {
        assertEquals(1.0, scoreReport(bareReport(rawText = "a".repeat(1000))))
        assertEquals(5.0, scoreReport(bareReport(rawText = "a".repeat(10_000))))
    }

    @Test
    fun `having a device row and lead rows both add bonus points`() {
        assertEquals(1.0, scoreReport(bareReport(hasDevice = true)))
        assertEquals(2.0, scoreReport(bareReport(hasLeads = true)))
        assertEquals(3.0, scoreReport(bareReport(hasDevice = true, hasLeads = true)))
    }

    @Test
    fun `a richer report outscores a sparser one, matching which visit should be kept`() {
        val sparse = bareReport(rawText = "short")
        val rich = ReportRichness("Medtronic", "ICD", "Model1", "S1", "V1", "a".repeat(3000), hasDevice = true, hasLeads = true)
        assertTrue(scoreReport(rich) > scoreReport(sparse))
    }
}
