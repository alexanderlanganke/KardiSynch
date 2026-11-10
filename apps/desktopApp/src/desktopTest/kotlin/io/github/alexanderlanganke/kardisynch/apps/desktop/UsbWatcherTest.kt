package io.github.alexanderlanganke.kardisynch.apps.desktop

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers issue #189: the USB watcher's Source -> Target and Target -> Import legs. */
class UsbWatcherTest {
    private lateinit var root: File
    private lateinit var sourceDir: File
    private lateinit var targetDir: File
    private lateinit var importDir: File
    private lateinit var manifestFile: File
    private lateinit var scope: CoroutineScope
    private val events = mutableListOf<String>()

    @BeforeTest
    fun setUp() {
        root = Files.createTempDirectory("kardisynch-usb-watch-test").toFile()
        sourceDir = File(root, "source").apply { mkdirs() }
        targetDir = File(root, "target").apply { mkdirs() }
        importDir = File(root, "import").apply { mkdirs() }
        manifestFile = File(root, "usb_target_manifest.json")
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        events.clear()
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        root.deleteRecursively()
    }

    private fun watcher(
        sourceDirs: List<File> = listOf(sourceDir),
        target: File? = targetDir,
    ) = UsbWatcher(
        sourceDirs = sourceDirs,
        targetDir = target,
        importDir = importDir,
        manifestFile = manifestFile,
        scope = scope,
        stabilityChecks = 2,
        stabilityIntervalMs = 5,
    ) { events.add(it) }

    @Test
    fun `a supported source file is copied to target and removed from source`() = runBlocking {
        File(sourceDir, "report.xml").writeText("device data")
        watcher().poll()

        val copied = File(targetDir, "report.xml")
        assertTrue(copied.exists())
        assertEquals("device data", copied.readText())
        assertFalse(File(sourceDir, "report.xml").exists(), "removed from source after a verified copy")
        assertFalse(File(targetDir, "report.xml.part").exists(), "no leftover .part staging file")
    }

    @Test
    fun `an unsupported extension is left alone in source`() = runBlocking {
        File(sourceDir, "notes.txt").writeText("irrelevant")
        watcher().poll()

        assertTrue(File(sourceDir, "notes.txt").exists())
        assertFalse(File(targetDir, "notes.txt").exists())
    }

    @Test
    fun `a zero-byte file is never copied`() = runBlocking {
        File(sourceDir, "empty.xml").writeText("")
        watcher().poll()

        assertTrue(File(sourceDir, "empty.xml").exists(), "left in place, not silently lost")
        assertFalse(File(targetDir, "empty.xml").exists())
    }

    @Test
    fun `nested source directory structure is preserved in target, and emptied parents are removed`() = runBlocking {
        val nested = File(sourceDir, "sub/dir").apply { mkdirs() }
        File(nested, "report.pdd").writeText("nested report")
        watcher().poll()

        assertTrue(File(targetDir, "sub/dir/report.pdd").exists())
        assertFalse(File(sourceDir, "sub/dir").exists(), "emptied leaf directory removed")
        assertFalse(File(sourceDir, "sub").exists(), "emptied parent directory removed too")
        assertTrue(sourceDir.exists(), "the source root itself is never removed")
    }

    @Test
    fun `Source-to-Target is skipped entirely when no target directory is configured`() = runBlocking {
        File(sourceDir, "report.xml").writeText("device data")
        watcher(target = null).poll()

        assertTrue(File(sourceDir, "report.xml").exists(), "left alone: nowhere configured to move it to")
    }

    @Test
    fun `a target file is copied into import and tracked so it is not recopied`() = runBlocking {
        File(targetDir, "report.xml").writeText("device data")
        watcher().poll()

        val imported = File(importDir, "report.xml")
        assertTrue(imported.exists())
        assertEquals("device data", imported.readText())
        assertTrue(manifestFile.exists(), "manifest persisted after a successful copy")

        // Modify the import copy to prove a second poll does NOT re-copy the
        // (unchanged) target file over it.
        imported.writeText("modified locally")
        watcher().poll()
        assertEquals("modified locally", imported.readText(), "target file already in the manifest, skipped")
    }

    @Test
    fun `a target file that changes since it was last processed is recopied`() = runBlocking {
        val targetFile = File(targetDir, "report.xml")
        targetFile.writeText("v1")
        watcher().poll()
        assertEquals("v1", File(importDir, "report.xml").readText())

        Thread.sleep(10)
        targetFile.writeText("v2 longer content")
        watcher().poll()
        assertEquals("v2 longer content", File(importDir, "report.xml").readText())
    }

    @Test
    fun `nothing happens when neither source nor target is configured`() = runBlocking {
        watcher(sourceDirs = emptyList(), target = null).poll()
        assertTrue(events.isEmpty())
    }
}
