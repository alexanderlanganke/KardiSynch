package io.github.alexanderlanganke.kardisynch.core.usb

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Tracks which files already made it from a USB target directory into the
 * import folder, keyed by path relative to the target root — a Kotlin port
 * of Electron's `usbTargetManifest.ts`. Persistence (reading/writing the
 * JSON file, e.g. under `~/.kardisynch`) is a desktop-only concern and
 * lives in `apps:desktopApp`; this file only holds the pure, testable
 * pieces: the entry shape, the "already processed" check, pruning, and
 * JSON codec.
 */
@Serializable
data class UsbManifestEntry(val mtimeMs: Long, val size: Long)

const val USB_MANIFEST_MAX_ENTRIES = 5000

fun isUsbFileProcessed(manifest: Map<String, UsbManifestEntry>, relativePath: String, mtimeMs: Long, size: Long): Boolean {
    val entry = manifest[relativePath] ?: return false
    return entry.size == size && entry.mtimeMs == mtimeMs
}

/** Removes the oldest (by mtimeMs) entries once [manifest] exceeds [maxEntries]. */
fun pruneUsbManifest(manifest: Map<String, UsbManifestEntry>, maxEntries: Int = USB_MANIFEST_MAX_ENTRIES): Map<String, UsbManifestEntry> {
    if (manifest.size <= maxEntries) return manifest
    val toRemove = manifest.size - maxEntries
    val oldestFirst = manifest.entries.sortedBy { it.value.mtimeMs }
    val removedKeys = oldestFirst.take(toRemove).map { it.key }.toSet()
    return manifest.filterKeys { it !in removedKeys }
}

private val manifestSerializer = MapSerializer(String.serializer(), UsbManifestEntry.serializer())
private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }

fun encodeUsbManifest(manifest: Map<String, UsbManifestEntry>): String = json.encodeToString(manifestSerializer, manifest)

fun decodeUsbManifest(rawText: String): Map<String, UsbManifestEntry> =
    try {
        json.decodeFromString(manifestSerializer, rawText)
    } catch (e: Exception) {
        emptyMap()
    }
