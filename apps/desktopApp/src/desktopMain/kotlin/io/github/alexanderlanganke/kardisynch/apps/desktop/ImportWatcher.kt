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
 * simplified desktop-only counterpart to Electron's `watcher.ts`: no PDF text
 * extraction/OCR (no PDF parser is ported yet — see [dispatchParse]'s doc
 * comment), no `.pkg` zip extraction, no cross-batch "active visits" session
 * memory (matching only happens within one [processStableFiles] pass, not
 * across separate watcher ticks), no manual-sort queue for ambiguous patient
 * matches.
 *
 * A `.pdf` is content-blind matched to a structured file processed in the
 * *same batch* by shared basename (stem) — e.g. `12345.pdd` + `12345.pdf`
 * arriving together — and copied into that visit's directory without
 * touching its `visit.xml` (mirrors Electron's `storeFile(..., report =
 * undefined)`: never let a PDF the app can't read overwrite structured
 * data). A PDF with no same-batch structured companion, or any other
 * unsupported/unparseable file, is moved to `_IMPORT/_unmatched` for the
 * clinician to handle by hand instead of being silently dropped.
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
        val stableFiles = importDir.listFiles { f -> f.isFile }?.filter { waitForStable(it) } ?: return
        val (pdfFiles, structuredFiles) = stableFiles.partition { it.extension.equals("pdf", ignoreCase = true) }

        // Structured files first, so a same-batch companion PDF (below) has
        // something to attach to.
        val visitDirHandlesByStem = mutableMapOf<String, String>()
        for (file in structuredFiles) {
            processFile(file)?.let { visitDirHandle -> visitDirHandlesByStem[file.nameWithoutExtension] = visitDirHandle }
        }

        for (pdf in pdfFiles) {
            processCompanionPdf(pdf, visitDirHandlesByStem)
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

    /** Parses and stores [file]; returns the visit directory it landed in, or null if it was skipped/failed. */
    private suspend fun processFile(file: File): String? {
        try {
            val bytes = file.readBytes()
            val report = dispatchParse(file.name, bytes)
            if (report == null) {
                moveToUnmatched(file)
                onEvent("Skipped ${file.name}: unsupported or unparseable file type.")
                return null
            }

            var visitDirHandle: String? = null
            repository.importReport(reader, writer, reportsRootHandle, report, lock = lock).fold(
                onSuccess = { outcome ->
                    storeIncomingFile(file, File(outcome.visitDirHandle))
                    val mergeNote = if (outcome.reusedExistingVisit) " (merged into existing visit)" else ""
                    onEvent("Imported ${file.name} -> ${report.patient.lastName}, ${report.patient.firstName}$mergeNote")
                    visitDirHandle = outcome.visitDirHandle
                },
                onFailure = { e ->
                    moveToUnmatched(file)
                    onEvent("Import failed for ${file.name}: ${e.message}")
                },
            )
            return visitDirHandle
        } catch (e: Exception) {
            onEvent("Error processing ${file.name}: ${e.message}")
            return null
        }
    }

    private fun processCompanionPdf(file: File, visitDirHandlesByStem: Map<String, String>) {
        val visitDirHandle = visitDirHandlesByStem[file.nameWithoutExtension]
        if (visitDirHandle == null) {
            moveToUnmatched(file)
            onEvent("Skipped ${file.name}: no matching structured file in this batch (PDF content isn't parsed yet).")
            return
        }
        try {
            storeIncomingFile(file, File(visitDirHandle))
            onEvent("Attached ${file.name} to the visit imported from ${file.nameWithoutExtension} in this batch.")
        } catch (e: Exception) {
            moveToUnmatched(file)
            onEvent("Failed to attach ${file.name} to its matching visit: ${e.message}")
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
