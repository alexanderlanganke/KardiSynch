package io.github.alexanderlanganke.kardisynch.apps.desktop

import java.io.File
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MoveFileReliablyTest {
    private val dir = Files.createTempDirectory("kardisynch-move-test").toFile()

    @AfterTest
    fun tearDown() {
        dir.deleteRecursively()
    }

    @Test
    fun `moves a file and keeps its content`() {
        val src = File(dir, "a.xml").apply { writeText("<x/>") }
        val dest = File(dir, "sub").apply { mkdirs() }.resolve("b.xml")
        moveFileReliably(src, dest)
        assertFalse(src.exists())
        assertEquals("<x/>", dest.readText())
    }

    @Test
    fun `a vanished source fails at once instead of retrying`() {
        val started = System.nanoTime()
        assertFailsWith<NoSuchFileException> { moveFileReliably(File(dir, "gone.xml"), File(dir, "b.xml"), attempts = 5, pauseMs = 1000) }
        assertTrue((System.nanoTime() - started) / 1_000_000 < 900, "no retry pause for a file that does not exist")
    }

    @Test
    fun `an existing destination is not overwritten and the source stays put`() {
        val src = File(dir, "a.xml").apply { writeText("new") }
        val dest = File(dir, "b.xml").apply { writeText("old") }
        assertFailsWith<Exception> { moveFileReliably(src, dest, attempts = 2, pauseMs = 1) }
        assertEquals("old", dest.readText())
        assertTrue(src.exists(), "nothing lost when the move cannot be completed")
    }
}
