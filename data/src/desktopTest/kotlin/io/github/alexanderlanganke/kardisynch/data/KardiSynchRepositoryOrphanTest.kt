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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers issue #186: findOrphanedVisits, moveOrphanedVisits. */
class KardiSynchRepositoryOrphanTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-orphan-test").toFile()
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

    private fun report(lastName: String, dob: String, serial: String) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-07-21",
        patient = PatientInfo(firstName = "Max", lastName = lastName, dob = dob),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = serial),
    )

    @Test
    fun `a correctly placed visit is never flagged as an orphan`() = runBlocking {
        repository.importReport(reader, writer, reportsRoot, report("Doe", "1970-01-01", "S1")).getOrThrow()
        assertTrue(repository.findOrphanedVisits(reader, reportsRoot).isEmpty())
    }

    @Test
    fun `detects and repairs a visit whose directory was relocated without updating the index`() = runBlocking {
        val a = repository.importReport(reader, writer, reportsRoot, report("Alpha", "1970-01-01", "S1")).getOrThrow()
        val b = repository.importReport(reader, writer, reportsRoot, report("Beta", "1971-02-02", "S2")).getOrThrow()

        // Simulate corruption: physically relocate A's visit into B's patient
        // directory via the raw writer primitive, WITHOUT going through
        // moveReport (which would also update the index row) — exactly the
        // "interrupted move" scenario this feature repairs.
        val relocatedHandle = writer.moveDirectory(a.visitDirHandle, b.patientDirHandle)
        assertTrue(relocatedHandle != null)

        val orphans = repository.findOrphanedVisits(reader, reportsRoot)
        assertEquals(1, orphans.size)
        val orphan = orphans[0]
        assertEquals(a.reportId, orphan.reportId)
        assertEquals(b.patientId, orphan.currentPatientId, "currently sits under B's directory")
        assertEquals(a.patientId, orphan.correctPatientId, "the index still says it belongs to A")
        assertTrue(orphan.correctPatientDirExists)

        val result = repository.moveOrphanedVisits(reader, writer, reportsRoot, listOf(a.reportId))
        assertEquals(1, result.moved)
        assertTrue(result.errors.isEmpty())

        assertTrue(repository.findOrphanedVisits(reader, reportsRoot).isEmpty(), "no longer an orphan after repair")
        val movedBackDir = File(a.patientDirHandle).listFiles { f -> f.isDirectory && f.name.endsWith(a.reportId) }?.firstOrNull()
        assertTrue(movedBackDir != null && movedBackDir.exists(), "visit should be back under A's directory")
        assertFalse(File(relocatedHandle!!).exists(), "no longer under B's directory")
    }

    @Test
    fun `moveOrphanedVisits ignores report IDs that aren't actually orphaned`() = runBlocking {
        val a = repository.importReport(reader, writer, reportsRoot, report("Alpha", "1970-01-01", "S1")).getOrThrow()
        val result = repository.moveOrphanedVisits(reader, writer, reportsRoot, listOf(a.reportId))
        assertEquals(0, result.moved)
        assertTrue(result.errors.isEmpty())
    }
}
