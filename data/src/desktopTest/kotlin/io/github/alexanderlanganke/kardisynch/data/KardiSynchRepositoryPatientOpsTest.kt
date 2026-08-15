package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers issue #177: updatePatientInfo, moveReport, removePatientDirectory. */
class KardiSynchRepositoryPatientOpsTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-patientops-test").toFile()
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
    }

    @AfterTest
    fun tearDown() {
        dataRoot.deleteRecursively()
    }

    private fun sampleReport(lastName: String, dob: String, serial: String) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-07-21",
        patient = PatientInfo(firstName = "Max", lastName = lastName, dob = dob),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = serial),
    )

    @Test
    fun `updatePatientInfo rewrites patient xml and the local index row`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Testpatient", "1970-03-15", "S1")).getOrThrow()

        repository.updatePatientInfo(
            reader, writer, reportsRoot, outcome.patientId,
            firstName = "Maxine", lastName = "Correctname", dob = "1970-03-16", hospitalPatientId = "MRN123",
        ).getOrThrow()

        val patient = repository.getPatientById(outcome.patientId)
        assertEquals("Maxine", patient?.firstName)
        assertEquals("Correctname", patient?.lastName)
        assertEquals("1970-03-16", patient?.dob)
        assertEquals("MRN123", patient?.hospitalPatientId)

        val xml = File(outcome.patientDirHandle, "patient.xml").readText()
        assertTrue(xml.contains("Correctname"))
        assertTrue(xml.contains("MRN123"))
    }

    @Test
    fun `updatePatientInfo preserves an existing MRI-manufacturer-warning cache instead of wiping it (issue 175)`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Testpatient", "1970-03-15", "S1")).getOrThrow()

        // Simulate an Electron client having already cached these fields —
        // rewrite patient.xml directly, bypassing the KMP write path.
        val cachedXml = io.github.alexanderlanganke.kardisynch.core.datastore.generatePatientXml(
            outcome.patientId, "Max", "Testpatient", "1970-03-15", null,
            mriStatus = """{"foo":"bar"}""", mriDataHash = "hash-1",
            manufacturerWarningStatus = """{"status":"advisory","details":"Battery advisory"}""", manufacturerWarningHash = "hash-2",
        )
        File(outcome.patientDirHandle, "patient.xml").writeText(cachedXml)

        repository.updatePatientInfo(
            reader, writer, reportsRoot, outcome.patientId,
            firstName = "Maxine", lastName = "Correctname", dob = "1970-03-16", hospitalPatientId = null,
        ).getOrThrow()

        val xml = File(outcome.patientDirHandle, "patient.xml").readText()
        assertTrue(xml.contains("Correctname"), "the actual edit still applies")
        assertTrue(xml.contains("""{"foo":"bar"}"""), "mri_status preserved, not wiped")
        assertTrue(xml.contains("hash-1"), "mri_data_hash preserved")
        assertTrue(xml.contains("advisory"), "manufacturer_warning_status preserved")
        assertTrue(xml.contains("hash-2"), "manufacturer_warning_hash preserved")
    }

    @Test
    fun `reindexFrom populates the MRI-manufacturer-warning cache columns from patient xml`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Testpatient", "1970-03-15", "S1")).getOrThrow()
        val cachedXml = io.github.alexanderlanganke.kardisynch.core.datastore.generatePatientXml(
            outcome.patientId, "Max", "Testpatient", "1970-03-15", null,
            mriStatus = """{"foo":"bar"}""", mriDataHash = "hash-1",
            manufacturerWarningStatus = """{"status":"recall"}""", manufacturerWarningHash = "hash-2",
        )
        File(outcome.patientDirHandle, "patient.xml").writeText(cachedXml)

        repository.reindexFrom(reader, reportsRoot)

        val patient = repository.getPatientById(outcome.patientId)
        assertEquals("""{"foo":"bar"}""", patient?.mriStatus)
        assertEquals("hash-1", patient?.mriDataHash)
        assertEquals("""{"status":"recall"}""", patient?.manufacturerWarningStatus)
        assertEquals("hash-2", patient?.manufacturerWarningHash)
    }

    @Test
    fun `findPatientDirectoryHandle resolves an existing patient and returns null for an unknown one`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Testpatient", "1970-03-15", "S1")).getOrThrow()

        val handle = repository.findPatientDirectoryHandle(reader, reportsRoot, outcome.patientId)
        assertEquals(outcome.patientDirHandle, handle)
        assertTrue(repository.findPatientDirectoryHandle(reader, reportsRoot, "does-not-exist") == null)
    }

    @Test
    fun `moveReport relocates the visit directory and repoints the index`() = runBlocking {
        val fromOutcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Alpha", "1970-01-01", "S1")).getOrThrow()
        val toOutcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Beta", "1970-02-02", "S2")).getOrThrow()

        assertTrue(File(fromOutcome.visitDirHandle).exists())

        repository.moveReport(reader, writer, reportsRoot, fromOutcome.reportId, fromOutcome.patientId, toOutcome.patientId).getOrThrow()

        assertFalse(File(fromOutcome.visitDirHandle).exists())
        val movedDir = File(toOutcome.patientDirHandle).listFiles { f -> f.isDirectory && f.name.endsWith(fromOutcome.reportId) }?.firstOrNull()
        assertTrue(movedDir != null && movedDir.exists())

        val betaReports = repository.observeReportsForPatient(toOutcome.patientId).first { it.size >= 2 }
        assertTrue(betaReports.any { it.id == fromOutcome.reportId })
        val alphaReports = repository.observeReportsForPatient(fromOutcome.patientId).first()
        assertFalse(alphaReports.any { it.id == fromOutcome.reportId })
    }

    @Test
    fun `removePatientDirectory deletes the patient's _DATA subtree`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport("Gone", "1970-01-01", "S1")).getOrThrow()
        assertTrue(File(outcome.patientDirHandle).exists())

        repository.removePatientDirectory(reader, writer, reportsRoot, outcome.patientId).getOrThrow()

        assertFalse(File(outcome.patientDirHandle).exists())
    }

    @Test
    fun `removePatientDirectory fails cleanly for an unknown patient`() = runBlocking {
        val result = repository.removePatientDirectory(reader, writer, reportsRoot, "does-not-exist")
        assertTrue(result.isFailure)
    }
}
