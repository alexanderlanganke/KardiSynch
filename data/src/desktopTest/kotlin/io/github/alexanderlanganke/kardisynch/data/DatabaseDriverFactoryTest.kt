package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Covers issue #196's real bug find: SQLDelight's own [io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase.Schema.version]
 * never changes without `.sqm` migration files (which this project doesn't
 * use), so an existing `database.db` predating a `.sq` schema change used
 * to be missing the new table/column forever — reproduced here by manually
 * building a stale (Patients-table-only) database, matching a real
 * "no such table: PendingSortTasks" crash caught by manually launching
 * the app after this session's schema changes.
 *
 * [DatabaseDriverFactory] hardcodes `~/.kardisynch` rather than accepting a
 * directory — this test points `user.home` at a temp directory for its
 * duration (restored in [tearDown]) rather than widening that class's API
 * just for testability.
 */
class DatabaseDriverFactoryTest {
    private lateinit var tempHome: File
    private lateinit var originalUserHome: String

    @BeforeTest
    fun setUp() {
        tempHome = Files.createTempDirectory("kardisynch-driverfactory-test").toFile()
        originalUserHome = System.getProperty("user.home")
        System.setProperty("user.home", tempHome.absolutePath)
    }

    @AfterTest
    fun tearDown() {
        System.setProperty("user.home", originalUserHome)
        tempHome.deleteRecursively()
    }

    private fun dbFile() = File(File(tempHome, ".kardisynch"), "database.db")

    @Test
    fun `a brand-new database gets the full current schema`() {
        val driver = DatabaseDriverFactory().createDriver()
        try {
            // Would throw SQLiteException if the table doesn't exist.
            driver.executeQuery(null, "SELECT COUNT(*) FROM PendingSortTasks;", { app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
        } finally {
            driver.close()
        }
    }

    @Test
    fun `a stale pre-existing database missing a newer table is rebuilt, not left broken`() {
        // Simulate a database.db from before PendingSortTasks existed: only
        // the Patients table, with the OLD code's user_version (it always
        // set user_version to SQLDelight's own Schema.version, which is
        // permanently 1 without .sqm files).
        val dbFile = dbFile()
        dbFile.parentFile.mkdirs()
        val staleDriver = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        staleDriver.execute(null, "CREATE TABLE Patients (id TEXT PRIMARY KEY);", 0)
        staleDriver.execute(null, "PRAGMA user_version = 1;", 0)
        staleDriver.close()
        assertTrue(dbFile.exists())

        val driver = DatabaseDriverFactory().createDriver()
        try {
            // The real bug: this used to throw "no such table: PendingSortTasks".
            driver.executeQuery(null, "SELECT COUNT(*) FROM PendingSortTasks;", { app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
        } finally {
            driver.close()
        }
    }

    @Test
    fun `an incompatible old database is set aside as a backup, never deleted`() {
        val dbFile = dbFile()
        dbFile.parentFile.mkdirs()
        val old = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        old.execute(null, "CREATE TABLE Settings (key TEXT NOT NULL PRIMARY KEY, value TEXT);", 0)
        old.execute(null, "INSERT INTO Settings(key, value) VALUES ('dataRootPath', '/precious');", 0)
        old.execute(null, "PRAGMA user_version = 2;", 0)
        old.close()

        DatabaseDriverFactory().createDriver().close()

        val backups = dbFile.parentFile.listFiles { f -> f.name.startsWith("database.db.old-v2-") }.orEmpty()
        assertTrue(backups.size == 1, "the old database must be kept as a backup: ${dbFile.parentFile.list()?.toList()}")
        val kept = JdbcSqliteDriver("jdbc:sqlite:${backups.single().absolutePath}")
        var value: String? = null
        kept.executeQuery(null, "SELECT value FROM Settings WHERE key = 'dataRootPath';", { c -> c.next(); value = c.getString(0); app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
        kept.close()
        assertTrue(value == "/precious", "the backup must still hold the old settings")
    }

    @Test
    fun `every thread's connection waits for a lock instead of failing with SQLITE_BUSY`() {
        // Regression: busy_timeout used to be set by a PRAGMA on one connection only, so work done on any other
        // thread failed instantly with "database is locked" while the importer wrote.
        val driver = DatabaseDriverFactory().createDriver() // creates the database file
        val failures = java.util.concurrent.CopyOnWriteArrayList<Throwable>()
        val writer = Thread {
            try {
                // A plain JDBC connection that takes the write lock and holds it for a while.
                java.sql.DriverManager.getConnection("jdbc:sqlite:${dbFile().absolutePath}").use { conn ->
                    conn.autoCommit = false
                    conn.createStatement().use { it.execute("INSERT OR REPLACE INTO Settings(key, value) VALUES ('held', '1')") }
                    Thread.sleep(4_500) // longer than sqlite-jdbc's built-in 3 s default wait
                    conn.commit()
                }
            } catch (t: Throwable) {
                failures += t
            }
        }
        writer.start()
        Thread.sleep(300) // the writer now holds the write lock

        // A different thread, hence a different connection, writes at the same time: it must wait, not fail.
        val other = DatabaseDriverFactory().createDriver()
        var waited = 0L
        val contender = Thread {
            try {
                val t0 = System.nanoTime()
                other.execute(null, "INSERT OR REPLACE INTO Settings(key, value) VALUES ('contender', '1');", 0)
                waited = (System.nanoTime() - t0) / 1_000_000
            } catch (t: Throwable) {
                failures += t
            }
        }
        contender.start()
        contender.join(30_000)
        writer.join(30_000)
        other.close()
        driver.close()
        assertTrue(failures.isEmpty(), "no thread may fail with a lock error: $failures")
        assertTrue(waited >= 3_500, "the contender should have waited for the lock (waited ${waited} ms)")
    }

    @Test
    fun `an already-current database is left in place across a second createDriver call`() {
        DatabaseDriverFactory().createDriver().close()
        val firstRunSize = dbFile().length()

        // A second launch against the same, already-up-to-date database
        // must not delete/recreate it.
        val driver = DatabaseDriverFactory().createDriver()
        try {
            driver.executeQuery(null, "SELECT COUNT(*) FROM PendingSortTasks;", { app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
        } finally {
            driver.close()
        }
        assertTrue(dbFile().length() >= firstRunSize, "not shrunk back down to a freshly recreated empty file")
    }

    @Test
    fun `a v4 database is migrated in place and keeps its queued sort tasks`() {
        val dbFile = dbFile()
        dbFile.parentFile.mkdirs()
        val old = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        old.execute(
            null,
            """CREATE TABLE PendingSortTasks (id TEXT NOT NULL PRIMARY KEY, createdAt TEXT NOT NULL, sessionId TEXT, stagedFilePath TEXT NOT NULL,
               originalFileName TEXT NOT NULL, suggestedPatientId TEXT, suggestedPatientName TEXT, note TEXT NOT NULL, manufacturer TEXT,
               deviceModel TEXT, deviceSerial TEXT, interrogationDate TEXT)""",
            0,
        )
        old.execute(null, "INSERT INTO PendingSortTasks(id, createdAt, stagedFilePath, originalFileName, note) VALUES ('t1', '2026-11-04', '/x/a.pdd', 'a.pdd', 'needs review')", 0)
        old.execute(null, "PRAGMA user_version = 4;", 0)
        old.close()

        val driver = DatabaseDriverFactory().createDriver()
        try {
            var count = 0L
            driver.executeQuery(
                null, "SELECT COUNT(*) FROM PendingSortTasks WHERE id = 't1';",
                { c -> c.next(); count = c.getLong(0) ?: 0L; app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0,
            )
            assertTrue(count == 1L, "the queued task must survive the upgrade")
            driver.executeQuery(null, "SELECT bundleId, evidence FROM PendingSortTasks;", { app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
            driver.executeQuery(null, "SELECT COUNT(*) FROM IntakeFiles;", { app.cash.sqldelight.db.QueryResult.Value(Unit) }, 0)
        } finally {
            driver.close()
        }
    }
}
