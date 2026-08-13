package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import app.cash.sqldelight.db.SqlDriver
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootIndexer
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import io.github.alexanderlanganke.kardisynch.core.datastore.IndexedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

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
