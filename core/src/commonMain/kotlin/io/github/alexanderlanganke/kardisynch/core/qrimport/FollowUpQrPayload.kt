package io.github.alexanderlanganke.kardisynch.core.qrimport

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Decodes the "follow-up" QR payload the desktop app already exports
 * (`visitToFuPayload.ts`, shipped v2.19.0 — `QrExportButton` on the patient
 * header/visit timeline/dashboard) — this is the counterpart that closes
 * issue #161's actual stated motivation: scanning that QR on a phone rather
 * than needing a desktop to read it. Envelope: `{v:1, t:'fu', ts:<unix
 * seconds>, d:{...compact fields...}}`, plain JSON, unsigned/unencrypted
 * (documented in the original as a known stopgap, not a KMP-side choice).
 *
 * The device-type/manufacturer compact-code maps here are confirmed
 * line-for-line against `visitToFuPayload.ts`'s `DEVICE_TYPE_MAP`/
 * `MANUFACTURER_MAP` (issue #179) — both the code table itself and the
 * fallback behavior: `compactDeviceType`/`compactManufacturer` on the
 * encode side pass an unrecognized type/manufacturer through *verbatim*
 * (`DEVICE_TYPE_MAP[type] || type`) rather than dropping it, so the decode
 * side does the same — `"Unknown"` only applies when the field is absent
 * entirely, never when it's present but uncoded.
 */
@Serializable
private data class FollowUpEnvelope(val v: Int, val t: String, val ts: Long, val d: FollowUpData)

@Serializable
private data class FollowUpData(
    val date: String? = null,
    val fn: String? = null,
    val ln: String? = null,
    val dob: String? = null,
    val dt: String? = null,
    val dm: String? = null,
    val mn: String? = null,
    val ds: String? = null,
    val di: String? = null,
    val a: LeadMeasurement? = null,
    val rv: LeadMeasurement? = null,
    val lv: LeadMeasurement? = null,
    val bv: Double? = null,
    val bs: String? = null,
    val lo: Double? = null,
)

@Serializable
private data class LeadMeasurement(val ta: Double? = null, val tp: Double? = null, val se: Double? = null, val im: Double? = null)

private val DEVICE_TYPE_MAP = mapOf(
    "PM" to "Pacemaker", "ICD" to "ICD", "CRT-D" to "CRT-D", "CRT-P" to "CRT-P",
    "S-ICD" to "S-ICD", "LR" to "Leadless Pacemaker", "CCM" to "CCM",
)

private val MANUFACTURER_MAP = mapOf(
    "BIO" to "Biotronik", "MDT" to "Medtronic", "ABT" to "Abbott",
    "BSC" to "Boston Scientific", "MIC" to "Microport", "SOR" to "Sorin",
)

/** A decoded follow-up QR, ready to become a new report — patient identity is intentionally partial (name/dob only; no serial-based patient matching happens here, that's the caller's job). */
data class FollowUpImport(
    val patientFirstName: String,
    val patientLastName: String,
    val patientDob: String,
    val report: UnifiedReport,
)

private val json = Json { ignoreUnknownKeys = true }

/** Parses raw QR text into a [FollowUpImport], or null if it isn't a recognized/parseable follow-up payload. */
fun parseFollowUpQrPayload(rawText: String): FollowUpImport? {
    val envelope = try {
        json.decodeFromString<FollowUpEnvelope>(rawText)
    } catch (e: Exception) {
        return null
    }
    if (envelope.v != 1 || envelope.t != "fu") return null
    val d = envelope.d

    fun leadData(name: String, location: String, m: LeadMeasurement?): LeadData? {
        if (m == null) return null
        val pacingThreshold = m.ta?.let { Measurement(it, if (m.tp != null) "V @ ${m.tp}ms" else "V") }
        if (pacingThreshold == null && m.se == null && m.im == null) return null
        return LeadData(
            name = name,
            anatomicLocation = location,
            pacingThreshold = pacingThreshold,
            sensing = m.se?.let { Measurement(it, "mV") },
            impedance = m.im?.let { Measurement(it, "Ohm") },
        )
    }

    val leads = listOfNotNull(
        leadData("Atrium", "A", d.a),
        leadData("RV", "RV", d.rv),
        leadData("LV", "LV", d.lv),
    )

    val report = UnifiedReport(
        manufacturer = d.dm?.let { MANUFACTURER_MAP[it] ?: it } ?: "Unknown",
        interrogationDate = d.date ?: "",
        patient = PatientInfo(firstName = d.fn ?: "", lastName = d.ln ?: "", dob = d.dob ?: ""),
        device = DeviceInfo(
            type = d.dt?.let { DEVICE_TYPE_MAP[it] ?: it } ?: "Unknown",
            model = d.mn ?: "",
            serialNumber = d.ds ?: "",
            implantDate = d.di,
        ),
        battery = BatteryData(
            voltage = d.bv?.let { Measurement(it, "V") },
            remainingLongevity = d.lo?.let { Measurement(it, "months") },
            status = d.bs,
        ),
        leads = leads,
        formatVariant = "qr-followup-v1",
        parseStatus = if (d.ln.isNullOrEmpty() && d.dob.isNullOrEmpty()) ParseStatus.FAILED else ParseStatus.OK,
    )

    return FollowUpImport(
        patientFirstName = d.fn ?: "",
        patientLastName = d.ln ?: "",
        patientDob = d.dob ?: "",
        report = report,
    )
}
