package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.testing.MockDevice
import io.github.alexanderlanganke.kardisynch.core.testing.MockPatient
import io.github.alexanderlanganke.kardisynch.core.testing.mockAbbottLog
import io.github.alexanderlanganke.kardisynch.core.testing.mockBiotronikXml
import io.github.alexanderlanganke.kardisynch.core.testing.mockBostonScientificBnk
import io.github.alexanderlanganke.kardisynch.core.testing.mockDummyPdf
import io.github.alexanderlanganke.kardisynch.core.testing.mockMedtronicPdd
import io.github.alexanderlanganke.kardisynch.core.testing.mockMicroportXml
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * End-to-end coverage of the import pipeline (dispatch → parse → visit
 * match/merge → local index) using the synthetic exports from
 * [io.github.alexanderlanganke.kardisynch.core.testing] instead of the
 * real, gitignored `test/` fixtures — portable to a fresh clone or CI.
 * [MockExportFixturesTest] (in `core`) already checked each generator
 * parses correctly on its own; this suite checks what happens once a
 * (possibly messy, possibly batched) set of them lands in `_IMPORT`.
 */
class ImportPipelineMockTest {
    private lateinit var importDir: File
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter
    private lateinit var scope: CoroutineScope
    private val events = mutableListOf<String>()

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-pipeline-import").toFile()
        dataRoot = Files.createTempDirectory("kardisynch-pipeline-data").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        events.clear()
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        importDir.deleteRecursively()
        dataRoot.deleteRecursively()
    }

    private fun dropFile(name: String, bytes: ByteArray) {
        File(importDir, name).writeBytes(bytes)
    }

    private fun dropFile(name: String, text: String) = dropFile(name, text.encodeToByteArray())

    /** Starts the watcher, waits until at least [minEvents] events land (or times out), then stops it. */
    private suspend fun runBatch(minEvents: Int, timeoutMs: Long = 20_000) {
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock) { events.add(it) }
        watcher.start()
        try {
            withTimeout(timeoutMs) {
                while (events.size < minEvents) delay(100)
            }
        } finally {
            watcher.stop()
        }
    }

    private val patient = MockPatient(firstName = "Max", lastName = "Testpatient", dob = "1970-03-15")

    @Test
    fun `imports one file per manufacturer for the same patient as distinct same-day visits`() = runBlocking {
        val biotronikDevice = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-001")
        val microportDevice = MockDevice(model = "Reply 200 DR-T", serial = "MCP-SER-001")
        val bostonDevice = MockDevice(model = "D321-200-0", serial = "BOS-SER-001")
        val abbottDevice = MockDevice(model = "Assurity MRI", serial = "ABT-SER-001")
        val medtronicDevice = MockDevice(model = "Protecta XT", serial = "PQR123456X")

        dropFile("BIOSTD_mock.xml", mockBiotronikXml(patient, biotronikDevice))
        dropFile("microport_mock.xml", mockMicroportXml(patient, microportDevice))
        dropFile("boston_mock.bnk", mockBostonScientificBnk(patient, bostonDevice))
        dropFile("12345.log", mockAbbottLog(patient, abbottDevice))
        dropFile("medtronic_mock.pdd", mockMedtronicPdd(patient, medtronicDevice))

        runBatch(minEvents = 5)

        assertTrue(events.count { it.startsWith("Imported") } == 5, "expected 5 successful imports, got: $events")
        assertTrue(importDir.listFiles { f -> f.isFile }.isNullOrEmpty(), "_IMPORT should be empty after a clean batch")

        // Medtronic .pdd never carries a DOB (see MockExportFixturesTest) — its
        // report always lands under a "1900-01-01" placeholder patient, distinct
        // from the other four manufacturers' real-DOB patient. Two patients is
        // the correct outcome here, not a bug.
        val allPatients = withTimeout(5000) { waitForPatients(2) }
        assertEquals(2, allPatients.size)

        val realDobPatient = allPatients.first { it.dob == patient.dob }
        val realDobReports = withTimeout(5000) { waitForReports(repository.observeReportsForPatient(realDobPatient.id), 4) }
        assertEquals(4, realDobReports.size, "different device serials on the same day must not merge into one visit")
        assertEquals(setOf("Biotronik", "Microport", "Boston Scientific", "Abbott"), realDobReports.map { it.manufacturer }.toSet())

        val medtronicPatient = allPatients.first { it.dob == "1900-01-01" }
        val medtronicReports = withTimeout(5000) { waitForReports(repository.observeReportsForPatient(medtronicPatient.id), 1) }
        assertEquals(1, medtronicReports.size)
        assertEquals("Medtronic", medtronicReports[0].manufacturer)
    }

    @Test
    fun `reimporting the identical file merges into the same visit instead of duplicating it`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-002")
        dropFile("first.log", mockAbbottLog(patient, device))
        runBatch(minEvents = 1)

        val firstImportEvents = events.size
        dropFile("first_again.log", mockAbbottLog(patient, device)) // same patient/device/date -> same interrogation
        runBatch(minEvents = firstImportEvents + 1)

        val patients = withTimeout(5000) { waitForPatients(1) }
        val reports = repository.observeReportsForPatient(patients[0].id)
        val reportRows = withTimeout(5000) { waitForReports(reports, 1) }
        assertEquals(1, reportRows.size, "an identical same-day, same-serial reimport must reuse the existing visit")
        assertTrue(events.any { it.contains("merged into existing visit") })
    }

    @Test
    fun `a companion PDF sharing a basename with a structured file attaches to that visit`() = runBlocking {
        val device = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-002")
        dropFile("BIOSTD_session42.xml", mockBiotronikXml(patient, device))
        dropFile("BIOSTD_session42.pdf", mockDummyPdf(patient, device))

        runBatch(minEvents = 2)

        assertTrue(events.any { it.startsWith("Imported BIOSTD_session42.xml") }, "events: $events")
        assertTrue(events.any { it.startsWith("Attached BIOSTD_session42.pdf") }, "events: $events")
        assertFalse(events.any { it.contains("_unmatched") && it.contains("BIOSTD_session42.pdf") })

        val patients = withTimeout(5000) { waitForPatients(1) }
        val reports = repository.observeReportsForPatient(patients[0].id)
        val reportRows = withTimeout(5000) { waitForReports(reports, 1) }
        val visitDirName = File(reader.listChildren(reportsRoot).first().handle)
            .listFiles { f -> f.isDirectory && f.name.endsWith(reportRows[0].id) }
            ?.firstOrNull()
        assertTrue(visitDirName != null, "expected a visit directory ending in the report id")
        val visitFiles = visitDirName!!.list()?.toList() ?: emptyList()
        assertTrue(visitFiles.contains("BIOSTD_session42.pdf"), "expected the companion PDF copied into the visit dir, found: $visitFiles")
    }

    @Test
    fun `a standalone PDF with no same-batch companion is moved to _unmatched`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-003")
        dropFile("orphan_report.pdf", mockDummyPdf(patient, device))

        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Skipped orphan_report.pdf") }, "events: $events")
        assertTrue(File(importDir, "_unmatched/orphan_report.pdf").exists())
        assertFalse(File(importDir, "orphan_report.pdf").exists())
    }

    @Test
    fun `a processed batch is recorded as an import session with a matching event`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-004")
        dropFile("session_log_test.log", mockAbbottLog(patient, device))

        runBatch(minEvents = 1)

        val sessions = withTimeout(5000) {
            var list = repository.getImportHistory()
            while (list.isEmpty()) {
                delay(50)
                list = repository.getImportHistory()
            }
            list
        }
        assertEquals(1, sessions.size)
        val session = sessions[0]
        assertEquals("completed", session.status)
        assertTrue(session.summary?.contains("imported=1") == true, "summary: ${session.summary}")

        val sessionEvents = repository.getImportSessionEvents(session.id)
        assertEquals(1, sessionEvents.size)
        assertEquals("imported", sessionEvents[0].status)
        assertTrue(sessionEvents[0].filePath.endsWith("session_log_test.log"))
        assertTrue(sessionEvents[0].patientId != null)
        assertTrue(sessionEvents[0].reportId != null)
    }

    private suspend fun waitForPatients(minCount: Int): List<Patients> =
        withTimeout(5000) { repository.observePatients().first { it.size >= minCount } }

    private suspend fun waitForReports(flow: Flow<List<Reports>>, minCount: Int): List<Reports> =
        withTimeout(5000) { flow.first { it.size >= minCount } }
}
