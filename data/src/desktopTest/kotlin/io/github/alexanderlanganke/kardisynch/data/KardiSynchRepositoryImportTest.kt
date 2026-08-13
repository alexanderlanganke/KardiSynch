package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
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
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Exercises [KardiSynchRepository.importReport] end to end against a real
 * temp `_DATA` directory and an in-memory SQLite index — the desktop write
 * path task #25 built on top of the already-tested [io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport]
 * and [io.github.alexanderlanganke.kardisynch.core.matching.mergeReports].
 */
class KardiSynchRepositoryImportTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-import-test").toFile()
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

    private fun sampleReport(
        lastName: String = "Doe",
        firstName: String = "Jane",
        dob: String = "1950-01-01",
        interrogationDate: String = "2026-07-21T09:30:00",
        serial: String = "ABC123",
        leads: List<LeadData> = emptyList(),
    ) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = interrogationDate,
        patient = PatientInfo(firstName = firstName, lastName = lastName, dob = dob),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = serial),
        leads = leads,
    )

    @Test
    fun `creates a new patient and visit for a first import`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, sampleReport()).getOrThrow()

        assertFalse(outcome.reusedExistingVisit)
        assertTrue(File(outcome.visitDirHandle, "visit.xml").exists())
        assertTrue(File(outcome.patientDirHandle, "patient.xml").exists())
        assertNotNull(repository.getPatientById(outcome.patientId))
        Unit
    }

    @Test
    fun `merges a second same-day file into the existing visit instead of duplicating it`() = runBlocking {
        val first = sampleReport(leads = listOf(LeadData(name = "RV", serial = "L1", anatomicLocation = "RV")))
        val firstOutcome = repository.importReport(reader, writer, reportsRoot, first).getOrThrow()

        val second = sampleReport(
            interrogationDate = "2026-07-21T09:34:00",
            leads = listOf(LeadData(name = "LV", serial = "L2", anatomicLocation = "LV")),
        )
        val secondOutcome = repository.importReport(reader, writer, reportsRoot, second).getOrThrow()

        assertTrue(secondOutcome.reusedExistingVisit)
        assertEquals(firstOutcome.reportId, secondOutcome.reportId)
        assertEquals(firstOutcome.visitDirHandle, secondOutcome.visitDirHandle)
        assertEquals(2, repository.getLeadsForReport(secondOutcome.reportId).size)
    }

    @Test
    fun `does not merge two same-day interrogations hours apart`() = runBlocking {
        val firstOutcome = repository.importReport(
            reader, writer, reportsRoot, sampleReport(interrogationDate = "2026-07-21T09:30:00"),
        ).getOrThrow()
        val secondOutcome = repository.importReport(
            reader, writer, reportsRoot, sampleReport(interrogationDate = "2026-07-21T14:05:00"),
        ).getOrThrow()

        assertFalse(secondOutcome.reusedExistingVisit)
        assertNotEquals(firstOutcome.reportId, secondOutcome.reportId)
    }

    @Test
    fun `a conflicting device serial on the same day gets its own visit`() = runBlocking {
        repository.importReport(reader, writer, reportsRoot, sampleReport(serial = "ABC123")).getOrThrow()
        val secondOutcome = repository.importReport(reader, writer, reportsRoot, sampleReport(serial = "XYZ999")).getOrThrow()

        assertFalse(secondOutcome.reusedExistingVisit)
    }

    @Test
    fun `explicit new visit still dedups a provably identical interrogation`() = runBlocking {
        val report = sampleReport()
        val firstOutcome = repository.importReport(reader, writer, reportsRoot, report).getOrThrow()
        val secondOutcome = repository.importReport(reader, writer, reportsRoot, report, explicitNewVisit = true).getOrThrow()

        assertTrue(secondOutcome.reusedExistingVisit)
        assertEquals(firstOutcome.reportId, secondOutcome.reportId)
    }

    @Test
    fun `a second patient on the same day does not collide with the first`() = runBlocking {
        val alice = repository.importReport(reader, writer, reportsRoot, sampleReport(lastName = "Alpha")).getOrThrow()
        val bob = repository.importReport(reader, writer, reportsRoot, sampleReport(lastName = "Beta")).getOrThrow()

        assertNotEquals(alice.patientId, bob.patientId)
        assertNotEquals(alice.patientDirHandle, bob.patientDirHandle)
    }

    @Test
    fun `rejects a report without patient last name or DOB`() = runBlocking {
        val report = sampleReport(lastName = "", dob = "")
        val result = repository.importReport(reader, writer, reportsRoot, report)
        assertTrue(result.isFailure)
    }
}
