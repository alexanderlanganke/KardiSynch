package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.testing.MockDevice
import io.github.alexanderlanganke.kardisynch.core.testing.MockPatient
import io.github.alexanderlanganke.kardisynch.core.testing.mockBiotronikXml
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
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

/** Covers issue #188: reparseAllVisits walking real visit directories and re-parsing their stored raw files. */
class ReparseServiceTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-reparse-service-test").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
    }

    @AfterTest
    fun tearDown() {
        dataRoot.deleteRecursively()
    }

    private val patient = MockPatient(firstName = "Max", lastName = "Testpatient", dob = "1970-03-15")

    @Test
    fun `reparses a visit's raw file and rewrites visit xml and the local index`() = runBlocking {
        val xml = mockBiotronikXml(patient, MockDevice(model = "Amvia Sky DR-T", serial = "BIO-1"))
        val imported = repository.importReport(
            reader, writer, reportsRoot,
            io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse("BIOSTD_mock.xml", xml.encodeToByteArray())!!.copy(manufacturer = "Biotronik"),
            lock = NoOpDirectoryLock,
        ).getOrThrow()
        File(imported.visitDirHandle, "BIOSTD_mock.xml").writeText(xml)
        // Simulate a visit whose visit.xml is stale (as if imported by an older parser version).
        File(imported.visitDirHandle, "visit.xml").writeText(
            File(imported.visitDirHandle, "visit.xml").readText().replace("Pacemaker", "Unknown"),
        )

        val summary = reparseAllVisits(repository, reader, writer, reportsRoot)

        assertEquals(1, summary.visitsTotal)
        assertEquals(1, summary.visitsSucceeded)
        assertEquals(0, summary.visitsFailed)

        val reports = repository.observeReportsForPatient(imported.patientId).first()
        assertEquals("Pacemaker", reports.single().deviceType, "re-parsed from the raw file, not left at the stale Unknown")
    }

    @Test
    fun `a visit directory with no parseable raw files counts as empty, not failed`() = runBlocking {
        // No raw file copied alongside visit.xml — only the metadata file exists.
        repository.importReport(
            reader, writer, reportsRoot,
            io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse(
                "BIOSTD_mock.xml",
                mockBiotronikXml(patient, MockDevice(model = "Amvia Sky DR-T", serial = "BIO-1")).encodeToByteArray(),
            )!!.copy(manufacturer = "Biotronik"),
        ).getOrThrow()

        val summary = reparseAllVisits(repository, reader, writer, reportsRoot)
        assertEquals(1, summary.visitsTotal)
        assertEquals(0, summary.visitsSucceeded)
        assertEquals(1, summary.visitsEmpty)
        assertEquals(0, summary.visitsFailed)
    }

    @Test
    fun `reparsing an empty Reports root is a no-op`() = runBlocking {
        val summary = reparseAllVisits(repository, reader, writer, reportsRoot)
        assertEquals(0, summary.visitsTotal)
        assertTrue(summary.failures.isEmpty())
    }

    @Test
    fun `progress callback fires once per visit with the correct total`() = runBlocking {
        repository.importReport(
            reader, writer, reportsRoot,
            io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse(
                "BIOSTD_mock.xml",
                mockBiotronikXml(patient, MockDevice(model = "Amvia Sky DR-T", serial = "BIO-1")).encodeToByteArray(),
            )!!.copy(manufacturer = "Biotronik"),
        ).getOrThrow()

        val progressCalls = mutableListOf<Pair<Int, Int>>()
        reparseAllVisits(repository, reader, writer, reportsRoot) { current, total -> progressCalls.add(current to total) }

        assertEquals(listOf(1 to 1), progressCalls)
    }
}
