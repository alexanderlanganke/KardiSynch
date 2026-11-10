package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.runBlocking
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class KardiSynchRepositoryIntakeLedgerTest {
    private lateinit var repository: KardiSynchRepository

    @BeforeTest
    fun setUp() {
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
    }

    private suspend fun record(sha: String, state: String, name: String = "a.pdd", bundle: String? = null) = repository.recordIntakeFile(
        sha256 = sha, fileName = name, originalPath = "/in/$name", storedPath = null, sourceLabel = "import", sizeBytes = 10,
        seenAt = "2026-11-04T09:00:00Z", state = state, fileKind = "MEDTRONIC_PDD", manufacturer = "Medtronic",
        confidence = 90, evidence = "+ signature", bundleId = bundle,
    )

    @Test
    fun `a committed file is found again by its content hash, a pending one is not`() = runBlocking {
        record("aaa", "pending")
        assertNull(repository.findHandledIntakeFileBySha("aaa"), "pending is not handled yet")
        record("bbb", "committed")
        assertNotNull(repository.findHandledIntakeFileBySha("bbb"))
        assertNull(repository.findHandledIntakeFileBySha("zzz"))
    }

    @Test
    fun `unrecognised files stay visible and are counted per state`() = runBlocking {
        record("1", "unrecognised", "mystery.xml")
        record("2", "unrecognised", "other.bin")
        record("3", "committed")
        assertEquals(2, repository.getIntakeFilesByState("unrecognised").size)
        assertEquals(mapOf("unrecognised" to 2L, "committed" to 1L), repository.countIntakeFilesByState())
    }

    @Test
    fun `updating a ledger row records the outcome`() = runBlocking {
        val id = record("1", "pending")
        repository.updateIntakeFileState(id, "committed", "assigned manually", storedPath = "/data/x", patientId = "p1", reportId = "r1")
        val row = repository.getIntakeFile(id)!!
        assertEquals("committed", row.state)
        assertEquals("p1", row.patientId)
        assertEquals("/data/x", row.storedPath)
    }

    @Test
    fun `sort tasks of one interrogation are retrievable as a bundle`() = runBlocking {
        fun task(name: String, bundle: String) = runBlocking {
            repository.createPendingSortTask(
                createdAt = "2026-11-04T09:00:00Z", sessionId = null, stagedFilePath = "/p/$name", originalFileName = name,
                suggestedPatientId = null, suggestedPatientName = null, note = "n", manufacturer = null, deviceModel = null,
                deviceSerial = "S1", interrogationDate = null, bundleId = bundle, fileKind = "DEVICE_PDF", confidence = 80, evidence = "+ x",
            )
        }
        task("a.pdd", "B1"); task("a.pdf", "B1"); task("c.pdd", "B2")
        assertEquals(listOf("a.pdd", "a.pdf"), repository.getPendingSortTasksForBundle("B1").map { it.originalFileName }.sorted())
        assertEquals(1, repository.getPendingSortTasksForBundle("B2").size)
    }
}
