package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.storeIncomingFile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardWatchEventKinds
import java.util.concurrent.TimeUnit

/**
 * Watches `_IMPORT` under a `_DATA` root for new device report files and
 * stores them via [KardiSynchRepository.importReport]. A deliberately
 * simplified desktop-only counterpart to Electron's `watcher.ts`: no PDF/OCR
 * matching, no `.pkg` zip extraction, no cross-batch "active visits" session
 * memory for grouping a XML + generated PDF from one interrogation, no
 * manual-sort queue for ambiguous patient matches. An unsupported or
 * unparseable file — or one whose patient can't be resolved — is moved to
 * `_IMPORT/_unmatched` for the clinician to handle by hand instead of being
 * silently dropped. See [dispatchParse]'s doc comment for exactly which
 * file types are covered.
 */
class ImportWatcher(
    private val importDir: File,
    private val reportsRootHandle: String,
    private val repository: KardiSynchRepository,
    private val reader: DesktopDataRootReader,
    private val writer: DesktopDataRootWriter,
    private val scope: CoroutineScope,
    private val lock: DirectoryLock,
    private val onEvent: (String) -> Unit,
) {
    private val unmatchedDir = File(importDir, "_unmatched")
    private var watchJob: Job? = null

    fun start() {
        importDir.mkdirs()
        unmatchedDir.mkdirs()
        watchJob = scope.launch(Dispatchers.IO) { watchLoop() }
    }

    fun stop() {
        watchJob?.cancel()
    }

    private suspend fun watchLoop() {
        val watchService = FileSystems.getDefault().newWatchService()
        importDir.toPath().register(watchService, StandardWatchEventKinds.ENTRY_CREATE, StandardWatchEventKinds.ENTRY_MODIFY)

        // Files already sitting in _IMPORT before the app started (e.g. left
        // over from a previous run) are picked up on the first pass too.
        processStableFiles()

        while (currentCoroutineContext().isActive) {
            val key = watchService.poll(2, TimeUnit.SECONDS)
            key?.pollEvents()
            key?.reset()
            processStableFiles()
        }
    }

    private suspend fun processStableFiles() {
        val candidates = importDir.listFiles { f -> f.isFile }?.toList() ?: return
        for (file in candidates) {
            if (waitForStable(file)) processFile(file)
        }
    }

    /** A file is "stable" once its size stops changing across polls — a plain stand-in for chokidar's awaitWriteFinish. */
    private suspend fun waitForStable(file: File, checks: Int = 2, intervalMs: Long = 500): Boolean {
        var lastSize = -1L
        repeat(checks) {
            if (!file.exists()) return false
            val size = file.length()
            if (size == lastSize && size > 0) return true
            lastSize = size
            delay(intervalMs)
        }
        return file.exists() && file.length() == lastSize && lastSize > 0
    }

    private suspend fun processFile(file: File) {
        try {
            val bytes = file.readBytes()
            val report = dispatchParse(file.name, bytes)
            if (report == null) {
                moveToUnmatched(file)
                onEvent("Skipped ${file.name}: unsupported or unparseable file type.")
                return
            }

            repository.importReport(reader, writer, reportsRootHandle, report, lock = lock).fold(
                onSuccess = { outcome ->
                    storeIncomingFile(file, File(outcome.visitDirHandle))
                    val mergeNote = if (outcome.reusedExistingVisit) " (merged into existing visit)" else ""
                    onEvent("Imported ${file.name} -> ${report.patient.lastName}, ${report.patient.firstName}$mergeNote")
                },
                onFailure = { e ->
                    moveToUnmatched(file)
                    onEvent("Import failed for ${file.name}: ${e.message}")
                },
            )
        } catch (e: Exception) {
            onEvent("Error processing ${file.name}: ${e.message}")
        }
    }

    private fun moveToUnmatched(file: File) {
        try {
            Files.move(file.toPath(), File(unmatchedDir, file.name).toPath(), StandardCopyOption.REPLACE_EXISTING)
        } catch (e: Exception) {
            onEvent("Failed to move ${file.name} to _unmatched: ${e.message}")
        }
    }
}
