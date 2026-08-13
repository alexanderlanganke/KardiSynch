package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.db.SqlDriver

/**
 * Creates the platform's SQLDelight driver, always pointed at LOCAL,
 * per-device storage — never at the shared `_DATA` root, on any platform.
 * Mirrors Electron's `ensureDatabaseLocation()` (src/main/databaseMigration.ts),
 * which pins the SQLite file to its local `userData` dir specifically so it's
 * never shared over the SMB mount `_DATA` can live on. Every client rebuilds/
 * refreshes this local index from `_DATA`'s XML via `DataRootIndexer`.
 */
expect class DatabaseDriverFactory {
    fun createDriver(): SqlDriver
}
