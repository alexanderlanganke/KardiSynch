package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import java.io.File

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
        val databaseAlreadyExists = dbFile.exists()
        val driver = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        // The reactive Flow layer and the _IMPORT folder watcher can both touch
        // the DB from different threads around the same time; without this,
        // SQLite throws SQLITE_BUSY immediately instead of waiting the
        // (typically sub-millisecond) moment for the other statement to finish.
        driver.execute(null, "PRAGMA busy_timeout = 5000;", 0)
        // Unlike AndroidSqliteDriver, the plain JDBC driver has no built-in
        // schema versioning — without this, an existing database.db from
        // before a new table/column was added would just be missing it forever.
        if (!databaseAlreadyExists) {
            KardiSynchDatabase.Schema.create(driver)
            setSchemaVersion(driver, KardiSynchDatabase.Schema.version)
        } else {
            val currentVersion = schemaVersion(driver)
            if (currentVersion < KardiSynchDatabase.Schema.version) {
                KardiSynchDatabase.Schema.migrate(driver, currentVersion, KardiSynchDatabase.Schema.version)
                setSchemaVersion(driver, KardiSynchDatabase.Schema.version)
            }
        }
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
