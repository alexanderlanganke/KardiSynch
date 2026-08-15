package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers the UI-parity plan's Phase 1: `Reports.sq`'s `deleteReport` query had no repository wrapper until now. */
class KardiSynchRepositoryDeleteReportTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-delete-report-test").toFile()
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
        interrogationDate = "2026-07-21",
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
        leads = listOf(LeadData(name = "RV", anatomicLocation = "RV")),
    )

    @Test
    fun `deleteReport removes the report row, its devices and leads, and the visit directory`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        assertTrue(File(outcome.visitDirHandle).exists())

        repository.deleteReport(reader, writer, reportsRoot, outcome.reportId).getOrThrow()

        assertTrue(repository.observeReportsForPatient(outcome.patientId).first().isEmpty())
        assertTrue(repository.getDevicesForReport(outcome.reportId).isEmpty())
        assertTrue(repository.getLeadsForReport(outcome.reportId).isEmpty())
        assertFalse(File(outcome.visitDirHandle).exists())
    }

    @Test
    fun `deleteReport on an unknown report id fails instead of silently no-opping`() = runBlocking {
        val result = repository.deleteReport(reader, writer, reportsRoot, "does-not-exist")
        assertTrue(result.isFailure)
    }
}
