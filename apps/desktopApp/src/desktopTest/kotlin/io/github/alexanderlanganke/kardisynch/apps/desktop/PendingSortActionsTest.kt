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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers issue #172/#173's resolve/dismiss actions on a queued pending-sort task. */
class PendingSortActionsTest {
    private lateinit var importDir: File
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-pending-import").toFile()
        dataRoot = Files.createTempDirectory("kardisynch-pending-data").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
    }

    @AfterTest
    fun tearDown() {
        importDir.deleteRecursively()
        dataRoot.deleteRecursively()
    }

    @Test
    fun `resolvePendingSortTask attaches the staged file to the target patient and clears the task`() = runBlocking {
        val existingPatient = repository.importReport(
            reader, writer, reportsRoot,
            io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport(
                manufacturer = "Medtronic",
                interrogationDate = "2026-06-01",
                patient = io.github.alexanderlanganke.kardisynch.core.model.PatientInfo("Max", "Testpatient", "1970-03-15"),
                device = io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo("ICD", "Model1", "EXISTING-SERIAL"),
            ),
        ).getOrThrow()

        val pendingDir = File(importDir, "_pending_sort").apply { mkdirs() }
        val staged = File(pendingDir, "task_BIOSTD_mock.xml")
        staged.writeText(mockBiotronikXml(MockPatient("Unrelated", "Name", "1980-01-01"), MockDevice(model = "Amvia Sky DR-T", serial = "S-NEW")))
        val taskId = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = null,
            stagedFilePath = staged.absolutePath, originalFileName = "BIOSTD_mock.xml",
            suggestedPatientId = existingPatient.patientId, suggestedPatientName = "Testpatient, Max",
            note = "Similar patient on file.", manufacturer = "Biotronik", deviceModel = "Amvia Sky DR-T",
            deviceSerial = "S-NEW", interrogationDate = "2026-07-21",
        )

        val result = resolvePendingSortTask(repository, reader, writer, reportsRoot, taskId, existingPatient.patientId, NoOpDirectoryLock)
        result.getOrThrow()

        assertTrue(repository.getPendingSortTasks().isEmpty(), "task removed after resolving")
        assertFalse(staged.exists(), "staged file moved out of _pending_sort")
        val reports = repository.observeReportsForPatient(existingPatient.patientId).first()
        assertEquals(2, reports.size, "the resolved report is attached to the target patient, not a new one")
        val attached = reports.first { it.id != existingPatient.reportId }
        val patientRow = repository.getPatientById(existingPatient.patientId)
        assertEquals("Testpatient", patientRow?.lastName, "target patient's own identity is untouched")
        assertEquals("Biotronik", attached.manufacturer)
    }

    @Test
    fun `resolvePendingSortTask fails when the staged file is missing`() = runBlocking {
        val taskId = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = null,
            stagedFilePath = File(importDir, "gone.xml").absolutePath, originalFileName = "gone.xml",
            suggestedPatientId = null, suggestedPatientName = null, note = "test",
            manufacturer = null, deviceModel = null, deviceSerial = null, interrogationDate = null,
        )
        val result = resolvePendingSortTask(repository, reader, writer, reportsRoot, taskId, "some-patient-id", NoOpDirectoryLock)
        assertTrue(result.isFailure)
        assertEquals(1, repository.getPendingSortTasks().size, "task left in place so it isn't silently lost")
    }

    @Test
    fun `dismissPendingSortTask moves the staged file to _unmatched and removes the task`() = runBlocking {
        val pendingDir = File(importDir, "_pending_sort").apply { mkdirs() }
        val staged = File(pendingDir, "task_orphan.log")
        staged.writeText("raw content")
        val taskId = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = null,
            stagedFilePath = staged.absolutePath, originalFileName = "orphan.log",
            suggestedPatientId = null, suggestedPatientName = null, note = "No identity at all.",
            manufacturer = null, deviceModel = null, deviceSerial = null, interrogationDate = null,
        )

        dismissPendingSortTask(repository, importDir, taskId).getOrThrow()

        assertTrue(repository.getPendingSortTasks().isEmpty())
        assertFalse(staged.exists())
        assertTrue(File(importDir, "_unmatched/orphan.log").exists())
    }

    @Test
    fun `dismissing an already-gone task is a harmless no-op`() = runBlocking {
        dismissPendingSortTask(repository, importDir, "nonexistent-task-id").getOrThrow()
    }

    @Test
    fun `resolvePendingSortTaskAsNewPatient creates a new patient from manually-entered demographics`() = runBlocking {
        val pendingDir = File(importDir, "_pending_sort").apply { mkdirs() }
        val staged = File(pendingDir, "task_BIOSTD_mock.xml")
        staged.writeText(mockBiotronikXml(MockPatient("Parsed", "Wrongname", "1980-01-01"), MockDevice(model = "Amvia Sky DR-T", serial = "S-NEW")))
        val taskId = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = null,
            stagedFilePath = staged.absolutePath, originalFileName = "BIOSTD_mock.xml",
            suggestedPatientId = null, suggestedPatientName = null, note = "No match found.",
            manufacturer = "Biotronik", deviceModel = "Amvia Sky DR-T", deviceSerial = "S-NEW", interrogationDate = "2026-07-21",
        )

        resolvePendingSortTaskAsNewPatient(
            repository, reader, writer, reportsRoot, taskId,
            firstName = "Correct", lastName = "Realname", dob = "1975-05-05", hospitalPatientId = "MRN-1",
            lock = NoOpDirectoryLock,
        ).getOrThrow()

        assertTrue(repository.getPendingSortTasks().isEmpty())
        assertFalse(staged.exists())
        val patients = repository.observePatients().first()
        assertEquals(1, patients.size)
        assertEquals("Realname", patients.single().lastName, "the manually-entered identity wins, not whatever the parser found")
        assertEquals("MRN-1", patients.single().hospitalPatientId)
    }

    @Test
    fun `resolvePendingSortTaskManually files a report using only the typed-in device identity, no parsing required`() = runBlocking {
        val existingPatient = repository.importReport(
            reader, writer, reportsRoot,
            io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport(
                manufacturer = "Medtronic",
                interrogationDate = "2026-06-01",
                patient = io.github.alexanderlanganke.kardisynch.core.model.PatientInfo("Max", "Testpatient", "1970-03-15"),
                device = io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo("ICD", "Model1", "EXISTING-SERIAL"),
            ),
        ).getOrThrow()

        val pendingDir = File(importDir, "_pending_sort").apply { mkdirs() }
        val staged = File(pendingDir, "task_unparseable.pkg")
        staged.writeBytes(byteArrayOf(0, 1, 2, 3)) // not parseable by any registered parser
        val taskId = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = null,
            stagedFilePath = staged.absolutePath, originalFileName = "unparseable.pkg",
            suggestedPatientId = null, suggestedPatientName = null, note = "Couldn't parse this file at all.",
            manufacturer = null, deviceModel = null, deviceSerial = null, interrogationDate = null,
        )

        resolvePendingSortTaskManually(
            repository, reader, writer, reportsRoot, taskId, existingPatient.patientId,
            manufacturer = "Abbott", deviceType = "ICD", deviceModel = "Manual Model", deviceSerial = "MANUAL-S1",
            interrogationDate = "2026-07-21", lock = NoOpDirectoryLock,
        ).getOrThrow()

        assertTrue(repository.getPendingSortTasks().isEmpty())
        assertFalse(staged.exists())
        val reports = repository.observeReportsForPatient(existingPatient.patientId).first()
        assertEquals(2, reports.size)
        val manual = reports.first { it.id != existingPatient.reportId }
        assertEquals("Abbott", manual.manufacturer)
        assertEquals("Manual Model", manual.deviceModel)
        assertEquals("MANUAL-S1", manual.deviceSerialNumber)
    }
}
