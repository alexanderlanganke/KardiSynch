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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Covers the UI-parity plan's Phase 9: rescanning a visit's raw files is a preview — it must not write anything, only report what a fresh parse would produce, for the merge-diff dialog to act on. */
class KardiSynchRepositoryRescanTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-rescan-test").toFile()
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

    private fun report() = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-01-01",
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
    )

    @Test
    fun `rescanVisit with only a visit xml and no parseable raw files returns null`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()

        val result = repository.rescanVisit(reader, reportsRoot, outcome.patientId, outcome.reportId).getOrThrow()
        assertNull(result)
    }

    @Test
    fun `rescanVisit does not modify the stored report even when it finds data`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        // Drop a raw Biotronik-style XML file (recognized by dispatchParse) with different device info into the visit dir.
        File(outcome.visitDirHandle, "BIOSTD_test.xml").writeText(
            """<?xml version="1.0"?><Patient><LastName>Testpatient</LastName><FirstName>Max</FirstName><BirthDate>1970-01-01</BirthDate></Patient>""",
        )

        repository.rescanVisit(reader, reportsRoot, outcome.patientId, outcome.reportId).getOrThrow()

        // Whatever the parse produced (or didn't), the original stored report must be untouched — rescanVisit is a preview only.
        val storedReport = repository.observeReportsForPatient(outcome.patientId).first().single()
        assertEquals("Medtronic", storedReport.manufacturer)
        assertEquals("Model1", storedReport.deviceModel)
    }

    @Test
    fun `rescanVisit fails for an unknown report id`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        val result = repository.rescanVisit(reader, reportsRoot, outcome.patientId, "does-not-exist")
        assertTrue(result.isFailure)
    }
}
