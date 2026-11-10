package io.github.alexanderlanganke.kardisynch.apps.desktop

import java.io.File
import java.sql.DriverManager

/** What the Electron app (v2.x) had configured, read from its own settings database. */
data class ElectronSettings(
    val userDataDir: File,
    val dataPath: String?,
    val importDir: String?,
    val usbSourceDirs: List<String>,
    val usbTargetDir: String?,
    val theme: String?,
    val onboardingCompleted: Boolean,
)

/** Where Electron kept its per-user data, by OS. The app name in `package.json` is `kardisynch`; capitalised spellings are tried too. */
fun electronUserDataCandidates(env: Map<String, String> = System.getenv(), home: String = System.getProperty("user.home"), os: String = System.getProperty("os.name").orEmpty()): List<File> {
    val bases = when {
        os.startsWith("Windows") -> listOfNotNull(env["APPDATA"]?.let(::File), File(home, "AppData/Roaming"))
        os.startsWith("Mac") -> listOf(File(home, "Library/Application Support"))
        else -> listOf(env["XDG_CONFIG_HOME"]?.takeIf { it.isNotBlank() }?.let(::File) ?: File(home, ".config"))
    }
    return bases.flatMap { b -> listOf("kardisynch", "KardiSynch").map { File(b, it) } }.distinct()
}

/** Reads Electron's `Settings` table from a COPY of its `database.db` (the Electron app may still be running). Null when there is nothing usable. */
fun readElectronSettings(userDataDir: File): ElectronSettings? {
    val db = File(userDataDir, "database.db")
    if (!db.isFile) return null
    val copy = File.createTempFile("kardisynch-electron-", ".db")
    return try {
        db.copyTo(copy, overwrite = true)
        // A WAL-mode database keeps recent writes in a side file; copy it alongside so they aren't lost.
        File(userDataDir, "database.db-wal").takeIf { it.isFile }?.copyTo(File(copy.path + "-wal"), overwrite = true)
        val rows = mutableMapOf<String, String>()
        DriverManager.getConnection("jdbc:sqlite:${copy.absolutePath}").use { c ->
            c.createStatement().use { st -> st.executeQuery("SELECT key, value FROM Settings").use { rs -> while (rs.next()) rows[rs.getString(1)] = rs.getString(2) ?: "" } }
        }
        interpretElectronSettings(userDataDir, rows)
    } catch (_: Exception) {
        null
    } finally {
        copy.delete(); File(copy.path + "-wal").delete(); File(copy.path + "-shm").delete()
    }
}

private fun unquote(v: String): String = v.trim().let { if (it.length >= 2 && it.first() == '"' && it.last() == '"') it.substring(1, it.length - 1) else it }

/** Pure: turns Electron's raw key/value rows into [ElectronSettings]. The default data folder is `<userData>/_DATA` when none was chosen. */
fun interpretElectronSettings(userDataDir: File, rows: Map<String, String>): ElectronSettings? {
    val dataPath = rows["dataPath"]?.let(::unquote)?.takeIf { it.isNotBlank() }
        ?: File(userDataDir, "_DATA").takeIf { it.isDirectory }?.absolutePath
    if (dataPath == null && rows.isEmpty()) return null
    val usb = rows["usbSourceDirectories"]?.let { raw ->
        Regex(""""((?:[^"\\]|\\.)*)"""").findAll(raw).map { it.groupValues[1].replace("\\\\", "\\").replace("\\\"", "\"") }.filter { it.isNotBlank() }.toList()
    }.orEmpty()
    return ElectronSettings(
        userDataDir = userDataDir,
        dataPath = dataPath,
        importDir = rows["importDir"]?.let(::unquote)?.takeIf { it.isNotBlank() },
        usbSourceDirs = usb,
        usbTargetDir = rows["usbTargetDirectory"]?.let(::unquote)?.takeIf { it.isNotBlank() },
        theme = rows["theme"]?.let(::unquote)?.lowercase()?.takeIf { it in setOf("light", "dark", "system") },
        onboardingCompleted = rows["onboardingCompleted"]?.let(::unquote)?.lowercase() == "true",
    )
}

/** The first Electron user-data folder that has readable settings. */
fun findElectronSettings(candidates: List<File> = electronUserDataCandidates()): ElectronSettings? =
    candidates.firstNotNullOfOrNull { readElectronSettings(it) }
