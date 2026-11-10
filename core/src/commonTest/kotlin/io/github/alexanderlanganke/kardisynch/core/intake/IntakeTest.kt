package io.github.alexanderlanganke.kardisynch.core.intake

import io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse
import io.github.alexanderlanganke.kardisynch.core.testing.MockDevice
import io.github.alexanderlanganke.kardisynch.core.testing.MockPatient
import io.github.alexanderlanganke.kardisynch.core.testing.extractPdfText
import io.github.alexanderlanganke.kardisynch.core.testing.mockAbbottLog
import io.github.alexanderlanganke.kardisynch.core.testing.mockBiotronikXml
import io.github.alexanderlanganke.kardisynch.core.testing.mockBostonScientificBnk
import io.github.alexanderlanganke.kardisynch.core.testing.mockDummyPdf
import io.github.alexanderlanganke.kardisynch.core.testing.mockMedtronicPdd
import io.github.alexanderlanganke.kardisynch.core.testing.mockMicroportXml
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class IntakeTest {
    private val patient = MockPatient("Erika", "Muster", "1951-09-04")
    private val device = MockDevice("Azure XT DR", "PZK123456P")

    // ---- identification -------------------------------------------------

    @Test
    fun `a Biotronik XML is recognised by content even without the BIOSTD_ file name`() {
        val bytes = mockBiotronikXml(patient, MockDevice("Amvia Sky DR-T", "5551234")).encodeToByteArray()
        val id = identifyFile("export_final.xml", bytes)
        assertEquals(FileKind.BIOTRONIK_XML, id.kind)
        assertEquals("Biotronik", id.manufacturer)
        assertTrue(id.isUsable)
        val report = dispatchParse("export_final.xml", bytes)
        assertNotNull(report)
        assertEquals("Biotronik", report.manufacturer)
    }

    @Test
    fun `a Biotronik XML with a namespaced root and a stylesheet instruction is recognised`() {
        // Real device exports look like this; the mock fixture's plain root hid the bug.
        val xml = """<?xml version="1.0" encoding="UTF-8"?>
            <?xml-stylesheet type="text/xsl" href="report.xslt"?>
            <carddas:InterfaceData xmlns:carddas="urn:example:carddas"><carddas:TableEntry/></carddas:InterfaceData>"""
        val id = identifyFile("anything.xml", xml.encodeToByteArray())
        assertEquals(FileKind.BIOTRONIK_XML, id.kind)
        assertTrue(id.isUsable)
    }

    @Test
    fun `a Boston Scientific bnk is recognised by its header even with a wrong extension`() {
        val bytes = mockBostonScientificBnk(patient, MockDevice("D321-200-0", "123456")).encodeToByteArray()
        val id = identifyFile("interrogation.txt", bytes)
        assertEquals(FileKind.BOSTON_BNK, id.kind)
        assertEquals("Boston Scientific", id.manufacturer)
    }

    @Test
    fun `an Abbott log is recognised by its coded lines even without the log extension`() {
        val bytes = mockAbbottLog(patient, MockDevice("Gallant", "GL4410982"))
        assertEquals(FileKind.ABBOTT_LOG, identifyFile("session_dump", bytes).kind)
    }

    @Test
    fun `a Microport XML is recognised by the Paceart element`() {
        val bytes = mockMicroportXml(patient, device).encodeToByteArray()
        assertEquals(FileKind.MICROPORT_XML, identifyFile("data.xml", bytes).kind)
    }

    @Test
    fun `a Medtronic pdd is recognised and carries its evidence`() {
        val bytes = mockMedtronicPdd(patient, device)
        val id = identifyFile("20261104_0912.pdd", bytes)
        assertEquals(FileKind.MEDTRONIC_PDD, id.kind)
        assertTrue(id.confidence >= 60, "confidence was ${id.confidence}")
        assertTrue(id.evidence.any { it.text.contains("PZK123456P") }, "serial should be cited as evidence")
    }

    @Test
    fun `an XML nobody claims is unknown, not silently dropped, and says why`() {
        val id = identifyFile("report.xml", "<?xml version=\"1.0\"?><Export><Row/></Export>".encodeToByteArray())
        assertEquals(FileKind.UNKNOWN_XML, id.kind)
        assertFalse(id.isUsable)
        assertTrue(id.evidence.any { it.text.contains("Export") })
    }

    @Test
    fun `a misleading file name does not make a foreign XML Biotronik`() {
        val id = identifyFile("BIOSTD_2025-11-03_14-21-46_Doe_John_1234.xml", "<Foo><Bar/></Foo>".encodeToByteArray())
        assertEquals(FileKind.UNKNOWN_XML, id.kind)
        assertTrue(id.evidence.any { it.strength == EvidenceStrength.AGAINST && it.text.contains("file name says Biotronik") })
    }

    @Test
    fun `a PDF is identified by its text and flagged when the text is unreadable`() {
        val withText = identifyFile("a.pdf", mockDummyPdf(listOf("Medtronic CareLink report", "Serial: PZK123456P")), "Medtronic CareLink report")
        assertEquals(FileKind.DEVICE_PDF, withText.kind)
        assertEquals("Medtronic", withText.manufacturer)

        val blind = identifyFile("a.pdf", mockDummyPdf(listOf("x")), null)
        assertEquals(FileKind.DEVICE_PDF, blind.kind)
        assertNull(blind.manufacturer)
        assertTrue(blind.evidence.any { it.strength == EvidenceStrength.AGAINST })
    }

    @Test
    fun `random bytes are unknown`() {
        val id = identifyFile("notes.bin", byteArrayOf(1, 2, 3, 4, 5))
        assertEquals(FileKind.UNKNOWN, id.kind)
        assertEquals(0, id.confidence)
    }

    // ---- PDF facts ---------------------------------------------------------

    @Test
    fun `facts are read from the PDF text`() {
        val text = extractPdfText(mockDummyPdf(MockPatient("Erika", "Muster", "04.09.1951"), device, interrogationDate = "04.11.2026"))
        val facts = extractPdfFacts(text, "report.pdf")
        assertEquals("Muster", facts.lastName)
        assertEquals("Erika", facts.firstName)
        assertEquals("1951-09-04", facts.dob)
        assertEquals("PZK123456P", facts.serial)
        assertEquals("2026-11-04", facts.interrogation)
    }

    @Test
    fun `an ISO interrogation date, with and without a time, is read`() {
        assertEquals("2026-07-21", extractPdfFacts("Interrogation Date: 2026-07-21").interrogation)
        assertEquals("2026-07-21T09:05:00", extractPdfFacts("Session Date: 2026-07-21 9:05").interrogation)
        assertEquals("1970-03-15", extractPdfFacts("DOB: 1970-03-15").dob)
        assertEquals("ABT-SER-003", extractPdfFacts("Serial: ABT-SER-003").serial)
    }

    @Test
    fun `a space separated interrogation date with a time is read, as in real SmartSync PDFs`() {
        // Real PDF text has only three labelled fields; the date is space separated and carries a time.
        val text = "Patient: Muster, Erika\nDevice Serial: PZK123456P\nInterrogation Date: 24 Jul 2024 09 15 03 123"
        val f = extractPdfFacts(text, "scan_0001.pdf")
        assertEquals("2024-07-24T09:15:03", f.interrogation)
        assertEquals("PZK123456P", f.serial)
        assertEquals("Muster", f.lastName)
        assertEquals("Erika", f.firstName)
    }

    @Test
    fun `facts come from a Medtronic SmartSync file name`() {
        val facts = extractPdfFacts("", "A1B2_Doe_John-DEV123456-SmartSyncPDF-06_Nov_2025.pdf")
        assertEquals("Doe", facts.lastName)
        assertEquals("John", facts.firstName)
        assertEquals("DEV123456", facts.serial)
        assertEquals("Medtronic", facts.manufacturer)
        assertEquals("2025-11-06", facts.interrogation)
    }

    @Test
    fun `facts come from a Biotronik file name including the time`() {
        val facts = extractPdfFacts("", "BIOSTD_2025-11-03_14-21-46_Doe_John_5551234.PDF")
        assertEquals("5551234", facts.serial)
        assertEquals("2025-11-03T14:21:46", facts.interrogation)
        assertEquals("Biotronik", facts.manufacturer)
    }

    @Test
    fun `system words are not mistaken for patient names`() {
        assertNull(extractPdfFacts("Patient: Report, Device").lastName)
    }

    @Test
    fun `abbreviated first names are compatible, different ones are not`() {
        assertTrue(firstNamesCompatible("E.", "Erika"))
        assertTrue(firstNamesCompatible("Erika", "erika"))
        assertTrue(firstNamesCompatible(null, "Erika"))
        assertFalse(firstNamesCompatible("Erik", "Erika"))
        assertFalse(firstNamesCompatible("Hans", "Erika"))
    }

    // ---- bundling ------------------------------------------------------------

    private fun item(
        name: String,
        kind: FileKind,
        facts: DocumentFacts,
        dir: String = "/in",
        at: Long = 0L,
    ) = IntakeItem(name, name, Identification(kind, facts.manufacturer, 90, emptyList()), facts, dir, at)

    private val pddFacts = DocumentFacts("Medtronic", "Muster", "Erika", "1951-09-04", null, "PZK123456P", "Azure", "2026-11-04T09:12:00")

    @Test
    fun `a PDF with a different name joins its data file by serial and time`() {
        val pdf = item("Report_Muster.pdf", FileKind.DEVICE_PDF, DocumentFacts("Medtronic", "Muster", "E.", "1951-09-04", null, "PZK123456P", null, "2026-11-04T09:14:00"))
        val bundles = groupIntoBundles(listOf(item("20261104.pdd", FileKind.MEDTRONIC_PDD, pddFacts), pdf))
        assertEquals(1, bundles.size)
        assertEquals("Erika", bundles.single().facts.firstName, "the longest first name wins over the initial")
        assertTrue(bundles.single().conflicts.isEmpty())
        assertTrue(bundles.single().structured.size == 1 && bundles.single().pdfs.size == 1)
    }

    @Test
    fun `the same device hours apart is a different visit`() {
        val later = pddFacts.copy(interrogation = "2026-11-04T15:40:00")
        val bundles = groupIntoBundles(listOf(item("a.pdd", FileKind.MEDTRONIC_PDD, pddFacts), item("b.pdd", FileKind.MEDTRONIC_PDD, later)))
        assertEquals(2, bundles.size)
    }

    @Test
    fun `files that contradict each other are never bundled even with the same serial`() {
        val other = pddFacts.copy(dob = "1960-01-01", interrogation = "2026-11-04T09:13:00")
        val bundles = groupIntoBundles(listOf(item("a.pdd", FileKind.MEDTRONIC_PDD, pddFacts), item("b.pdf", FileKind.DEVICE_PDF, other)))
        assertEquals(2, bundles.size)
    }

    @Test
    fun `companions sharing a base name are bundled`() {
        val bundles = groupIntoBundles(
            listOf(
                item("12345.pdd", FileKind.MEDTRONIC_PDD, pddFacts.copy(serial = null)),
                item("12345.pdf", FileKind.DEVICE_PDF, DocumentFacts()),
            ),
        )
        assertEquals(1, bundles.size)
    }

    @Test
    fun `a generic base name does not bundle unrelated files`() {
        val bundles = groupIntoBundles(
            listOf(
                item("report.pdf", FileKind.DEVICE_PDF, DocumentFacts(lastName = "A", dob = "1950-01-01")),
                item("report.xml", FileKind.BIOTRONIK_XML, DocumentFacts(lastName = "B", dob = "1960-01-01")),
            ),
        )
        assertEquals(2, bundles.size)
    }

    @Test
    fun `an unreadable PDF joins its only folder neighbour that arrived with it`() {
        val data = item("a.pdd", FileKind.MEDTRONIC_PDD, pddFacts, dir = "/in/x", at = 1_000)
        val blind = item("scan.pdf", FileKind.DEVICE_PDF, DocumentFacts(), dir = "/in/x", at = 30_000)
        assertEquals(1, groupIntoBundles(listOf(data, blind)).size)
    }

    @Test
    fun `an unreadable PDF next to two different bundles stays alone rather than guessing`() {
        val a = item("a.pdd", FileKind.MEDTRONIC_PDD, pddFacts, dir = "/in", at = 1_000)
        val b = item("b.pdd", FileKind.MEDTRONIC_PDD, pddFacts.copy(serial = "ZZZ999999Z", lastName = "Other", dob = "1940-01-01"), dir = "/in", at = 2_000)
        val blind = item("scan.pdf", FileKind.DEVICE_PDF, DocumentFacts(), dir = "/in", at = 3_000)
        assertEquals(3, groupIntoBundles(listOf(a, b, blind)).size)
    }
}
