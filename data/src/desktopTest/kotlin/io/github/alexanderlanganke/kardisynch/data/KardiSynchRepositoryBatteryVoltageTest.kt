package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
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
import kotlin.test.assertNull

/** Covers issue #198: battery voltage is promoted from visit.xml into the queryable Reports index, for the detail screen's trend chart. */
class KardiSynchRepositoryBatteryVoltageTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-battery-test").toFile()
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

    private fun report(voltage: Measurement?) = UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = "2026-07-21",
        patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
        battery = BatteryData(voltage = voltage),
    )

    @Test
    fun `importReport persists battery voltage onto the report row`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report(Measurement(2.85, "V"))).getOrThrow()

        val row = repository.observeReportsForPatient(outcome.patientId).first().single()
        assertEquals(2.85, row.batteryVoltageValue)
        assertEquals("V", row.batteryVoltageUnit)
    }

    @Test
    fun `a report with no battery data leaves the voltage columns null`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report(null)).getOrThrow()

        val row = repository.observeReportsForPatient(outcome.patientId).first().single()
        assertNull(row.batteryVoltageValue)
        assertNull(row.batteryVoltageUnit)
    }

    @Test
    fun `reindexFrom also populates battery voltage from visit xml`() = runBlocking {
        val outcome = repository.importReport(reader, writer, reportsRoot, report(Measurement(3.1, "V"))).getOrThrow()

        repository.clearLocalIndex()
        repository.reindexFrom(reader, reportsRoot)

        val row = repository.observeReportsForPatient(outcome.patientId).first().single()
        assertEquals(3.1, row.batteryVoltageValue)
    }
}
