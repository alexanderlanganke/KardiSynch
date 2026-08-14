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
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Covers issue #172/#173: the import-identity resolution ladder and the pending-sort queue. */
class KardiSynchRepositoryIdentityResolutionTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-identity-test").toFile()
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

    private fun report(
        lastName: String,
        firstName: String = "Max",
        dob: String = "1970-01-01",
        serial: String = "S1",
        manufacturer: String = "Medtronic",
        interrogationDate: String = "2026-07-21",
    ) = UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = interrogationDate,
        patient = PatientInfo(firstName = firstName, lastName = lastName, dob = dob),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = serial),
    )

    @Test
    fun `an exact last name and DOB match resolves to ExactMatch`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("Max", "Doe", "1970-01-01"), deviceSerial = "S1", manufacturer = "Medtronic")
        assertEquals(KardiSynchRepository.IdentityResolution.ExactMatch(existing.patientId), resolution)
    }

    @Test
    fun `no similar patient at all resolves to NoMatch`() = runBlocking {
        val resolution = repository.resolvePatientIdentity(PatientInfo("Max", "Doe", "1970-01-01"), deviceSerial = null, manufacturer = null)
        assertEquals(KardiSynchRepository.IdentityResolution.NoMatch, resolution)
    }

    @Test
    fun `a serial match sharing DOB is adopted silently`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe", serial = "S-KNOWN")).getOrThrow()
        // Same DOB, but the new programmer spelled the last name differently.
        val resolution = repository.resolvePatientIdentity(PatientInfo("Max", "Do", "1970-01-01"), deviceSerial = "S-KNOWN", manufacturer = "Medtronic")
        val adopted = assertIs<KardiSynchRepository.IdentityResolution.Adopted>(resolution)
        assertEquals(existing.patientId, adopted.patientId)
        assertEquals("Doe", adopted.lastName, "adopts the STORED identity, not the incoming spelling")
    }

    @Test
    fun `a serial match sharing last name but a different DOB is also adopted`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe", serial = "S-KNOWN")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("Max", "Doe", "1975-06-06"), deviceSerial = "S-KNOWN", manufacturer = "Medtronic")
        val adopted = assertIs<KardiSynchRepository.IdentityResolution.Adopted>(resolution)
        assertEquals(existing.patientId, adopted.patientId)
    }

    @Test
    fun `a serial match sharing neither DOB nor last name is a conflicting suggestion, not adopted`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe", serial = "S-KNOWN")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("Someone", "Else", "1990-01-01"), deviceSerial = "S-KNOWN", manufacturer = "Medtronic")
        val pending = assertIs<KardiSynchRepository.IdentityResolution.PendingReview>(resolution)
        assertEquals(existing.patientId, pending.suggestedPatientId)
    }

    @Test
    fun `a near match by DOB alone is suggested for review`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Smith")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("Max", "Different", "1970-01-01"), deviceSerial = null, manufacturer = null)
        val pending = assertIs<KardiSynchRepository.IdentityResolution.PendingReview>(resolution)
        assertEquals(existing.patientId, pending.suggestedPatientId)
    }

    @Test
    fun `missing patient identity entirely with a serial match is a suggestion, never auto-adopted`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe", serial = "S-EXPLANT")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("", "Unknown", ""), deviceSerial = "S-EXPLANT", manufacturer = "Medtronic")
        val pending = assertIs<KardiSynchRepository.IdentityResolution.PendingReview>(resolution)
        assertEquals(existing.patientId, pending.suggestedPatientId)
    }

    @Test
    fun `missing patient identity with no serial match at all still requires manual review`() = runBlocking {
        val resolution = repository.resolvePatientIdentity(PatientInfo("", "Unknown", ""), deviceSerial = null, manufacturer = null)
        val pending = assertIs<KardiSynchRepository.IdentityResolution.PendingReview>(resolution)
        assertNull(pending.suggestedPatientId)
    }

    @Test
    fun `a serial known to a different manufacturer is not matched`() = runBlocking {
        repository.importReport(reader, writer, reportsRoot, report("Doe", serial = "SAME-SERIAL", manufacturer = "Medtronic")).getOrThrow()
        val resolution = repository.resolvePatientIdentity(PatientInfo("Someone", "Else", "1990-01-01"), deviceSerial = "SAME-SERIAL", manufacturer = "Biotronik")
        assertEquals(KardiSynchRepository.IdentityResolution.NoMatch, resolution)
    }

    @Test
    fun `importReportForExistingPatient attaches a new visit to a specific patient`() = runBlocking {
        val existing = repository.importReport(reader, writer, reportsRoot, report("Doe")).getOrThrow()
        val result = repository.importReportForExistingPatient(
            reader, writer, reportsRoot, existing.patientId,
            report("IgnoredIncomingName", dob = "1999-09-09", interrogationDate = "2026-08-01"),
        ).getOrThrow()
        assertEquals(existing.patientId, result.patientId)
        assertTrue(result.reportId != existing.reportId, "a distinct new visit, not merged into the existing one")
    }

    @Test
    fun `pending sort tasks round-trip through create, list, get, and delete`() = runBlocking {
        val id = repository.createPendingSortTask(
            createdAt = "2026-07-21T10:00:00Z", sessionId = "session-1",
            stagedFilePath = "/tmp/staged/file.xml", originalFileName = "file.xml",
            suggestedPatientId = "p1", suggestedPatientName = "Doe, Max", note = "Similar patient on file.",
            manufacturer = "Medtronic", deviceModel = "Model1", deviceSerial = "S1", interrogationDate = "2026-07-21",
        )
        assertEquals(1, repository.getPendingSortTasks().size)
        assertEquals("file.xml", repository.getPendingSortTask(id)?.originalFileName)

        repository.deletePendingSortTask(id)
        assertTrue(repository.getPendingSortTasks().isEmpty())
        assertNull(repository.getPendingSortTask(id))
    }
}
