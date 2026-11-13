package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.intake.FileKind
import io.github.alexanderlanganke.kardisynch.core.matching.ReportMatchCandidate
import io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
import io.github.alexanderlanganke.kardisynch.data.storeIncomingFile
import kotlinx.coroutines.flow.first
import java.io.File
import java.time.Instant

/**
 * Attaches every PDF waiting in Pending Sort to the visit it provably belongs to. It is the single place that
 * answers "does a waiting PDF match a visit that is on file now?", and it is called whenever such a visit may
 * have appeared: after a data file is committed by the watcher, after a person assigns a queued file, and on
 * every watcher pass (so a late or missed trigger is caught).
 *
 * Strictness is the same as for a PDF arriving after its data file ([ImportWatcher.processPdfAlone]); a PDF
 * with nothing readable in it is never matched here, because there is nothing to prove a match with:
 *  1. The PDF names a device serial and an interrogation day: it joins the same-day visit of that serial
 *     (same-session rule of `pickSameDayReport`, and never across a serial conflict).
 *  2. The PDF names no serial but a full identity (last name, first name, date of birth, all exactly equal,
 *     ignoring case) and a day: it joins that patient's visit of that day, only when there is exactly one.
 */
internal suspend fun attachWaitingPdfs(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    reportsRootHandle: String,
    sessionId: String?,
    onEvent: (String) -> Unit = {},
): Int {
    val waiting = repository.getPendingSortTasks().filter { it.fileKind == FileKind.DEVICE_PDF.name }
    var attached = 0
    for (task in waiting) {
        val staged = File(task.stagedFilePath)
        if (!staged.isFile) continue
        try {
            val target = findVisitForWaitingPdf(repository, task) ?: continue
            val patientDir = repository.findPatientDirectoryHandle(reader, reportsRootHandle, target.patientId) ?: continue
            val visitDir = File(patientDir).listFiles { f -> f.isDirectory && f.name.endsWith(target.reportId) }?.firstOrNull() ?: continue
            storeIncomingFile(staged, visitDir)
            repository.deletePendingSortTask(task.id)
            repository.resolvePendingIntakeRow(task.stagedFilePath, "attached", "Attached automatically when its data file arrived", target.patientId, target.reportId)
            val message = "Attached ${task.originalFileName} to the visit ${target.how} (it had arrived first)."
            onEvent(message)
            if (sessionId != null) {
                repository.logImportEvent(sessionId, Instant.now().toString(), task.stagedFilePath, "attached", patientId = target.patientId, reportId = target.reportId, message = message)
            }
            attached++
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            onEvent("Could not attach the waiting ${task.originalFileName}: ${e.message}")
        }
    }
    return attached
}

internal data class WaitingPdfTarget(val patientId: String, val reportId: String, val how: String)

internal suspend fun findVisitForWaitingPdf(repository: KardiSynchRepository, task: PendingSortTasks): WaitingPdfTarget? {
    val interrogation = task.interrogationDate?.takeIf { it.take(10).length == 10 } ?: return null
    val day = interrogation.take(10)
    val serial = task.deviceSerial?.takeIf { it.isNotBlank() && it != "Unknown" }

    if (serial != null) {
        val candidates = repository.getReportsByDeviceSerial(serial).filter { it.interrogationDate.take(10) == day }
        val match = pickSameDayReport(candidates.map { ReportMatchCandidate(it.id, it.interrogationDate, it.deviceSerialNumber) }, interrogation, serial, explicitNewVisit = false)
        val report = candidates.firstOrNull { it.id == match?.id } ?: return null
        return WaitingPdfTarget(report.patientId, report.id, "imported for device $serial")
    }

    val last = task.patientLastName?.takeIf { it.isNotBlank() && it != "Unknown" } ?: return null
    val first = task.patientFirstName?.takeIf { it.isNotBlank() } ?: return null
    val dob = task.patientDob?.takeIf { it.isNotBlank() } ?: return null
    val identity = repository.resolvePatientIdentity(PatientInfo(first, last, dob), null, task.manufacturer)
    val patientId = (identity as? KardiSynchRepository.IdentityResolution.ExactMatch)?.patientId ?: return null
    if (!repository.getPatientById(patientId)?.firstName.orEmpty().equals(first, ignoreCase = true)) return null
    val sameDay = repository.observeReportsForPatient(patientId).first().filter { it.interrogationDate.take(10) == day }
    val report = sameDay.singleOrNull() ?: return null
    return WaitingPdfTarget(patientId, report.id, "of $day for this patient")
}
