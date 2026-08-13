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
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.qrimport.FollowUpImport
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
            val existing = db.patientsQueries.selectAllPatients().executeAsList().firstOrNull {
                it.lastName.equals(import.patientLastName, ignoreCase = true) && it.dob == import.patientDob
            }

            val patientDirHandle: String
            if (existing != null) {
                val match = reader.listChildren(reportsRootHandle)
                    .firstOrNull { it.isDirectory && it.name.startsWith("${existing.id}_") }
                    ?: reader.listChildren(reportsRootHandle).firstOrNull { it.isDirectory && it.name.startsWith(existing.id) }
                patientDirHandle = match?.handle
                    ?: return@withContext Result.failure(IllegalStateException("Patient ${existing.id} is indexed locally but its _DATA directory couldn't be found"))
            } else {
                val newPatientId = Uuid.random().toString()
                val safeName = (import.patientLastName + import.patientFirstName).filter { it.isLetterOrDigit() }
                val dirName = "${newPatientId}_$safeName"
                patientDirHandle = writer.createDirectory(reportsRootHandle, dirName)
                    ?: return@withContext Result.failure(IllegalStateException("Failed to create patient directory"))
                val patientXml = generatePatientXml(newPatientId, import.patientFirstName, import.patientLastName, import.patientDob, hospitalPatientId = null)
                if (!writer.writeTextFile(patientDirHandle, "patient.xml", patientXml)) {
                    return@withContext Result.failure(IllegalStateException("Failed to write patient.xml"))
                }
            }

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
