package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.usb.isSupportedUsbFile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Ports Electron's `usbWatcher.ts` (issue #189): polls a set of USB source
 * directories, copying newly-seen supported files into a configured target
 * directory (Source -> Target), then separately copies files sitting in
 * that target directory into `_IMPORT` for [ImportWatcher] to pick up
 * (Target -> Import) — tracking what's already been copied via
 * [UsbTargetManifestStore] so re-plugging the same drive doesn't re-copy
 * everything. Both legs stage through a `.part` name, verified by byte
 * size, before the final rename: an interrupted copy (drive unplugged
 * mid-write) must never leave a truncated file with an importable
 * extension.
 *
 * [sourceDirs]/[targetDir] are read once at construction — mirrors
 * Electron's "always restart the watcher on settings change" behavior
 * (`main.ts`): the desktop app tears down and recreates this class rather
 * than mutating it in place.
 *
 * Unlike Electron's `setInterval`-driven poll (which can re-enter while a
 * previous poll is still running, hence its `pollRunning` guard), this
 * watcher's poll loop is a single sequential coroutine — `delay` only runs
 * after the previous [poll] finishes, so overlap is structurally
 * impossible and no reentrancy guard is needed.
 */
class UsbWatcher(
    private val sourceDirs: List<File>,
    private val targetDir: File?,
    private val importDir: File,
    private val manifestFile: File,
    private val scope: CoroutineScope,
    private val pollIntervalMs: Long = 3000L,
    private val fsTimeoutMs: Long = 10_000L,
    private val copyTimeoutMs: Long = 120_000L,
    private val stabilityChecks: Int = 10,
    private val stabilityIntervalMs: Long = 500L,
    private val onEvent: (String) -> Unit,
) {
    private val manifestStore = UsbTargetManifestStore(manifestFile)
    private var watchJob: Job? = null
    private var manifestLoaded = false

    fun start() {
        if (sourceDirs.isEmpty() && targetDir == null) return
        watchJob = scope.launch(Dispatchers.IO) { pollLoop() }
    }

    fun stop() {
        watchJob?.cancel()
    }

    private suspend fun pollLoop() {
        while (currentCoroutineContext().isActive) {
            poll()
            delay(pollIntervalMs)
        }
    }

    /** Public so tests can drive individual polls deterministically instead of waiting on [pollIntervalMs]. */
    suspend fun poll() {
        if (!manifestLoaded) {
            manifestStore.load()
            manifestLoaded = true
        }
        if (sourceDirs.isNotEmpty() && targetDir != null) {
            for (sourceDir in sourceDirs) {
                if (!currentCoroutineContext().isActive) break
                if (!accessible(sourceDir)) continue
                processSourceDirectory(sourceDir, sourceDir, targetDir)
            }
        }
        if (targetDir != null && currentCoroutineContext().isActive && accessible(targetDir)) {
            processTargetDirectory(targetDir, targetDir)
        }
    }

    private suspend fun accessible(dir: File): Boolean =
        try {
            withTimeout(fsTimeoutMs) { withContext(Dispatchers.IO) { dir.exists() } }
        } catch (e: TimeoutCancellationException) {
            false
        }

    private suspend fun processSourceDirectory(dir: File, sourceBase: File, targetRoot: File) {
        val entries = listDirectory(dir) ?: return
        for (entry in entries) {
            if (!currentCoroutineContext().isActive) break
            if (entry.isDirectory) {
                processSourceDirectory(entry, sourceBase, targetRoot)
            } else if (entry.isFile && isSupportedUsbFile(entry.name)) {
                handleSourceFile(entry, sourceBase, targetRoot)
            }
        }
    }

    private suspend fun processTargetDirectory(dir: File, targetBase: File) {
        val entries = listDirectory(dir) ?: return
        for (entry in entries) {
            if (!currentCoroutineContext().isActive) break
            if (entry.isDirectory) {
                processTargetDirectory(entry, targetBase)
            } else if (entry.isFile && isSupportedUsbFile(entry.name)) {
                handleTargetFile(entry, targetBase)
            }
        }
    }

    private suspend fun listDirectory(dir: File): List<File>? =
        try {
            withTimeout(fsTimeoutMs) { withContext(Dispatchers.IO) { dir.listFiles()?.toList() } }
        } catch (e: Exception) {
            onEvent("[UsbWatcher] Cannot read ${dir.absolutePath}: ${e.message}")
            null
        }

    /** A file is "stable" once its size stops changing across polls; a zero-byte file is never considered stable. */
    private suspend fun isFileStable(file: File): Boolean {
        var lastSize = -1L
        repeat(stabilityChecks) {
            if (!currentCoroutineContext().isActive) return false
            if (!file.exists()) return false
            val size = file.length()
            if (size == 0L) return false
            if (size == lastSize) return true
            lastSize = size
            delay(stabilityIntervalMs)
        }
        return false
    }

    private suspend fun handleSourceFile(file: File, sourceBase: File, targetRoot: File) {
        if (targetDir == null) return
        if (!isFileStable(file)) return
        val relativePath = file.relativeTo(sourceBase).path
        val targetPath = File(targetRoot, relativePath)
        try {
            withContext(Dispatchers.IO) { targetPath.parentFile?.mkdirs() }
            if (!copyVerified(file, targetPath)) return
            withTimeout(fsTimeoutMs) { withContext(Dispatchers.IO) { file.delete() } }
            removeEmptyParents(file.parentFile, sourceBase)
            onEvent("Moved from USB to Target: ${file.name}")
        } catch (e: Exception) {
            onEvent("Error moving from USB: ${e.message}")
        }
    }

    private suspend fun handleTargetFile(file: File, targetBase: File) {
        val relativePath = file.relativeTo(targetBase).path
        try {
            val (size, mtime) = withTimeout(fsTimeoutMs) { withContext(Dispatchers.IO) { file.length() to file.lastModified() } }
            if (manifestStore.isProcessed(relativePath, mtime, size)) return
            if (!isFileStable(file)) return
            val (stableSize, stableMtime) = withTimeout(fsTimeoutMs) { withContext(Dispatchers.IO) { file.length() to file.lastModified() } }

            val importPath = File(importDir, relativePath)
            withContext(Dispatchers.IO) { importPath.parentFile?.mkdirs() }
            if (!copyVerified(file, importPath)) return

            manifestStore.markProcessed(relativePath, stableMtime, stableSize)
            onEvent("Copied to Import: ${file.name}")
        } catch (e: Exception) {
            onEvent("Error copying to Import: ${e.message}")
        }
    }

    /** Copies [source] to [destination] via a `.part` staging name, verified by byte size, before the final rename. Returns false (already logged) on a verification mismatch; throws on an I/O error. */
    private suspend fun copyVerified(source: File, destination: File): Boolean {
        val partial = File(destination.parentFile, destination.name + ".part")
        try {
            withTimeout(copyTimeoutMs) {
                withContext(Dispatchers.IO) { Files.copy(source.toPath(), partial.toPath(), StandardCopyOption.REPLACE_EXISTING) }
            }
        } catch (e: Exception) {
            partial.delete()
            throw e
        }
        if (partial.length() != source.length()) {
            onEvent("Failed to copy ${source.name}: verification failed")
            partial.delete()
            return false
        }
        withTimeout(fsTimeoutMs) {
            withContext(Dispatchers.IO) { Files.move(partial.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING) }
        }
        return true
    }

    /** Removes now-empty directories walking up from [dir], stopping at (never deleting) [stopAt]. */
    private fun removeEmptyParents(dir: File?, stopAt: File) {
        if (dir == null) return
        try {
            val resolved = dir.canonicalFile
            val stopResolved = stopAt.canonicalFile
            if (resolved == stopResolved || !resolved.path.startsWith(stopResolved.path + File.separator)) return
            val entries = resolved.listFiles() ?: return
            if (entries.isEmpty()) {
                resolved.delete()
                removeEmptyParents(resolved.parentFile, stopAt)
            }
        } catch (e: Exception) {
            // Directory not empty, doesn't exist, or a permission error — stop climbing.
        }
    }
}
