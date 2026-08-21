package io.github.alexanderlanganke.kardisynch.data

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase

private const val DB_NAME = "database.db"

/** Kept in sync with the desktop actual's own `LOCAL_SCHEMA_VERSION` — see its doc comment for why this hand-maintained constant exists at all instead of [KardiSynchDatabase.Schema.version]. */
private const val LOCAL_SCHEMA_VERSION = 4
private const val PREFS_NAME = "kardisynch_db"
private const val PREFS_KEY_SCHEMA_VERSION = "schemaVersion"

actual class DatabaseDriverFactory(
    private val context: Context,
) {
    // No PRAGMA busy_timeout here (unlike the desktop actual): Android's
    // SQLiteDatabase throws for any execSQL-style call to a statement that
    // returns a row, which PRAGMA busy_timeout does. Android's own SQLite
    // wrapper already manages connection contention itself.
    actual fun createDriver(): SqlDriver {
        // AndroidSqliteDriver's own version tracking is driven by
        // KardiSynchDatabase.Schema.version, which is permanently 1 without
        // .sqm migration files (this project doesn't use them) — it never
        // detects a plain .sq schema change (a new column/table) either,
        // same underlying gap the desktop actual's LOCAL_SCHEMA_VERSION
        // exists to close. Tracked here via SharedPreferences rather than
        // SQLite's own `PRAGMA user_version` (AndroidSqliteDriver's
        // SupportSQLiteOpenHelper unconditionally overwrites that with
        // Schema.version on create, so it can't double as a hand-maintained
        // counter the way the desktop actual uses it).
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getInt(PREFS_KEY_SCHEMA_VERSION, 0) != LOCAL_SCHEMA_VERSION) {
            // database.db is a rebuildable local index/cache over _DATA
            // (the actual source of truth), never authoritative data itself
            // — see DataRootIndexer's doc comment — so on any schema drift
            // the safe, simple fix is to drop and recreate it fresh.
            context.deleteDatabase(DB_NAME)
            prefs.edit().putInt(PREFS_KEY_SCHEMA_VERSION, LOCAL_SCHEMA_VERSION).apply()
        }
        return AndroidSqliteDriver(KardiSynchDatabase.Schema, context, DB_NAME)
    }
}
