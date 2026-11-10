package io.github.alexanderlanganke.kardisynch.core.usb

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UsbFileFilterTest {
    @Test
    fun `recognizes every extension the parsers can consume`() {
        for (ext in listOf("pdf", "xml", "bnk", "pdd", "pkg", "log", "PDF", "Xml")) {
            assertTrue(isSupportedUsbFile("report.$ext"), ext)
        }
    }

    @Test
    fun `rejects unsupported extensions and extensionless files`() {
        assertFalse(isSupportedUsbFile("report.part"))
        assertFalse(isSupportedUsbFile("report.txt"))
        assertFalse(isSupportedUsbFile("README"))
    }
}

class UsbManifestTest {
    @Test
    fun `a file never seen before is not processed`() {
        assertFalse(isUsbFileProcessed(emptyMap(), "a/b.xml", mtimeMs = 100, size = 10))
    }

    @Test
    fun `a file with matching size and mtime is already processed`() {
        val manifest = mapOf("a/b.xml" to UsbManifestEntry(mtimeMs = 100, size = 10))
        assertTrue(isUsbFileProcessed(manifest, "a/b.xml", mtimeMs = 100, size = 10))
    }

    @Test
    fun `a file that changed size or mtime since last processed is reprocessed`() {
        val manifest = mapOf("a/b.xml" to UsbManifestEntry(mtimeMs = 100, size = 10))
        assertFalse(isUsbFileProcessed(manifest, "a/b.xml", mtimeMs = 100, size = 11))
        assertFalse(isUsbFileProcessed(manifest, "a/b.xml", mtimeMs = 200, size = 10))
    }

    @Test
    fun `pruning below the limit leaves the manifest untouched`() {
        val manifest = mapOf("a" to UsbManifestEntry(1, 1), "b" to UsbManifestEntry(2, 2))
        assertEquals(manifest, pruneUsbManifest(manifest, maxEntries = 5))
    }

    @Test
    fun `pruning over the limit removes the oldest entries by mtime`() {
        val manifest = mapOf(
            "oldest" to UsbManifestEntry(mtimeMs = 1, size = 1),
            "middle" to UsbManifestEntry(mtimeMs = 2, size = 1),
            "newest" to UsbManifestEntry(mtimeMs = 3, size = 1),
        )
        val pruned = pruneUsbManifest(manifest, maxEntries = 2)
        assertEquals(setOf("middle", "newest"), pruned.keys)
    }

    @Test
    fun `manifest round-trips through JSON`() {
        val manifest = mapOf(
            "a/report.xml" to UsbManifestEntry(mtimeMs = 1234567890, size = 4096),
            "b/report.pdf" to UsbManifestEntry(mtimeMs = 999, size = 1),
        )
        val decoded = decodeUsbManifest(encodeUsbManifest(manifest))
        assertEquals(manifest, decoded)
    }

    @Test
    fun `decoding garbage returns an empty manifest instead of throwing`() {
        assertEquals(emptyMap(), decodeUsbManifest("not json"))
    }
}
