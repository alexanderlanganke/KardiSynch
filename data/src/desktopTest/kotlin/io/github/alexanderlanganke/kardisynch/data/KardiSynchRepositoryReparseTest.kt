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

/** Covers issue #188: reparseVisit rewrites visit.xml and the local index row, merging into what's already stored. */
class KardiSynchRepositoryReparseTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-reparse-test").toFile()
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

    private fun report(deviceModel: String = "Model1", deviceType: String = "ICD") = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-07-21",
        patient = PatientInfo(firstName = "Max", lastName = "Doe", dob = "1970-01-01"),
        device = DeviceInfo(type = deviceType, model = deviceModel, serialNumber = "S1"),
    )

    @Test
    fun `reparseVisit rewrites visit xml and the local index row from the fresh aggregate`() = runBlocking {
        val imported = repository.importReport(reader, writer, reportsRoot, report(deviceType = "Unknown")).getOrThrow()

        val result = repository.reparseVisit(
            reader, writer, imported.patientId, imported.visitDirHandle, imported.reportId,
            report(deviceType = "ICD"),
        )
        result.getOrThrow()

        val row = repository.observeReportsForPatient(imported.patientId).first()
        assertEquals("ICD", row.single().deviceType)

        val visitXml = File(imported.visitDirHandle, "visit.xml").readText()
        assertEquals(true, visitXml.contains("ICD"))
    }

    @Test
    fun `reparseVisit preserves an existing field the fresh aggregate can't recover`() = runBlocking {
        val imported = repository.importReport(reader, writer, reportsRoot, report(deviceModel = "KnownModel")).getOrThrow()

        // Simulate a fresh re-parse that regressed and lost the model.
        val weakened = report(deviceModel = "Unknown")
        repository.reparseVisit(reader, writer, imported.patientId, imported.visitDirHandle, imported.reportId, weakened).getOrThrow()

        val reports = repository.observeReportsForPatient(imported.patientId).first()
        assertEquals("KnownModel", reports.single().deviceModel, "existing model preserved when the fresh parse came back Unknown")
    }
}
