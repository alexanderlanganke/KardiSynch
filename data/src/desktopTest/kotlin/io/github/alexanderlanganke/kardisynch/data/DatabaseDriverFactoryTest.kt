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
}
