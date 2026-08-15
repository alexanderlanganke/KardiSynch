package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import java.io.File

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
private const val LOCAL_SCHEMA_VERSION = 3L // v3: Reports.batteryVoltageValue/batteryVoltageUnit (issue #198)

/**
 * `~/.kardisynch/database.db` — a simple, cross-OS-enough local app-data
 * location for now. (Electron's equivalent, `app.getPath('userData')`,
 * resolves to a proper per-OS app-data directory; revisit if this needs to
 * match that exactly, e.g. for a future migration path from the Electron
 * app's existing local database.)
 */
actual class DatabaseDriverFactory {
    actual fun createDriver(): SqlDriver {
        val appDataDir = File(System.getProperty("user.home"), ".kardisynch")
        appDataDir.mkdirs()
        val dbFile = File(appDataDir, "database.db")

        if (dbFile.exists()) {
            val probe = openDriver(dbFile)
            val upToDate = schemaVersion(probe) == LOCAL_SCHEMA_VERSION
            probe.close()
            if (!upToDate) {
                // database.db is a rebuildable local index/cache over _DATA
                // (the actual source of truth — see this class's doc
                // comment), never authoritative data itself, so on any
                // schema drift the safe, simple fix is to drop and recreate
                // it fresh rather than hand-write a real migration for
                // every column/table this early in the port. The next
                // _DATA root pick (or Settings > Reindex) rebuilds it.
                dbFile.delete()
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
        val driver = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        // The reactive Flow layer and the _IMPORT folder watcher can both touch
        // the DB from different threads around the same time; without this,
        // SQLite throws SQLITE_BUSY immediately instead of waiting the
        // (typically sub-millisecond) moment for the other statement to finish.
        driver.execute(null, "PRAGMA busy_timeout = 5000;", 0)
        return driver
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
