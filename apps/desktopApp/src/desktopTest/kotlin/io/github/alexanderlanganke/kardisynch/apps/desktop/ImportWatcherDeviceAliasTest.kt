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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Covers issue #184's auto-resolve integration: [ImportWatcher] filling in an Unknown device type from the shared alias file. */
class ImportWatcherDeviceAliasTest {
    private lateinit var importDir: File
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter
    private lateinit var scope: CoroutineScope
    private val events = mutableListOf<String>()

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-alias-import").toFile()
        dataRoot = Files.createTempDirectory("kardisynch-alias-data").toFile()
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

    private suspend fun runBatch(minEvents: Int = 1, timeoutMs: Long = 20_000) {
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock, dataRootHandle = dataRoot.absolutePath) { events.add(it) }
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
    fun `a device model the parser can't classify is auto-resolved from a persisted alias`() = runBlocking {
        repository.upsertDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Biotronik", "Unrecognized-Model-9000", "ICM", "2024-01-01").getOrThrow()

        val xml = mockBiotronikXml(patient, MockDevice(model = "Unrecognized-Model-9000", serial = "BIO-1"), deviceModel = "Unrecognized-Model-9000", functionalDomain = "OTHER")
        File(importDir, "BIOSTD_unknown.xml").writeText(xml)

        runBatch(minEvents = 1)

        val patientId = repository.observePatients().first().single().id
        val reports = repository.observeReportsForPatient(patientId).first()
        assertEquals("ICM", reports.single().deviceType)
    }

    @Test
    fun `a device model with no alias is left as Unknown, not guessed`() = runBlocking {
        val xml = mockBiotronikXml(patient, MockDevice(model = "Unrecognized-Model-9000", serial = "BIO-1"), deviceModel = "Unrecognized-Model-9000", functionalDomain = "OTHER")
        File(importDir, "BIOSTD_unknown.xml").writeText(xml)

        runBatch(minEvents = 1)

        val patientId = repository.observePatients().first().single().id
        val reports = repository.observeReportsForPatient(patientId).first()
        assertEquals("Unknown", reports.single().deviceType)
    }
}
