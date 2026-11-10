package io.github.alexanderlanganke.kardisynch.core.testing

import io.github.alexanderlanganke.kardisynch.core.parsers.abbott.parseAbbottLog
import io.github.alexanderlanganke.kardisynch.core.parsers.biotronik.parseBiotronikXML
import io.github.alexanderlanganke.kardisynch.core.parsers.bostonscientific.parseBostonScientificBnk
import io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.parseMedtronicPdd
import io.github.alexanderlanganke.kardisynch.core.parsers.microport.parseMicroportXML
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Round-trips every generator in [MockExportFixtures] through its real
 * parser — the mocks are only useful if they actually parse the way the
 * real exports do, so this is the check that keeps them honest whenever a
 * parser changes.
 */
class MockExportFixturesTest {
    private val patient = MockPatient(firstName = "Max", lastName = "Testpatient", dob = "1970-03-15")
    private val device = MockDevice(model = "Mock Model 100", serial = "MOCK-SER-001")

    @Test
    fun `Boston Scientific bnk mock parses back to the input patient and device`() {
        val bostonDevice = MockDevice(model = "D321-200-0", serial = device.serial) // model must be whitespace-free — see mockBostonScientificBnk's doc comment
        val bnk = mockBostonScientificBnk(patient, bostonDevice)
        val report = parseBostonScientificBnk(bnk)

        assertEquals("Boston Scientific", report.manufacturer)
        assertEquals(patient.firstName, report.patient.firstName)
        assertEquals(patient.lastName, report.patient.lastName)
        assertEquals("1970-03-15", report.patient.dob)
        assertEquals(bostonDevice.model, report.device.model)
        assertEquals(bostonDevice.serial, report.device.serialNumber)
        assertEquals("2026-07-21", report.interrogationDate)
        assertEquals(2, report.leads.size, "expected the atrial (slot A) and RV (slot V1) leads")
    }

    @Test
    fun `Abbott log mock parses back to the input patient and device`() {
        val log = mockAbbottLog(patient, device)
        val report = parseAbbottLog(log, "mock_import.log")

        assertNotNull(report)
        assertEquals("Abbott", report.manufacturer)
        assertEquals(patient.firstName, report.patient.firstName)
        assertEquals(patient.lastName, report.patient.lastName)
        assertEquals("1970-03-15", report.patient.dob)
        assertEquals(device.model, report.device.model)
        assertEquals(device.serial, report.device.serialNumber)
        // Not "2026-07-21T09:30:00": buildReportFromCodedLog's already-ISO
        // parseAbbottDateTime result gets piped through normalizeDate a
        // second time, whose ISO regex only captures the date portion —
        // confirmed this matches the original TS (src/lib/dates.ts), not a
        // porting bug, so Abbott interrogation dates never carry a time.
        assertEquals("2026-07-21", report.interrogationDate)
        assertEquals(1, report.leads.size)
        assertEquals("RV", report.leads[0].name)
    }

    @Test
    fun `Biotronik XML mock parses back to the input patient and device`() {
        val xml = mockBiotronikXml(patient, device)
        val report = parseBiotronikXML(xml)

        assertEquals("Biotronik", report.manufacturer)
        assertEquals(patient.firstName, report.patient.firstName)
        assertEquals(patient.lastName, report.patient.lastName)
        assertEquals("1970-03-15", report.patient.dob)
        assertEquals(device.serial, report.device.serialNumber)
        assertEquals("Pacemaker", report.device.type)
        assertEquals("2026-07-21", report.interrogationDate)
        assertNotNull(report.battery.voltage)
        assertEquals(3.20, report.battery.voltage!!.value)
        assertEquals(1, report.leads.size)
    }

    @Test
    fun `Microport XML mock parses back to the input patient and device`() {
        val xml = mockMicroportXml(patient, device)
        val report = parseMicroportXML(xml)

        assertNotNull(report)
        assertEquals("Microport", report.manufacturer)
        assertEquals(patient.firstName, report.patient.firstName)
        assertEquals(patient.lastName, report.patient.lastName)
        assertEquals("1970-03-15", report.patient.dob)
        assertEquals(device.serial, report.device.serialNumber)
        assertEquals("2026-07-21", report.interrogationDate)
        assertEquals(1, report.leads.size)
        assertEquals("RV", report.leads[0].name)
    }

    @Test
    fun `Medtronic pdd mock parses back to the input patient and device`() {
        val medtronicDevice = MockDevice(model = "Protecta XT", serial = "PQR123456X")
        val pdd = mockMedtronicPdd(patient, medtronicDevice)
        val report = parseMedtronicPdd(pdd)

        assertEquals("Medtronic", report.manufacturer)
        assertEquals(patient.firstName, report.patient.firstName)
        assertEquals(patient.lastName, report.patient.lastName)
        assertEquals("1900-01-01", report.patient.dob, "the .pdd format never carries a DOB — always the parser's placeholder")
        assertEquals(medtronicDevice.model, report.device.model)
        assertEquals(medtronicDevice.serial, report.device.serialNumber)
        assertEquals("2026-07-21", report.interrogationDate)
        assertNotNull(report.battery.voltage)
        assertEquals(3.2, report.battery.voltage!!.value)
        assertEquals(2, report.leads.size, "expected an Atrial and an RV lead entry")
    }

    @Test
    fun `mockMedtronicPdd rejects a serial that doesn't match the format's shape`() {
        val badDevice = MockDevice(model = "Protecta XT", serial = "not-a-valid-serial")
        try {
            mockMedtronicPdd(patient, badDevice)
            throw AssertionError("expected an IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun `dummy PDF round-trips through the minimal text extractor`() {
        val pdf = mockDummyPdf(patient, device, interrogationDate = "2026-07-21")
        assertContains(pdf.decodeToString(), "%PDF-1.4")

        val text = extractPdfText(pdf)
        assertContains(text, "Testpatient")
        assertContains(text, "Max")
        assertContains(text, device.model)
        assertContains(text, device.serial)
        assertContains(text, "2026-07-21")
    }

    @Test
    fun `dummy PDF escapes parentheses and backslashes in its content stream`() {
        val pdf = mockDummyPdf(listOf("Model (Test) \\Backslash\\"))
        val text = extractPdfText(pdf)
        assertEquals("Model (Test) \\Backslash\\", text)
    }
}
