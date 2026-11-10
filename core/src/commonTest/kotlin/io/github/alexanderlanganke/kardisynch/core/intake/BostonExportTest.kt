package io.github.alexanderlanganke.kardisynch.core.intake

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** All names, dates and serials here are invented. */
class BostonExportTest {
    private val layoutText = """
        LATITUDE™ Programming System                                 Bericht erstel. 03 Nov 2026
                                          Bericht Patientendaten
        Mustermann, Max                                              Letzte Abfrage in der Praxis
        Geburtsdatum         15 Sep 1950                             02 Nov 2026
        Aggregat             ESSENTIO MRI L111/ 482915
                                                                     Dat. Implant.
        Allgemein
         Patient Name                             Max Josef Mustermann
    """.trimIndent()

    // Text extractors differ in spacing; a single space must not change the result.
    private val flatText = "LATITUDE™ Programming System Bericht erstel. 03 Nov 2026\n" +
        "Bericht Patientendaten\nMustermann, Max Letzte Abfrage in der Praxis\n" +
        "Geburtsdatum 15 Sep 1950 02 Nov 2026\nAggregat ESSENTIO MRI L111/ 482915\n"

    @Test
    fun readsTheLatitudeHeader() {
        for (text in listOf(layoutText, flatText)) {
            val f = extractPdfFacts(text, "PatientDataReport-Nov-3-2026_10-0-0.pdf")
            assertEquals("Mustermann", f.lastName)
            assertEquals("Max", f.firstName)
            assertEquals("1950-09-15", f.dob)
            assertEquals("482915", f.serial)
            assertEquals("2026-11-03", f.interrogation) // print day = session day, not "Letzte Abfrage"
            assertEquals("Boston Scientific", f.manufacturer)
        }
    }

    @Test
    fun aMiddleNameIsNotReadAsTheSurname() {
        // Only the labelled "Patient Name  First Middle Last" line would give "Max Josef"; the header must win.
        assertEquals("Mustermann", extractPdfFacts(layoutText).lastName)
    }

    @Test
    fun keepsNameParticlesAndSecondGivenNames() {
        val text = "LATITUDE™ Programming System\nVon Muster, Anna Maria Letzte Abfrage\nGeburtsdatum 17 Mär 1949\n"
        val f = extractPdfFacts(text)
        assertEquals("Von Muster", f.lastName)
        assertEquals("Anna Maria", f.firstName)
        assertEquals("1949-03-17", f.dob)
    }

    @Test
    fun readsACompoundSurnameWithoutDroppingAWord() {
        // BNK: PatientLastName "Muster Beispiel". The PDF header must give the same, or the two contradict.
        val text = "LATITUDE™ Programming System Bericht erstel. 03 Nov 2026\nBericht Patientendaten\n" +
            "Muster Beispiel, Anna Letzte Abfrage in der Praxis\nGeburtsdatum 15 Sep 1950\n"
        val f = extractPdfFacts(text)
        assertEquals("Muster Beispiel", f.lastName)
        assertEquals("Anna", f.firstName)
        // Header words that share the line are not part of the surname.
        val merged = "Bericht Patientendaten Muster Beispiel, Anna\nGeburtsdatum 15 Sep 1950\n"
        assertEquals("Muster Beispiel", extractPdfFacts("LATITUDE\n$merged").lastName)
    }

    @Test
    fun ignoresNonLatitudeText() {
        val f = extractPdfFacts("Aggregat ESSENTIO MRI L111/ 482915\nGeburtsdatum 15 Sep 1950")
        assertNull(f.serial)
        assertNull(f.dob)
    }

    @Test
    fun readsTheDeviceFromThePatientFolder() {
        val f = bostonPatientFolder("/usb/bsc/patientData/Mustermann_Max_15SEP1950_L111_482915/report/CustomViewReport.pdf")!!
        assertEquals("L111", f.model)
        assertEquals("482915", f.serial)
        assertEquals("/usb/bsc/patientData/Mustermann_Max_15SEP1950_L111_482915", f.root)
        // Same root for the .bnk beside the report/ folder.
        assertEquals(f.root, bostonPatientFolder("/usb/bsc/patientData/Mustermann_Max_15SEP1950_L111_482915/ab12cd34.bnk")!!.root)
    }

    @Test
    fun copesWithMultiPartNamesMojibakeAndWindowsPaths() {
        assertEquals("593026", bostonPatientFolder("/x/patientData/Von_Muster_Anna_17MÃR1949_G347_593026/a.bnk")!!.serial)
        assertEquals("604137", bostonPatientFolder("E:\\bsc\\patientData\\Muster_Erika_07AUG1953_L211_604137\\report\\x.pdf")!!.serial)
    }

    @Test
    fun needsAPatientDataAncestor() {
        assertNull(bostonPatientFolder("/x/Muster_Erika_07AUG1953_L211_604137/a.pdf"))
        assertNull(bostonPatientFolder("/usb/bsc/patientData/Storage.cfg"))
    }

    @Test
    fun aSerialTheFileNamesItselfWinsOverTheFolder() {
        val folder = BostonPatientFolder("/r", "L111", "482915")
        assertEquals("482915", DocumentFacts().withBostonFolder(folder).serial)
        assertEquals("777777", DocumentFacts(serial = "777777").withBostonFolder(folder).serial)
        assertNull(DocumentFacts().withBostonFolder(null).serial)
    }

    @Test
    fun aBulkOfPdfsBundlesWithItsBnkAndNotWithAnotherPatient() {
        fun item(name: String, kind: FileKind, facts: DocumentFacts, root: String) =
            IntakeItem(name, name, Identification(kind, "Boston Scientific", 90, emptyList()), facts, root, 0L)

        val rootA = "/usb/bsc/patientData/Mustermann_Max_15SEP1950_L111_482915"
        val rootB = "/usb/bsc/patientData/Muster_Erika_07AUG1953_L211_604137"
        val bnkA = DocumentFacts("Boston Scientific", "Mustermann", "Max", "1950-09-15", null, "482915", "L111-200-0", "2026-11-03")
        val bnkB = DocumentFacts("Boston Scientific", "Muster", "Erika", "1953-08-07", null, "604137", "L211-200-0", "2026-11-03")
        val pdfA = extractPdfFacts(layoutText)
        // A PDF that names no serial of its own gets the folder's.
        val pdfBlind = DocumentFacts(manufacturer = "Boston Scientific", interrogation = "2026-11-03")
            .withBostonFolder(BostonPatientFolder(rootB, "L211", "604137"))

        val bundles = groupIntoBundles(
            listOf(
                item("a.bnk", FileKind.BOSTON_BNK, bnkA, rootA),
                item("b.bnk", FileKind.BOSTON_BNK, bnkB, rootB),
                item("a1.pdf", FileKind.DEVICE_PDF, pdfA, rootA),
                item("b1.pdf", FileKind.DEVICE_PDF, pdfBlind, rootB),
            ),
        )
        assertEquals(2, bundles.size)
        assertEquals(setOf("a.bnk", "a1.pdf"), bundles.first { "a.bnk" in it.items.map { i -> i.fileName } }.items.map { it.fileName }.toSet())
        assertEquals(setOf("b.bnk", "b1.pdf"), bundles.first { "b.bnk" in it.items.map { i -> i.fileName } }.items.map { it.fileName }.toSet())
    }
}
