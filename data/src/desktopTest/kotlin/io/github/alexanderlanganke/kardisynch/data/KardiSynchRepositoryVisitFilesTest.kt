package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Covers the UI-parity plan's Phase 11: the raw document viewer's file list must include the visit's real source files but never the visit.xml/patient.xml metadata siblings. */
class KardiSynchRepositoryVisitFilesTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-visit-files-test").toFile()
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

    private fun report() = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-01-01",
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
    )

    @Test
    fun `getVisitFiles lists raw files but excludes visit and patient xml`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        File(outcome.visitDirHandle, "report.pdf").writeBytes(byteArrayOf(1, 2, 3))
        File(outcome.visitDirHandle, "raw_data.xml").writeText("<data/>")

        val files = repository.getVisitFiles(reader, reportsRoot, outcome.patientId, outcome.reportId)
        val names = files.map { it.name }.toSet()
        assertEquals(setOf("report.pdf", "raw_data.xml"), names)
        assertTrue("visit.xml" !in names)
    }

    @Test
    fun `getVisitFiles returns an empty list for an unknown report id`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        val files = repository.getVisitFiles(reader, reportsRoot, outcome.patientId, "does-not-exist")
        assertEquals(emptyList(), files)
    }
}
