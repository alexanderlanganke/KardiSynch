package io.github.alexanderlanganke.kardisynch.core.datastore

/** Result of walking a `_DATA/Reports` root: every patient and report found. */
data class IndexResult(val patients: List<IndexedPatient>, val reports: List<IndexedReport>)

/**
 * Walks a `_DATA/Reports` root via a [DataRootReader] and rebuilds a full
 * patient/report index from the on-disk XML — the KMP equivalent of
 * Electron's `rebuildDatabase` (src/main/database.ts), which every KMP
 * client uses to bootstrap/refresh its own local SQLite index (per the
 * migration plan: SQLite is always local-only, never shared on `_DATA`).
 *
 * A patient directory with no readable `patient.xml`, or a visit directory
 * with no readable `visit.xml`, is silently skipped — matches
 * `rebuildDatabase`'s tolerance of partially-written/mid-import directories
 * rather than failing the whole reindex over one bad entry.
 */
class DataRootIndexer(private val reader: DataRootReader) {
    fun indexAll(reportsRootHandle: String): IndexResult {
        val patients = mutableListOf<IndexedPatient>()
        val reports = mutableListOf<IndexedReport>()

        for (patientEntry in reader.listChildren(reportsRootHandle).filter { it.isDirectory }) {
            val patientChildren = reader.listChildren(patientEntry.handle)
            val patientXmlHandle = patientChildren.firstOrNull { !it.isDirectory && it.name == "patient.xml" } ?: continue
            val patientXmlText = reader.readText(patientXmlHandle.handle) ?: continue
            val patient = parsePatientXml(patientXmlText) ?: continue
            patients.add(patient)

            for (visitEntry in patientChildren.filter { it.isDirectory }) {
                val visitChildren = reader.listChildren(visitEntry.handle)
                val visitXmlHandle = visitChildren.firstOrNull { !it.isDirectory && it.name == "visit.xml" } ?: continue
                val visitXmlText = reader.readText(visitXmlHandle.handle) ?: continue
                val report = parseVisitXml(visitXmlText, patient.id) ?: continue
                reports.add(report)
            }
        }

        return IndexResult(patients, reports)
    }
}
