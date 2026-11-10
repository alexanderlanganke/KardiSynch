package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import java.io.File
import java.util.Properties

/**
 * Hand-maintained, bumped every time a `.sq` file's schema changes (a new
 * `CREATE TABLE`, a new column, etc.) — NOT the same thing as SQLDelight's
 * own [KardiSynchDatabase.Schema.version], which tracks numbered `.sqm`
 * migration files this project has never adopted and so is permanently
 * `1` no matter how the `.sq` files change. [KardiSynchDatabase.Schema.migrate]
 * driven by that always-`1` version was consequently a no-op the one time
 * it mattered: an existing local `database.db` from before the
 * `PendingSortTasks` table was added (issue #172) crashed on launch with
 * "no such table: PendingSortTasks" instead of picking it up. Bump this
 * constant (to a value distinct from every previous one) whenever a `.sq`
 * file's schema changes.
 */
private const val LOCAL_SCHEMA_VERSION = 5L // v5: IntakeFiles ledger + bundle/identification columns on PendingSortTasks
// v4: Reports.batteryStatus/afBurdenValue/afBurdenUnit/vtEpisodes (issue #198)

/**
 * `~/.kardisynch/database.db` — a simple, cross-OS-enough local app-data
 * location for now. (Electron's equivalent, `app.getPath('userData')`,
 * resolves to a proper per-OS app-data directory; revisit if this needs to
 * match that exactly, e.g. for a future migration path from the Electron
 * app's existing local database.)
 */
actual class DatabaseDriverFactory {
    actual fun createDriver(): SqlDriver {
        val appDataDir = appStateDir()
        appDataDir.mkdirs()
        val dbFile = File(appDataDir, "database.db")

        if (dbFile.exists()) {
            val probe = openDriver(dbFile)
            var found = schemaVersion(probe)
            // v4 -> v5 is migrated in place: the manual-sort queue lives only in
            // this database, so dropping the file would silently lose the files
            // a clinician still has to assign.
            if (found == 4L) {
                migrateV4ToV5(probe)
                setSchemaVersion(probe, LOCAL_SCHEMA_VERSION)
                found = LOCAL_SCHEMA_VERSION
            }
            val upToDate = found == LOCAL_SCHEMA_VERSION
            probe.close()
            if (!upToDate) {
                // database.db is a rebuildable local index/cache over _DATA (the actual source of
                // truth — see this class's doc comment), so on schema drift the simple fix is to start
                // a fresh one; the next _DATA root pick (or Settings > Reindex) rebuilds it. But it also
                // holds settings and the manual-sort queue, so the old file is set aside as a backup,
                // never deleted.
                val backup = File(appDataDir, "database.db.old-v$found-${System.currentTimeMillis()}")
                if (!dbFile.renameTo(backup)) dbFile.delete()
            }
        }

        val driver = openDriver(dbFile)
        if (schemaVersion(driver) != LOCAL_SCHEMA_VERSION) {
            KardiSynchDatabase.Schema.create(driver)
            setSchemaVersion(driver, LOCAL_SCHEMA_VERSION)
        }
        return driver
    }

    private fun openDriver(dbFile: File): SqlDriver {
        // JdbcSqliteDriver opens one connection PER THREAD, and a PRAGMA only configures the connection it
        // runs on, so busy_timeout set that way left every other thread (the UI's database reads, the
        // importer) at sqlite-jdbc's short default: any overlap with a longer write failed with SQLITE_BUSY
        // ("database is locked"). A connection property applies to every connection the driver opens.
        //
        // Deliberately NOT journal_mode=WAL: this driver opens and closes a connection for every statement
        // outside an explicit transaction, and in WAL mode each of those opens/closes (the last close does a
        // checkpoint) is expensive and contended; with the importer running, imports crawled and the UI's
        // queries queued behind them, which looked like a frozen window.
        val properties = Properties().apply { setProperty("busy_timeout", "10000") }
        return JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}", properties)
    }

    private fun migrateV4ToV5(driver: SqlDriver) {
        val statements = listOf(
            "ALTER TABLE PendingSortTasks ADD COLUMN bundleId TEXT",
            "ALTER TABLE PendingSortTasks ADD COLUMN fileKind TEXT",
            "ALTER TABLE PendingSortTasks ADD COLUMN confidence INTEGER",
            "ALTER TABLE PendingSortTasks ADD COLUMN evidence TEXT",
            "ALTER TABLE PendingSortTasks ADD COLUMN patientLastName TEXT",
            "ALTER TABLE PendingSortTasks ADD COLUMN patientFirstName TEXT",
            "ALTER TABLE PendingSortTasks ADD COLUMN patientDob TEXT",
            """CREATE TABLE IF NOT EXISTS IntakeFiles (
                id TEXT NOT NULL PRIMARY KEY, sha256 TEXT NOT NULL, fileName TEXT NOT NULL, originalPath TEXT NOT NULL,
                storedPath TEXT, sourceLabel TEXT, sizeBytes INTEGER NOT NULL, seenAt TEXT NOT NULL, state TEXT NOT NULL,
                fileKind TEXT, manufacturer TEXT, confidence INTEGER, evidence TEXT, bundleId TEXT, patientId TEXT, reportId TEXT, message TEXT)""",
            "CREATE INDEX IF NOT EXISTS idx_intake_files_sha ON IntakeFiles(sha256)",
            "CREATE INDEX IF NOT EXISTS idx_intake_files_state ON IntakeFiles(state)",
        )
        statements.forEach { driver.execute(null, it, 0) }
    }

    private fun schemaVersion(driver: SqlDriver): Long =
        driver
            .executeQuery(
                null,
                "PRAGMA user_version;",
                { cursor -> QueryResult.Value(if (cursor.next().value) cursor.getLong(0) ?: 0L else 0L) },
                0,
            ).value

    private fun setSchemaVersion(driver: SqlDriver, version: Long) {
        driver.execute(null, "PRAGMA user_version = $version;", 0)
    }
}
