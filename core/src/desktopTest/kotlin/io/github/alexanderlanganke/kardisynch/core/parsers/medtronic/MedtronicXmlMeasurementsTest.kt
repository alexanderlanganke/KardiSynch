package io.github.alexanderlanganke.kardisynch.core.parsers.medtronic

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Lead impedance sits in `SessionPathwayStatus`, and lead locations are spelled "Atrial", "RV/SVC", "CS", ... */
class MedtronicXmlMeasurementsTest {
    private fun str(name: String, value: String) =
        """<Composite><Field name="Name"><String>$name</String></Field><Field name="Current"><String>$value</String></Field></Composite>"""

    private fun real(name: String, value: String) =
        """<Composite><Field name="Name"><String>$name</String></Field><Field name="Current"><Real>$value</Real></Field></Composite>"""

    private fun pathway(use: String, at: String, ohms: Int) =
        """<Composite><Field name="Pathway"><Composite><Field name="FromElectrode"><Array/></Field></Composite></Field>
           <Field name="LeadMeasurementUse"><Discrete>$use</Discrete></Field>
           <Field name="ImpedanceStatus"><Composite><Field name="DateTime"><DateTime>$at</DateTime></Field><Field name="ImpedanceValue"><Integer>$ohms</Integer></Field></Composite></Field></Composite>"""

    /** [params] go in the "NoPendingSettings" context, [session] in "SessionSettings", as in real exports. */
    private fun xml(params: List<String>, session: List<String> = emptyList()): String {
        fun context(name: String, items: List<String>) = """<Composite>
            <Field name="Name"><String>$name</String></Field>
            <Field name="NormalizedParameterCollection"><Composite><Array>${items.joinToString("\n")}</Array></Composite></Field>
          </Composite>"""
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <Composite>
          <Field name="SavedDateTime"><DateTime>2026-07-21T10:00:00</DateTime></Field>
          <Field name="Value"><Composite><Field name="ContextCollection"><Composite><Array>
            ${context("NoPendingSettings", params)}
            ${context("SessionSettings", session)}
          </Array></Composite></Field></Composite></Field>
        </Composite>
        """.trimIndent()
    }

    private val pathwayStatus = """
        <Composite><Field name="Name"><String>SessionPathwayStatus</String></Field><Field name="Current"><Composite>
          <Field name="PathwayStatusCollection"><Array>
            <IndexDescriptor><Integer>0</Integer></IndexDescriptor>
            ${pathway("RVPacingTherapy", "2026-07-21T09:00:00", 470)}
            ${pathway("RVPacingTherapy", "2026-07-21T09:30:00", 480)}
            ${pathway("APacingTherapy", "2026-07-21T09:31:00", 510)}
            ${pathway("LVPacingTherapy", "2026-07-21T09:32:00", 620)}
            ${pathway("ShockTherapy", "2026-07-21T09:33:00", 65)}
          </Array></Field></Composite></Field></Composite>
    """.trimIndent()

    private fun sensed(use: String, mv: String) = """<Composite><Field name="SensingMeasurementUse"><Discrete>$use</Discrete></Field>
        <Field name="Status"><Composite><Field name="DateTime"><DateTime>2026-07-21T09:00:00</DateTime></Field><Field name="AmplitudeValue"><Real>$mv</Real></Field></Composite></Field></Composite>"""

    private val sensedStatus = """
        <Composite><Field name="Name"><String>SEventAmplitudeStatus</String></Field><Field name="Current"><Array>
          <IndexDescriptor><Integer>1</Integer></IndexDescriptor>
          ${sensed("RVSensingAmplitude", "12.5")}
          ${sensed("RecentAutoRVDailyMedian", "9.0")}
          ${sensed("ASensingAmplitude", "3.9")}
        </Array></Field></Composite>
    """.trimIndent()

    private val base = listOf(
        str("DeviceSerialNumber", "PZK123456P"), str("DeviceModelName", "Test ICD"),
        str("PatientName", "Mustermann, Erika"), str("PatientBirthDate", "1950-09-15"),
        str("Lead1Location", "RV/SVC"), str("Lead1Model", "6935"),
        str("Lead2Location", "Atrial"), str("Lead2Model", "5076"),
        str("Lead3Location", "CS"), str("Lead3Model", "4398"),
        real("VPacingTherapyRVPacingAmplitude", "2.5"), real("APacingTherapyRAPacingAmplitude", "3.0"), real("VPacingTherapyLVPacingPathwayAAmplitude", "2.0"),
        real("VSEventDetectionRVSensingThreshold", "0.9"), real("ASEventDetectionRASensingThreshold", "0.3"),
    )

    @Test
    fun `reads the latest impedance per channel and the shock impedance`() {
        val report = assertNotNull(parseMedtronicXml(xml(base, listOf(pathwayStatus))))
        val rv = report.leads.single { it.anatomicLocation == "RV/SVC" }
        assertEquals(480.0, rv.impedance?.value, "the latest RV measurement wins")
        assertEquals(65.0, rv.shockImpedance?.value)
        assertEquals(510.0, report.leads.single { it.anatomicLocation == "Atrial" }.impedance?.value)
        assertEquals(620.0, report.leads.single { it.anatomicLocation == "CS" }.impedance?.value)
    }

    @Test
    fun `reads the measured sensing amplitude, never the programmed sensing threshold`() {
        val report = assertNotNull(parseMedtronicXml(xml(base + sensedStatus)))
        assertEquals(12.5, report.leads.single { it.anatomicLocation == "RV/SVC" }.sensing?.value, "the sensing test, not the daily median and not the setting (0.9)")
        assertEquals(3.9, report.leads.single { it.anatomicLocation == "Atrial" }.sensing?.value, "the sensing test, not the setting (0.3)")
        assertEquals("0.9 mV", report.additionalFields["rv_sensing_threshold"], "the programmed sensitivity is kept apart")
        assertEquals("0.3 mV", report.additionalFields["ra_sensing_threshold"])
    }

    @Test
    fun `the device daily median is the fallback when no sensing test was done`() {
        val onlyMedian = sensedStatus.replace("RVSensingAmplitude", "SomethingElse")
        val report = assertNotNull(parseMedtronicXml(xml(base + onlyMedian)))
        assertEquals(9.0, report.leads.single { it.anatomicLocation == "RV/SVC" }.sensing?.value)
    }

    @Test
    fun `without any measured amplitude there is no sensing, even though a sensing threshold is programmed`() {
        val report = assertNotNull(parseMedtronicXml(xml(base)))
        assertNull(report.leads.single { it.anatomicLocation == "Atrial" }.sensing, "Wahrnehmungsschwelle (programmed) is not Wahrnehmung (measured)")
        assertEquals("0.3 mV", report.additionalFields["ra_sensing_threshold"])
        assertEquals(3.0, report.leads.single { it.anatomicLocation == "Atrial" }.pacingAmplitude?.value)
        assertEquals(2.0, report.leads.single { it.anatomicLocation == "CS" }.pacingAmplitude?.value)
        assertEquals(2.5, report.leads.single { it.anatomicLocation == "RV/SVC" }.pacingAmplitude?.value)
    }

    @Test
    fun `a session without pathway data simply has no impedance`() {
        val report = assertNotNull(parseMedtronicXml(xml(base)))
        assertNull(report.leads.first().impedance)
    }
}
