package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
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
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Watches `_IMPORT` under a `_DATA` root for new device report files and
 * stores them via [KardiSynchRepository.importReport]. A deliberately
 * simplified desktop-only counterpart to Electron's `watcher.ts`: no PDF text
 * extraction/OCR (no PDF parser is ported yet — see [dispatchParse]'s doc
 * comment, and see below for what this means for cross-batch matching), no
 * manual-sort queue for ambiguous patient matches. `.pkg` (Medtronic's zip
 * archive format, issue #170) IS handled — see [dispatchParseFile].
 *
 * A `.pdf` is content-blind matched to a structured file's visit by shared
 * basename (stem) — e.g. `12345.pdd` + `12345.pdf` — and copied into that
 * visit's directory without touching its `visit.xml` (mirrors Electron's
 * `storeFile(..., report = undefined)`: never let a PDF the app can't read
 * overwrite structured data). This match isn't limited to files that arrive
 * in the same [processStableFiles] pass (issue #171): every successfully
 * imported visit's stem is remembered for [activeVisitWindowMs] (default 2
 * minutes, matching Electron's `ACTIVE_VISITS_QUIET_PERIOD`) across
 * subsequent polling ticks too, so a PDF that finishes exporting a few
 * seconds after its sibling XML still gets attached instead of orphaned.
 * What this does NOT replicate: Electron's cross-batch matching keys on the
 * device *serial number* extracted from the PDF's own text, which requires
 * PDF content parsing (issue #169, not built) — basename is a weaker but
 * workable stand-in until then. A PDF with no basename match within the
 * window, or any other unsupported/unparseable file, is moved to
 * `_IMPORT/_unmatched` for the clinician to handle by hand.
 *
 * Every non-empty batch is logged as one import session (issue #174) —
 * mirrors Electron's per-run `createImportSession`/`logImportEvent` audit
 * trail. An empty poll (nothing new in `_IMPORT`) doesn't create a session.
 *
 * A structured file whose device type came back unknown gets one more
 * chance before storing: [resolveDeviceTypeAlias] looks it up in the shared
 * `device_types.xml` alias file (issue #184). No interactive "still
 * unknown, ask the clinician" dialog is built, unlike `watcher.ts`.
 *
 * Before a visit can be auto-created (or an ambiguous one silently
 * misattached), [KardiSynchRepository.resolvePatientIdentity] runs the
 * import-identity ladder (issue #172/#173): an exact or safely-adopted
 * match proceeds straight to import; anything less certain is staged into
 * `_IMPORT/_pending_sort` and queued as a [KardiSynchRepository.getPendingSortTasks]
 * row instead of guessing — resolved later via [resolvePendingSortTask]/
 * [dismissPendingSortTask].
 */
class ImportWatcher(
    private val importDir: File,
    private val reportsRootHandle: String,
    private val repository: KardiSynchRepository,
    private val reader: DesktopDataRootReader,
    private val writer: DesktopDataRootWriter,
    private val scope: CoroutineScope,
    private val lock: DirectoryLock,
    private val activeVisitWindowMs: Long = 2 * 60 * 1000L,
    private val now: () -> Long = { System.currentTimeMillis() },
    /** The `_DATA` root itself (parent of [reportsRootHandle]) — only used to look up the shared device-type alias file (issue #184). Null skips auto-resolve entirely (e.g. in tests that don't care about it). */
    private val dataRootHandle: String? = null,
    private val onEvent: (String) -> Unit,
) {
    private val unmatchedDir = File(importDir, "_unmatched")
    private val pendingSortDir = File(importDir, "_pending_sort")
    private var watchJob: Job? = null

    /** Stem (filename without extension) → the visit it landed in, pruned once older than [activeVisitWindowMs] — see this class's doc comment. */
    private data class RecentVisit(val visitDirHandle: String, val importedAtMs: Long)
    private val recentVisitsByStem = mutableMapOf<String, RecentVisit>()

    fun start() {
        importDir.mkdirs()
        unmatchedDir.mkdirs()
        pendingSortDir.mkdirs()
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

        pruneExpiredVisits()

        val sessionId = repository.createImportSession(nowIso())
        var imported = 0
        var attached = 0
        var unmatched = 0
        var errors = 0
        var pendingSort = 0

        val (pdfFiles, structuredFiles) = stableFiles.partition { it.extension.equals("pdf", ignoreCase = true) }

        // Structured files first, so a same-batch companion PDF (below) has
        // something to attach to immediately, without waiting for the window.
        for (file in structuredFiles) {
            when (val outcome = processFile(sessionId, file)) {
                is FileOutcome.Imported -> {
                    imported++
                    recentVisitsByStem[file.nameWithoutExtension] = RecentVisit(outcome.visitDirHandle, now())
                }
                FileOutcome.Skipped -> unmatched++
                FileOutcome.Failed -> errors++
                FileOutcome.PendingSort -> pendingSort++
            }
        }

        for (pdf in pdfFiles) {
            if (processCompanionPdf(sessionId, pdf)) attached++ else unmatched++
        }

        val summary = "imported=$imported attached=$attached unmatched=$unmatched errors=$errors pendingSort=$pendingSort"
        repository.updateImportSessionStatus(sessionId, "completed", summary)
    }

    private fun pruneExpiredVisits() {
        val cutoff = now() - activeVisitWindowMs
        recentVisitsByStem.entries.removeAll { it.value.importedAtMs < cutoff }
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
        data object PendingSort : FileOutcome
    }

    /**
     * Auto-resolves an unknown device type from the shared `device_types.xml`
     * alias file (issue #184) — mirrors `watcher.ts`'s auto-resolve step, not
     * the interactive "device ambiguity" dialog that follows it there (not
     * ported: no per-import manual device-entry UI yet).
     */
    private suspend fun resolveDeviceTypeAlias(report: UnifiedReport): UnifiedReport {
        val root = dataRootHandle ?: return report
        val manufacturer = report.manufacturer
        val model = report.device.model
        val typeKnown = report.device.type.isNotBlank() && report.device.type != "Unknown"
        if (manufacturer.isBlank() || manufacturer == "Unknown" || model.isBlank() || model == "Unknown" || typeKnown) return report
        val aliasType = repository.resolveDeviceTypeFromAlias(reader, root, manufacturer, model) ?: return report
        onEvent("Auto-resolved device type from alias: $manufacturer $model -> $aliasType")
        return report.copy(device = report.device.copy(type = aliasType))
    }

    /** Parses and stores [file], logging one import event to [sessionId] either way. */
    private suspend fun processFile(sessionId: String, file: File): FileOutcome {
        try {
            val bytes = file.readBytes()
            val parsed = dispatchParseFileIncludingPkg(file.name, bytes)
            if (parsed == null) {
                moveToUnmatched(file)
                val message = "Skipped ${file.name}: unsupported or unparseable file type."
                onEvent(message)
                repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
                return FileOutcome.Skipped
            }
            val aliasResolved = resolveDeviceTypeAlias(parsed)

            val identity = repository.resolvePatientIdentity(aliasResolved.patient, aliasResolved.device.serialNumber, aliasResolved.manufacturer)
            if (identity is KardiSynchRepository.IdentityResolution.PendingReview) {
                return stageForPendingSort(sessionId, file, aliasResolved, identity)
            }
            val report = if (identity is KardiSynchRepository.IdentityResolution.Adopted) {
                aliasResolved.copy(
                    patient = aliasResolved.patient.copy(
                        firstName = identity.firstName, lastName = identity.lastName,
                        dob = identity.dob, hospitalPatientId = identity.hospitalPatientId,
                    ),
                )
            } else {
                aliasResolved
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

    /** Moves [file] into `_pending_sort` and records it as a [KardiSynchRepository.getPendingSortTasks] row instead of importing — the import-identity ladder wasn't confident enough (issue #172/#173). */
    private suspend fun stageForPendingSort(
        sessionId: String,
        file: File,
        report: UnifiedReport,
        resolution: KardiSynchRepository.IdentityResolution.PendingReview,
    ): FileOutcome {
        return try {
            val stagedFile = File(pendingSortDir, "${UUID.randomUUID()}_${file.name}")
            Files.move(file.toPath(), stagedFile.toPath())
            repository.createPendingSortTask(
                createdAt = nowIso(), sessionId = sessionId,
                stagedFilePath = stagedFile.absolutePath, originalFileName = file.name,
                suggestedPatientId = resolution.suggestedPatientId, suggestedPatientName = resolution.suggestedPatientName,
                note = resolution.note,
                manufacturer = report.manufacturer.takeIf { it.isNotBlank() && it != "Unknown" },
                deviceModel = report.device.model.takeIf { it.isNotBlank() && it != "Unknown" },
                deviceSerial = report.device.serialNumber.takeIf { it.isNotBlank() && it != "Unknown" },
                interrogationDate = report.interrogationDate.takeIf { it.isNotBlank() },
            )
            val message = "Queued ${file.name} for manual sort: ${resolution.note}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), stagedFile.absolutePath, "pending_sort", message = message)
            FileOutcome.PendingSort
        } catch (e: Exception) {
            moveToUnmatched(file)
            val message = "Failed to queue ${file.name} for manual sort: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
            FileOutcome.Failed
        }
    }

    /** Returns true if [file] was attached to a same-basename visit imported within [activeVisitWindowMs], false if it went to `_unmatched`. */
    private suspend fun processCompanionPdf(sessionId: String, file: File): Boolean {
        val visitDirHandle = recentVisitsByStem[file.nameWithoutExtension]?.visitDirHandle
        if (visitDirHandle == null) {
            moveToUnmatched(file)
            val minutes = activeVisitWindowMs / 60_000
            val message = "Skipped ${file.name}: no matching structured file imported in the last ${minutes}m (PDF content isn't parsed yet)."
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
            return false
        }
        return try {
            storeIncomingFile(file, File(visitDirHandle))
            val message = "Attached ${file.name} to the visit imported from ${file.nameWithoutExtension}."
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
 * [dispatchParse] can't handle `.pkg` itself (it needs `java.util.zip`,
 * unreachable from `core`'s commonMain) — [parseMedtronicPkg] is this
 * desktop layer's own equivalent for that one extension (issue #170).
 * Shared between [ImportWatcher] and [resolvePendingSortTask] (which
 * re-parses a staged file rather than persisting the full parsed report
 * while it sits in the queue).
 */
private fun dispatchParseFileIncludingPkg(fileName: String, bytes: ByteArray): UnifiedReport? =
    if (fileName.substringAfterLast('.', "").equals("pkg", ignoreCase = true)) {
        parseMedtronicPkg(bytes)?.copy(manufacturer = "Medtronic")
    } else {
        dispatchParse(fileName, bytes)
    }

/**
 * Approves a pending-sort task (issue #172/#173): re-parses its staged
 * file, overwrites the parsed patient identity with [targetPatientId]'s
 * actual on-file identity (the parsed report's own patient fields may be
 * missing or wrong — that's exactly why this was queued), imports it via
 * [KardiSynchRepository.importReportForExistingPatient], moves the staged
 * file into the resulting visit directory, and removes the task.
 */
suspend fun resolvePendingSortTask(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    taskId: String,
    targetPatientId: String,
    lock: DirectoryLock = NoOpDirectoryLock,
): Result<Unit> {
    val task = repository.getPendingSortTask(taskId) ?: return Result.failure(IllegalStateException("Pending sort task $taskId not found"))
    val stagedFile = File(task.stagedFilePath)
    if (!stagedFile.isFile) return Result.failure(IllegalStateException("Staged file for task $taskId is missing: ${task.stagedFilePath}"))

    val parsed = dispatchParseFileIncludingPkg(task.originalFileName, stagedFile.readBytes())
        ?: return Result.failure(IllegalStateException("Staged file for task $taskId no longer parses"))
    val patient = repository.getPatientById(targetPatientId)
        ?: return Result.failure(IllegalStateException("Target patient $targetPatientId not found"))

    val report = parsed.copy(
        patient = parsed.patient.copy(
            firstName = patient.firstName.orEmpty(), lastName = patient.lastName,
            dob = patient.dob, hospitalPatientId = patient.hospitalPatientId,
        ),
    )

    return repository.importReportForExistingPatient(reader, writer, reportsRootHandle, targetPatientId, report, lock).fold(
        onSuccess = { imported ->
            storeIncomingFile(stagedFile, File(imported.visitDirHandle))
            repository.deletePendingSortTask(taskId)
            Result.success(Unit)
        },
        onFailure = { Result.failure(it) },
    )
}

/** Dismisses a pending-sort task: moves its staged file to `_IMPORT/_unmatched` (never deletes it outright) and removes the task. */
suspend fun dismissPendingSortTask(repository: KardiSynchRepository, importDir: File, taskId: String): Result<Unit> {
    val task = repository.getPendingSortTask(taskId) ?: return Result.success(Unit)
    val stagedFile = File(task.stagedFilePath)
    return try {
        if (stagedFile.isFile) {
            val unmatchedDir = File(importDir, "_unmatched").apply { mkdirs() }
            Files.move(stagedFile.toPath(), collisionFreeName(unmatchedDir, task.originalFileName).toPath())
        }
        repository.deletePendingSortTask(taskId)
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }
}

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
