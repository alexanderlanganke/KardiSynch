package io.github.alexanderlanganke.kardisynch.data

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase

actual class DatabaseDriverFactory(
    private val context: Context,
) {
    // No PRAGMA busy_timeout here (unlike the desktop actual): Android's
    // SQLiteDatabase throws for any execSQL-style call to a statement that
    // returns a row, which PRAGMA busy_timeout does. Android's own SQLite
    // wrapper already manages connection contention itself.
    actual fun createDriver(): SqlDriver = AndroidSqliteDriver(KardiSynchDatabase.Schema, context, "database.db")
}
