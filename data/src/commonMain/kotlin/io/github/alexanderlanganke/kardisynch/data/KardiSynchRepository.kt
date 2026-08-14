package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import app.cash.sqldelight.db.SqlDriver
import io.github.alexanderlanganke.kardisynch.core.aliases.AliasKind
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.LeadAliasAttrs
import io.github.alexanderlanganke.kardisynch.core.aliases.encodeDeviceTypeAliasesXml
import io.github.alexanderlanganke.kardisynch.core.aliases.lookupDeviceAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.parseDeviceTypeAliasesXml
import io.github.alexanderlanganke.kardisynch.core.aliases.removeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.seedDeviceTypeAliases
import io.github.alexanderlanganke.kardisynch.core.aliases.upsertDeviceAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.upsertLeadAlias
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootIndexer
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter
import io.github.alexanderlanganke.kardisynch.core.datastore.IndexedReport
import io.github.alexanderlanganke.kardisynch.core.datastore.generatePatientXml
import io.github.alexanderlanganke.kardisynch.core.datastore.generateVisitXml
import io.github.alexanderlanganke.kardisynch.core.datastore.parseVisitXml
import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.matching.PatientDupGroup
import io.github.alexanderlanganke.kardisynch.core.matching.PatientSummary
import io.github.alexanderlanganke.kardisynch.core.matching.ReportMatchCandidate
import io.github.alexanderlanganke.kardisynch.core.matching.findDuplicatePatientGroups
import io.github.alexanderlanganke.kardisynch.core.matching.mergeReports
import io.github.alexanderlanganke.kardisynch.core.matching.patientIdForDir
import io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport
import io.github.alexanderlanganke.kardisynch.core.matching.reportIdFromDirName
import io.github.alexanderlanganke.kardisynch.core.matching.visitDatePrefix
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpImport
import io.github.alexanderlanganke.kardisynch.core.util.visitDirDateString
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.ImportEvents
import io.github.alexanderlanganke.kardisynch.data.db.ImportSessions
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Resolves the `_DATA/Reports` subdirectory's handle from the picked
 * `_DATA` root. Desktop paths could just be string-concatenated directly,
 * but SAF document URIs (Android) can't be — this is the one shared way
 * every platform locates it, kept symmetric rather than giving desktop a
 * shortcut the other platforms can't take. Null if "Reports" doesn't exist
 * under the picked root yet (treated as "nothing to index yet", not an
 * error, by callers).
 */
fun resolveReportsRootHandle(reader: DataRootReader, dataRootHandle: String): String? =
    reader.listChildren(dataRootHandle).firstOrNull { it.isDirectory && it.name == "Reports" }?.handle

private const val DEVICE_TYPES_FILE_NAME = "device_types.xml"

/**
 * Local, per-device query/write layer over the SQLDelight-generated
 * `KardiSynchDatabase` — the index every client (desktop, Android) rebuilds
 * from the shared `_DATA` root, never the shared store itself (see
 * [DatabaseDriverFactory]'s doc comment).
 */
class KardiSynchRepository(
    driver: SqlDriver,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    private val db = KardiSynchDatabase(driver)

    fun observePatients(): Flow<List<Patients>> =
        db.patientsQueries.selectAllPatients().asFlow().mapToList(ioDispatcher)

    fun observeReportsForPatient(patientId: String): Flow<List<Reports>> =
        db.reportsQueries.selectReportsByPatientId(patientId).asFlow().mapToList(ioDispatcher)

    suspend fun getPatientById(patientId: String): Patients? = withContext(ioDispatcher) {
        db.patientsQueries.selectPatientById(patientId).executeAsOneOrNull()
    }

    suspend fun getDevicesForReport(reportId: String): List<Devices> = withContext(ioDispatcher) {
        db.devicesQueries.selectDevicesByReportId(reportId).executeAsList()
    }

    suspend fun getLeadsForReport(reportId: String): List<Leads> = withContext(ioDispatcher) {
        db.leadsQueries.selectLeadsByReportId(reportId).executeAsList()
    }

    /**
     * The most recent report's device/leads for a patient — "current
     * devices/leads" is a query against the latest report's rows rather than
     * a separately-maintained deduplicated table (migration plan Decision 3).
     */
    suspend fun getLatestDeviceForPatient(patientId: String): Devices? = withContext(ioDispatcher) {
        db.devicesQueries.selectLatestDeviceForPatient(patientId).executeAsOneOrNull()
    }

    suspend fun getSetting(key: String): String? = withContext(ioDispatcher) {
        db.settingsQueries.getSetting(key).executeAsOneOrNull()?.value_
    }

    suspend fun setSetting(key: String, value: String) = withContext(ioDispatcher) {
        db.settingsQueries.setSetting(key, value)
    }

    /**
     * Import session/event audit trail (issue #174) — mirrors Electron's
     * `createImportSession`/`updateImportSessionStatus`/`logImportEvent`/
     * `getImportHistory`/`getImportSessionEvents`. [timestamp] is a caller-
     * supplied ISO-8601 string rather than read from a clock, matching the
     * "core/data has no platform clock" pattern used elsewhere (e.g.
     * `buildFollowUpQrPayload`'s `nowEpochSeconds`).
     *
     * `summary` is a plain human-readable string here, not the structured
     * JSON blob the TS original stores — there's no UI consuming it yet to
     * justify a rigid schema; upgrade to JSON if/when one needs to parse it
     * rather than just display it (issue #178).
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun createImportSession(timestamp: String): String = withContext(ioDispatcher) {
        val id = Uuid.random().toString()
        db.importSessionsQueries.insertImportSession(id, timestamp, "running", null)
        id
    }

    suspend fun updateImportSessionStatus(sessionId: String, status: String, summary: String?) = withContext(ioDispatcher) {
        db.importSessionsQueries.updateImportSessionStatus(status, summary, sessionId)
    }

    @OptIn(ExperimentalUuidApi::class)
    suspend fun logImportEvent(
        sessionId: String,
        timestamp: String,
        filePath: String,
        status: String,
        patientId: String? = null,
        reportId: String? = null,
        message: String? = null,
    ) = withContext(ioDispatcher) {
        db.importEventsQueries.insertImportEvent(Uuid.random().toString(), sessionId, timestamp, filePath, status, patientId, reportId, message, null)
    }

    suspend fun getImportHistory(limit: Long = 50): List<ImportSessions> = withContext(ioDispatcher) {
        db.importSessionsQueries.selectRecentImportSessions(limit).executeAsList()
    }

    suspend fun getImportSessionEvents(sessionId: String): List<ImportEvents> = withContext(ioDispatcher) {
        db.importEventsQueries.selectImportEventsBySession(sessionId).executeAsList()
    }

    /**
     * Persistent `(manufacturer, model)` -> device type / lead connector map
     * (issue #184), a Kotlin port of Electron's `deviceTypeAliases.ts`. Lives
     * in `device_types.xml` at the `_DATA` root (a sibling of `Reports`, so
     * callers pass [dataRootHandle] here, not `reportsRootHandle`) — shared
     * across every workstation pointed at the same folder.
     *
     * Deliberately backend-only for now: there's no Settings screen to
     * browse/edit the store yet (issue #178's territory — this is reference
     * data a clinician would edit through a form, same as the interactive
     * "device ambiguity" dialog `watcher.ts` shows during import, which also
     * isn't ported). What *is* ported and wired up is the auto-resolve path
     * ([resolveDeviceTypeFromAlias], called from [ImportWatcher] on every
     * import) and the seed data ([seedDeviceTypeAliasesIfNeeded]).
     */
    suspend fun listDeviceTypeAliases(reader: DataRootReader, dataRootHandle: String): List<DeviceTypeAlias> = withContext(ioDispatcher) {
        readDeviceTypeAliasesFile(reader, dataRootHandle)
    }

    suspend fun upsertDeviceTypeAlias(
        reader: DataRootReader,
        writer: DataRootWriter,
        dataRootHandle: String,
        manufacturer: String,
        model: String,
        type: String,
        nowIso: String,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val aliases = readDeviceTypeAliasesFile(reader, dataRootHandle)
            val next = upsertDeviceAlias(aliases, manufacturer, model, type, nowIso)
            if (!writeDeviceTypeAliasesFile(writer, dataRootHandle, next)) {
                return@withContext Result.failure(IllegalStateException("Failed to write device_types.xml"))
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun upsertLeadTypeAlias(
        reader: DataRootReader,
        writer: DataRootWriter,
        dataRootHandle: String,
        manufacturer: String,
        model: String,
        attrs: LeadAliasAttrs,
        nowIso: String,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val aliases = readDeviceTypeAliasesFile(reader, dataRootHandle)
            val next = upsertLeadAlias(aliases, manufacturer, model, attrs, nowIso)
            if (!writeDeviceTypeAliasesFile(writer, dataRootHandle, next)) {
                return@withContext Result.failure(IllegalStateException("Failed to write device_types.xml"))
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteDeviceTypeAlias(
        reader: DataRootReader,
        writer: DataRootWriter,
        dataRootHandle: String,
        manufacturer: String,
        model: String,
        kind: AliasKind = AliasKind.DEVICE,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val aliases = readDeviceTypeAliasesFile(reader, dataRootHandle)
            val next = removeAlias(aliases, manufacturer, model, kind)
            if (next.size == aliases.size) return@withContext Result.success(Unit)
            if (!writeDeviceTypeAliasesFile(writer, dataRootHandle, next)) {
                return@withContext Result.failure(IllegalStateException("Failed to write device_types.xml"))
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Auto-resolves an unknown device type from the shared alias file — mirrors `watcher.ts`'s auto-resolve step (not the interactive dialog that follows it). Returns null if there's no usable manufacturer/model or no match. */
    suspend fun resolveDeviceTypeFromAlias(reader: DataRootReader, dataRootHandle: String, manufacturer: String?, model: String?): String? =
        withContext(ioDispatcher) {
            lookupDeviceAlias(readDeviceTypeAliasesFile(reader, dataRootHandle), manufacturer, model)
        }

    /** Idempotent/additive — safe to call every time the app (re-)points at a `_DATA` root, mirrors Electron's `initializeStorage` call to `seedDeviceTypeAliases`. Returns the number of entries added. */
    suspend fun seedDeviceTypeAliasesIfNeeded(reader: DataRootReader, writer: DataRootWriter, dataRootHandle: String, nowIso: String): Int =
        withContext(ioDispatcher) {
            val existing = readDeviceTypeAliasesFile(reader, dataRootHandle)
            val toAdd = seedDeviceTypeAliases(existing, nowIso)
            if (toAdd.isEmpty()) return@withContext 0
            if (!writeDeviceTypeAliasesFile(writer, dataRootHandle, existing + toAdd)) return@withContext 0
            toAdd.size
        }

    private fun readDeviceTypeAliasesFile(reader: DataRootReader, dataRootHandle: String): List<DeviceTypeAlias> {
        val handle = reader.listChildren(dataRootHandle).firstOrNull { !it.isDirectory && it.name == DEVICE_TYPES_FILE_NAME }?.handle
            ?: return emptyList()
        val xml = reader.readText(handle) ?: return emptyList()
        return parseDeviceTypeAliasesXml(xml)
    }

    private fun writeDeviceTypeAliasesFile(writer: DataRootWriter, dataRootHandle: String, aliases: List<DeviceTypeAlias>): Boolean =
        writer.writeTextFile(dataRootHandle, DEVICE_TYPES_FILE_NAME, encodeDeviceTypeAliasesXml(aliases))

    /**
     * Full rebuild from `_DATA` — the KMP equivalent of Electron's
     * `rebuildDatabase`. Clears the local index and reconstructs it from
     * every `patient.xml`/`visit.xml` under [reportsRootHandle], read via
     * [reader] (desktop: real paths; Android: SAF).
     */
    /**
     * The QR-scan-to-new-visit flow (issue #161's actual payload): finds the
     * scanned patient by last name + DOB in the LOCAL index (best-effort —
     * no serial-based matching, unlike Electron's watcher), creates their
     * `_DATA` directory if new, always creates a brand-new visit directory
     * (never rewrites an existing one — see [DataRootWriter]'s doc comment
     * on why this is safe without the lock-file convention yet), then
     * reindexes so the write is immediately reflected locally too.
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun importFollowUp(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        import: FollowUpImport,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val (_, patientDirHandle) = findOrCreatePatientDir(
                reader, writer, reportsRootHandle,
                import.patientFirstName, import.patientLastName, import.patientDob, hospitalPatientId = null,
            ).getOrElse { return@withContext Result.failure(it) }

            val reportId = Uuid.random().toString()
            val datePart = import.report.interrogationDate.take(10).replace("-", "_").ifEmpty { "Unknown" }
            val visitDirHandle = writer.createDirectory(patientDirHandle, "${datePart}_$reportId")
                ?: return@withContext Result.failure(IllegalStateException("Failed to create visit directory"))
            val visitXml = generateVisitXml(reportId, import.report)
            if (!writer.writeTextFile(visitDirHandle, "visit.xml", visitXml)) {
                return@withContext Result.failure(IllegalStateException("Failed to write visit.xml"))
            }

            reindexFrom(reader, reportsRootHandle)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Finds the patient's `_DATA` directory by exact last-name+DOB match in
     * the local index (issue #139: identity is last name + DOB, not exact
     * first-name spelling), or creates a new patient directory + `patient.xml`
     * if none matches. Shared by [importFollowUp] (QR-scan) and [importReport]
     * (the `_IMPORT` folder watcher's structured-file path).
     */
    @OptIn(ExperimentalUuidApi::class)
    private fun findOrCreatePatientDir(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        firstName: String,
        lastName: String,
        dob: String,
        hospitalPatientId: String?,
    ): Result<Pair<String, String>> {
        val existing = db.patientsQueries.selectAllPatients().executeAsList().firstOrNull {
            it.lastName.equals(lastName, ignoreCase = true) && it.dob == dob
        }
        if (existing != null) {
            val handle = findPatientDirHandle(reader, reportsRootHandle, existing.id)
                ?: return Result.failure(IllegalStateException("Patient ${existing.id} is indexed locally but its _DATA directory couldn't be found"))
            return Result.success(existing.id to handle)
        }

        val newPatientId = Uuid.random().toString()
        val safeName = (lastName + firstName).filter { it.isLetterOrDigit() }
        val dirName = "${newPatientId}_$safeName"
        val patientDirHandle = writer.createDirectory(reportsRootHandle, dirName)
            ?: return Result.failure(IllegalStateException("Failed to create patient directory"))
        val patientXml = generatePatientXml(newPatientId, firstName, lastName, dob, hospitalPatientId)
        if (!writer.writeTextFile(patientDirHandle, "patient.xml", patientXml)) {
            return Result.failure(IllegalStateException("Failed to write patient.xml"))
        }
        // Mirrors reindexFrom's own patient-insert so the new patient shows up
        // in observePatients() immediately, without waiting on a full rescan
        // (importFollowUp still does one afterward as a belt-and-braces
        // rebuild; importReport does not, so this insert is load-bearing there).
        db.patientsQueries.insertPatient(
            id = newPatientId,
            firstName = firstName,
            lastName = lastName,
            lastNameKey = lastName.trim().lowercase(),
            dob = dob,
            hospitalPatientId = hospitalPatientId,
            mriStatus = null,
            mriDataHash = null,
            manufacturerWarningStatus = null,
            manufacturerWarningHash = null,
            lastIndexedMtime = null,
        )
        return Result.success(newPatientId to patientDirHandle)
    }

    /** Resolves an existing patient's `_DATA` directory handle from their ID, or null if it can't be found. */
    private fun findPatientDirHandle(reader: DataRootReader, reportsRootHandle: String, patientId: String): String? {
        val children = reader.listChildren(reportsRootHandle)
        return children.firstOrNull { it.isDirectory && it.name.startsWith("${patientId}_") }?.handle
            ?: children.firstOrNull { it.isDirectory && it.name.startsWith(patientId) }?.handle
    }

    /**
     * Locks two patient directories for one operation that touches both,
     * always in the same (sorted-by-handle) order regardless of which is
     * "from" and which is "to" — otherwise two concurrent opposite-direction
     * operations (patient A moving a visit to B, patient B moving one to A)
     * could each hold one lock and wait on the other forever.
     */
    private fun <T> DirectoryLock.withTwoLocks(handleA: String, handleB: String, operation: String, block: () -> T): T {
        val (first, second) = if (handleA <= handleB) handleA to handleB else handleB to handleA
        return withLock(first, operation) { withLock(second, operation) { block() } }
    }

    /**
     * Updates a patient's identity fields — mirrors Electron's
     * `updatePatientXML` (the patient-info-editing write path; issue #177).
     * Rewrites `patient.xml` and the local index row.
     */
    suspend fun updatePatientInfo(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        patientId: String,
        firstName: String,
        lastName: String,
        dob: String,
        hospitalPatientId: String?,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $patientId directory not found"))
            lock.withLock(patientDirHandle, "updatePatientInfo:patientId=$patientId") {
                val xml = generatePatientXml(patientId, firstName, lastName, dob, hospitalPatientId)
                if (!writer.writeTextFile(patientDirHandle, "patient.xml", xml)) {
                    return@withLock Result.failure(IllegalStateException("Failed to write patient.xml"))
                }
                db.patientsQueries.updatePatientInfo(firstName, lastName, lastName.trim().lowercase(), dob, hospitalPatientId, patientId)
                Result.success(Unit)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Moves a visit's `_DATA` directory from one patient to another and
     * repoints the local index row — mirrors Electron's `moveReport` (issue
     * #177). Locks both patient directories (see [withTwoLocks]) since the
     * visit is removed from one and added to the other.
     */
    suspend fun moveReport(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        reportId: String,
        fromPatientId: String,
        toPatientId: String,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val fromDir = findPatientDirHandle(reader, reportsRootHandle, fromPatientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $fromPatientId directory not found"))
            val toDir = findPatientDirHandle(reader, reportsRootHandle, toPatientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $toPatientId directory not found"))

            lock.withTwoLocks(fromDir, toDir, "moveReport:reportId=$reportId") {
                val visitDirHandle = reader.listChildren(fromDir).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
                    ?: return@withTwoLocks Result.failure(IllegalStateException("Visit $reportId not found under patient $fromPatientId"))
                if (writer.moveDirectory(visitDirHandle, toDir) == null) {
                    return@withTwoLocks Result.failure(IllegalStateException("Failed to move visit directory"))
                }
                db.reportsQueries.updateReportPatientId(toPatientId, reportId)
                Result.success(Unit)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Deletes a patient's `_DATA` directory entirely — mirrors Electron's
     * `removePatientDirectory` (issue #177), used after a merge has moved
     * all of a patient's visits away. Does not touch the local index row —
     * callers are expected to have already removed it (or run [reindexFrom]
     * afterward).
     */
    suspend fun removePatientDirectory(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        patientId: String,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $patientId directory not found"))
            lock.withLock(patientDirHandle, "removePatientDirectory:patientId=$patientId") {
                if (writer.deleteDirectory(patientDirHandle)) Result.success(Unit)
                else Result.failure(IllegalStateException("Failed to delete patient directory"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Every patient with their report count, last visit date, and distinct device serials — the raw input to [findDuplicatePatientGroups] (issue #187). */
    suspend fun getPatientsWithSerials(): List<PatientSummary> = withContext(ioDispatcher) {
        db.patientsQueries.selectPatientsWithSerials().executeAsList().map { row ->
            PatientSummary(
                id = row.id,
                firstName = row.firstName,
                lastName = row.lastName,
                dob = row.dob,
                hospitalPatientId = row.hospitalPatientId,
                reportCount = row.reportCount.toInt(),
                lastReportDate = row.lastReportDate,
                serials = (row.serials ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() && it != "Unknown" },
            )
        }
    }

    /** Detects probable-duplicate patient records across the local index (issue #187) — see [findDuplicatePatientGroups] for the tier logic. */
    suspend fun findDuplicatePatients(): List<PatientDupGroup> = findDuplicatePatientGroups(getPatientsWithSerials())

    /** The outcome of [mergePatients]. */
    data class MergeResult(val keeperId: String, val patientsDeleted: Int, val reportsMoved: Int, val errors: List<String>)

    /**
     * Merges one or more "loser" patients into [keeperId] — mirrors Electron's
     * `mergePatients` (issue #187): moves every loser's reports to the keeper
     * (via [moveReport]), then deletes each loser's DB row and `_DATA`
     * directory, but ONLY for losers whose every visit verifiably moved — a
     * loser with a failed move keeps its row and directory so no visit is
     * ever deleted unmoved (errors are collected in the result instead).
     *
     * Two steps the TS original does that this doesn't: consolidating device/
     * lead history into the keeper's `patient.xml` (`mergePatientProfiles`,
     * out of scope per migration plan Decision 3 — see [DataRootWriter]'s doc
     * comment) and a post-merge dedup pass for same-date visit collisions the
     * move can create (`runDedupCleanup` — issue #185, not built yet).
     */
    suspend fun mergePatients(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        keeperId: String,
        loserIds: List<String>,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<MergeResult> = withContext(ioDispatcher) {
        val uniqueLosers = loserIds.distinct().filter { it.isNotEmpty() && it != keeperId }
        if (uniqueLosers.isEmpty()) return@withContext Result.failure(IllegalArgumentException("No distinct loser patients to merge into the keeper."))
        if (getPatientById(keeperId) == null) return@withContext Result.failure(IllegalStateException("Keeper patient $keeperId not found."))

        val errors = mutableListOf<String>()
        val losersWithMoveFailures = mutableSetOf<String>()
        var reportsMoved = 0
        var patientsDeleted = 0

        for (loserId in uniqueLosers) {
            val reportIds = try {
                db.reportsQueries.selectReportsByPatientId(loserId).executeAsList().map { it.id }
            } catch (e: Exception) {
                errors += "Failed to list reports for $loserId: ${e.message}"
                losersWithMoveFailures += loserId
                continue
            }
            for (reportId in reportIds) {
                moveReport(reader, writer, reportsRootHandle, reportId, loserId, keeperId, lock).fold(
                    onSuccess = { reportsMoved++ },
                    onFailure = { e ->
                        errors += "Failed to move report $reportId from $loserId: ${e.message}"
                        losersWithMoveFailures += loserId
                    },
                )
            }
        }

        for (loserId in uniqueLosers) {
            if (loserId in losersWithMoveFailures) {
                errors += "Skipped deleting patient $loserId: one or more visits could not be moved to the keeper."
                continue
            }
            db.patientsQueries.deletePatient(loserId)
            removePatientDirectory(reader, writer, reportsRootHandle, loserId, lock).fold(
                onSuccess = { patientsDeleted++ },
                onFailure = { e -> errors += "Failed to delete patient directory for $loserId: ${e.message}" },
            )
        }

        Result.success(MergeResult(keeperId, patientsDeleted, reportsMoved, errors))
    }

    /** A visit directory that physically sits under the wrong patient's `_DATA` folder — see [findOrphanedVisits] (issue #186). */
    data class OrphanVisit(
        val reportId: String,
        val visitDirHandle: String,
        val visitDirName: String,
        val date: String?,
        val currentPatientId: String?,
        val currentPatientDirHandle: String,
        val currentPatientDirName: String,
        val correctPatientId: String,
        val correctPatientDirExists: Boolean,
    )

    /**
     * Scans `_DATA/Reports` for visits whose containing directory doesn't
     * match the local index's own idea of which patient they belong to —
     * ported from `services/orphanService.ts`'s `findOrphanedVisits` (issue
     * #186). A visit's report ID is read from `visit.xml`'s `<report_id>`
     * when present, falling back to stripping the visit directory's own
     * date/`Unknown` prefix. Visits whose report has no local index row are
     * ignored — that's a job for the report/directory deduplicator (#185),
     * not this one.
     */
    suspend fun findOrphanedVisits(reader: DataRootReader, reportsRootHandle: String): List<OrphanVisit> = withContext(ioDispatcher) {
        val patientIds = db.patientsQueries.selectAllPatients().executeAsList().map { it.id }
        val patientDirEntries = reader.listChildren(reportsRootHandle).filter { it.isDirectory }

        val dirsByPatientId = mutableMapOf<String, MutableList<String>>()
        for (entry in patientDirEntries) {
            val owner = patientIdForDir(entry.name, patientIds) ?: continue
            dirsByPatientId.getOrPut(owner) { mutableListOf() }.add(entry.name)
        }

        val orphans = mutableListOf<OrphanVisit>()
        for (patientDirEntry in patientDirEntries) {
            val currentPatientId = patientIdForDir(patientDirEntry.name, patientIds)
            val visitEntries = reader.listChildren(patientDirEntry.handle).filter { it.isDirectory }

            for (visitEntry in visitEntries) {
                val reportIdFromXml = reader.listChildren(visitEntry.handle)
                    .firstOrNull { !it.isDirectory && it.name == "visit.xml" }
                    ?.let { reader.readText(it.handle) }
                    ?.let { parseVisitXml(it, currentPatientId ?: "") }
                    ?.id
                val reportId = reportIdFromXml ?: reportIdFromDirName(visitEntry.name) ?: continue

                val report = db.reportsQueries.selectReportById(reportId).executeAsOneOrNull() ?: continue
                val correctPatientId = report.patientId
                if (correctPatientId == currentPatientId) continue

                orphans += OrphanVisit(
                    reportId = reportId,
                    visitDirHandle = visitEntry.handle,
                    visitDirName = visitEntry.name,
                    date = visitDatePrefix(visitEntry.name) ?: report.interrogationDate.take(10).ifEmpty { null },
                    currentPatientId = currentPatientId,
                    currentPatientDirHandle = patientDirEntry.handle,
                    currentPatientDirName = patientDirEntry.name,
                    correctPatientId = correctPatientId,
                    correctPatientDirExists = dirsByPatientId[correctPatientId]?.isNotEmpty() == true,
                )
            }
        }
        orphans
    }

    /** The outcome of [moveOrphanedVisits]. */
    data class OrphanMoveResult(val moved: Int, val errors: List<String>)

    /**
     * Moves the orphaned visits (see [findOrphanedVisits]) matching [reportIds]
     * into their correct patient directory and repoints the local index row —
     * ported from `services/orphanService.ts`'s `moveOrphanedVisits`. Re-scans
     * first so callers only need to pass report IDs; a stale selection (already
     * fixed elsewhere) is silently skipped rather than failing.
     */
    suspend fun moveOrphanedVisits(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        reportIds: List<String>,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): OrphanMoveResult = withContext(ioDispatcher) {
        val wanted = reportIds.toSet()
        val orphans = findOrphanedVisits(reader, reportsRootHandle).filter { it.reportId in wanted }
        if (orphans.isEmpty()) return@withContext OrphanMoveResult(0, emptyList())

        var moved = 0
        val errors = mutableListOf<String>()
        for (o in orphans) {
            try {
                val destPatientDirHandle = findPatientDirHandle(reader, reportsRootHandle, o.correctPatientId)
                    ?: run {
                        val patient = db.patientsQueries.selectPatientById(o.correctPatientId).executeAsOneOrNull()
                        val safeName = ((patient?.lastName ?: "") + (patient?.firstName ?: "")).filter { it.isLetterOrDigit() }
                        writer.createDirectory(reportsRootHandle, "${o.correctPatientId}_$safeName")
                            ?: throw IllegalStateException("Failed to create destination patient directory")
                    }

                lock.withTwoLocks(o.currentPatientDirHandle, destPatientDirHandle, "moveOrphanedVisit:reportId=${o.reportId}") {
                    var destName = o.visitDirName
                    var suffix = 2
                    while (reader.listChildren(destPatientDirHandle).any { it.isDirectory && it.name == destName }) {
                        destName = "${o.visitDirName}_${suffix++}"
                    }
                    if (writer.moveDirectory(o.visitDirHandle, destPatientDirHandle, destName) == null) {
                        throw IllegalStateException("Failed to move visit directory")
                    }
                    db.reportsQueries.updateReportPatientId(o.correctPatientId, o.reportId)
                }
                moved++
            } catch (e: Exception) {
                errors += "Failed to move visit ${o.visitDirName} (report ${o.reportId}): ${e.message}"
            }
        }
        OrphanMoveResult(moved, errors)
    }

    /** The outcome of [importReport]: where the report ended up, and whether it reused an existing visit. */
    data class ImportedVisit(
        val patientId: String,
        val patientDirHandle: String,
        val reportId: String,
        val visitDirHandle: String,
        val reusedExistingVisit: Boolean,
    )

    /**
     * Writes a parsed [report] into `_DATA`: finds or creates the patient,
     * then either reuses an existing same-day visit ([pickSameDayReport],
     * merging via [mergeReports] so a second file for that visit doesn't
     * blank out what the first one contributed) or creates a new visit
     * directory. Updates the local index for just that one report — callers
     * still own copying the raw source file itself into [ImportedVisit.visitDirHandle]
     * (a desktop-filesystem-specific concern this common method doesn't
     * touch), and any patient.xml device/lead history refresh (out of scope
     * per the KMP migration plan's Decision 3 — see [DataRootWriter]'s doc comment).
     *
     * The whole read-merge-write is wrapped in [lock] (see [DirectoryLock]'s
     * doc comment) — [NoOpDirectoryLock] by default, since patient-directory
     * creation itself is a pure "create" that can't corrupt an existing
     * write (mirroring Electron's own `storeReport`, which doesn't lock
     * patient creation either — only the read-merge-write that follows it).
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun importReport(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        report: UnifiedReport,
        explicitNewVisit: Boolean = false,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<ImportedVisit> = withContext(ioDispatcher) {
        try {
            val patientData = report.patient
            if (patientData.lastName.isBlank() || patientData.dob.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("Cannot store report without patient last name and DOB."))
            }

            val (patientId, patientDirHandle) = findOrCreatePatientDir(
                reader, writer, reportsRootHandle,
                patientData.firstName, patientData.lastName, patientData.dob, patientData.hospitalPatientId,
            ).getOrElse { return@withContext Result.failure(it) }

            lock.withLock(patientDirHandle, "importReport:patient=$patientId") {
                writeVisit(reader, writer, patientId, patientDirHandle, report, explicitNewVisit)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    @OptIn(ExperimentalUuidApi::class)
    private fun writeVisit(
        reader: DataRootReader,
        writer: DataRootWriter,
        patientId: String,
        patientDirHandle: String,
        report: UnifiedReport,
        explicitNewVisit: Boolean,
    ): Result<ImportedVisit> {
        val datePrefix = report.interrogationDate.take(10)
        val sameDayReports = db.reportsQueries.selectReportsByDatePrefix(patientId, datePrefix).executeAsList()
        val candidates = sameDayReports.map { ReportMatchCandidate(it.id, it.interrogationDate, it.deviceSerialNumber) }
        val match = pickSameDayReport(candidates, report.interrogationDate, report.device.serialNumber, explicitNewVisit)

        val reportId: String
        val visitDirHandle: String
        val finalReport: UnifiedReport
        val reused: Boolean

        if (match != null) {
            reportId = match.id
            visitDirHandle = reader.listChildren(patientDirHandle).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
                ?: return Result.failure(IllegalStateException("Visit $reportId is indexed locally but its directory couldn't be found"))
            val existingReport = reader.listChildren(visitDirHandle)
                .firstOrNull { !it.isDirectory && it.name == "visit.xml" }
                ?.let { reader.readText(it.handle) }
                ?.let { parseVisitXml(it, patientId)?.report }
            finalReport = if (existingReport != null) mergeReports(existingReport, report) else report
            reused = true
        } else {
            reportId = Uuid.random().toString()
            val dateString = visitDirDateString(report.interrogationDate)
            visitDirHandle = writer.createDirectory(patientDirHandle, "${dateString}_$reportId")
                ?: return Result.failure(IllegalStateException("Failed to create visit directory"))
            finalReport = report
            reused = false
        }

        if (!writer.writeTextFile(visitDirHandle, "visit.xml", generateVisitXml(reportId, finalReport))) {
            return Result.failure(IllegalStateException("Failed to write visit.xml"))
        }

        db.devicesQueries.deleteDevicesForReport(reportId)
        db.leadsQueries.deleteLeadsForReport(reportId)
        insertReportRow(IndexedReport(reportId, patientId, finalReport))

        return Result.success(ImportedVisit(patientId, patientDirHandle, reportId, visitDirHandle, reused))
    }

    suspend fun reindexFrom(reader: DataRootReader, reportsRootHandle: String) = withContext(ioDispatcher) {
        val result = DataRootIndexer(reader).indexAll(reportsRootHandle)
        db.transaction {
            db.leadsQueries.deleteAllLeads()
            db.devicesQueries.deleteAllDevices()
            db.reportsQueries.deleteAllReports()
            db.patientsQueries.deleteAllPatients()

            for (patient in result.patients) {
                db.patientsQueries.insertPatient(
                    id = patient.id,
                    firstName = patient.firstName,
                    lastName = patient.lastName,
                    lastNameKey = patient.lastName.trim().lowercase(),
                    dob = patient.dob,
                    hospitalPatientId = patient.hospitalPatientId,
                    mriStatus = null,
                    mriDataHash = null,
                    manufacturerWarningStatus = null,
                    manufacturerWarningHash = null,
                    lastIndexedMtime = null,
                )
            }

            for (indexed in result.reports) {
                insertReportRow(indexed)
            }
        }
    }

    /**
     * Wipes the local index only — never `_DATA` itself. Electron's
     * `clear-all-data` deletes the shared `_DATA`/unmatched directories too,
     * but here `_DATA` is explicitly the shared, possibly-multi-client
     * source of truth (see [DatabaseDriverFactory]'s doc comment); a KMP
     * client nuking it would destroy data other clients — including
     * Electron itself — still rely on. This scoped-down version is fully
     * safe and reversible: [reindexFrom] rebuilds the exact same state from
     * `_DATA` afterward. Deleting `_DATA` itself, if ever wanted, deserves
     * its own deliberate, harder-to-trigger confirmation flow — not bundled
     * in here by default.
     */
    suspend fun clearLocalIndex() = withContext(ioDispatcher) {
        db.transaction {
            db.leadsQueries.deleteAllLeads()
            db.devicesQueries.deleteAllDevices()
            db.reportsQueries.deleteAllReports()
            db.patientsQueries.deleteAllPatients()
            db.importEventsQueries.deleteAllImportEvents()
            db.importSessionsQueries.deleteAllImportSessions()
        }
    }

    private fun insertReportRow(indexed: IndexedReport) {
        val report = indexed.report
        db.reportsQueries.insertReport(
            id = indexed.id,
            patientId = indexed.patientId,
            manufacturer = report.manufacturer,
            interrogationDate = report.interrogationDate,
            hospitalVisitId = report.hospitalVisitId,
            deviceType = report.device.type,
            deviceModel = report.device.model,
            deviceSerialNumber = report.device.serialNumber,
            rawText = report.rawText,
            data_ = null,
        )

        db.devicesQueries.insertDevice(
            id = "${indexed.id}-device",
            reportId = indexed.id,
            type = report.device.type,
            model = report.device.model,
            serialNumber = report.device.serialNumber,
            implantDate = report.device.implantDate,
        )

        report.leads.filter(::hasLeadData).forEachIndexed { i, lead ->
            db.leadsQueries.insertLead(
                id = "${indexed.id}-lead-$i",
                reportId = indexed.id,
                name = lead.name,
                manufacturer = lead.manufacturer,
                model = lead.model,
                serial = lead.serial,
                anatomicLocation = lead.anatomicLocation,
                implantDate = lead.implantDate,
                pacingThresholdValue = lead.pacingThreshold?.value,
                pacingThresholdUnit = lead.pacingThreshold?.unit,
                pacingAmplitudeValue = lead.pacingAmplitude?.value,
                pacingAmplitudeUnit = lead.pacingAmplitude?.unit,
                sensingValue = lead.sensing?.value,
                sensingUnit = lead.sensing?.unit,
                impedanceValue = lead.impedance?.value,
                impedanceUnit = lead.impedance?.unit,
                shockImpedanceValue = lead.shockImpedance?.value,
                shockImpedanceUnit = lead.shockImpedance?.unit,
            )
        }
    }
}
