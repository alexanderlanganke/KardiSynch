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
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootIndexer
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter
import io.github.alexanderlanganke.kardisynch.core.datastore.IndexedReport
import io.github.alexanderlanganke.kardisynch.core.dedup.ReportRichness
import io.github.alexanderlanganke.kardisynch.core.dedup.scoreReport
import io.github.alexanderlanganke.kardisynch.core.datastore.generatePatientXml
import io.github.alexanderlanganke.kardisynch.core.datastore.generateVisitXml
import io.github.alexanderlanganke.kardisynch.core.datastore.parsePatientXml
import io.github.alexanderlanganke.kardisynch.core.datastore.parseVisitXml
import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.matching.PatientDupGroup
import io.github.alexanderlanganke.kardisynch.core.matching.PatientIdentity
import io.github.alexanderlanganke.kardisynch.core.matching.PatientSummary
import io.github.alexanderlanganke.kardisynch.core.matching.ReportMatchCandidate
import io.github.alexanderlanganke.kardisynch.core.matching.findDuplicatePatientGroups
import io.github.alexanderlanganke.kardisynch.core.matching.findNearMatchPatients
import io.github.alexanderlanganke.kardisynch.core.matching.mergeReports
import io.github.alexanderlanganke.kardisynch.core.matching.normalizeNameKey
import io.github.alexanderlanganke.kardisynch.core.matching.patientIdForDir
import io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport
import io.github.alexanderlanganke.kardisynch.core.matching.reportIdFromDirName
import io.github.alexanderlanganke.kardisynch.core.matching.visitDatePrefix
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpImport
import io.github.alexanderlanganke.kardisynch.core.reparse.aggregateReports
import io.github.alexanderlanganke.kardisynch.core.util.visitDirDateString
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.ImportEvents
import io.github.alexanderlanganke.kardisynch.data.db.ImportSessions
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
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

    /** Every distinct lead location a patient has had a reading for — drives Patient Detail's per-lead trend chart location picker (issue #198's follow-up, Phase 5). */
    suspend fun getLeadLocationsForPatient(patientId: String): List<String> = withContext(ioDispatcher) {
        db.leadsQueries.selectDistinctLeadLocationsForPatient(patientId).executeAsList().filterNotNull()
    }

    /** One reading of a lead's impedance/sensing/pacing-threshold at a given visit, for [getLeadTrendByLocation]'s trend chart. */
    data class LeadTrendPoint(
        val interrogationDate: String,
        val deviceSerialNumber: String?,
        val impedanceValue: Double?,
        val impedanceUnit: String?,
        val sensingValue: Double?,
        val sensingUnit: String?,
        val pacingThresholdValue: Double?,
        val pacingThresholdUnit: String?,
    )

    /** `Leads.sq`'s `selectLeadTrendByLocation` had no repository wrapper at all until now — the original battery-only trend chart's doc comment flagged this as scoped-out "additional per-lead trends" work (issue #198's follow-up, Phase 5). */
    suspend fun getLeadTrendByLocation(patientId: String, anatomicLocation: String): List<LeadTrendPoint> = withContext(ioDispatcher) {
        db.leadsQueries.selectLeadTrendByLocation(patientId, anatomicLocation).executeAsList().map { row ->
            LeadTrendPoint(
                interrogationDate = row.interrogationDate,
                deviceSerialNumber = row.reportDeviceSerialNumber,
                impedanceValue = row.impedanceValue,
                impedanceUnit = row.impedanceUnit,
                sensingValue = row.sensingValue,
                sensingUnit = row.sensingUnit,
                pacingThresholdValue = row.pacingThresholdValue,
                pacingThresholdUnit = row.pacingThresholdUnit,
            )
        }
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

    /** Public wrapper around [findPatientDirHandle] — e.g. for a desktop "Open Folder" action (issue #197). */
    suspend fun findPatientDirectoryHandle(reader: DataRootReader, reportsRootHandle: String, patientId: String): String? =
        withContext(ioDispatcher) { findPatientDirHandle(reader, reportsRootHandle, patientId) }

    /**
     * Every raw file (excluding `visit.xml`/`patient.xml`) in one visit's
     * directory — the raw document viewer's file list (issue #197/#198's
     * follow-up UI-parity plan, Phase 11). Mirrors Electron's `getVisitFiles`.
     */
    suspend fun getVisitFiles(reader: DataRootReader, reportsRootHandle: String, patientId: String, reportId: String): List<DataEntry> = withContext(ioDispatcher) {
        val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId) ?: return@withContext emptyList()
        val visitDirHandle = reader.listChildren(patientDirHandle).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
            ?: return@withContext emptyList()
        reader.listChildren(visitDirHandle).filter { !it.isDirectory && it.name != "visit.xml" && it.name != "patient.xml" }
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
     *
     * Reads the existing `patient.xml` first and carries its MRI/
     * manufacturer-warning cache fields forward unchanged (issue #175) —
     * [generatePatientXml] otherwise defaults them to absent, which would
     * silently wipe out whatever an Electron client had already cached
     * there the moment a KMP client edits this patient's name/DOB.
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
                val existing = reader.listChildren(patientDirHandle)
                    .firstOrNull { !it.isDirectory && it.name == "patient.xml" }
                    ?.let { reader.readText(it.handle) }
                    ?.let { parsePatientXml(it) }
                val xml = generatePatientXml(
                    patientId, firstName, lastName, dob, hospitalPatientId,
                    mriStatus = existing?.mriStatus, mriDataHash = existing?.mriDataHash,
                    manufacturerWarningStatus = existing?.manufacturerWarningStatus, manufacturerWarningHash = existing?.manufacturerWarningHash,
                )
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
     * Deletes one visit — its on-disk directory under the owning patient
     * plus its `Reports`/`Devices`/`Leads` index rows. `Reports.sq`'s
     * `deleteReport` query existed with no repository wrapper until now
     * (parity gap analysis, issue #202's UI-parity plan, Phase 1) — this is
     * the first place either single-report or bulk deletion becomes
     * reachable at all in this port.
     */
    suspend fun deleteReport(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        reportId: String,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val report = db.reportsQueries.selectReportById(reportId).executeAsOneOrNull()
                ?: return@withContext Result.failure(IllegalStateException("Report $reportId not found"))
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, report.patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient ${report.patientId} directory not found"))

            lock.withLock(patientDirHandle, "deleteReport:reportId=$reportId") {
                val visitDirHandle = reader.listChildren(patientDirHandle).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
                if (visitDirHandle != null && !writer.deleteDirectory(visitDirHandle)) {
                    return@withLock Result.failure(IllegalStateException("Failed to delete visit directory"))
                }
                db.devicesQueries.deleteDevicesForReport(reportId)
                db.leadsQueries.deleteLeadsForReport(reportId)
                db.reportsQueries.deleteReport(reportId)
                Result.success(Unit)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** One patient+date's group of >1 report — the raw input to [dedupReports]. */
    data class DuplicateReportGroup(val patientId: String, val date: String, val reportIds: List<String>)

    suspend fun findDuplicateReportGroups(): List<DuplicateReportGroup> = withContext(ioDispatcher) {
        db.reportsQueries.selectDuplicateReportDateGroups().executeAsList().map { row ->
            DuplicateReportGroup(row.patientId, row.interrogationDate, (row.reportIds ?: "").split(","))
        }
    }

    /** The outcome of [dedupReports]. */
    data class DedupResult(val groupsFound: Int, val reportsRemoved: Int, val errors: List<String>)

    private data class DedupCandidate(val reportId: String, val deviceSerialNumber: String?, val score: Double, val fileCount: Int, val visitDirHandle: String?)

    /**
     * Finds duplicate report *rows* — same patient, same day, and (once
     * sub-grouped) the same device serial number — and merges each group
     * down to one: the richest-scoring report's row and visit directory
     * survive, every other duplicate's unique files are moved into the
     * survivor's directory (content-hash-verified against name collisions)
     * before its own row/directory are removed via [deleteReport]. Ported
     * from Electron's `dedupService.ts`'s database-driven dedup phase
     * (issue #197/#198's follow-up UI-parity plan, Phase 6) — its
     * filesystem-driven second phase (reconciling on-disk directories that
     * don't cleanly map to a single DB row: several directories for one
     * report, or orphan directories with no row at all) is deliberately
     * NOT ported here. Every directory-touching operation in this port
     * ([importReport], [moveReport], [deleteReport], [reindexFrom]) already
     * maintains a strict one-directory-per-report invariant, so that
     * category of drift shouldn't arise here the way it could in the
     * original codebase's longer, more organically-evolved history — revisit
     * if orphaned/duplicated directories are ever actually observed.
     *
     * Same-day multi-visit groups aren't necessarily true duplicates (e.g.
     * an ICD and a separate ICM interrogated the same day) — only rows that
     * also share a device serial (or that both lack one) are merged.
     */
    suspend fun dedupReports(reader: DataRootReader, writer: DataRootWriter, reportsRootHandle: String): DedupResult = withContext(ioDispatcher) {
        var groupsFound = 0
        var reportsRemoved = 0
        val errors = mutableListOf<String>()

        for (group in findDuplicateReportGroups()) {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, group.patientId)

            val candidates = group.reportIds.mapNotNull { reportId ->
                val row = db.reportsQueries.selectReportById(reportId).executeAsOneOrNull() ?: return@mapNotNull null
                val visitDirHandle = patientDirHandle?.let { dir ->
                    reader.listChildren(dir).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
                }
                val hasDevice = db.devicesQueries.selectDevicesByReportId(reportId).executeAsList().isNotEmpty()
                val hasLeads = db.leadsQueries.selectLeadsByReportId(reportId).executeAsList().isNotEmpty()
                val score = scoreReport(
                    ReportRichness(row.manufacturer, row.deviceType, row.deviceModel, row.deviceSerialNumber, row.hospitalVisitId, row.rawText, hasDevice, hasLeads),
                )
                val fileCount = visitDirHandle?.let { dir -> reader.listChildren(dir).count { !it.isDirectory && !it.name.endsWith(".xml") } } ?: 0
                DedupCandidate(reportId, row.deviceSerialNumber, score, fileCount, visitDirHandle)
            }

            for (subgroup in candidates.groupBy { it.deviceSerialNumber.orEmpty().trim().lowercase() }.values) {
                if (subgroup.size < 2) continue
                groupsFound++

                val sorted = subgroup.sortedWith(compareByDescending<DedupCandidate> { it.score }.thenByDescending { it.fileCount })
                val keeper = sorted.first()

                for (dup in sorted.drop(1)) {
                    val filesCleared = when {
                        dup.visitDirHandle == null -> true
                        keeper.visitDirHandle == null -> false
                        else -> {
                            val merge = mergeVisitFiles(reader, writer, dup.visitDirHandle, keeper.visitDirHandle)
                            merge.failed == 0 && isVisitDirSafeToRemove(reader, dup.visitDirHandle)
                        }
                    }
                    if (!filesCleared) {
                        errors.add("Couldn't fully merge visit ${dup.reportId} into ${keeper.reportId} — left untouched.")
                        continue
                    }
                    deleteReport(reader, writer, reportsRootHandle, dup.reportId).fold(
                        onSuccess = { reportsRemoved++ },
                        onFailure = { e -> errors.add("Failed to remove duplicate visit ${dup.reportId}: ${e.message}") },
                    )
                }
            }
        }

        DedupResult(groupsFound, reportsRemoved, errors)
    }

    private data class FileMergeOutcome(val merged: Int, val failed: Int)

    /**
     * Moves every non-metadata file from [srcDirHandle] into [destDirHandle].
     * A name collision is resolved by content hash: a verified byte-identical
     * file is dropped from the source; genuinely different content keeps
     * both, the incoming file suffixed. Ported from `dedupService.ts`'s
     * `mergeFiles`.
     */
    private fun mergeVisitFiles(reader: DataRootReader, writer: DataRootWriter, srcDirHandle: String, destDirHandle: String): FileMergeOutcome {
        var merged = 0
        var failed = 0
        val destChildren = reader.listChildren(destDirHandle).associateBy { it.name }.toMutableMap()

        for (entry in reader.listChildren(srcDirHandle)) {
            if (entry.isDirectory || entry.name == "visit.xml" || entry.name == "patient.xml") continue

            val existing = destChildren[entry.name]
            if (existing == null) {
                val moved = writer.moveFile(entry.handle, destDirHandle, entry.name)
                if (moved != null) {
                    merged++
                    destChildren[entry.name] = DataEntry(entry.name, moved, false)
                } else {
                    failed++
                }
                continue
            }

            val srcBytes = reader.readBytes(entry.handle)
            val destBytes = reader.readBytes(existing.handle)
            if (srcBytes != null && destBytes != null && sha256Hex(srcBytes) == sha256Hex(destBytes)) {
                if (writer.deleteFile(entry.handle)) merged++ else failed++
                continue
            }

            val ext = entry.name.substringAfterLast('.', "")
            val base = if (ext.isEmpty()) entry.name else entry.name.removeSuffix(".$ext")
            var suffix = 2
            var candidateName: String
            do {
                candidateName = if (ext.isEmpty()) "${base}_$suffix" else "${base}_${suffix}.$ext"
                suffix++
            } while (destChildren.containsKey(candidateName))

            val moved = writer.moveFile(entry.handle, destDirHandle, candidateName)
            if (moved != null) {
                merged++
                destChildren[candidateName] = DataEntry(candidateName, moved, false)
            } else {
                failed++
            }
        }
        return FileMergeOutcome(merged, failed)
    }

    /** A merged-away visit directory may only be deleted once nothing but the (now-superseded) metadata XML files remain — mirrors `dedupService.ts`'s `isDirSafeToRemove`. */
    private fun isVisitDirSafeToRemove(reader: DataRootReader, dirHandle: String): Boolean =
        reader.listChildren(dirHandle).all { it.name == "visit.xml" || it.name == "patient.xml" }

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

    /** Each patient's most recent report's manufacturer/model — the Dashboard's manufacturer filter and sortable Manufacturer/Model columns (issue #197). */
    data class PatientDeviceSummary(val patientId: String, val manufacturer: String?, val deviceModel: String?)

    suspend fun getPatientsLatestDeviceInfo(): List<PatientDeviceSummary> = withContext(ioDispatcher) {
        db.patientsQueries.selectPatientsWithLatestDevice().executeAsList().map { row ->
            PatientDeviceSummary(patientId = row.id, manufacturer = row.manufacturer, deviceModel = row.deviceModel)
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

    /** Like [importReport], but for a patient ID already known (rather than discovered by exact name+DOB match) — used to attach a report to a specific patient after [resolvePatientIdentity] adopts or a pending-sort task is approved (issue #172/#173). */
    suspend fun importReportForExistingPatient(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        patientId: String,
        report: UnifiedReport,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<ImportedVisit> = withContext(ioDispatcher) {
        try {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $patientId not found under $reportsRootHandle"))
            lock.withLock(patientDirHandle, "importReportForExistingPatient:patient=$patientId") {
                writeVisit(reader, writer, patientId, patientDirHandle, report, explicitNewVisit = false)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    sealed interface IdentityResolution {
        /** Exact last-name+DOB match — proceed with the incoming report's own identity. */
        data class ExactMatch(val patientId: String) : IdentityResolution

        /** A device-serial match corroborated by a shared DOB or last name — adopt the stored identity onto the incoming report before storing. */
        data class Adopted(val patientId: String, val firstName: String, val lastName: String, val dob: String, val hospitalPatientId: String?) : IdentityResolution

        /** Not confident enough to auto-attach or auto-create — queue for manual review instead of storing. [suggestedPatientId] is null when there's nothing to suggest at all (missing identity, no serial match). */
        data class PendingReview(val suggestedPatientId: String?, val suggestedPatientName: String?, val note: String) : IdentityResolution

        /** No similar patient at all — genuinely new. */
        data object NoMatch : IdentityResolution
    }

    /**
     * The import-identity ladder (issue #143/#173): before a new visit's
     * patient can be auto-created (or an ambiguous one silently
     * misattached), resolve identity conservatively —
     *   1. Missing name/DOB entirely -> never auto-attach; a device-serial
     *      match is offered only as a suggestion (single-signal, uncorroborated).
     *   2. Exact last-name+DOB match -> proceed as that patient.
     *   3. Serial+manufacturer match sharing DOB or last name -> adopt that
     *      patient's stored identity (lets re-import succeed silently once a
     *      generator-change spelling variant was sorted manually the first time).
     *   4. A serial match that shares NEITHER -> conflicting; suggest for review.
     *   5. Any near-match (same DOB or same last name, not both) -> suggest for review.
     *   6. Nothing similar at all -> [NoMatch], genuinely new.
     */
    suspend fun resolvePatientIdentity(patient: PatientInfo, deviceSerial: String?, manufacturer: String?): IdentityResolution = withContext(ioDispatcher) {
        val serial = deviceSerial?.takeIf { it.isNotBlank() && it != "Unknown" }
        val mfg = manufacturer?.takeIf { it.isNotBlank() && it != "Unknown" }
        val hasIdentity = patient.lastName.isNotBlank() && patient.lastName != "Unknown" && patient.dob.isNotBlank()

        if (!hasIdentity) {
            val bySerial = serial?.let { findPatientBySerialRow(it, mfg) }
            return@withContext if (bySerial != null) {
                IdentityResolution.PendingReview(
                    bySerial.id, "${bySerial.lastName}, ${bySerial.firstName}",
                    "Device serial matches ${bySerial.lastName}, ${bySerial.firstName} on file, but this report has no name/DOB of its own to confirm it's the same patient (e.g. device explant/reimplant). Confirm or reassign before importing.",
                )
            } else {
                IdentityResolution.PendingReview(null, null, "This report has no patient name/DOB and no matching device serial on file. Assign it to a patient manually.")
            }
        }

        val exact = db.patientsQueries.selectAllPatients().executeAsList()
            .firstOrNull { it.lastName.equals(patient.lastName, ignoreCase = true) && it.dob == patient.dob }
        if (exact != null) return@withContext IdentityResolution.ExactMatch(exact.id)

        if (serial != null) {
            val bySerial = findPatientBySerialRow(serial, mfg)
            if (bySerial != null) {
                val sharesDob = bySerial.dob == patient.dob
                val sharesName = normalizeNameKey(bySerial.lastName) == normalizeNameKey(patient.lastName)
                if (sharesDob || sharesName) {
                    return@withContext IdentityResolution.Adopted(bySerial.id, bySerial.firstName.orEmpty(), bySerial.lastName, bySerial.dob, bySerial.hospitalPatientId)
                }
                return@withContext IdentityResolution.PendingReview(
                    bySerial.id, "${bySerial.lastName}, ${bySerial.firstName}",
                    "Device serial matches ${bySerial.lastName}, ${bySerial.firstName} on file, but the name/DOB on this report don't match. Confirm or reassign before importing.",
                )
            }
        }

        val allPatients = db.patientsQueries.selectAllPatients().executeAsList()
            .map { PatientIdentity(it.id, it.firstName.orEmpty(), it.lastName, it.dob, it.hospitalPatientId) }
        val near = findNearMatchPatients(allPatients, patient.lastName, patient.dob).firstOrNull()
        if (near != null) {
            return@withContext IdentityResolution.PendingReview(
                near.id, "${near.lastName}, ${near.firstName}",
                "Similar patient on file: ${near.lastName}, ${near.firstName} (DOB ${near.dob}). Possible generator change or spelling variant — assign to the existing patient or confirm this is a new one.",
            )
        }

        IdentityResolution.NoMatch
    }

    private fun findPatientBySerialRow(serial: String, manufacturer: String?): Patients? =
        db.patientsQueries.selectPatientBySerial(serial, manufacturer).executeAsOneOrNull()

    /**
     * Manual-sort queue (issue #172): one row per file [resolvePatientIdentity]
     * couldn't confidently attach anywhere. [stagedFilePath] is the raw
     * file's new location (moved there by the caller — a desktop concern,
     * see `ImportWatcher`), kept around so [resolvePendingSortTask]/dismiss
     * can find it again.
     */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun createPendingSortTask(
        createdAt: String,
        sessionId: String?,
        stagedFilePath: String,
        originalFileName: String,
        suggestedPatientId: String?,
        suggestedPatientName: String?,
        note: String,
        manufacturer: String?,
        deviceModel: String?,
        deviceSerial: String?,
        interrogationDate: String?,
    ): String = withContext(ioDispatcher) {
        val id = Uuid.random().toString()
        db.pendingSortTasksQueries.insertPendingSortTask(
            id, createdAt, sessionId, stagedFilePath, originalFileName,
            suggestedPatientId, suggestedPatientName, note, manufacturer, deviceModel, deviceSerial, interrogationDate,
        )
        id
    }

    suspend fun getPendingSortTasks(): List<PendingSortTasks> = withContext(ioDispatcher) {
        db.pendingSortTasksQueries.selectPendingSortTasks().executeAsList()
    }

    suspend fun getPendingSortTask(id: String): PendingSortTasks? = withContext(ioDispatcher) {
        db.pendingSortTasksQueries.selectPendingSortTaskById(id).executeAsOneOrNull()
    }

    suspend fun deletePendingSortTask(id: String) = withContext(ioDispatcher) {
        db.pendingSortTasksQueries.deletePendingSortTask(id)
    }

    /**
     * Re-parses every raw file still sitting in [patientId]/[reportId]'s
     * visit directory with the current parser logic and returns the
     * aggregated result WITHOUT writing
     * anything — the preview half of Electron's `rescanVisitDirectory`
     * (issue #197/#198's follow-up UI-parity plan, Phase 9), for a diff UI
     * to compare against what's currently stored before the user chooses
     * what to merge (see [PatientDetailScreen]'s "Rescan" action). Returns
     * `null` if none of the visit's files were parseable — mirrors
     * `rescanVisitDirectory`'s `{status: 'empty'}` case.
     *
     * Now possible directly through [DataRootReader]/[reader] (unlike
     * [reparseVisit]/[ReparseService.kt]'s original desktop-only,
     * `java.io.File`-based aggregation) since [DataRootReader.readBytes]
     * exists — added for report-level dedup (Phase 6) — giving this port a
     * portable raw-byte read it didn't have when `reparseVisit` was first
     * written.
     */
    suspend fun rescanVisit(reader: DataRootReader, reportsRootHandle: String, patientId: String, reportId: String): Result<UnifiedReport?> = withContext(ioDispatcher) {
        try {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $patientId directory not found"))
            val visitDirEntry = reader.listChildren(patientDirHandle).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }
                ?: return@withContext Result.failure(IllegalStateException("Visit $reportId not found under patient $patientId"))

            val parsed = reader.listChildren(visitDirEntry.handle)
                .filter { !it.isDirectory && it.name != "visit.xml" && it.name != "patient.xml" }
                .mapNotNull { entry ->
                    reader.readBytes(entry.handle)?.let { bytes ->
                        try {
                            dispatchParse(entry.name, bytes)
                        } catch (e: Exception) {
                            null
                        }
                    }
                }
            Result.success(aggregateReports(parsed, visitDirEntry.name))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Re-parses one visit: rewrites `visit.xml` from [aggregatedReport] (the
     * caller's fresh re-parse of every raw file still sitting in the visit
     * directory — assembling it is a desktop/data-layer concern, see
     * [aggregateReports]'s and [DataRootWriter]'s doc comments on why binary
     * file reads bypass this module) and refreshes the local index row for
     * [reportId] — a Kotlin port of Electron's `rescanVisitDirectory`/
     * `refreshVisitMetadata` (issue #188), letting a retroactive parser fix
     * reach a visit that was imported before the fix shipped.
     *
     * Reuses [mergeReports] against whatever's already in `visit.xml` —
     * exactly the same "fresh values win, existing preserved when fresh is
     * weak/empty/Unknown" rule an ordinary same-day re-import already
     * applies, so a field this parse run couldn't recover doesn't blank out
     * one a previous run did. Does NOT touch `patient.xml`'s device/lead
     * history (out of scope, KMP migration plan Decision 3).
     */
    suspend fun reparseVisit(
        reader: DataRootReader,
        writer: DataRootWriter,
        patientId: String,
        visitDirHandle: String,
        reportId: String,
        aggregatedReport: UnifiedReport,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val existingReport = reader.listChildren(visitDirHandle)
                .firstOrNull { !it.isDirectory && it.name == "visit.xml" }
                ?.let { reader.readText(it.handle) }
                ?.let { parseVisitXml(it, patientId)?.report }
            val finalReport = if (existingReport != null) mergeReports(existingReport, aggregatedReport) else aggregatedReport

            if (!writer.writeTextFile(visitDirHandle, "visit.xml", generateVisitXml(reportId, finalReport))) {
                return@withContext Result.failure(IllegalStateException("Failed to write visit.xml"))
            }

            db.devicesQueries.deleteDevicesForReport(reportId)
            db.leadsQueries.deleteLeadsForReport(reportId)
            insertReportRow(IndexedReport(reportId, patientId, finalReport))
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Directly replaces a visit's manufacturer/device/leads with manually
     * corrected values — unlike [reparseVisit], no union-merge against the
     * existing data, since a manual correction needs to be able to actually
     * remove a wrong value, not just add to it. Ported from Electron's
     * `DeviceLeadEditor.tsx`, adapted to this port's data model in two real
     * ways: [UnifiedReport.device] is a single device per report, not an
     * editable list (no "several current devices, one explanted" support —
     * that would need `UnifiedReport`'s device field to become a list
     * first, out of scope here), and [io.github.alexanderlanganke.kardisynch.core.model.LeadData]
     * has no connector field at all (the alias store's `LeadAliasAttrs.connector`
     * — issue #184 — has no destination column to write a correction or a
     * suggestion into; would need a new `Leads.connector` schema column
     * first). Everything else about a lead ([LeadData.name]/manufacturer/
     * model/serial/anatomicLocation/implantDate) is directly editable;
     * measurement values (impedance/sensing/pacing threshold) are left as
     * whatever the device readout already recorded — this dialog corrects
     * identity, not clinical values.
     */
    suspend fun updateReportDeviceAndLeads(
        reader: DataRootReader,
        writer: DataRootWriter,
        reportsRootHandle: String,
        patientId: String,
        reportId: String,
        manufacturer: String,
        device: DeviceInfo,
        leads: List<LeadData>,
        lock: DirectoryLock = NoOpDirectoryLock,
    ): Result<Unit> = withContext(ioDispatcher) {
        try {
            val patientDirHandle = findPatientDirHandle(reader, reportsRootHandle, patientId)
                ?: return@withContext Result.failure(IllegalStateException("Patient $patientId directory not found"))

            lock.withLock(patientDirHandle, "updateReportDeviceAndLeads:reportId=$reportId") {
                val visitDirHandle = reader.listChildren(patientDirHandle).firstOrNull { it.isDirectory && it.name.endsWith("_$reportId") }?.handle
                    ?: return@withLock Result.failure(IllegalStateException("Visit $reportId not found under patient $patientId"))
                val existingReport = reader.listChildren(visitDirHandle)
                    .firstOrNull { !it.isDirectory && it.name == "visit.xml" }
                    ?.let { reader.readText(it.handle) }
                    ?.let { parseVisitXml(it, patientId)?.report }
                    ?: return@withLock Result.failure(IllegalStateException("visit.xml not found or unparseable"))

                val updatedReport = existingReport.copy(manufacturer = manufacturer, device = device, leads = leads.filter(::hasLeadData))
                if (!writer.writeTextFile(visitDirHandle, "visit.xml", generateVisitXml(reportId, updatedReport))) {
                    return@withLock Result.failure(IllegalStateException("Failed to write visit.xml"))
                }

                db.devicesQueries.deleteDevicesForReport(reportId)
                db.leadsQueries.deleteLeadsForReport(reportId)
                insertReportRow(IndexedReport(reportId, patientId, updatedReport))
                Result.success(Unit)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
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
                    mriStatus = patient.mriStatus,
                    mriDataHash = patient.mriDataHash,
                    manufacturerWarningStatus = patient.manufacturerWarningStatus,
                    manufacturerWarningHash = patient.manufacturerWarningHash,
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
            batteryVoltageValue = report.battery.voltage?.value,
            batteryVoltageUnit = report.battery.voltage?.unit,
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
