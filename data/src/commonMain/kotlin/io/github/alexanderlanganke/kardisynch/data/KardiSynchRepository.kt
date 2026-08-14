package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import app.cash.sqldelight.db.SqlDriver
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootIndexer
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter
import io.github.alexanderlanganke.kardisynch.core.datastore.IndexedReport
import io.github.alexanderlanganke.kardisynch.core.datastore.generatePatientXml
import io.github.alexanderlanganke.kardisynch.core.datastore.generateVisitXml
import io.github.alexanderlanganke.kardisynch.core.datastore.parseVisitXml
import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.core.matching.ReportMatchCandidate
import io.github.alexanderlanganke.kardisynch.core.matching.mergeReports
import io.github.alexanderlanganke.kardisynch.core.matching.pickSameDayReport
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpImport
import io.github.alexanderlanganke.kardisynch.core.util.visitDirDateString
import io.github.alexanderlanganke.kardisynch.data.db.Devices
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
            val children = reader.listChildren(reportsRootHandle)
            val match = children.firstOrNull { it.isDirectory && it.name.startsWith("${existing.id}_") }
                ?: children.firstOrNull { it.isDirectory && it.name.startsWith(existing.id) }
            val handle = match?.handle
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
