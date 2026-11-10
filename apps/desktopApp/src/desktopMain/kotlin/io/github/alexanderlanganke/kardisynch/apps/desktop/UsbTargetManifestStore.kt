package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.usb.UsbManifestEntry
import io.github.alexanderlanganke.kardisynch.core.usb.decodeUsbManifest
import io.github.alexanderlanganke.kardisynch.core.usb.encodeUsbManifest
import io.github.alexanderlanganke.kardisynch.core.usb.isUsbFileProcessed
import io.github.alexanderlanganke.kardisynch.core.usb.pruneUsbManifest
import java.io.File

/**
 * Desktop persistence for core's USB manifest — a Kotlin port of Electron's
 * `usbTargetManifest.ts` (which kept the manifest under Electron's
 * `userData` dir; here it's a file under `~/.kardisynch`, passed in by the
 * caller). Saves synchronously on every [markProcessed] rather than
 * batching via `setImmediate` like the original: this already runs off the
 * UI thread on [UsbWatcher]'s own coroutine, so there's no frame-blocking
 * concern the batching was solving for.
 */
class UsbTargetManifestStore(private val manifestFile: File) {
    private var manifest: Map<String, UsbManifestEntry> = emptyMap()

    fun load() {
        manifest = if (manifestFile.exists()) decodeUsbManifest(manifestFile.readText()) else emptyMap()
    }

    fun isProcessed(relativePath: String, mtimeMs: Long, size: Long): Boolean =
        isUsbFileProcessed(manifest, relativePath, mtimeMs, size)

    fun markProcessed(relativePath: String, mtimeMs: Long, size: Long) {
        manifest = pruneUsbManifest(manifest + (relativePath to UsbManifestEntry(mtimeMs, size)))
        save()
    }

    private fun save() {
        manifestFile.parentFile?.mkdirs()
        manifestFile.writeText(encodeUsbManifest(manifest))
    }
}
