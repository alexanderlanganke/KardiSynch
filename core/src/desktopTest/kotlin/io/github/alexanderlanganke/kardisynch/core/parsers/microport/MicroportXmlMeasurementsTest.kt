package io.github.alexanderlanganke.kardisynch.core.parsers.microport

import io.github.alexanderlanganke.kardisynch.core.testing.MockDevice
import io.github.alexanderlanganke.kardisynch.core.testing.MockPatient
import io.github.alexanderlanganke.kardisynch.core.testing.mockMicroportXml
import kotlin.test.Test
import kotlin.test.assertEquals

class MicroportXmlMeasurementsTest {
    private val base = mockMicroportXml(MockPatient("Erika", "Mustermann", "1950-09-15"), MockDevice("Reply 200 DR-T", "MPT100005"))

    @Test
    fun `a bipolar impedance is read`() {
        assertEquals(450.0, parseMicroportXML(base)!!.leads.single { it.name == "RV" }.impedance?.value)
    }

    @Test
    fun `a lead with only a unipolar impedance still has one`() {
        val unipolar = base.replace("BipolarImpedance_ohms", "UnipolarImpedance_ohms")
        assertEquals(450.0, parseMicroportXML(unipolar)!!.leads.single { it.name == "RV" }.impedance?.value)
    }
}
