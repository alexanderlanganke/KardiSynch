package io.github.alexanderlanganke.kardisynch.core.datastore

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import kotlin.test.Test
import kotlin.test.assertEquals

class DataRootXmlWriterTest {
    @Test
    fun `patient xml round-trips through the writer and reader`() {
        val xml = generatePatientXml(id = "patient-1", firstName = "Jane", lastName = "Doe", dob = "1970-05-05", hospitalPatientId = "MRN123")
        val parsed = parsePatientXml(xml)
        assertEquals("patient-1", parsed?.id)
        assertEquals("Jane", parsed?.firstName)
        assertEquals("Doe", parsed?.lastName)
        assertEquals("1970-05-05", parsed?.dob)
        assertEquals("MRN123", parsed?.hospitalPatientId)
    }

    @Test
    fun `patient xml round-trips the MRI and manufacturer-warning cache fields`() {
        val xml = generatePatientXml(
            id = "patient-1", firstName = "Jane", lastName = "Doe", dob = "1970-05-05", hospitalPatientId = null,
            mriStatus = """{"foo":"bar"}""", mriDataHash = "hash-1",
            manufacturerWarningStatus = """{"status":"advisory","details":"Battery advisory"}""", manufacturerWarningHash = "hash-2",
        )
        val parsed = parsePatientXml(xml)
        assertEquals("""{"foo":"bar"}""", parsed?.mriStatus)
        assertEquals("hash-1", parsed?.mriDataHash)
        assertEquals("""{"status":"advisory","details":"Battery advisory"}""", parsed?.manufacturerWarningStatus)
        assertEquals("hash-2", parsed?.manufacturerWarningHash)
    }

    @Test
    fun `patient xml omits the MRI and manufacturer-warning fields entirely when null, not as empty elements`() {
        val xml = generatePatientXml(id = "p1", firstName = "A", lastName = "B", dob = "2000-01-01", hospitalPatientId = null)
        assertEquals(false, xml.contains("mri_status"))
        assertEquals(false, xml.contains("manufacturer_warning_status"))
        val parsed = parsePatientXml(xml)
        assertEquals(null, parsed?.mriStatus)
        assertEquals(null, parsed?.manufacturerWarningStatus)
    }

    @Test
    fun `patient xml omits hospitalPatientId element when null, round-tripping to null not empty string`() {
        val xml = generatePatientXml(id = "p1", firstName = "A", lastName = "B", dob = "2000-01-01", hospitalPatientId = null)
        val parsed = parsePatientXml(xml)
        assertEquals(null, parsed?.hospitalPatientId)
    }

    @Test
    fun `visit xml round-trips battery, leads, and additional fields`() {
        val report = UnifiedReport(
            manufacturer = "Abbott",
            interrogationDate = "2026-02-05",
            patient = PatientInfo(firstName = "", lastName = "", dob = ""),
            device = DeviceInfo(type = "Pacemaker", model = "Endurity Core", serialNumber = "ANONDEV00001"),
            battery = BatteryData(voltage = Measurement(2.94784, "V"), status = "OK"),
            leads = listOf(
                LeadData(
                    name = "RV",
                    model = "2088TC Tendril STS",
                    serial = "ANONRV00001",
                    anatomicLocation = "RV",
                    impedance = Measurement(537.5, "Ohm"),
                    sensing = Measurement(12.0, "mV"),
                    pacingThreshold = Measurement(0.5, "V"),
                ),
            ),
            additionalFields = mapOf("ejection_fraction" to "55%"),
        )

        val xml = generateVisitXml("report-1", report)
        val parsed = parseVisitXml(xml, patientId = "patient-1")

        assertEquals("report-1", parsed?.id)
        assertEquals("patient-1", parsed?.patientId)
        val roundTripped = parsed!!.report
        assertEquals(report.manufacturer, roundTripped.manufacturer)
        assertEquals(report.interrogationDate, roundTripped.interrogationDate)
        assertEquals(report.device.model, roundTripped.device.model)
        assertEquals(report.device.serialNumber, roundTripped.device.serialNumber)
        assertEquals(report.battery.voltage?.value, roundTripped.battery.voltage?.value)
        assertEquals(report.battery.status, roundTripped.battery.status)
        assertEquals(1, roundTripped.leads.size)
        assertEquals("RV", roundTripped.leads[0].name)
        assertEquals(537.5, roundTripped.leads[0].impedance?.value)
        assertEquals("55%", roundTripped.additionalFields["ejection_fraction"])
    }

    @Test
    fun `visit xml escapes special characters in text and attribute values`() {
        val report = UnifiedReport(
            manufacturer = "A & B <Co>",
            interrogationDate = "2026-01-01",
            patient = PatientInfo(firstName = "", lastName = "", dob = ""),
            device = DeviceInfo(type = "Pacemaker", model = "Model \"X\"", serialNumber = "S1"),
            additionalFields = mapOf("note" to "5 < 10 & 10 > 5"),
        )
        val xml = generateVisitXml("r1", report)
        val parsed = parseVisitXml(xml, "p1")
        assertEquals("A & B <Co>", parsed?.report?.manufacturer)
        assertEquals("Model \"X\"", parsed?.report?.device?.model)
        assertEquals("5 < 10 & 10 > 5", parsed?.report?.additionalFields?.get("note"))
    }

    /** A literal `patient.xml` shaped exactly like Electron's `generatePatientXML` output (`src/main/storage.ts`) — device/lead history included, one explanted device, one lead with no serial (name-only identity). */
    private val electronPatientXmlWithHistory = """
        <?xml version="1.0" encoding="UTF-8"?>
        <patient>
          <id>patient-1</id>
          <first_name>Jane</first_name>
          <last_name>Doe</last_name>
          <dob>1970-05-05</dob>
          <hospitalPatientId>MRN123</hospitalPatientId>
          <devices>
            <device>
              <model>Old Generator</model>
              <serial>OLD001</serial>
              <manufacturer>Medtronic</manufacturer>
              <implant_date>2015-03-01</implant_date>
              <type>ICD</type>
              <status>explanted</status>
            </device>
            <device>
              <model>New Generator</model>
              <serial>NEW001</serial>
              <manufacturer>Medtronic</manufacturer>
              <implant_date>2024-06-01</implant_date>
              <type>ICD</type>
              <status>current</status>
            </device>
          </devices>
          <leads>
            <lead>
              <model>Sprint Quattro</model>
              <serial>LEAD001</serial>
              <manufacturer>Medtronic</manufacturer>
              <implant_date>2015-03-01</implant_date>
              <type>Defibrillation</type>
              <connector>DF-1</connector>
            </lead>
          </leads>
        </patient>
    """.trimIndent()

    @Test
    fun `parsePatientXml captures the devices and leads history blocks`() {
        val parsed = parsePatientXml(electronPatientXmlWithHistory)
        assertEquals("devices", parsed?.devicesXml?.name)
        assertEquals(2, parsed?.devicesXml?.childrenNamed("device")?.size)
        assertEquals("explanted", parsed?.devicesXml?.childrenNamed("device")?.get(0)?.child("status")?.text)
        assertEquals("leads", parsed?.leadsXml?.name)
        assertEquals("DF-1", parsed?.leadsXml?.child("lead")?.child("connector")?.text)
    }

    @Test
    fun `a patient-info edit preserves the devices and leads history untouched — the updatePatientInfo read-merge-write this port must not corrupt`() {
        val existing = parsePatientXml(electronPatientXmlWithHistory)!!

        // Simulates KardiSynchRepository.updatePatientInfo: regenerate with new
        // identity fields, passing the existing devicesXml/leadsXml straight through.
        val rewritten = generatePatientXml(
            id = existing.id, firstName = "Janet", lastName = existing.lastName, dob = existing.dob,
            hospitalPatientId = existing.hospitalPatientId,
            devicesXml = existing.devicesXml, leadsXml = existing.leadsXml,
        )

        val reparsed = parsePatientXml(rewritten)
        assertEquals("Janet", reparsed?.firstName)
        val devices = reparsed?.devicesXml?.childrenNamed("device")
        assertEquals(2, devices?.size)
        assertEquals("OLD001", devices?.get(0)?.child("serial")?.text)
        assertEquals("explanted", devices?.get(0)?.child("status")?.text)
        assertEquals("NEW001", devices?.get(1)?.child("serial")?.text)
        assertEquals("current", devices?.get(1)?.child("status")?.text)
        val lead = reparsed?.leadsXml?.child("lead")
        assertEquals("LEAD001", lead?.child("serial")?.text)
        assertEquals("DF-1", lead?.child("connector")?.text)
    }

    @Test
    fun `a brand-new patient with no existing file omits devices and leads entirely`() {
        val xml = generatePatientXml(id = "p1", firstName = "A", lastName = "B", dob = "2000-01-01", hospitalPatientId = null)
        assertEquals(false, xml.contains("<devices>"))
        assertEquals(false, xml.contains("<leads>"))
        val parsed = parsePatientXml(xml)
        assertEquals(null, parsed?.devicesXml)
        assertEquals(null, parsed?.leadsXml)
    }
}
