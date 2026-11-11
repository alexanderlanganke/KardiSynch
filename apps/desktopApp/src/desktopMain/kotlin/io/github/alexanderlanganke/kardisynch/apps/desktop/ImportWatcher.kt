package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.intake.Bundle
import io.github.alexanderlanganke.kardisynch.core.intake.FileKind
import io.github.alexanderlanganke.kardisynch.core.intake.IntakeItem
import io.github.alexanderlanganke.kardisynch.core.intake.bostonPatientFolder
import io.github.alexanderlanganke.kardisynch.core.intake.withBostonFolder
import io.github.alexanderlanganke.kardisynch.core.intake.formatEvidence
import io.github.alexanderlanganke.kardisynch.core.intake.groupIntoBundles
import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.matching.ReportMatchCandidate
import io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
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
import java.nio.file.StandardWatchEventKinds
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Watches `_IMPORT` (recursively) under a `_DATA` root and turns the files that
 * land there into visits. The unit of work is a **bundle** — the files that
 * describe one interrogation — not a single file:
 *
 *  1. **Scan** every subfolder (the old watcher listed only the top level),
 *     skipping the app's own `_unmatched`/`_pending_sort`/`_duplicates` folders.
 *  2. **Settle**: size and modified time unchanged, old enough, readable — a
 *     half-copied file from a share is not imported.
 *  3. **Fingerprint**: SHA-256. Content already imported (and still stored) is a
 *     duplicate, not a second visit.
 *  4. **Identify and parse** by content ([parseForIntake]); the file name is
 *     only a hint. A PDF's text is read for patient, serial and date.
 *  5. **Bundle** by facts ([groupIntoBundles]): same device serial within the
 *     time tolerance, shared base name, or same patient and day. This replaces
 *     the old in-memory "stem → visit for 2 minutes" map, so a PDF that
 *     finishes exporting later — or after a restart — still finds its visit.
 *  6. **Resolve and commit** once per bundle through the import-identity ladder
 *     ([KardiSynchRepository.resolvePatientIdentity]): confident → import,
 *     anything less → the manual-sort queue with the evidence, never a guess.
 *
 * Every file gets a ledger row ([KardiSynchRepository.recordIntakeFile]), so
 * nothing disappears into a folder: unrecognised files, duplicates and queued
 * files are all visible in the Inbox. Every non-empty batch is also logged as
 * one import session.
 */
class ImportWatcher(
    private val importDir: File,
    private val reportsRootHandle: String,
    private val repository: KardiSynchRepository,
    private val reader: DesktopDataRootReader,
    private val writer: DesktopDataRootWriter,
    private val scope: CoroutineScope,
    private val lock: DirectoryLock,
    /** The `_DATA` root itself (parent of [reportsRootHandle]) — only used to look up the shared device-type alias file (issue #184). Null skips auto-resolve entirely (e.g. in tests that don't care about it). */
    private val dataRootHandle: String? = null,
    private val pdfText: PdfTextExtractor = PdfBoxTextExtractor,
    /** A file must be at least this old (by modified time) before it is picked up. */
    private val minFileAgeMs: Long = 1500L,
    /** A held-back file (empty, locked, still changing) is announced once after this long. */
    private val announceWaitingAfterMs: Long = 30_000L,
    private val onEvent: (String) -> Unit,
) {
    private val unmatchedDir = File(importDir, "_unmatched")
    private val pendingSortDir = File(importDir, "_pending_sort")
    private val duplicatesDir = File(importDir, "_duplicates")
    private val reservedDirs = setOf("_unmatched", "_pending_sort", "_duplicates")
    private var watchJob: Job? = null

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
        // over from a previous run) are picked up on the first pass too. The
        // 2s poll below also covers subfolders and network shares, where
        // WatchService events are unreliable.
        processStableFiles()

        while (currentCoroutineContext().isActive) {
            val key = watchService.poll(2, TimeUnit.SECONDS)
            key?.pollEvents()
            key?.reset()
            processStableFiles()
        }
    }

    private fun scanFiles(): List<File> =
        importDir.walkTopDown()
            .onEnter { it == importDir || (it.name !in reservedDirs && !it.name.startsWith(".")) }
            .filter { f ->
                f.isFile && !f.name.startsWith(".") && !f.name.startsWith("~$") &&
                    !f.name.endsWith(".part", true) && !f.name.endsWith(".tmp", true) && !f.name.endsWith(".crdownload", true)
            }
            .toList()

    /** Stable = unchanged size and modified time across two checks, old enough, and readable. */
    private suspend fun waitForStable(file: File, checks: Int = 2, intervalMs: Long = 500): Boolean {
        var lastSize = -1L
        var lastModified = -1L
        repeat(checks) {
            if (!file.exists()) return false
            val size = file.length()
            val modified = file.lastModified()
            if (size == lastSize && modified == lastModified && size > 0) return isOldAndReadable(file)
            lastSize = size
            lastModified = modified
            delay(intervalMs)
        }
        return file.exists() && file.length() == lastSize && file.lastModified() == lastModified && lastSize > 0 && isOldAndReadable(file)
    }

    private fun isOldAndReadable(file: File): Boolean {
        // Only a file modified a moment AGO is held back. A modified time in the FUTURE (a programmer or USB stick with
        // a wrong clock or time zone) must not block the file forever: the size/time did not change across the checks
        // in waitForStable, which is what says the writer has finished.
        val age = System.currentTimeMillis() - file.lastModified()
        if (age in 0 until minFileAgeMs) return false
        return try {
            file.inputStream().use { it.read() }
            true
        } catch (e: Exception) {
            false // locked by the writer, or the share dropped
        }
    }

    /** When each currently held-back file (path + size + time) was first seen waiting; the value is -1 once announced. */
    private val waitingSince = mutableMapOf<String, Long>()

    /**
     * A file that is not picked up must never be invisible. A fresh copy settles within a couple of seconds and
     * needs no comment; one still held back after [announceWaitingAfterMs] (empty, locked by another program, kept
     * changing) is announced once with the reason, instead of being ignored silently.
     */
    private fun announceWaitingFiles(waiting: List<File>, nowMs: Long = System.currentTimeMillis()) {
        val keys = HashSet<String>()
        for (file in waiting) {
            if (!file.exists()) continue
            val key = "${file.absolutePath}|${file.length()}|${file.lastModified()}"
            keys += key
            val since = waitingSince.getOrPut(key) { nowMs }
            if (since < 0 || nowMs - since < announceWaitingAfterMs) continue
            waitingSince[key] = -1
            val reason = when {
                file.length() == 0L -> "it is empty (0 bytes)"
                !runCatching { file.inputStream().use { it.read() } }.isSuccess -> "it cannot be read (locked by another program, or no permission)"
                else -> "it is still being written or keeps changing"
            }
            onEvent("Waiting for ${file.name}: $reason. It will be imported as soon as that clears.")
        }
        waitingSince.keys.retainAll(keys) // files that were imported, changed or removed are forgotten
    }

    private class Tally {
        var imported = 0
        var attached = 0
        var unmatched = 0
        var errors = 0
        var pendingSort = 0
        var duplicates = 0
    }

    private class Prepared(val file: File, val bytes: ByteArray, val sha: String, val parsed: ParsedIntake, val item: IntakeItem)

    private sealed interface FileOutcome {
        data class Imported(val visitDirHandle: String, val patientId: String, val reportId: String, val sourceName: String) : FileOutcome
        data object Skipped : FileOutcome
        data object Failed : FileOutcome
        data object PendingSort : FileOutcome
    }

    private suspend fun processStableFiles() {
        val scanned = scanFiles()
        val stableFiles = scanned.filter { waitForStable(it) }
        announceWaitingFiles(scanned.filter { it !in stableFiles })
        if (stableFiles.isEmpty()) return

        val sessionId = repository.createImportSession(nowIso())
        val tally = Tally()

        val seenShas = mutableSetOf<String>()
        val prepared = stableFiles.mapNotNull { prepare(sessionId, it, seenShas, tally) }
        val byId = prepared.associateBy { it.item.id }
        for (bundle in groupIntoBundles(prepared.map { it.item })) processBundle(sessionId, bundle, byId, tally)

        val summary = "imported=${tally.imported} attached=${tally.attached} unmatched=${tally.unmatched} errors=${tally.errors} pendingSort=${tally.pendingSort} duplicates=${tally.duplicates}"
        repository.updateImportSessionStatus(sessionId, "completed", summary)
    }

    /** Reads, fingerprints, de-duplicates, identifies and parses one file. Returns null when the file is fully dealt with here (duplicate, unrecognised, unreadable). */
    private suspend fun prepare(sessionId: String, file: File, seenShas: MutableSet<String>, tally: Tally): Prepared? {
        val bytes = try {
            file.readBytes()
        } catch (e: Exception) {
            val message = "Error processing ${file.name}: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
            tally.errors++
            return null
        }
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

        val handled = repository.findHandledIntakeFileBySha(sha)
        val alreadyStored = handled?.storedPath?.let { File(it).exists() } == true
        // The same content may also be waiting in the Inbox already; queueing it again would show it twice.
        val alreadyWaiting = repository.findPendingIntakeFileBySha(sha)?.storedPath?.let { File(it).exists() } == true
        if (!seenShas.add(sha) || alreadyStored || alreadyWaiting) {
            // Identical content that is still stored (or still waiting for a person): nothing new to do.
            // (If the visit was deleted since, the stored copy is gone and the file is imported again.)
            val dup = moveUnique(file, duplicatesDir)
            val message = "Skipped ${file.name}: identical to a file already imported (duplicate)."
            repository.recordIntakeFile(
                sha256 = sha, fileName = file.name, originalPath = file.absolutePath, storedPath = dup?.absolutePath, sourceLabel = sourceLabel(file),
                sizeBytes = bytes.size.toLong(), seenAt = nowIso(), state = "duplicate", fileKind = null, manufacturer = null, confidence = null,
                evidence = null, bundleId = null, message = message,
            )
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "duplicate", message = message)
            onEvent(message)
            tally.duplicates++
            return null
        }

        val parsed = try {
            parseForIntake(file.name, bytes, pdfText)
        } catch (e: Exception) {
            // A damaged or truncated file whose parser threw. It is not an app error: put it aside and list it
            // under "not recognised" in the Inbox so a person sees it and can retry, exactly like a file no
            // parser claims.
            val message = "Skipped ${file.name}: it could not be read (${e.message?.take(120) ?: e.javaClass.simpleName}); the file may be damaged."
            repository.clearUnhandledIntakeRows(sha)
            val moved = moveUnique(file, unmatchedDir)
            record(file, bytes.size, sha, "unrecognised", message, moved?.absolutePath, null, null, null)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
            onEvent(message)
            tally.unmatched++
            return null
        }

        val kind = parsed.identification.kind
        if (parsed.report == null && !kind.isPdf) {
            val reason = if (kind == FileKind.UNKNOWN || kind == FileKind.UNKNOWN_XML) {
                "unsupported or unparseable file type"
            } else {
                "recognised as ${kind.name.lowercase().replace('_', ' ')} but could not be parsed"
            }
            val message = "Skipped ${file.name}: $reason."
            repository.clearUnhandledIntakeRows(sha)
            val moved = moveUnique(file, unmatchedDir)
            record(file, bytes.size, sha, "unrecognised", message, moved?.absolutePath, parsed, null, null)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "unmatched", message = message)
            // Announce only once the file has really been put aside and recorded.
            onEvent(message)
            tally.unmatched++
            return null
        }

        // Boston exports keep one folder per patient (see BostonExport.kt): its serial links PDFs that
        // name none, and its root is one bundling scope for the .bnk and the PDFs in its report/ folder.
        val bostonFolder = bostonPatientFolder(file.path)
        val item = IntakeItem(
            id = sha, fileName = file.name, identification = parsed.identification,
            facts = parsed.facts.withBostonFolder(bostonFolder),
            sourceDir = bostonFolder?.root ?: file.parent.orEmpty(), arrivedAtMs = file.lastModified(),
        )
        return Prepared(file, bytes, sha, parsed, item)
    }

    private suspend fun processBundle(sessionId: String, bundle: Bundle, byId: Map<String, Prepared>, tally: Tally) {
        val preps = bundle.items.map { byId.getValue(it.id) }
        val bundleId = bundle.id
        val structured = preps.filter { it.parsed.identification.kind.isStructured }
        val pdfs = preps.filter { it.parsed.identification.kind.isPdf }

        if (bundle.conflicts.isNotEmpty()) {
            val note = "The files of this bundle disagree on: ${bundle.conflicts.joinToString(", ")}. Check that they belong to the same patient."
            for (p in preps) stage(sessionId, p, note, null, null, bundleId, tally)
            return
        }

        var anchor: FileOutcome.Imported? = null
        var pendingAny = false
        for (p in structured) {
            when (val outcome = processStructured(sessionId, p, bundleId)) {
                is FileOutcome.Imported -> { tally.imported++; if (anchor == null) anchor = outcome }
                FileOutcome.PendingSort -> { tally.pendingSort++; pendingAny = true }
                FileOutcome.Failed -> tally.errors++
                FileOutcome.Skipped -> tally.unmatched++
            }
        }

        for (p in pdfs) {
            val a = anchor
            when {
                a != null -> attach(sessionId, p, File(a.visitDirHandle), a.patientId, a.reportId, "the visit imported from ${a.sourceName}", bundleId, tally)
                pendingAny -> stage(sessionId, p, "Part of a bundle that is waiting for manual sort.", null, null, bundleId, tally)
                else -> processPdfAlone(sessionId, p, bundleId, tally)
            }
        }
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

    /** Stores one already-parsed structured file, logging one import event and one ledger row either way. */
    private suspend fun processStructured(sessionId: String, p: Prepared, bundleId: String): FileOutcome {
        val file = p.file
        try {
            val aliasResolved = resolveDeviceTypeAlias(p.parsed.report!!)
            val identity = repository.resolvePatientIdentity(aliasResolved.patient, aliasResolved.device.serialNumber, aliasResolved.manufacturer)
            if (identity is KardiSynchRepository.IdentityResolution.PendingReview) {
                return stageOutcome(sessionId, p, identity.note, identity.suggestedPatientId, identity.suggestedPatientName, bundleId)
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
                    val stored = storeIncomingFile(file, File(imported.visitDirHandle))
                    val mergeNote = if (imported.reusedExistingVisit) " (merged into existing visit)" else ""
                    val message = "Imported ${file.name} -> ${report.patient.lastName}, ${report.patient.firstName}$mergeNote"
                    repository.logImportEvent(
                        sessionId, nowIso(), file.absolutePath, "imported",
                        patientId = imported.patientId, reportId = imported.reportId, message = message,
                    )
                    repository.clearUnhandledIntakeRows(p.sha)
                    record(file, p.bytes.size, p.sha, "committed", message, stored?.absolutePath, p.parsed, bundleId, imported.patientId, imported.reportId)
                    onEvent(message)
                    outcome = FileOutcome.Imported(imported.visitDirHandle, imported.patientId, imported.reportId, file.name)
                    adoptWaitingCompanions(sessionId, report, imported.visitDirHandle, imported.patientId, imported.reportId, file.name)
                },
                onFailure = { e ->
                    val moved = moveUnique(file, unmatchedDir)
                    val message = "Import failed for ${file.name}: ${e.message}"
                    onEvent(message)
                    repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
                    repository.clearUnhandledIntakeRows(p.sha)
                    record(file, p.bytes.size, p.sha, "error", message, moved?.absolutePath, p.parsed, bundleId)
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

    /**
     * A PDF that arrived BEFORE its data file was queued (nothing to match it with yet). When the data file
     * is imported afterwards, every waiting PDF for the same device and day belongs to that visit: attach it
     * now instead of leaving it in the Inbox for a person to do the same by hand.
     */
    private suspend fun adoptWaitingCompanions(sessionId: String, report: UnifiedReport, visitDirHandle: String, patientId: String, reportId: String, sourceName: String) {
        val serial = report.device.serialNumber.takeIf { it.isNotBlank() && it != "Unknown" } ?: return
        val day = report.interrogationDate.take(10).takeIf { it.length == 10 } ?: return
        val waiting = repository.getPendingSortTasks().filter {
            it.fileKind == FileKind.DEVICE_PDF.name && it.deviceSerial.equals(serial, ignoreCase = true) && it.interrogationDate?.take(10) == day
        }
        for (task in waiting) {
            val staged = File(task.stagedFilePath)
            if (!staged.isFile) continue
            try {
                storeIncomingFile(staged, File(visitDirHandle))
                repository.deletePendingSortTask(task.id)
                repository.resolvePendingIntakeRow(task.stagedFilePath, "attached", "Attached automatically when its data file arrived", patientId, reportId)
                val message = "Attached ${task.originalFileName} to the visit imported from $sourceName (it had arrived first)."
                onEvent(message)
                repository.logImportEvent(sessionId, nowIso(), task.stagedFilePath, "attached", patientId = patientId, reportId = reportId, message = message)
            } catch (e: Exception) {
                onEvent("Could not attach the waiting ${task.originalFileName}: ${e.message}")
            }
        }
    }

    /**
     * A PDF with no structured sibling in its bundle. In order: (1) a late
     * companion — the same device on the same day already has a visit, so the
     * PDF joins it; (2) the PDF names a patient already on file — it becomes a
     * (partial) visit of that patient; (3) anything else is queued for a
     * clinician, because a name regex over PDF text is not enough to create a
     * patient from.
     */
    private suspend fun processPdfAlone(sessionId: String, p: Prepared, bundleId: String, tally: Tally) {
        val facts = p.parsed.facts
        val serial = facts.serial
        val day = facts.interrogation?.take(10)
        if (serial != null && day != null) {
            val candidates = repository.getReportsByDeviceSerial(serial).filter { it.interrogationDate.take(10) == day }
            val match = pickSameDayReport(candidates.map { ReportMatchCandidate(it.id, it.interrogationDate, it.deviceSerialNumber) }, facts.interrogation, serial, explicitNewVisit = false)
            val report = candidates.firstOrNull { it.id == match?.id }
            val visitDir = report?.let { locateVisitDir(it.patientId, it.id) }
            if (report != null && visitDir != null) {
                attach(sessionId, p, visitDir, report.patientId, report.id, "the existing visit of ${facts.interrogation} for device $serial", bundleId, tally)
                return
            }
        }

        if (facts.isEmpty) {
            stage(sessionId, p, "No patient or device details could be read from this PDF (a scanned image?). Assign it manually.", null, null, bundleId, tally)
            return
        }

        val patientInfo = PatientInfo(facts.firstName.orEmpty(), facts.lastName ?: "Unknown", facts.dob.orEmpty(), facts.patientId)
        when (val identity = repository.resolvePatientIdentity(patientInfo, facts.serial, facts.manufacturer)) {
            is KardiSynchRepository.IdentityResolution.ExactMatch -> importPartial(sessionId, p, identity.patientId, bundleId, tally)
            is KardiSynchRepository.IdentityResolution.Adopted -> importPartial(sessionId, p, identity.patientId, bundleId, tally)
            is KardiSynchRepository.IdentityResolution.PendingReview ->
                stage(sessionId, p, identity.note, identity.suggestedPatientId, identity.suggestedPatientName, bundleId, tally)
            KardiSynchRepository.IdentityResolution.NoMatch ->
                stage(sessionId, p, "This PDF alone does not match a patient on file, and a PDF is not enough to create one. Confirm the patient, or create a new one.", null, null, bundleId, tally)
        }
    }

    /** Imports a PDF's partial report into an existing patient, using the patient's on-file identity (so "E." never creates a second Erika). */
    private suspend fun importPartial(sessionId: String, p: Prepared, patientId: String, bundleId: String, tally: Tally) {
        val patient = repository.getPatientById(patientId)
        val partial = p.parsed.report
        if (patient == null || partial == null) {
            stage(sessionId, p, "The matched patient could not be loaded.", patientId, null, bundleId, tally)
            return
        }
        val report = partial.copy(patient = PatientInfo(patient.firstName.orEmpty(), patient.lastName, patient.dob, patient.hospitalPatientId))
        repository.importReportForExistingPatient(reader, writer, reportsRootHandle, patientId, report, lock).fold(
            onSuccess = { imported ->
                val stored = storeIncomingFile(p.file, File(imported.visitDirHandle))
                val message = "Imported ${p.file.name} -> ${patient.lastName}, ${patient.firstName.orEmpty()}" + if (imported.reusedExistingVisit) " (merged into existing visit)" else " (from PDF only)"
                repository.logImportEvent(sessionId, nowIso(), p.file.absolutePath, "imported", patientId = imported.patientId, reportId = imported.reportId, message = message)
                repository.clearUnhandledIntakeRows(p.sha)
                record(p.file, p.bytes.size, p.sha, "committed", message, stored?.absolutePath, p.parsed, bundleId, imported.patientId, imported.reportId)
                onEvent(message)
                tally.imported++
            },
            onFailure = { e ->
                val moved = moveUnique(p.file, unmatchedDir)
                val message = "Import failed for ${p.file.name}: ${e.message}"
                onEvent(message)
                repository.logImportEvent(sessionId, nowIso(), p.file.absolutePath, "error", message = message)
                repository.clearUnhandledIntakeRows(p.sha)
                record(p.file, p.bytes.size, p.sha, "error", message, moved?.absolutePath, p.parsed, bundleId)
                tally.errors++
            },
        )
    }

    private suspend fun attach(sessionId: String, p: Prepared, visitDir: File, patientId: String, reportId: String, target: String, bundleId: String, tally: Tally) {
        try {
            val stored = storeIncomingFile(p.file, visitDir)
            val message = "Attached ${p.file.name} to $target."
            repository.logImportEvent(sessionId, nowIso(), p.file.absolutePath, "attached", patientId = patientId, reportId = reportId, message = message)
            repository.clearUnhandledIntakeRows(p.sha)
            record(p.file, p.bytes.size, p.sha, "attached", message, stored?.absolutePath, p.parsed, bundleId, patientId, reportId)
            onEvent(message)
            tally.attached++
        } catch (e: Exception) {
            val moved = moveUnique(p.file, unmatchedDir)
            val message = "Failed to attach ${p.file.name} to its matching visit: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), p.file.absolutePath, "error", message = message)
            repository.clearUnhandledIntakeRows(p.sha)
            record(p.file, p.bytes.size, p.sha, "error", message, moved?.absolutePath, p.parsed, bundleId)
            tally.errors++
        }
    }

    private suspend fun stage(sessionId: String, p: Prepared, note: String, suggestedId: String?, suggestedName: String?, bundleId: String, tally: Tally) {
        when (stageOutcome(sessionId, p, note, suggestedId, suggestedName, bundleId)) {
            FileOutcome.PendingSort -> tally.pendingSort++
            FileOutcome.Skipped -> Unit // already handled by an earlier pass: nothing new, and not an error
            else -> tally.errors++
        }
    }

    /** Moves the file into `_pending_sort` and queues it with its bundle and evidence instead of importing it. */
    private suspend fun stageOutcome(sessionId: String, p: Prepared, note: String, suggestedId: String?, suggestedName: String?, bundleId: String): FileOutcome {
        val file = p.file
        val facts = p.parsed.facts
        var stagedFile: File? = null
        return try {
            pendingSortDir.mkdirs()
            val target = File(pendingSortDir, "${UUID.randomUUID()}_${file.name}")
            moveFileReliably(file, target)
            stagedFile = target
            repository.createPendingSortTask(
                createdAt = nowIso(), sessionId = sessionId, stagedFilePath = stagedFile.absolutePath, originalFileName = file.name,
                suggestedPatientId = suggestedId, suggestedPatientName = suggestedName, note = note,
                manufacturer = facts.manufacturer, deviceModel = facts.model, deviceSerial = facts.serial, interrogationDate = facts.interrogation,
                bundleId = bundleId, fileKind = p.parsed.identification.kind.name, confidence = p.parsed.identification.confidence,
                evidence = formatEvidence(p.parsed.identification.evidence),
                patientLastName = facts.lastName, patientFirstName = facts.firstName, patientDob = facts.dob,
            )
            val message = "Queued ${file.name} for manual sort: $note"
            repository.logImportEvent(sessionId, nowIso(), stagedFile.absolutePath, "pending_sort", message = message)
            repository.clearUnhandledIntakeRows(p.sha)
            record(file, p.bytes.size, p.sha, "pending", note, stagedFile.absolutePath, p.parsed, bundleId)
            onEvent(message)
            FileOutcome.PendingSort
        } catch (e: Exception) {
            // The file is gone from the import folder and something else already has its content: an earlier pass
            // (or a second watcher) queued or imported it between our scan and this move. Nothing is lost.
            if (stagedFile == null && !file.exists()) {
                val waiting = repository.findPendingIntakeFileBySha(p.sha) != null
                if (waiting || repository.findHandledIntakeFileBySha(p.sha) != null) {
                    onEvent("${file.name} was already handled by an earlier pass.")
                    return if (waiting) FileOutcome.PendingSort else FileOutcome.Skipped
                }
            }
            // The move worked but recording the task did not: put the file back, so it is not stranded in
            // _pending_sort with no Inbox row, and the next pass can try again.
            val staged = stagedFile
            if (staged != null && staged.exists() && !file.exists()) runCatching { moveFileReliably(staged, file) }
            val moved = if (file.exists()) moveUnique(file, unmatchedDir) else null
            val message = "Failed to queue ${file.name} for manual sort: ${e.javaClass.simpleName}: ${e.message}"
            onEvent(message)
            repository.logImportEvent(sessionId, nowIso(), file.absolutePath, "error", message = message)
            record(file, p.bytes.size, p.sha, "error", message, moved?.absolutePath, p.parsed, bundleId)
            FileOutcome.Failed
        }
    }

    private suspend fun locateVisitDir(patientId: String, reportId: String): File? {
        val patientDir = repository.findPatientDirectoryHandle(reader, reportsRootHandle, patientId) ?: return null
        return File(patientDir).listFiles { f -> f.isDirectory && f.name.endsWith(reportId) }?.firstOrNull()
    }

    private fun sourceLabel(file: File): String {
        val rel = runCatching { file.parentFile.relativeTo(importDir).path }.getOrDefault("")
        return if (rel.isEmpty()) "Import folder" else "Import folder/$rel"
    }

    private suspend fun record(
        file: File, size: Int, sha: String, state: String, message: String?, stored: String?, parsed: ParsedIntake?, bundleId: String?,
        patientId: String? = null, reportId: String? = null,
    ) {
        repository.recordIntakeFile(
            sha256 = sha, fileName = file.name, originalPath = file.absolutePath, storedPath = stored, sourceLabel = sourceLabel(file),
            sizeBytes = size.toLong(), seenAt = nowIso(), state = state, fileKind = parsed?.identification?.kind?.name,
            manufacturer = parsed?.identification?.manufacturer, confidence = parsed?.identification?.confidence,
            evidence = parsed?.identification?.evidence?.let(::formatEvidence), bundleId = bundleId, patientId = patientId, reportId = reportId, message = message,
        )
    }

    /** Moves [file] into [dir] under a collision-free name (never overwrites another file). */
    private fun moveUnique(file: File, dir: File): File? = try {
        dir.mkdirs()
        val dest = collisionFreeName(dir, file.name)
        moveFileReliably(file, dest)
        dest
    } catch (e: Exception) {
        onEvent("Failed to move ${file.name} to ${dir.name}: ${e.message}")
        null
    }
}

private fun nowIso(): String = Instant.now().toString()

/**
 * Moves [src] to [dest] and survives the short-lived failures of a busy file system: on Windows another process
 * (antivirus, a sync client, the programmer software still finishing its export, a share that blips) can hold the
 * file for a moment, which made a plain move fail now and then. Retries with a growing pause, then falls back to
 * copy + delete. A source that has vanished is rethrown at once (nothing to retry). Never leaves two copies behind.
 */
internal fun moveFileReliably(src: File, dest: File, attempts: Int = 4, pauseMs: Long = 200) {
    var last: Exception? = null
    for (attempt in 1..attempts) {
        try {
            Files.move(src.toPath(), dest.toPath())
            return
        } catch (e: java.nio.file.NoSuchFileException) {
            throw e
        } catch (e: Exception) {
            last = e
            if (attempt < attempts) Thread.sleep(pauseMs * attempt)
        }
    }
    try {
        Files.copy(src.toPath(), dest.toPath())
        try {
            Files.delete(src.toPath())
        } catch (e: Exception) {
            Files.deleteIfExists(dest.toPath()) // still locked: do not leave a second copy behind
            throw e
        }
    } catch (e: Exception) {
        if (last != null && last !== e) e.addSuppressed(last)
        throw e
    }
}

/**
 * [dispatchParse] can't handle `.pkg` itself (it needs `java.util.zip`,
 * unreachable from `core`'s commonMain) — [parseMedtronicPkg] is this
 * desktop layer's own equivalent for that one extension (issue #170).
 * Shared between [ImportWatcher] and [resolvePendingSortTask] (which
 * re-parses a staged file rather than persisting the full parsed report
 * while it sits in the queue).
 */
private fun dispatchParseFileIncludingPkg(fileName: String, bytes: ByteArray): UnifiedReport? =
    parseForIntake(fileName, bytes).report

/**
 * The report to store for a queued file. Normally what the parsers read. A PDF with nothing readable in it (a scan,
 * or a layout the text heuristics do not know) used to fail here with "no longer parses", so it could be queued but
 * never assigned. For such a PDF the person has already chosen the patient, so a bare visit is built from what the
 * queue recorded about the file (manufacturer, model, serial, date), falling back to the day the file was written.
 */
internal fun reportForStagedFile(task: PendingSortTasks, stagedFile: File, bytes: ByteArray): UnifiedReport? {
    dispatchParseFileIncludingPkg(task.originalFileName, bytes)?.let { return it }
    if (!bytes.decodeToString(0, minOf(bytes.size, 5)).startsWith("%PDF")) return null
    val written = Instant.ofEpochMilli(minOf(stagedFile.lastModified(), System.currentTimeMillis())).toString().take(10)
    val day = task.interrogationDate?.take(10)?.takeIf { it.length == 10 } ?: written
    return UnifiedReport(
        manufacturer = task.manufacturer?.takeIf { it.isNotBlank() } ?: "Unknown",
        interrogationDate = day,
        patient = PatientInfo("Unknown", "Unknown", "", null),
        device = DeviceInfo(type = "Unknown", model = task.deviceModel?.takeIf { it.isNotBlank() } ?: "Unknown", serialNumber = task.deviceSerial?.takeIf { it.isNotBlank() } ?: "Unknown"),
        parseStatus = io.github.alexanderlanganke.kardisynch.core.model.ParseStatus.PARTIAL,
    )
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

    val parsed = reportForStagedFile(task, stagedFile, stagedFile.readBytes())
        ?: return Result.failure(IllegalStateException("${task.originalFileName} could not be read as a device file, so it cannot be filed automatically. Use \"Manual entry\" in the file sorter to type in the device details."))
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
            repository.resolvePendingIntakeRow(task.stagedFilePath, "committed", "Assigned manually", imported.patientId, imported.reportId)
            Result.success(Unit)
        },
        onFailure = { Result.failure(it) },
    )
}

/**
 * Resolves a pending-sort task by creating a brand-new patient from
 * manually-entered demographics rather than picking an existing one —
 * Electron's `PatientAssignmentModal.tsx` "Create New" tab (parity plan
 * Phase 10). Still requires the staged file to parse (unlike
 * [resolvePendingSortTaskManually] below) — [KardiSynchRepository.importReport]
 * already finds-or-creates a patient by name+DOB on its own, so this is
 * really just [resolvePendingSortTask] with caller-supplied identity
 * instead of an existing patient's.
 */
suspend fun resolvePendingSortTaskAsNewPatient(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    taskId: String,
    firstName: String,
    lastName: String,
    dob: String,
    hospitalPatientId: String?,
    lock: DirectoryLock = NoOpDirectoryLock,
): Result<Unit> {
    val task = repository.getPendingSortTask(taskId) ?: return Result.failure(IllegalStateException("Pending sort task $taskId not found"))
    val stagedFile = File(task.stagedFilePath)
    if (!stagedFile.isFile) return Result.failure(IllegalStateException("Staged file for task $taskId is missing: ${task.stagedFilePath}"))

    val parsed = reportForStagedFile(task, stagedFile, stagedFile.readBytes())
        ?: return Result.failure(IllegalStateException("${task.originalFileName} could not be read as a device file, so it cannot be filed automatically. Use \"Manual entry\" in the file sorter to type in the device details."))
    val report = parsed.copy(patient = PatientInfo(firstName, lastName, dob, hospitalPatientId))

    return repository.importReport(reader, writer, reportsRootHandle, report, lock = lock).fold(
        onSuccess = { imported ->
            storeIncomingFile(stagedFile, File(imported.visitDirHandle))
            repository.deletePendingSortTask(taskId)
            repository.resolvePendingIntakeRow(task.stagedFilePath, "committed", "Assigned manually", imported.patientId, imported.reportId)
            Result.success(Unit)
        },
        onFailure = { Result.failure(it) },
    )
}

/**
 * Resolves a pending-sort task with entirely manually-typed device/lead
 * identity rather than the auto-parser's output — Electron's
 * `DeviceSelectionModal.tsx` (parity plan Phase 10), the escape hatch for a
 * file the parser can't read at all (unlike [resolvePendingSortTask]/
 * [resolvePendingSortTaskAsNewPatient], this doesn't require
 * [dispatchParseFileIncludingPkg] to succeed). No lead data — the manual
 * form only captures device identity, matching the original's own scope.
 */
suspend fun resolvePendingSortTaskManually(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    taskId: String,
    targetPatientId: String,
    manufacturer: String,
    deviceType: String,
    deviceModel: String,
    deviceSerial: String,
    interrogationDate: String,
    lock: DirectoryLock = NoOpDirectoryLock,
): Result<Unit> {
    val task = repository.getPendingSortTask(taskId) ?: return Result.failure(IllegalStateException("Pending sort task $taskId not found"))
    val stagedFile = File(task.stagedFilePath)
    if (!stagedFile.isFile) return Result.failure(IllegalStateException("Staged file for task $taskId is missing: ${task.stagedFilePath}"))
    val patient = repository.getPatientById(targetPatientId)
        ?: return Result.failure(IllegalStateException("Target patient $targetPatientId not found"))

    val report = UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = interrogationDate,
        patient = PatientInfo(patient.firstName.orEmpty(), patient.lastName, patient.dob, patient.hospitalPatientId),
        device = DeviceInfo(deviceType, deviceModel, deviceSerial),
    )

    return repository.importReportForExistingPatient(reader, writer, reportsRootHandle, targetPatientId, report, lock).fold(
        onSuccess = { imported ->
            storeIncomingFile(stagedFile, File(imported.visitDirHandle))
            repository.deletePendingSortTask(taskId)
            repository.resolvePendingIntakeRow(task.stagedFilePath, "committed", "Assigned manually", imported.patientId, imported.reportId)
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
        repository.resolvePendingIntakeRow(task.stagedFilePath, "ignored", "Dismissed")
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }
}

/**
 * Resolves every queued file of one interrogation (a bundle) onto
 * [targetPatientId] in one go: structured files first, so the PDFs that
 * belong with them merge into the same visit instead of each starting its own.
 * Returns the failures (empty on full success); files that did work stay
 * resolved even if a sibling fails.
 */
suspend fun resolvePendingBundle(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    bundleId: String,
    targetPatientId: String,
    lock: DirectoryLock = NoOpDirectoryLock,
): List<Throwable> {
    val tasks = repository.getPendingSortTasksForBundle(bundleId)
        .sortedBy { it.fileKind == FileKind.DEVICE_PDF.name }
    return tasks.mapNotNull { task ->
        resolvePendingSortTask(repository, reader, writer, reportsRootHandle, task.id, targetPatientId, lock).exceptionOrNull()
    }
}

/**
 * Resolves chosen queued files, each onto its own patient (a bundle may hold
 * files of different people). Structured files go first, so a PDF merges into
 * the visit of the structured file that was assigned to the same patient.
 */
suspend fun resolvePendingFiles(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    assignments: List<Pair<String, String>>,
    lock: DirectoryLock = NoOpDirectoryLock,
): List<Throwable> {
    val kinds = repository.getPendingSortTasks().associate { it.id to it.fileKind }
    return assignments.sortedBy { (taskId, _) -> kinds[taskId] == FileKind.DEVICE_PDF.name }.mapNotNull { (taskId, patientId) ->
        resolvePendingSortTask(repository, reader, writer, reportsRootHandle, taskId, patientId, lock).exceptionOrNull()
    }
}

/**
 * Files the chosen queued files under ONE brand-new patient built from [firstName]/[lastName]/[dob]
 * (the form is pre-filled from what the files say). Structured files go first so a PDF merges into the
 * visit of the file it belongs with; every file uses the same identity, so the first one creates the
 * patient and the others find it. Returns the failures (empty on full success); files that did work
 * stay resolved even if a sibling fails.
 */
suspend fun resolvePendingFilesAsNewPatient(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    taskIds: List<String>,
    firstName: String,
    lastName: String,
    dob: String,
    hospitalPatientId: String?,
    lock: DirectoryLock = NoOpDirectoryLock,
): List<Throwable> {
    val kinds = repository.getPendingSortTasks().associate { it.id to it.fileKind }
    return taskIds.sortedBy { kinds[it] == FileKind.DEVICE_PDF.name }.mapNotNull { taskId ->
        resolvePendingSortTaskAsNewPatient(repository, reader, writer, reportsRootHandle, taskId, firstName, lastName, dob, hospitalPatientId, lock).exceptionOrNull()
    }
}

/** Dismisses every queued file of a bundle (moved to `_unmatched`, never deleted). */
suspend fun dismissPendingBundle(repository: KardiSynchRepository, importDir: File, bundleId: String): List<Throwable> =
    repository.getPendingSortTasksForBundle(bundleId).mapNotNull { dismissPendingSortTask(repository, importDir, it.id).exceptionOrNull() }

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
