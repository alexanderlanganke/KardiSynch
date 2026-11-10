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

// -----------------------------------------------------------------------
// Encode side — ported from `visitToFuPayload.ts`'s `buildFuQrPayload`
// (issue #199). Only the desktop app has a QR *export* action (mirroring
// Electron: `QrExportButton` on the patient header/visit timeline/
// dashboard) — Android only scans/imports. Deliberately shaped around the
// local index's own read model (patient/report/device/lead DB rows), not
// [UnifiedReport], since that's what's actually on hand when a user clicks
// "export" on an already-stored visit — the local index doesn't carry
// battery voltage/status/longevity or additional_fields at all (Decision 3:
// it's a coarse read-model, not a full visit.xml mirror), so those three
// fields are never populated by this function. A caller wanting them would
// need to re-read the visit's `visit.xml` from `_DATA` first.
// -----------------------------------------------------------------------

data class FollowUpExportPatient(val firstName: String?, val lastName: String?, val dob: String?)

data class FollowUpExportLead(
    val location: String? = null,
    val type: String? = null,
    val impedance: Double? = null,
    val sensing: Double? = null,
    val threshold: Double? = null,
    val pulseWidth: Double? = null,
)

data class FollowUpExportReport(
    val interrogationDate: String,
    val manufacturer: String? = null,
    val deviceType: String? = null,
    val deviceModel: String? = null,
    val deviceSerial: String? = null,
    val deviceImplantDate: String? = null,
    val leads: List<FollowUpExportLead> = emptyList(),
)

private val DEVICE_TYPE_EXPORT_MAP = mapOf(
    "pacemaker" to "PM", "icd" to "ICD", "crt-d" to "CRT-D", "crt-p" to "CRT-P",
    "s-icd" to "S-ICD", "leadless pacemaker" to "LR", "ccm" to "CCM",
)

private val MANUFACTURER_EXPORT_MAP = mapOf(
    "biotronik" to "BIO", "medtronic" to "MDT", "abbott" to "ABT",
    "boston scientific" to "BSC", "microport" to "MIC", "sorin" to "SOR",
)

/** Passes an unrecognized type through verbatim rather than dropping it — see this file's doc comment. */
fun compactDeviceType(type: String?): String? = type?.let { DEVICE_TYPE_EXPORT_MAP[it.lowercase()] ?: it }

/** Passes an unrecognized manufacturer through verbatim rather than dropping it — see this file's doc comment. */
fun compactManufacturer(manufacturer: String?): String? = manufacturer?.let { MANUFACTURER_EXPORT_MAP[it.lowercase()] ?: it }

private data class ChannelPattern(val channel: String, val type: Regex, val location: Regex)

private val CHANNEL_PATTERNS = listOf(
    ChannelPattern("a", Regex("""atri|^A$|^RA$|A-Lead""", RegexOption.IGNORE_CASE), Regex("""right\s*atri|\bRA\b|\bA\b""", RegexOption.IGNORE_CASE)),
    ChannelPattern("rv", Regex("""^RV$|RV-Lead|^RV\s""", RegexOption.IGNORE_CASE), Regex("""right\s*ventri|\bRV\b""", RegexOption.IGNORE_CASE)),
    ChannelPattern("lv", Regex("""^LV$|LV-Lead|^LV\s""", RegexOption.IGNORE_CASE), Regex("""left\s*ventri|\bLV\b|coronary\s*sinus""", RegexOption.IGNORE_CASE)),
)

private fun classifyLead(type: String?, location: String?): String? {
    for (p in CHANNEL_PATTERNS) {
        if ((type != null && p.type.containsMatchIn(type)) || (location != null && p.location.containsMatchIn(location))) return p.channel
    }
    return null
}

private fun buildMeasurement(lead: FollowUpExportLead): LeadMeasurement? {
    val ta = lead.threshold?.takeIf { it.isFinite() }
    val tp = lead.pulseWidth?.takeIf { it.isFinite() }
    val se = lead.sensing?.takeIf { it.isFinite() }
    val im = lead.impedance?.takeIf { it.isFinite() }
    if (ta == null && tp == null && se == null && im == null) return null
    return LeadMeasurement(ta = ta, tp = tp, se = se, im = im)
}

/**
 * Builds the follow-up QR payload string for [report] (optionally alongside
 * [patient] identity) — the encode-side counterpart to [parseFollowUpQrPayload].
 * [nowEpochSeconds] is a parameter rather than read from a clock because
 * `core` is platform-agnostic (same reason [io.github.alexanderlanganke.kardisynch.core.util.normalizeDate]
 * takes `assumedCurrentYear`) — desktop callers pass `System.currentTimeMillis() / 1000`.
 */
fun buildFollowUpQrPayload(patient: FollowUpExportPatient?, report: FollowUpExportReport, nowEpochSeconds: Long): String {
    var a: LeadMeasurement? = null
    var rv: LeadMeasurement? = null
    var lv: LeadMeasurement? = null
    for (lead in report.leads) {
        val channel = classifyLead(lead.type, lead.location) ?: continue
        val measurement = buildMeasurement(lead) ?: continue
        when (channel) {
            "a" -> a = measurement
            "rv" -> rv = measurement
            "lv" -> lv = measurement
        }
    }

    val data = FollowUpData(
        date = report.interrogationDate,
        fn = patient?.firstName?.takeIf { it.isNotEmpty() },
        ln = patient?.lastName?.takeIf { it.isNotEmpty() },
        dob = patient?.dob?.takeIf { it.isNotEmpty() },
        dt = compactDeviceType(report.deviceType),
        dm = compactManufacturer(report.manufacturer),
        mn = report.deviceModel?.takeIf { it.isNotEmpty() },
        ds = report.deviceSerial?.takeIf { it.isNotEmpty() },
        di = report.deviceImplantDate?.takeIf { it.isNotEmpty() },
        a = a,
        rv = rv,
        lv = lv,
    )
    return json.encodeToString(FollowUpEnvelope.serializer(), FollowUpEnvelope(v = 1, t = "fu", ts = nowEpochSeconds, d = data))
}
