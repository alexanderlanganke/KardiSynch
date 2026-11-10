package io.github.alexanderlanganke.kardisynch.apps.desktop

import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ElectronMigrationTest {
    private fun electronDir(vararg rows: Pair<String, String>): File {
        val dir = Files.createTempDirectory("electron-userdata").toFile()
        DriverManager.getConnection("jdbc:sqlite:${File(dir, "database.db").absolutePath}").use { c ->
            c.createStatement().use { it.execute("CREATE TABLE Settings (key TEXT PRIMARY KEY, value TEXT)") }
            c.prepareStatement("INSERT INTO Settings VALUES (?, ?)").use { ps -> rows.forEach { (k, v) -> ps.setString(1, k); ps.setString(2, v); ps.executeUpdate() } }
        }
        return dir
    }

    @Test fun `reads the data path, import folder, usb folders and theme from the Electron database`() {
        val dir = electronDir(
            "dataPath" to "D:\\Clinic\\_DATA", "importDir" to "D:\\Clinic\\_IMPORT",
            "usbSourceDirectories" to """["E:\\Programmer","F:\\Reports"]""",
            "usbTargetDirectory" to "D:\\Clinic\\usb", "theme" to "dark", "onboardingCompleted" to "true",
        )
        val s = assertNotNull(readElectronSettings(dir))
        assertEquals("D:\\Clinic\\_DATA", s.dataPath)
        assertEquals("D:\\Clinic\\_IMPORT", s.importDir)
        assertEquals(listOf("E:\\Programmer", "F:\\Reports"), s.usbSourceDirs)
        assertEquals("dark", s.theme)
        assertEquals(true, s.onboardingCompleted)
    }

    @Test fun `falls back to the default _DATA folder under the Electron user data when none was chosen`() {
        val dir = electronDir("theme" to "light")
        File(dir, "_DATA").mkdirs()
        assertEquals(File(dir, "_DATA").absolutePath, readElectronSettings(dir)?.dataPath)
    }

    @Test fun `no database means nothing to migrate`() {
        assertNull(readElectronSettings(Files.createTempDirectory("empty").toFile()))
    }

    @Test fun `knows where Electron kept its data on each OS`() {
        val win = electronUserDataCandidates(mapOf("APPDATA" to "AppRoaming"), "home", "Windows 11")
        assertEquals(File("AppRoaming", "kardisynch"), win.first())
        assertEquals("/home/a/.config/kardisynch", electronUserDataCandidates(emptyMap(), "/home/a", "Linux").first().path)
    }
}
