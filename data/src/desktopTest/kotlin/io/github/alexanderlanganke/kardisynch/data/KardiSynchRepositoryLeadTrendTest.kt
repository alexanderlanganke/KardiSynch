package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
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

/** Covers the UI-parity plan's Phase 5: the per-lead trend chart's backend — `Leads.sq`'s `selectLeadTrendByLocation` had no repository wrapper at all before this. */
class KardiSynchRepositoryLeadTrendTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-lead-trend-test").toFile()
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

    private fun report(date: String, serial: String, location: String, impedance: Double) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = date,
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = serial),
        leads = listOf(LeadData(name = "RV", anatomicLocation = location, impedance = Measurement(impedance, "Ω"))),
    )

    @Test
    fun `getLeadLocationsForPatient lists distinct locations across visits`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report("2024-01-01", "S1", "RV", 500.0)).getOrThrow()
        repository.importReport(reader, writer, reportsRoot, report("2024-06-01", "S1", "RA", 450.0), explicitNewVisit = true).getOrThrow()
        repository.importReport(reader, writer, reportsRoot, report("2024-09-01", "S1", "RV", 520.0), explicitNewVisit = true).getOrThrow()

        val locations = repository.getLeadLocationsForPatient(first.patientId)
        assertEquals(listOf("RA", "RV"), locations)
    }

    @Test
    fun `getLeadTrendByLocation returns readings in chronological order with device serial for the generator-change break`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report("2024-01-01", "S1", "RV", 500.0)).getOrThrow()
        repository.importReport(reader, writer, reportsRoot, report("2024-06-01", "S2", "RV", 480.0), explicitNewVisit = true).getOrThrow()

        val trend = repository.getLeadTrendByLocation(first.patientId, "RV")
        assertEquals(2, trend.size)
        assertEquals(listOf("2024-01-01", "2024-06-01"), trend.map { it.interrogationDate })
        assertEquals(listOf(500.0, 480.0), trend.map { it.impedanceValue })
        assertTrue(trend[0].deviceSerialNumber != trend[1].deviceSerialNumber)
    }
}
