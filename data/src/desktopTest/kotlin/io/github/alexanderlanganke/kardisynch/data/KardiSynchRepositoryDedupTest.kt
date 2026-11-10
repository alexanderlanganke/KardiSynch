package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.datastore.generateVisitXml
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Covers the UI-parity plan's Phase 6. Real duplicate report *rows* for the
 * same patient+date+serial don't arise through the normal [KardiSynchRepository.importReport]
 * path — its same-day-visit matching already merges those at import time
 * (see [io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport]).
 * The scenario [dedupReports] actually cleans up is two on-disk visit
 * directories that already exist independently (a filesystem-level race
 * between multiple clients writing the same shared `_DATA` root, or a crash
 * mid-write) and get picked up as separate rows by [KardiSynchRepository.reindexFrom],
 * which indexes directories directly rather than going through the
 * merge-aware import path — these tests fabricate that scenario directly.
 */
@OptIn(ExperimentalUuidApi::class)
class KardiSynchRepositoryDedupTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-dedup-test").toFile()
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

    // hasLead is the differentiator: leads round-trip through generateVisitXml/
    // parseVisitXml (unlike rawText or hospitalVisitId, neither of which is
    // wired into visit.xml serialization in this port at all — using either
    // as the test's richness signal would silently vanish on reindex and
    // make both fabricated visits score identically). The lead needs a real
    // measurement, not just a name/location — core.model.hasLeadData filters
    // out leads with no model/serial/measurement at all before they're ever
    // written to the Leads table.
    private fun report(hasLead: Boolean) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2024-05-01",
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
        leads = if (hasLead) listOf(LeadData(name = "RV", anatomicLocation = "RV", impedance = Measurement(500.0, "Ω"))) else emptyList(),
    )

    /** Fabricates a second, sparser (no leads) independent visit directory for the same patient+date+serial, mimicking a multi-client write race, and reindexes so both are separate DB rows. */
    private fun createSecondVisitDirectory(patientDirHandle: String, extraDataFileContent: ByteArray? = null): String {
        val secondReportId = Uuid.random().toString()
        val visitDirHandle = writer.createDirectory(patientDirHandle, "2024_05_01_$secondReportId")!!
        writer.writeTextFile(visitDirHandle, "visit.xml", generateVisitXml(secondReportId, report(hasLead = false)))
        if (extraDataFileContent != null) {
            writer.writeBytes(visitDirHandle, "report.pdf", extraDataFileContent)
        }
        return visitDirHandle
    }

    @Test
    fun `dedupReports merges a duplicate visit directory pair, keeping the richer report`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report(hasLead = true)).getOrThrow()
        val patientDirHandle = repository.findPatientDirectoryHandle(reader, reportsRoot, first.patientId)!!
        createSecondVisitDirectory(patientDirHandle)

        repository.clearLocalIndex()
        repository.reindexFrom(reader, reportsRoot)
        assertEquals(2, repository.observeReportsForPatient(first.patientId).first().size)

        val result = repository.dedupReports(reader, writer, reportsRoot)
        assertEquals(1, result.groupsFound)
        assertEquals(1, result.reportsRemoved)
        assertTrue(result.errors.isEmpty())

        val remaining = repository.observeReportsForPatient(first.patientId).first()
        assertEquals(1, remaining.size)
        assertEquals(first.reportId, remaining.single().id)
        assertTrue(File(first.visitDirHandle).exists())
    }

    @Test
    fun `dedupReports merges a unique file from the duplicate into the keeper before removing it`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report(hasLead = true)).getOrThrow()
        val patientDirHandle = repository.findPatientDirectoryHandle(reader, reportsRoot, first.patientId)!!
        val uniqueBytes = "unique pdf content".encodeToByteArray()
        createSecondVisitDirectory(patientDirHandle, extraDataFileContent = uniqueBytes)

        repository.clearLocalIndex()
        repository.reindexFrom(reader, reportsRoot)

        val result = repository.dedupReports(reader, writer, reportsRoot)
        assertEquals(1, result.reportsRemoved)

        val mergedFile = File(first.visitDirHandle, "report.pdf")
        assertTrue(mergedFile.exists())
        assertEquals("unique pdf content", mergedFile.readText())
    }

    @Test
    fun `dedupReports leaves same-day visits with different device serials alone`() = runBlocking {
        val first = repository.importReport(reader, writer, reportsRoot, report(hasLead = true)).getOrThrow()
        val other = report(hasLead = false).copy(device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S2"))
        repository.importReport(reader, writer, reportsRoot, other, explicitNewVisit = true).getOrThrow()

        val result = repository.dedupReports(reader, writer, reportsRoot)
        assertEquals(0, result.groupsFound)
        assertEquals(0, result.reportsRemoved)
        assertEquals(2, repository.observeReportsForPatient(first.patientId).first().size)
    }

    @Test
    fun `dedupReports on a store with no duplicates is a no-op`() = runBlocking {
        repository.importReport(reader, writer, reportsRoot, report(hasLead = true)).getOrThrow()

        val result = repository.dedupReports(reader, writer, reportsRoot)
        assertEquals(0, result.groupsFound)
        assertEquals(0, result.reportsRemoved)
        assertFalse(result.errors.isNotEmpty())
    }
}
