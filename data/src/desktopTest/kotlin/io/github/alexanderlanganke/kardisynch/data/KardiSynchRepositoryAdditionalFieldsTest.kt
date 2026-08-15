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

/** Covers the UI-parity plan's Phase 12: the "Additional Data" card merges manufacturer-specific fields across all of a patient's visits, newest visit wins per field — matching Electron's mergeAdditionalFields. */
class KardiSynchRepositoryAdditionalFieldsTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-additional-fields-test").toFile()
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

    private fun report(date: String, fields: Map<String, String>) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = date,
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
        additionalFields = fields,
    )

    @Test
    fun `getMergedAdditionalFields keeps the newest value per field across visits`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report("2025-01-01", mapOf("EF" to "35%", "NYHA" to "II"))).getOrThrow()
        repository.importReport(reader, writer, reportsRoot, report("2026-01-01", mapOf("EF" to "40%")), explicitNewVisit = true).getOrThrow()

        val merged = repository.getMergedAdditionalFields(reader, reportsRoot, first.patientId)
        assertEquals("40%", merged["EF"]?.value, "the later visit's EF value wins")
        assertEquals("2026-01-01", merged["EF"]?.lastSeenDate)
        assertEquals("II", merged["NYHA"]?.value, "a field only present on the older visit is still carried forward")
        assertEquals("2025-01-01", merged["NYHA"]?.lastSeenDate)
    }

    @Test
    fun `getMergedAdditionalFields is empty for a patient with no additional fields on file`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report("2026-01-01", emptyMap())).getOrThrow()
        val merged = repository.getMergedAdditionalFields(reader, reportsRoot, outcome.patientId)
        assertTrue(merged.isEmpty())
    }
}
