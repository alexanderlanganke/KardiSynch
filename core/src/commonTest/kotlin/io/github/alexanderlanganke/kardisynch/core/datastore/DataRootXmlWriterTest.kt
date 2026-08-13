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
}
