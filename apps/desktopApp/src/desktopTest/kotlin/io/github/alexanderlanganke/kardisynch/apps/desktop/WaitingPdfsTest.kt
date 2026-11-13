package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** [attachWaitingPdfs] on its own: the sweep that also runs after a person assigns a queued data file. */
class WaitingPdfsTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private val reader = DesktopDataRootReader()
    private val writer = DesktopDataRootWriter()

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-waiting-pdfs").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
    }

    @AfterTest
    fun tearDown() {
        dataRoot.deleteRecursively()
    }

    private suspend fun queuePdf(name: String, serial: String?, day: String?, last: String? = null, first: String? = null, dob: String? = null): File {
        val staged = File(dataRoot, name).apply { writeText("%PDF-1.4 fake") }
        repository.createPendingSortTask(
            createdAt = "2026-01-01T00:00:00Z", sessionId = "s", stagedFilePath = staged.absolutePath, originalFileName = name,
            suggestedPatientId = null, suggestedPatientName = null, note = "n", manufacturer = "Medtronic", deviceModel = null,
            deviceSerial = serial, interrogationDate = day, bundleId = "b-$name", fileKind = "DEVICE_PDF", confidence = 80, evidence = "e",
            patientLastName = last, patientFirstName = first, patientDob = dob,
        )
        return staged
    }

    private suspend fun importVisit(): Pair<String, String> {
        val imported = repository.importReport(
            reader, writer, reportsRoot,
            UnifiedReport(
                manufacturer = "Medtronic", interrogationDate = "2026-06-01",
                patient = PatientInfo("Erika", "Mustermann", "1950-09-15"),
                device = DeviceInfo("ICD", "Model1", "PZK123456P"),
            ),
        ).getOrThrow()
        return imported.patientId to imported.reportId
    }

    @Test
    fun `a waiting PDF with the same serial and day is attached, others stay queued`() = runBlocking {
        importVisit()
        queuePdf("match.pdf", "PZK123456P", "2026-06-01")
        queuePdf("otherday.pdf", "PZK123456P", "2026-06-02")
        queuePdf("scan.pdf", null, null)

        assertEquals(1, attachWaitingPdfs(repository, reader, reportsRoot, null))
        assertEquals(setOf("otherday.pdf", "scan.pdf"), repository.getPendingSortTasks().map { it.originalFileName }.toSet())
    }

    @Test
    fun `a serial-less PDF needs the exact full identity and a single visit that day`() = runBlocking {
        importVisit()
        queuePdf("initial.pdf", null, "2026-06-01", "Mustermann", "E.", "1950-09-15")
        queuePdf("otherdob.pdf", null, "2026-06-01", "Mustermann", "Erika", "1950-09-16")
        queuePdf("full.pdf", null, "2026-06-01", "mustermann", "erika", "1950-09-15")

        assertEquals(1, attachWaitingPdfs(repository, reader, reportsRoot, null))
        assertEquals(setOf("initial.pdf", "otherdob.pdf"), repository.getPendingSortTasks().map { it.originalFileName }.toSet())
    }
}
