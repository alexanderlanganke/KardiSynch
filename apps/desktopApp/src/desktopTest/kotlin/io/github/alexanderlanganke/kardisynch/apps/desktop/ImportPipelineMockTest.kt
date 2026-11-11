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
    private val events = java.util.concurrent.CopyOnWriteArrayList<String>()

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

        // These four all share the real DOB, so — regardless of which order
        // the watcher happens to process them in — they're mutual EXACT
        // matches on (last name, DOB) and consolidate into one patient.
        dropFile("BIOSTD_mock.xml", mockBiotronikXml(patient, biotronikDevice))
        dropFile("microport_mock.xml", mockMicroportXml(patient, microportDevice))
        dropFile("boston_mock.bnk", mockBostonScientificBnk(patient, bostonDevice))
        dropFile("12345.log", mockAbbottLog(patient, abbottDevice))
        runBatch(minEvents = 4)

        assertTrue(events.count { it.startsWith("Imported") } == 4, "expected 4 successful imports, got: $events")

        val allPatients = withTimeout(5000) { waitForPatients(1) }
        assertEquals(1, allPatients.size)
        val realDobReports = withTimeout(5000) { waitForReports(repository.observeReportsForPatient(allPatients[0].id), 4) }
        assertEquals(4, realDobReports.size, "different device serials on the same day must not merge into one visit")
        assertEquals(setOf("Biotronik", "Microport", "Boston Scientific", "Abbott"), realDobReports.map { it.manufacturer }.toSet())

        // Medtronic .pdd never carries a DOB (see MockExportFixturesTest) — its
        // report always lands under a "1900-01-01" placeholder, same last name
        // as the patient just created but a different DOB: exactly the
        // near-match signal issue #173's identity ladder exists to catch. It
        // must NOT silently create a second "Testpatient" patient — it's
        // queued for manual review instead, and no second patient appears.
        events.clear()
        val medtronicDevice = MockDevice(model = "Protecta XT", serial = "PQR123456X")
        dropFile("medtronic_mock.pdd", mockMedtronicPdd(patient, medtronicDevice))
        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Queued") && it.contains("Similar patient on file") }, "expected a pending-sort queue message, got: $events")
        assertEquals(1, withTimeout(5000) { waitForPatients(1) }.size, "no second patient created")
        assertEquals(1, repository.getPendingSortTasks().size)
        assertTrue(importDir.listFiles { f -> f.isFile }.isNullOrEmpty(), "the file is staged into _pending_sort, not left in _IMPORT")
    }

    @Test
    fun `a same-surname patient with a different first name and DOB is imported as a new patient, not queued`() = runBlocking {
        val erika = MockPatient("Erika", "Mustermann", "1950-09-15")
        val max = MockPatient("Max", "Mustermann", "1962-03-02")
        dropFile("BIOSTD_erika.xml", mockBiotronikXml(erika, MockDevice(model = "Amvia Sky DR-T", serial = "BIO-ERIKA-1")))
        runBatch(minEvents = 1)
        assertTrue(events.any { it.startsWith("Imported") }, "first patient imported, got: $events")

        events.clear()
        dropFile("BIOSTD_max.xml", mockBiotronikXml(max, MockDevice(model = "Amvia Sky DR-T", serial = "BIO-MAX-1"), interrogationDate = "22.07.2026", dob = "02.03.1962"))
        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Imported") }, "expected an automatic import, got: $events")
        assertTrue(events.none { it.contains("Similar patient") || it.startsWith("Queued") }, "must not be queued for a merge decision, got: $events")
        assertEquals(2, withTimeout(5000) { waitForPatients(2) }.size, "two distinct patients")
        assertTrue(repository.getPendingSortTasks().isEmpty())
    }

    @Test
    fun `an Abbott log and its PDF in a subfolder are imported even when their modified time is in the future`() = runBlocking {
        // A programmer (or a USB stick) with a wrong clock or time zone leaves files stamped hours ahead.
        val abbott = MockPatient("Erika", "Mustermann", "1950-09-15")
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-777")
        val log = File(importDir, "12345.log").apply { writeBytes(mockAbbottLog(abbott, device)) }
        val pdfDir = File(importDir, "PDF").apply { mkdirs() }
        val pdf = File(pdfDir, "12345.pdf").apply {
            writeBytes(mockDummyPdf(listOf("Abbott Merlin PCS Report", "Patient: Mustermann, Erika", "DOB: 1950-09-15", "Device: Assurity MRI", "Serial: ABT-SER-777", "Interrogation Date: 2026-07-21")))
        }
        val threeHoursAhead = System.currentTimeMillis() + 3 * 3_600_000L
        log.setLastModified(threeHoursAhead)
        pdf.setLastModified(threeHoursAhead)

        // The PDF may be handled before or after the log (then it waits and is adopted); either way it must end up attached.
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock) { events.add(it) }
        watcher.start()
        try {
            withTimeout(20_000) { while (events.none { it.startsWith("Attached 12345.pdf") }) delay(100) }
        } finally {
            watcher.stop()
        }

        assertTrue(events.any { it.startsWith("Imported 12345.log") }, "the log must be imported, got: $events")
        assertTrue(repository.getPendingSortTasks().isEmpty(), "nothing is left waiting in the inbox, got: $events")
    }

    @Test
    fun `a file that is held back is announced with the reason instead of being ignored silently`() = runBlocking {
        File(importDir, "empty.log").writeBytes(ByteArray(0))
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock, announceWaitingAfterMs = 0) { events.add(it) }
        watcher.start()
        try {
            withTimeout(10_000) { while (events.none { it.startsWith("Waiting for empty.log") }) delay(100) }
        } finally {
            watcher.stop()
        }
        assertTrue(events.any { it.contains("empty (0 bytes)") }, "the reason is stated, got: $events")
    }

    @Test
    fun `reimporting the identical file is recognised as a duplicate and does not create a second visit`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-002")
        dropFile("first.log", mockAbbottLog(patient, device))
        runBatch(minEvents = 1)

        val firstImportEvents = events.size
        dropFile("first_again.log", mockAbbottLog(patient, device)) // byte-identical content
        runBatch(minEvents = firstImportEvents + 1)

        val patients = withTimeout(5000) { waitForPatients(1) }
        val reports = repository.observeReportsForPatient(patients[0].id)
        val reportRows = withTimeout(5000) { waitForReports(reports, 1) }
        assertEquals(1, reportRows.size, "an identical reimport must not create a second visit")
        assertTrue(events.any { it.contains("duplicate") }, "events: $events")
        assertTrue(File(importDir, "_duplicates/first_again.log").exists(), "the duplicate is kept aside, not deleted")
    }

    @Test
    fun `a file whose visit was deleted since is imported again, not skipped as a duplicate`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-020")
        val bytes = mockAbbottLog(patient, device)
        dropFile("again.log", bytes)
        runBatch(minEvents = 1)
        val storedPath = repository.getIntakeFilesByState("committed").single().storedPath!!
        File(storedPath).delete() // the clinician deleted the visit's files

        val before = events.size
        dropFile("again_copy.log", bytes)
        runBatch(minEvents = before + 1)

        assertTrue(events.drop(before).any { it.startsWith("Imported again_copy.log") }, "events: $events")
    }

    @Test
    fun `files in subfolders of the import folder are picked up`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-021")
        File(importDir, "2026-11-04/clinic").mkdirs()
        File(importDir, "2026-11-04/clinic/session.log").writeBytes(mockAbbottLog(patient, device))

        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Imported session.log") }, "events: $events")
        assertEquals("Import folder/2026-11-04/clinic", repository.getIntakeFilesByState("committed").single().sourceLabel)
    }

    @Test
    fun `a Biotronik export without the BIOSTD_ prefix is recognised by its content`() = runBlocking {
        val device = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-030")
        dropFile("export_final.xml", mockBiotronikXml(patient, device))

        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Imported export_final.xml") }, "events: $events")
        assertEquals("BIOTRONIK_XML", repository.getIntakeFilesByState("committed").single().fileKind)
    }

    @Test
    fun `an unrecognised file is kept, visible in the ledger, and never overwritten by a same-named one`() = runBlocking {
        dropFile("mystery.xml", "<Export><Row/></Export>")
        runBatch(minEvents = 1)
        dropFile("mystery.xml", "<Other><Row/></Other>") // same name, different content
        runBatch(minEvents = 2)

        val unmatched = importDir.resolve("_unmatched").list()!!.sorted()
        assertEquals(2, unmatched.size, "both files must survive: $unmatched")
        assertEquals(2, repository.getIntakeFilesByState("unrecognised").size)
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
    fun `a standalone PDF that matches nothing on file is queued for manual sort with its evidence`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-003")
        dropFile("orphan_report.pdf", mockDummyPdf(patient, device))

        runBatch(minEvents = 1)

        assertTrue(events.any { it.startsWith("Queued orphan_report.pdf for manual sort") }, "events: $events")
        assertFalse(File(importDir, "orphan_report.pdf").exists())
        val task = repository.getPendingSortTasks().single()
        assertEquals("DEVICE_PDF", task.fileKind)
        assertEquals("Testpatient", task.patientLastName)
        assertEquals("ABT-SER-003", task.deviceSerial)
        assertTrue(task.evidence!!.isNotBlank())
        assertEquals("pending", repository.getIntakeFilesByState("pending").single().state)
    }

    @Test
    fun `a PDF naming a patient already on file becomes a visit of that patient`() = runBlocking {
        val device = MockDevice(model = "Assurity MRI", serial = "ABT-SER-040")
        dropFile("first.log", mockAbbottLog(patient, device))
        runBatch(minEvents = 1)

        val before = events.size
        // A different device and day, so it cannot be a companion of the first visit; same patient name and birth date.
        dropFile("followup.pdf", mockDummyPdf(patient, MockDevice("Assurity MRI", "ABT-SER-041"), interrogationDate = "2026-09-01"))
        runBatch(minEvents = before + 1)

        assertTrue(events.drop(before).any { it.startsWith("Imported followup.pdf") && it.contains("from PDF only") }, "events: $events")
        val patients = withTimeout(5000) { waitForPatients(1) }
        assertEquals(1, patients.size, "must not create a second patient")
    }

    @Test
    fun `a companion PDF that arrives in a later poll tick still attaches (issue #171)`() = runBlocking {
        val device = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-010")
        // A short poll-equivalent window so the test doesn't need to wait
        // anywhere near the production 2-minute default — the watcher's own
        // 2-second poll loop naturally separates the two drops into two
        // different processStableFiles() passes since the PDF isn't dropped
        // until after the first one has already completed.
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock) { events.add(it) }
        watcher.start()
        try {
            dropFile("BIOSTD_late_companion.xml", mockBiotronikXml(patient, device))
            withTimeout(20_000) { while (events.none { it.startsWith("Imported BIOSTD_late_companion.xml") }) delay(100) }

            dropFile("BIOSTD_late_companion.pdf", mockDummyPdf(patient, device))
            withTimeout(20_000) { while (events.none { it.startsWith("Attached BIOSTD_late_companion.pdf") }) delay(100) }
        } finally {
            watcher.stop()
        }

        assertFalse(File(importDir, "_unmatched/BIOSTD_late_companion.pdf").exists())
    }

    @Test
    fun `a companion PDF arriving long after still attaches, matched by serial and day rather than a time window`() = runBlocking {
        val device = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-011")
        dropFile("BIOSTD_data.xml", mockBiotronikXml(patient, device))
        runBatch(minEvents = 1)

        val before = events.size
        dropFile("a_completely_different_name.pdf", mockDummyPdf(patient, device))
        runBatch(minEvents = before + 1)

        assertTrue(events.drop(before).any { it.startsWith("Attached a_completely_different_name.pdf") }, "events: $events")
        assertFalse(File(importDir, "_unmatched/a_completely_different_name.pdf").exists())
    }

    @Test
    fun `a PDF that arrives before its data file is attached automatically once the data file is imported`() = runBlocking {
        val device = MockDevice(model = "Amvia Sky DR-T", serial = "BIO-SER-050")
        dropFile("early_report.pdf", mockDummyPdf(patient, device))
        runBatch(minEvents = 1)
        assertEquals(1, repository.getPendingSortTasks().size, "nothing to match the PDF with yet, so it waits for a person")

        val before = events.size
        dropFile("BIOSTD_data_arrives_later.xml", mockBiotronikXml(patient, device))
        runBatch(minEvents = before + 2)

        assertTrue(events.drop(before).any { it.startsWith("Attached early_report.pdf") && it.contains("it had arrived first") }, "events: $events")
        assertEquals(0, repository.getPendingSortTasks().size, "the waiting PDF must leave the Inbox")
        assertEquals("attached", repository.getRecentIntakeFiles().first { it.fileName == "early_report.pdf" }.state)
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
