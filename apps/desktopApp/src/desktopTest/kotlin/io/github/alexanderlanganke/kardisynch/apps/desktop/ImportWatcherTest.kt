package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
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
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assume.assumeTrue
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * End-to-end smoke test for [ImportWatcher] against a REAL sample file (not
 * a synthetic fixture) — the full loop this task (#25) was built for: a file
 * lands in `_IMPORT`, gets parsed, stored under `_DATA/Reports`, and shows up
 * in the local index, exactly like Electron's `watcher.ts` + `storeFile`.
 */
class ImportWatcherTest {
    private lateinit var importDir: File
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var scope: CoroutineScope

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-import-watch-test").toFile()
        dataRoot = Files.createTempDirectory("kardisynch-data-watch-test").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        importDir.deleteRecursively()
        dataRoot.deleteRecursively()
    }

    /**
     * Not present in a fresh clone or CI (gitignored real manufacturer
     * samples, only in the original checkout — issue #181) — returns null
     * rather than throwing so the caller can skip instead of hard-failing.
     */
    private fun locateRepoTestDir(): File? {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            val candidate = File(dir, "test")
            if (candidate.isDirectory && File(candidate, "medtronic pdd files").isDirectory) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        return null
    }

    @Test
    fun `imports a real Medtronic pdd file dropped in _IMPORT and updates the local index`() = runBlocking {
        val repoTestDir = locateRepoTestDir()
        assumeTrue(
            "Skipping: the real test/ fixture directory isn't available in this checkout.",
            repoTestDir != null,
        )
        val pddDir = File(repoTestDir, "medtronic pdd files")
        val sample = pddDir.listFiles { f -> f.extension.equals("pdd", ignoreCase = true) }!!.first()
        sample.copyTo(File(importDir, sample.name))

        val events = mutableListOf<String>()
        val watcher = ImportWatcher(
            importDir, reportsRoot, repository, DesktopDataRootReader(), DesktopDataRootWriter(), scope, NoOpDirectoryLock,
        ) { events.add(it) }
        watcher.start()

        val imported = withTimeoutOrNull(20_000) {
            while (events.none { it.startsWith("Imported") || it.startsWith("Import failed") || it.startsWith("Skipped") }) {
                delay(200)
            }
            true
        }
        watcher.stop()

        assertTrue(imported == true, "Watcher never processed the dropped file within the timeout. Events: $events")
        assertTrue(events.any { it.startsWith("Imported") }, "Expected a successful import, got: $events")
        assertFalse(File(importDir, sample.name).exists(), "Source file should have been moved out of _IMPORT")

        val sawPatient = withTimeoutOrNull(5000) {
            repository.observePatients().first { it.isNotEmpty() }
        } != null
        assertTrue(sawPatient, "Expected the imported patient to appear in the local index")
    }
}
