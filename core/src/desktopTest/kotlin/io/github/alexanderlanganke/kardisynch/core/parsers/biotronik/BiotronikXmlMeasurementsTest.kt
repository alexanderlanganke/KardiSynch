package io.github.alexanderlanganke.kardisynch.core.parsers.biotronik

import io.github.alexanderlanganke.kardisynch.core.testing.MockDevice
import io.github.alexanderlanganke.kardisynch.core.testing.MockPatient
import io.github.alexanderlanganke.kardisynch.core.testing.mockBiotronikXml
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BiotronikXmlMeasurementsTest {
    private val base = mockBiotronikXml(MockPatient("Erika", "Mustermann", "1950-09-15"), MockDevice("Amvia Sky DR-T", "BIO100001"))

    private fun entry(name: String, value: String) = "<TableEntry><AttributeName>$name</AttributeName><CharValue>$value</CharValue></TableEntry>"

    @Test
    fun `the IMPEDANCE_ SENSING_ THRESHOLD_ naming scheme is read like the FU_ one`() {
        val xml = base.replace("FU_RA_IMPED", "IMPEDANCE_RA")
            .replace("</Table>", entry("SENSING_RA", "3.5") + entry("THRESHOLD_RA", "0.7") + entry("THRESHTIME_RA", "0.4") + "</Table>")
        val lead = parseBiotronikXML(xml).leads.single()
        assertEquals(480.0, lead.impedance?.value)
        assertEquals(3.5, lead.sensing?.value)
        assertEquals(0.7, lead.pacingThreshold?.value)
        assertEquals("V @ 0.4ms", lead.pacingThreshold?.unit)
    }

    @Test
    fun `the shock impedance is attached to the RV lead`() {
        val rv = base.replace("<CharValue>RA</CharValue>", "<CharValue>RV</CharValue>").replace("FU_RA_IMPED", "FU_RV_IMPED")
            .replace("</Measurements>", "<Table><TableName>SHOCK</TableName>${entry("Schockimpedanz", "64")}</Table></Measurements>")
        val lead = parseBiotronikXML(rv).leads.single { it.name == "RV-Lead" }
        assertEquals(64.0, lead.shockImpedance?.value)
        assertEquals(480.0, lead.impedance?.value)
    }

    @Test
    fun `without a Schockimpedanz entry there is no shock impedance`() {
        assertNull(parseBiotronikXML(base).leads.single().shockImpedance)
    }
}
