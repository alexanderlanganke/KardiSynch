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
import java.time.Instant
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
 *
 * Every non-empty batch is logged as one import session (issue #174) —
 * mirrors Electron's per-run `createImportSession`/`logImportEvent` audit
 * trail. An empty poll (nothing new in `_IMPORT`) doesn't create a session.
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
        if (stableFiles.isEmpty()) return

        val sessionId = repository.createImportSession(nowIso())
        var imported = 0
        var attached = 0
        var unmatched = 0
        var errors = 0

        val (pdfFiles, structuredFiles) = stableFiles.partition { it.extension.equals("pdf", ignoreCase = true) }

        // Structured files first, so a same-batch companion PDF (below) has
        // something to attach to.
        val visitDirHandlesByStem = mutableMapOf<String, String>()
        for (file in structuredFiles) {
            when (val outcome = processFile(sessionId, file)) {
                is FileOutcome.Imported -> {
                    imported++
                    visitDirHandlesByStem[file.nameWithoutExtension] = outcome.visitDirHandle
                }
                FileOutcome.Skipped -> unmatched++
                FileOutcome.Failed -> errors++
            }
        }

        for (pdf in pdfFiles) {
            if (processCompanionPdf(sessionId, pdf, visitDirHandlesByStem)) attached++ else unmatched++
        }

        val summary = "imported=$imported attached=$attached unmatched=$unmatched errors=$errors"
        repository.updateImportSessionStatus(sessionId, "completed", summary)
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

    private sealed interface FileOutcome {
        data class Imported(val visitDirHandle: String) : FileOutcome
        data object Skipped : FileOutcome
        data object Failed : FileOutcome
    }

    /** Parses and stores [file], logging one import event to [sessionId] either way. */
    private suspend fun processFile(sessionId: String, file: File): FileOutcome {
        try {
            val bytes = file.readBytes()
            val report = dispatchParse(file.name, bytes)
            if (report == null) {
                moveToUnmatched(file)
                val message = "Skipped ${file.name}: unsupported or unparseable file type."
                onEvent(message)
                repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
                return FileOutcome.Skipped
            }

            var outcome: FileOutcome = FileOutcome.Failed
            repository.importReport(reader, writer, reportsRootHandle, report, lock = lock).fold(
                onSuccess = { imported ->
                    storeIncomingFile(file, File(imported.visitDirHandle))
                    val mergeNote = if (imported.reusedExistingVisit) " (merged into existing visit)" else ""
                    val message = "Imported ${file.name} -> ${report.patient.lastName}, ${report.patient.firstName}$mergeNote"
                    onEvent(message)
                    repository.logImportEvent(
                        sessionId, nowIso(), file.absolutePath, "imported",
                        patientId = imported.patientId, reportId = imported.reportId, message = message,
                    )
                    outcome = FileOutcome.Imported(imported.visitDirHandle)
                },
                onFailure = { e ->
                    moveToUnmatched(file)
                    val message = "Import failed for ${file.name}: ${e.message}"
                    onEvent(message)
                    repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
                    outcome = FileOutcome.Failed
                },
            )
            return outcome
        } catch (e: Exception) {
            val message = "Error processing ${file.name}: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
            return FileOutcome.Failed
        }
    }

    /** Returns true if [file] was attached to a same-batch companion visit, false if it went to `_unmatched`. */
    private suspend fun processCompanionPdf(sessionId: String, file: File, visitDirHandlesByStem: Map<String, String>): Boolean {
        val visitDirHandle = visitDirHandlesByStem[file.nameWithoutExtension]
        if (visitDirHandle == null) {
            moveToUnmatched(file)
            val message = "Skipped ${file.name}: no matching structured file in this batch (PDF content isn't parsed yet)."
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
            return false
        }
        return try {
            storeIncomingFile(file, File(visitDirHandle))
            val message = "Attached ${file.name} to the visit imported from ${file.nameWithoutExtension} in this batch."
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "attached", message = message)
            true
        } catch (e: Exception) {
            moveToUnmatched(file)
            val message = "Failed to attach ${file.name} to its matching visit: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
            false
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

private fun nowIso(): String = Instant.now().toString()

/**
 * Moves every file sitting in `_IMPORT/_unmatched` back into `_IMPORT`, so
 * the next watcher pass retries them against the current parser/matching
 * logic — mirrors Electron's `reprocess-unmatched` IPC handler. Returns the
 * number of files moved. Collision-safe: a same-named file that has since
 * landed back in `_IMPORT` (unlikely, but possible between "Reprocess" and
 * the watcher's next tick) gets a numbered suffix instead of being clobbered.
 */
fun reprocessUnmatchedFiles(importDir: File): Int {
    val unmatchedDir = File(importDir, "_unmatched")
    val files = unmatchedDir.listFiles { f -> f.isFile } ?: return 0
    var moved = 0
    for (file in files) {
        try {
            Files.move(file.toPath(), collisionFreeName(importDir, file.name).toPath())
            moved++
        } catch (e: Exception) {
            // Leave it in _unmatched — better than losing track of it.
        }
    }
    return moved
}

private fun collisionFreeName(dir: File, baseName: String): File {
    var candidate = File(dir, baseName)
    if (!candidate.exists()) return candidate
    val ext = baseName.substringAfterLast('.', "")
    val stem = if (ext.isEmpty()) baseName else baseName.removeSuffix(".$ext")
    var i = 1
    while (candidate.exists()) {
        i++
        candidate = File(dir, if (ext.isEmpty()) "${stem}_$i" else "${stem}_$i.$ext")
    }
    return candidate
}
