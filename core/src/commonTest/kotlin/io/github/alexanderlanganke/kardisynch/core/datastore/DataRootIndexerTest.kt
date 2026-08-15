package io.github.alexanderlanganke.kardisynch.core.datastore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** In-memory [DataRootReader] for tests — handles are just map keys, directories are handle prefixes tracked separately. */
private class FakeDataRootReader : DataRootReader {
    private val files = mutableMapOf<String, String>()
    private val dirChildren = mutableMapOf<String, MutableList<DataEntry>>()

    fun addDirectory(parentHandle: String, name: String, handle: String) {
        dirChildren.getOrPut(parentHandle) { mutableListOf() }.add(DataEntry(name, handle, isDirectory = true))
        dirChildren.putIfAbsent(handle, mutableListOf())
    }

    fun addFile(parentHandle: String, name: String, handle: String, content: String) {
        dirChildren.getOrPut(parentHandle) { mutableListOf() }.add(DataEntry(name, handle, isDirectory = false))
        files[handle] = content
    }

    override fun listChildren(directoryHandle: String): List<DataEntry> = dirChildren[directoryHandle] ?: emptyList()
    override fun readText(fileHandle: String): String? = files[fileHandle]
    override fun readBytes(fileHandle: String): ByteArray? = files[fileHandle]?.encodeToByteArray()
    override fun fileSize(fileHandle: String): Long? = files[fileHandle]?.encodeToByteArray()?.size?.toLong()
}

private const val PATIENT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<patient>
  <id>patient-1</id>
  <first_name>Jane</first_name>
  <last_name>Doe</last_name>
  <dob>1970-05-05</dob>
  <hospitalPatientId>MRN123</hospitalPatientId>
  <devices>
    <device>
      <model>Endurity Core</model>
      <serial>ANONDEV00001</serial>
      <manufacturer>Abbott</manufacturer>
      <implant_date>2018-11-08</implant_date>
      <type>Pacemaker</type>
      <status>current</status>
    </device>
  </devices>
</patient>"""

private const val VISIT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<visit>
  <report_id>report-1</report_id>
  <interrogation_date>2026-02-05</interrogation_date>
  <manufacturer>Abbott</manufacturer>
  <device_type>Pacemaker</device_type>
  <device_model>Endurity Core</device_model>
  <device_serial>ANONDEV00001</device_serial>
  <battery>
    <voltage value="2.94784" unit="V" />
    <status>OK</status>
  </battery>
  <leads>
    <lead>
      <name>RV</name>
      <model>2088TC Tendril STS</model>
      <serial>ANONRV00001</serial>
      <anatomic_location>RV</anatomic_location>
      <impedance value="537.5" unit="Ohm" />
      <sensing value="12" unit="mV" />
      <pacing_threshold value="0.5" unit="V" />
    </lead>
  </leads>
  <additional_fields>
    <field name="ejection_fraction">55%</field>
  </additional_fields>
</visit>"""

class PatientXmlTest {
    @Test
    fun `parses a real patient xml shape`() {
        val patient = parsePatientXml(PATIENT_XML)
        assertEquals("patient-1", patient?.id)
        assertEquals("Jane", patient?.firstName)
        assertEquals("Doe", patient?.lastName)
        assertEquals("1970-05-05", patient?.dob)
        assertEquals("MRN123", patient?.hospitalPatientId)
    }

    @Test
    fun `returns null for the wrong root element`() {
        assertNull(parsePatientXml("<visit><report_id>x</report_id></visit>"))
    }

    @Test
    fun `hospitalPatientId is null, not empty string, when the element is absent`() {
        val patient = parsePatientXml("<patient><id>p1</id><last_name>Doe</last_name><dob>1970-01-01</dob></patient>")
        assertNull(patient?.hospitalPatientId)
    }
}

class VisitXmlTest {
    @Test
    fun `parses a real visit xml shape into a UnifiedReport`() {
        val indexed = parseVisitXml(VISIT_XML, patientId = "patient-1")
        assertEquals("report-1", indexed?.id)
        assertEquals("patient-1", indexed?.patientId)
        val report = indexed!!.report
        assertEquals("Abbott", report.manufacturer)
        assertEquals("2026-02-05", report.interrogationDate)
        assertEquals("Endurity Core", report.device.model)
        assertEquals("ANONDEV00001", report.device.serialNumber)
        assertEquals(2.94784, report.battery.voltage?.value)
        assertEquals("OK", report.battery.status)
        assertEquals(1, report.leads.size)
        assertEquals("RV", report.leads[0].name)
        assertEquals(537.5, report.leads[0].impedance?.value)
        assertEquals("55%", report.additionalFields["ejection_fraction"])
    }

    @Test
    fun `tolerates missing optional blocks (battery, leads, additional_fields)`() {
        val minimal = """<visit><report_id>r1</report_id><interrogation_date>2026-01-01</interrogation_date></visit>"""
        val indexed = parseVisitXml(minimal, patientId = "p1")
        assertEquals("r1", indexed?.id)
        assertEquals(BatteryDataDefaults, indexed?.report?.battery)
        assertTrue(indexed!!.report.leads.isEmpty())
        assertTrue(indexed.report.additionalFields.isEmpty())
    }

    @Test
    fun `returns null for the wrong root element or missing report_id`() {
        assertNull(parseVisitXml("<patient><id>x</id></patient>", "p1"))
        assertNull(parseVisitXml("<visit><interrogation_date>2026-01-01</interrogation_date></visit>", "p1"))
    }
}

class DataRootIndexerTest {
    @Test
    fun `walks a Reports root and rebuilds the full patient+report index`() {
        val reader = FakeDataRootReader()
        reader.addDirectory("root", "patient-1_Doe_Jane", "root/p1")
        reader.addFile("root/p1", "patient.xml", "root/p1/patient.xml", PATIENT_XML)
        reader.addDirectory("root/p1", "2026_02_05_report-1", "root/p1/v1")
        reader.addFile("root/p1/v1", "visit.xml", "root/p1/v1/visit.xml", VISIT_XML)
        reader.addFile("root/p1/v1", "report.pdf", "root/p1/v1/report.pdf", "binary-ish content")

        val result = DataRootIndexer(reader).indexAll("root")

        assertEquals(1, result.patients.size)
        assertEquals("patient-1", result.patients[0].id)
        assertEquals(1, result.reports.size)
        assertEquals("report-1", result.reports[0].id)
        assertEquals("patient-1", result.reports[0].patientId)
    }

    @Test
    fun `skips a patient directory with no readable patient xml instead of failing the whole reindex`() {
        val reader = FakeDataRootReader()
        reader.addDirectory("root", "broken", "root/broken") // no patient.xml added
        reader.addDirectory("root", "patient-1_Doe_Jane", "root/p1")
        reader.addFile("root/p1", "patient.xml", "root/p1/patient.xml", PATIENT_XML)

        val result = DataRootIndexer(reader).indexAll("root")

        assertEquals(1, result.patients.size)
        assertEquals("patient-1", result.patients[0].id)
    }

    @Test
    fun `skips a visit directory with no readable visit xml`() {
        val reader = FakeDataRootReader()
        reader.addDirectory("root", "patient-1_Doe_Jane", "root/p1")
        reader.addFile("root/p1", "patient.xml", "root/p1/patient.xml", PATIENT_XML)
        reader.addDirectory("root/p1", "broken_visit", "root/p1/broken")
        // no visit.xml added under root/p1/broken

        val result = DataRootIndexer(reader).indexAll("root")

        assertEquals(1, result.patients.size)
        assertTrue(result.reports.isEmpty())
    }
}

private val BatteryDataDefaults = io.github.alexanderlanganke.kardisynch.core.model.BatteryData()
