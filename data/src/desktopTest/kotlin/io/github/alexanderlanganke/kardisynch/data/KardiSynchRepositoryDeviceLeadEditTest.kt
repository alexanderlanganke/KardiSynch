package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
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
import kotlin.test.assertTrue

/** Covers the UI-parity plan's Phase 8: manually correcting a visit's device identity/lead roster, directly replacing rather than merging (unlike reparseVisit). */
class KardiSynchRepositoryDeviceLeadEditTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-device-lead-edit-test").toFile()
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
        leads = listOf(LeadData(name = "RV", anatomicLocation = "RV", impedance = Measurement(500.0, "Ω"))),
    )

    @Test
    fun `updateReportDeviceAndLeads replaces device identity and re-indexes it`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()

        val correctedDevice = DeviceInfo(type = "Pacemaker", model = "CorrectedModel", serialNumber = "S1-corrected")
        repository.updateReportDeviceAndLeads(
            reader, writer, reportsRoot, outcome.patientId, outcome.reportId,
            manufacturer = "Biotronik", device = correctedDevice, leads = emptyList(),
        ).getOrThrow()

        val devices = repository.getDevicesForReport(outcome.reportId)
        assertEquals(1, devices.size)
        assertEquals("Pacemaker", devices.single().type)
        assertEquals("CorrectedModel", devices.single().model)
        assertEquals("S1-corrected", devices.single().serialNumber)

        val updatedReport = repository.observeReportsForPatient(outcome.patientId).first().single()
        assertEquals("Biotronik", updatedReport.manufacturer)
    }

    @Test
    fun `updateReportDeviceAndLeads replaces the lead roster, not merges it`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        assertEquals(1, repository.getLeadsForReport(outcome.reportId).size)

        val newLeads = listOf(
            LeadData(name = "RA", anatomicLocation = "RA", impedance = Measurement(600.0, "Ω")),
            LeadData(name = "LV", anatomicLocation = "LV", impedance = Measurement(700.0, "Ω")),
        )
        repository.updateReportDeviceAndLeads(
            reader, writer, reportsRoot, outcome.patientId, outcome.reportId,
            manufacturer = "Medtronic", device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"), leads = newLeads,
        ).getOrThrow()

        val leads = repository.getLeadsForReport(outcome.reportId)
        assertEquals(2, leads.size)
        assertEquals(setOf("RA", "LV"), leads.map { it.anatomicLocation }.toSet())
    }

    @Test
    fun `updateReportDeviceAndLeads preserves a lead's measurement values when only identity is edited`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        val originalLead = repository.getLeadsForReport(outcome.reportId).single()

        val renamedLead = LeadData(name = "RV-renamed", anatomicLocation = "RV", impedance = originalLead.impedanceValue?.let { Measurement(it, originalLead.impedanceUnit.orEmpty()) })
        repository.updateReportDeviceAndLeads(
            reader, writer, reportsRoot, outcome.patientId, outcome.reportId,
            manufacturer = "Medtronic", device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"), leads = listOf(renamedLead),
        ).getOrThrow()

        val updatedLead = repository.getLeadsForReport(outcome.reportId).single()
        assertEquals("RV-renamed", updatedLead.name)
        assertEquals(500.0, updatedLead.impedanceValue)
    }

    @Test
    fun `updateReportDeviceAndLeads fails for an unknown report id`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report()).getOrThrow()
        val result = repository.updateReportDeviceAndLeads(
            reader, writer, reportsRoot, outcome.patientId, "does-not-exist",
            manufacturer = "Medtronic", device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"), leads = emptyList(),
        )
        assertTrue(result.isFailure)
    }
}
