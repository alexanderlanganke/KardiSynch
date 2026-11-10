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

/**
 * Regression: a real `_DATA` can contain the same visit (same report id in
 * visit.xml) in two folders, e.g. a copied/restored visit directory. The
 * reindex used to abort with "UNIQUE constraint failed: Devices.id" because
 * Reports is INSERT OR REPLACE but Devices/Leads were plain INSERTs.
 */
class KardiSynchRepositoryDuplicateReportIdReindexTest {
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-dupid-test").toFile()
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

    @Test
    fun `reindex survives the same report id appearing in two visit folders`() = runBlocking {
        val report = UnifiedReport(
            manufacturer = "Medtronic",
            interrogationDate = "2024-05-01",
            patient = PatientInfo(firstName = "Max", lastName = "Testpatient", dob = "1970-01-01"),
            device = DeviceInfo(type = "ICD", model = "Model1", serialNumber = "S1"),
            leads = listOf(LeadData(name = "RV", anatomicLocation = "RV", impedance = Measurement(500.0, "Ω"))),
        )
        val first = repository.importReport(reader, writer, reportsRoot, report).getOrThrow()
        File(first.visitDirHandle).copyRecursively(File(File(first.visitDirHandle).parentFile, "copy_of_visit"))

        repository.clearLocalIndex()
        repository.reindexFrom(reader, reportsRoot)

        val reports = repository.observeReportsForPatient(first.patientId).first()
        assertEquals(1, reports.size)
        assertEquals(1, repository.getDevicesForReport(first.reportId).size)
        assertEquals(1, repository.getLeadsForReport(first.reportId).size)
    }
}
