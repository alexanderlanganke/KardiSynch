package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.matching.patientIdForDir
import io.github.alexanderlanganke.kardisynch.core.matching.reportIdFromDirName
import io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse
import io.github.alexanderlanganke.kardisynch.core.reparse.aggregateReports
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import kotlinx.coroutines.flow.first
import java.io.File

data class ReparseFailure(val patientDir: String, val visitDir: String, val error: String)

data class ReparseSummary(
    val visitsTotal: Int,
    val visitsSucceeded: Int,
    val visitsEmpty: Int,
    val visitsFailed: Int,
    val failures: List<ReparseFailure>,
) {
    fun message(): String =
        "Reparsed $visitsTotal visit${if (visitsTotal == 1) "" else "s"}: $visitsSucceeded updated, $visitsEmpty empty, $visitsFailed failed."
}

/**
 * Walks every patient/visit directory under [reportsRootHandle] and
 * re-parses each visit's still-stored raw files with the CURRENT parser
 * logic — a Kotlin port of Electron's `reparseEverything`/
 * `rescanVisitDirectory` (issue #188), letting a retroactive parser fix
 * reach a visit that was imported before the fix shipped, without needing
 * the source files re-dropped into `_IMPORT`.
 *
 * Fails soft per visit, mirroring the original: one bad directory (a
 * missing raw file, an unreadable `visit.xml`, an unresolvable report ID)
 * doesn't abort the rest of the run — it's counted and reported instead.
 * Byte-level parsing bypasses [DesktopDataRootReader] (text-only — see
 * [DataRootWriter]'s doc comment) in favor of plain [File] reads, same as
 * [ImportWatcher] and `exportVisitFiles`.
 *
 * Not ported from Electron's `reparseEverything`: the `assertNoImportInProgress`
 * guard that blocks this from racing a concurrent `_IMPORT` watcher pass —
 * a real, if narrow, gap (a visit actively being written by [ImportWatcher]
 * could theoretically be read mid-write here). Acceptable for now since
 * both writers go through the same atomic tmp-then-rename [DataRootWriter]
 * primitive, so the worst case is losing this pass's update for that one
 * visit, not corrupting `visit.xml`.
 */
suspend fun reparseAllVisits(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    reportsRootHandle: String,
    onProgress: ((current: Int, total: Int) -> Unit)? = null,
): ReparseSummary {
    val reportsDir = File(reportsRootHandle)
    val patientDirs = reportsDir.listFiles { f -> f.isDirectory }?.toList() ?: emptyList()
    val knownPatientIds = repository.observePatients().first().map { it.id }

    val visits = patientDirs.flatMap { patientDir ->
        (patientDir.listFiles { f -> f.isDirectory }?.toList() ?: emptyList()).map { visitDir -> patientDir to visitDir }
    }

    var succeeded = 0
    var empty = 0
    var failed = 0
    val failures = mutableListOf<ReparseFailure>()

    visits.forEachIndexed { index, (patientDir, visitDir) ->
        onProgress?.invoke(index + 1, visits.size)
        try {
            val updated = reparseVisitDirectory(repository, reader, writer, patientDir, visitDir, knownPatientIds)
            if (updated) succeeded++ else empty++
        } catch (e: Exception) {
            failed++
            failures += ReparseFailure(patientDir.name, visitDir.name, e.message ?: e.toString())
        }
    }

    return ReparseSummary(visits.size, succeeded, empty, failed, failures)
}

/** Returns true if [visitDir] had parseable raw files (and was updated), false if it was empty — a no-op, not a failure. Throws on a genuine error. */
private suspend fun reparseVisitDirectory(
    repository: KardiSynchRepository,
    reader: DesktopDataRootReader,
    writer: DesktopDataRootWriter,
    patientDir: File,
    visitDir: File,
    knownPatientIds: List<String>,
): Boolean {
    val rawFiles = visitDir.listFiles { f -> f.isFile && f.name != "visit.xml" && f.name != "patient.xml" && !f.name.startsWith(".") }
        ?: throw IllegalStateException("Cannot list ${visitDir.absolutePath}")

    val parsed = rawFiles.mapNotNull { file ->
        try {
            dispatchParse(file.name, file.readBytes())
        } catch (e: Exception) {
            null
        }
    }
    val aggregated = aggregateReports(parsed, visitDir.name) ?: return false

    val patientId = patientIdForDir(patientDir.name, knownPatientIds)
        ?: throw IllegalStateException("Could not resolve a known patient for directory ${patientDir.name}")
    val reportId = reportIdFromDirName(visitDir.name) ?: readReportIdFromVisitXml(visitDir)
        ?: throw IllegalStateException("Could not determine a report ID for ${visitDir.name}")

    repository.reparseVisit(reader, writer, patientId, visitDir.absolutePath, reportId, aggregated).getOrThrow()
    return true
}

private fun readReportIdFromVisitXml(visitDir: File): String? {
    val visitXml = File(visitDir, "visit.xml")
    if (!visitXml.isFile) return null
    return Regex("""<report_id>([^<]+)</report_id>""").find(visitXml.readText())?.groupValues?.get(1)?.takeIf { it.isNotBlank() }
}
