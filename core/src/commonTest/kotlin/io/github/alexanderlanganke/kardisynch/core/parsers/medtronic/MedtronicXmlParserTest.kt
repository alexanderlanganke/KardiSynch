package io.github.alexanderlanganke.kardisynch.core.parsers.medtronic

import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Covers issue #170: parseMedtronicXml, the Medtronic .pkg archive's inner PublicDiscreteData.xml schema. */
class MedtronicXmlParserTest {

    private fun param(name: String, currentInner: String): String = """
        <Composite>
          <Field name="Name"><String>$name</String></Field>
          <Field name="Current">$currentInner</Field>
        </Composite>
    """.trimIndent()

    private fun xmlDoc(contextName: String, paramsXml: String): String = """
        <?xml version="1.0" encoding="UTF-8"?>
        <Composite>
          <Field name="SavedDateTime"><DateTime>2026-07-21T10:00:00</DateTime></Field>
          <Field name="Value">
            <Composite>
              <Field name="ContextCollection">
                <Composite>
                  <Array>
                    <Composite>
                      <Field name="Name"><String>$contextName</String></Field>
                      <Field name="NormalizedParameterCollection">
                        <Composite>
                          <Array>
                            $paramsXml
                          </Array>
                        </Composite>
                      </Field>
                    </Composite>
                  </Array>
                </Composite>
              </Field>
            </Composite>
          </Field>
        </Composite>
    """.trimIndent()

    @Test
    fun `parses device identity, battery, patient, and an RV lead from the happy-path schema`() {
        val params = listOf(
            param("DeviceModelName", """<Composite><Field name="Name"><String>Amplia MRI Quad CRT-D</String></Field></Composite>"""),
            param("DeviceSerialNumber", "<String>PKG-SER-001</String>"),
            param("DeviceType", "<String>CRT_D</String>"),
            param("BatteryStatus", """<Composite><Field name="VoltageStatus"><Composite><Field name="Voltage"><Real>2.85</Real></Field></Composite></Field></Composite>"""),
            param("PatientName", "<String>DOE, JOHN</String>"),
            param("PatientBirthDate", "<String>1970-03-15</String>"),
            param("Lead1Location", "<String>RV</String>"),
            param("Lead1Model", "<String>Model1</String>"),
            param("Lead1SerialNumber", "<String>LEAD-SER-1</String>"),
            param("VSEventDetectionRVSensingThreshold", "<Real>8.0</Real>"),
            param("VPacingTherapyRVPacingAmplitude", "<Real>2.5</Real>"),
        ).joinToString("\n")
        val report = parseMedtronicXml(xmlDoc("NoPendingSettings", params))

        assertNotNull(report)
        assertEquals("Medtronic", report.manufacturer)
        assertEquals("2026-07-21", report.interrogationDate)
        assertEquals("DOE", report.patient.lastName)
        assertEquals("JOHN", report.patient.firstName)
        assertEquals("1970-03-15", report.patient.dob)
        assertEquals("Amplia MRI Quad CRT-D", report.device.model)
        assertEquals("PKG-SER-001", report.device.serialNumber)
        assertEquals("CRT-D", report.device.type, "raw XML 'CRT_D' mapped to canonical 'CRT-D'")
        assertEquals(2.85, report.battery.voltage?.value)
        assertEquals("V", report.battery.voltage?.unit)
        assertEquals(1, report.leads.size)
        val lead = report.leads[0]
        assertEquals("RV", lead.anatomicLocation)
        assertEquals("Model1", lead.model)
        assertEquals("LEAD-SER-1", lead.serial)
        assertEquals(8.0, lead.sensing?.value)
        assertEquals(2.5, lead.pacingAmplitude?.value)
        assertEquals("medtronic-xml:context=NoPendingSettings", report.formatVariant)
        assertEquals(ParseStatus.OK, report.parseStatus)
    }

    @Test
    fun `splits a space-separated patient name into last then first`() {
        val params = param("PatientName", "<String>DOE JOHN MICHAEL</String>")
        val report = parseMedtronicXml(xmlDoc("NoPendingSettings", params))
        assertEquals("DOE", report?.patient?.lastName)
        assertEquals("JOHN MICHAEL", report?.patient?.firstName)
    }

    @Test
    fun `maps IPG to Pacemaker, and CRT_P to CRT-P`() {
        val ipg = parseMedtronicXml(xmlDoc("NoPendingSettings", param("DeviceType", "<String>IPG</String>")))
        assertEquals("Pacemaker", ipg?.device?.type)

        val crtP = parseMedtronicXml(xmlDoc("NoPendingSettings", param("DeviceType", "<String>CRT_P</String>")))
        assertEquals("CRT-P", crtP?.device?.type)
    }

    @Test
    fun `a Micra model overrides DeviceType to Leadless Pacemaker regardless of the raw IPG code`() {
        val params = listOf(
            param("DeviceType", "<String>IPG</String>"),
            param("DeviceModelName", """<Composite><Field name="Name"><String>MICRA MC1VR01</String></Field></Composite>"""),
        ).joinToString("\n")
        assertEquals("Leadless Pacemaker", parseMedtronicXml(xmlDoc("NoPendingSettings", params))?.device?.type)
    }

    @Test
    fun `a Micra with no Lead params gets a synthetic RV pacing-sensing channel`() {
        val params = listOf(
            param("DeviceModelName", """<Composite><Field name="Name"><String>MICRA MC1VR01</String></Field></Composite>"""),
            param("VSEventDetectionRVSensingThreshold", "<Real>6.5</Real>"),
            param("VPacingTherapyRVPacingAmplitude", "<Real>1.8</Real>"),
        ).joinToString("\n")
        val report = parseMedtronicXml(xmlDoc("NoPendingSettings", params))
        assertEquals(1, report?.leads?.size)
        assertEquals("Leadless Pacing/Sensing Channel", report?.leads?.get(0)?.name)
        assertEquals(6.5, report?.leads?.get(0)?.sensing?.value)
    }

    @Test
    fun `falls back to the first context with any parameters when none is named NoPendingSettings`() {
        val report = parseMedtronicXml(xmlDoc("SomeOtherContextName", param("DeviceSerialNumber", "<String>S1</String>")))
        assertEquals("S1", report?.device?.serialNumber)
        assertEquals("medtronic-xml:context=first-with-params", report?.formatVariant)
    }

    @Test
    fun `infers device type from model when DeviceType is absent`() {
        val params = param("DeviceModelName", """<Composite><Field name="Name"><String>Visia AF XT</String></Field></Composite>""")
        assertEquals("ICD", parseMedtronicXml(xmlDoc("NoPendingSettings", params))?.device?.type)
    }

    @Test
    fun `a document with no ContextCollection at all still returns a report, just with FAILED parse status`() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <Composite>
              <Field name="SavedDateTime"><DateTime>2026-07-21T10:00:00</DateTime></Field>
            </Composite>
        """.trimIndent()
        val report = parseMedtronicXml(xml)
        assertNotNull(report)
        assertEquals("", report.patient.lastName)
        assertEquals(ParseStatus.FAILED, report.parseStatus)
    }

    @Test
    fun `malformed XML returns null instead of throwing`() {
        assertNull(parseMedtronicXml("not xml at all <<<"))
    }

    @Test
    fun `a lead with no location and no model is not recorded`() {
        val params = param("Lead1SerialNumber", "<String>orphan-serial-with-no-location-or-model</String>")
        val report = parseMedtronicXml(xmlDoc("NoPendingSettings", params))
        assertTrue(report?.leads?.isEmpty() == true)
    }
}
