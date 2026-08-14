package io.github.alexanderlanganke.kardisynch.apps.desktop

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Covers issue #200's watcher-layer half: [reprocessUnmatchedFiles]. */
class ReprocessUnmatchedFilesTest {
    private lateinit var importDir: File
    private lateinit var unmatchedDir: File

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-reprocess-test").toFile()
        unmatchedDir = File(importDir, "_unmatched").apply { mkdirs() }
    }

    @AfterTest
    fun tearDown() {
        importDir.deleteRecursively()
    }

    @Test
    fun `moves every file from _unmatched back into _IMPORT`() {
        File(unmatchedDir, "a.log").writeText("a")
        File(unmatchedDir, "b.xml").writeText("b")

        val moved = reprocessUnmatchedFiles(importDir)

        assertEquals(2, moved)
        assertTrue(File(importDir, "a.log").exists())
        assertTrue(File(importDir, "b.xml").exists())
        assertEquals(0, unmatchedDir.listFiles { f -> f.isFile }?.size ?: 0)
    }

    @Test
    fun `returns 0 when _unmatched is empty`() {
        assertEquals(0, reprocessUnmatchedFiles(importDir))
    }

    @Test
    fun `gives a colliding filename a numbered suffix instead of clobbering`() {
        File(importDir, "a.log").writeText("already here")
        File(unmatchedDir, "a.log").writeText("retry me")

        val moved = reprocessUnmatchedFiles(importDir)

        assertEquals(1, moved)
        assertEquals("already here", File(importDir, "a.log").readText())
        assertEquals("retry me", File(importDir, "a_2.log").readText())
    }
}
