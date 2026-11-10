package io.github.alexanderlanganke.kardisynch.data

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Covers [DesktopDataRootWriter]'s issue #177 additions (deleteDirectory, moveDirectory) and [exportVisitFiles]. */
class DesktopDataRootWriterTest {
    private lateinit var root: File
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        root = Files.createTempDirectory("kardisynch-writer-test").toFile()
        writer = DesktopDataRootWriter()
    }

    @AfterTest
    fun tearDown() {
        root.deleteRecursively()
    }

    @Test
    fun `deleteDirectory removes a directory and its contents`() {
        val dir = File(root, "patient").apply { mkdirs() }
        File(dir, "patient.xml").writeText("<patient/>")

        assertTrue(writer.deleteDirectory(dir.absolutePath))
        assertFalse(dir.exists())
    }

    @Test
    fun `deleteDirectory returns false for a path that doesn't exist`() {
        assertFalse(writer.deleteDirectory(File(root, "nope").absolutePath))
    }

    @Test
    fun `moveDirectory relocates a directory with its contents intact`() {
        val source = File(root, "source_visit").apply { mkdirs() }
        File(source, "report.log").writeText("data")
        val newParent = File(root, "new_parent").apply { mkdirs() }

        val movedHandle = writer.moveDirectory(source.absolutePath, newParent.absolutePath)

        assertTrue(movedHandle != null)
        assertFalse(source.exists())
        val moved = File(movedHandle!!)
        assertTrue(moved.exists())
        assertEquals("data", File(moved, "report.log").readText())
    }

    @Test
    fun `moveDirectory can rename at the destination`() {
        val source = File(root, "old_name").apply { mkdirs() }
        val newParent = File(root, "parent").apply { mkdirs() }

        val movedHandle = writer.moveDirectory(source.absolutePath, newParent.absolutePath, newName = "new_name")

        assertEquals(File(newParent, "new_name").absolutePath, movedHandle)
    }

    @Test
    fun `exportVisitFiles copies every file in a visit directory to a destination`() {
        val visitDir = File(root, "visit").apply { mkdirs() }
        File(visitDir, "a.pdd").writeBytes(byteArrayOf(1, 2, 3))
        File(visitDir, "visit.xml").writeText("<visit/>")
        val destination = File(root, "export_target")

        val copied = exportVisitFiles(visitDir, destination)

        assertEquals(2, copied)
        assertTrue(destination.isDirectory)
        assertTrue(File(destination, "a.pdd").readBytes().contentEquals(byteArrayOf(1, 2, 3)))
        assertEquals("<visit/>", File(destination, "visit.xml").readText())
        // Source is untouched — this is a copy, not a move.
        assertTrue(File(visitDir, "a.pdd").exists())
    }
}
