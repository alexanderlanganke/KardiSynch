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
import kotlin.test.assertTrue

/** Covers issue #200's data-layer half: [KardiSynchRepository.clearLocalIndex]. */
class KardiSynchRepositoryMaintenanceTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-maintenance-test").toFile()
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

    @Test
    fun `clearLocalIndex empties patients, devices, leads, and reports`() {
        runBlocking {
            val report = UnifiedReport(
                manufacturer = "Medtronic",
                interrogationDate = "2026-07-21",
                patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-03-15"),
                device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "SER1"),
            )
            val outcome = repository.importReport(reader, writer, reportsRoot, report).getOrThrow()

            assertEquals(1, repository.observePatients().first().size)

            repository.clearLocalIndex()

            assertTrue(repository.observePatients().first().isEmpty())
            assertTrue(repository.observeReportsForPatient(outcome.patientId).first().isEmpty())
            assertTrue(repository.getDevicesForReport(outcome.reportId).isEmpty())
            assertTrue(repository.getLeadsForReport(outcome.reportId).isEmpty())
        }
    }

    @Test
    fun `clearLocalIndex does not touch the setting store`() {
        runBlocking {
            repository.setSetting("dataRootPath", "/some/path")
            repository.clearLocalIndex()
            assertEquals("/some/path", repository.getSetting("dataRootPath"))
        }
    }

    @Test
    fun `clearLocalIndex never touches _DATA on disk`() {
        runBlocking {
            val report = UnifiedReport(
                manufacturer = "Medtronic",
                interrogationDate = "2026-07-21",
                patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-03-15"),
                device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "SER1"),
            )
            repository.importReport(reader, writer, reportsRoot, report).getOrThrow()
            val patientDirsBefore = File(reportsRoot).listFiles()?.size ?: 0

            repository.clearLocalIndex()

            val patientDirsAfter = File(reportsRoot).listFiles()?.size ?: 0
            assertEquals(patientDirsBefore, patientDirsAfter)
            assertTrue(patientDirsAfter > 0, "expected the _DATA patient directory to still be on disk")
        }
    }
}
