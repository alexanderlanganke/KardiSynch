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

/** Covers the UI-parity plan's Phase 4: the dashboard's manufacturer filter/sort needs each patient's *most recent* report's manufacturer/model, not just any of them. */
class KardiSynchRepositoryDashboardQueriesTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-dashboard-queries-test").toFile()
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

    private fun report(date: String, manufacturer: String, model: String) = UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = date,
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = model, serialNumber = "S1"),
    )

    @Test
    fun `getPatientsLatestDeviceInfo returns the manufacturer and model of the most recent report`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report("2024-01-01", "Biotronik", "OldModel")).getOrThrow()
        repository.importReport(reader, writer, reportsRoot, report("2026-06-15", "Medtronic", "NewModel"), explicitNewVisit = true).getOrThrow()

        val summaries = repository.getPatientsLatestDeviceInfo()
        val summary = summaries.single { it.patientId == first.patientId }
        assertEquals("Medtronic", summary.manufacturer)
        assertEquals("NewModel", summary.deviceModel)
    }
}
