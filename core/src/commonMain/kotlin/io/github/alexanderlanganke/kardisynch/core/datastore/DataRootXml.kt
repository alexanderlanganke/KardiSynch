package io.github.alexanderlanganke.kardisynch.core.datastore

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.xml.XmlNode
import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser

/**
 * Readers for the `_DATA/Reports/{PatientID}/{VisitID}/patient.xml` and
 * `visit.xml` files Electron's `storage.ts` writes (`generatePatientXML`/
 * `generateVisitXML`). This is the byte-for-byte compatibility contract the
 * KMP migration plan requires — schema confirmed against the real writer,
 * not guessed.
 *
 * `patient.xml` also carries a curated devices/leads *history* list — not
 * read here. Per the migration plan's Decision 3, this port doesn't try to
 * replicate that separately-maintained aggregate; "current devices/leads"
 * for a patient is a query against their most recent report's rows
 * (built from `visit.xml`, which this file also reads) instead.
 */

data class IndexedPatient(
    val id: String,
    val firstName: String,
    val lastName: String,
    val dob: String,
    val hospitalPatientId: String?,
)

data class IndexedReport(
    val id: String,
    val patientId: String,
    val report: UnifiedReport,
)

/** Parses `patient.xml`. Returns null if the root element isn't `<patient>` or has no `<id>`. */
fun parsePatientXml(xml: String): IndexedPatient? {
    val root = XmlParser.parse(xml)
    if (root.name != "patient") return null
    val id = root.child("id")?.text?.takeIf { it.isNotEmpty() } ?: return null
    return IndexedPatient(
        id = id,
        firstName = root.child("first_name")?.text ?: "",
        lastName = root.child("last_name")?.text ?: "",
        dob = root.child("dob")?.text ?: "",
        hospitalPatientId = root.child("hospitalPatientId")?.text?.takeIf { it.isNotEmpty() },
    )
}

/** Parses `visit.xml`. Returns null if the root element isn't `<visit>` or has no `<report_id>`. */
fun parseVisitXml(xml: String, patientId: String): IndexedReport? {
    val root = XmlParser.parse(xml)
    if (root.name != "visit") return null
    val reportId = root.child("report_id")?.text?.takeIf { it.isNotEmpty() } ?: return null

    val battery = root.child("battery")?.let { b ->
        BatteryData(
            voltage = b.child("voltage")?.toMeasurement(),
            lastChargeTime = b.child("last_charge_time")?.toMeasurement(),
            status = b.child("status")?.text?.takeIf { it.isNotEmpty() },
        )
    } ?: BatteryData()

    val leads = root.child("leads")?.childrenNamed("lead")?.map { l ->
        LeadData(
            name = l.child("name")?.text ?: "",
            model = l.child("model")?.text?.takeIf { it.isNotEmpty() },
            serial = l.child("serial")?.text?.takeIf { it.isNotEmpty() },
            anatomicLocation = l.child("anatomic_location")?.text?.takeIf { it.isNotEmpty() },
            implantDate = l.child("implant_date")?.text?.takeIf { it.isNotEmpty() },
            impedance = l.child("impedance")?.toMeasurement(),
            sensing = l.child("sensing")?.toMeasurement(),
            pacingThreshold = l.child("pacing_threshold")?.toMeasurement(),
            pacingAmplitude = l.child("pacing_amplitude")?.toMeasurement(),
            shockImpedance = l.child("shock_impedance")?.toMeasurement(),
        )
    } ?: emptyList()

    val additionalFields = root.child("additional_fields")?.childrenNamed("field")
        ?.associate { (it.attributes["name"] ?: "") to it.text }
        ?.filterKeys { it.isNotEmpty() }
        ?: emptyMap()

    val report = UnifiedReport(
        manufacturer = root.child("manufacturer")?.text?.takeIf { it.isNotEmpty() } ?: "Unknown",
        interrogationDate = root.child("interrogation_date")?.text ?: "",
        patient = PatientInfo(firstName = "", lastName = "", dob = ""), // filled in from patient.xml by the caller
        device = DeviceInfo(
            type = root.child("device_type")?.text?.takeIf { it.isNotEmpty() } ?: "Unknown",
            model = root.child("device_model")?.text ?: "",
            serialNumber = root.child("device_serial")?.text ?: "",
        ),
        battery = battery,
        leads = leads,
        additionalFields = additionalFields,
    )
    return IndexedReport(id = reportId, patientId = patientId, report = report)
}

private fun XmlNode.toMeasurement(): Measurement? {
    val value = attributes["value"]?.toDoubleOrNull() ?: return null
    val unit = attributes["unit"] ?: ""
    return Measurement(value, unit)
}
