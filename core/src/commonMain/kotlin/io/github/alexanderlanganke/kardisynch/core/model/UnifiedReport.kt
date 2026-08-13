package io.github.alexanderlanganke.kardisynch.core.model

/**
 * A single measurement with a value and its unit. Ported from the Electron
 * app's `Measurement` (src/main/reports.ts) — that TS type allows
 * `value: number | string` for one Boston Scientific quirk (a composite
 * "amplitude @ pulseWidth" string); that parser isn't ported yet, so this
 * stays a plain Double until it is.
 */
data class Measurement(
    val value: Double,
    val unit: String,
)

/** Represents a single lead. Ported from `LeadData` (src/main/reports.ts). */
data class LeadData(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val anatomicLocation: String? = null,
    val implantDate: String? = null,
    val pacingThreshold: Measurement? = null,
    val pacingAmplitude: Measurement? = null,
    val sensing: Measurement? = null,
    val impedance: Measurement? = null,
    val shockImpedance: Measurement? = null,
)

/** Represents the device's battery status. Ported from `BatteryData`. */
data class BatteryData(
    val voltage: Measurement? = null,
    val remainingLongevity: Measurement? = null,
    val lastChargeTime: Measurement? = null,
    val status: String? = null,
)

data class PatientInfo(
    val firstName: String,
    val lastName: String,
    val dob: String,
    val hospitalPatientId: String? = null,
)

data class DeviceInfo(
    val type: String,
    val model: String,
    val serialNumber: String,
    val implantDate: String? = null,
)

/**
 * What a parseStatus of 'ok' | 'partial' | 'failed' means, ported from the
 * comment on `UnifiedReport.parseStatus` (src/main/reports.ts): 'partial'
 * means some fields fell back to a default but patient and/or device
 * identity was recovered; 'failed' means neither could be established
 * (still a real report, not null).
 */
enum class ParseStatus { OK, PARTIAL, FAILED }

/**
 * The top-level, standardized structure for a parsed interrogation report.
 * Ported from `UnifiedReport` (src/main/reports.ts). `arrhythmiaSummary` and
 * `parseWarnings`/diagnostics are simplified (or omitted) for now — this
 * covers what the ported parsers (Medtronic .pdd, Biotronik, Microport)
 * actually populate this session; extend as more parsers are ported.
 */
data class UnifiedReport(
    val manufacturer: String,
    val interrogationDate: String,
    val hospitalVisitId: String? = null,
    val sessionId: String? = null,
    val patient: PatientInfo,
    val device: DeviceInfo,
    val battery: BatteryData = BatteryData(),
    val leads: List<LeadData> = emptyList(),
    val additionalFields: Map<String, String> = emptyMap(),
    val rawText: String? = null,
    val formatVariant: String? = null,
    val parseStatus: ParseStatus = ParseStatus.OK,
)

/**
 * Check whether a lead has meaningful data beyond just a name/location.
 * Ported verbatim (semantics) from `hasLeadData()` (src/main/reports.ts).
 */
fun hasLeadData(lead: LeadData): Boolean {
    if (lead.model != null && lead.model != "Unknown" && lead.model != ".") return true
    if (lead.serial != null && lead.serial != "Unknown" && lead.serial != ".") return true
    if (lead.impedance != null) return true
    if (lead.sensing != null) return true
    if (lead.pacingThreshold != null) return true
    if (lead.pacingAmplitude != null) return true
    if (lead.shockImpedance != null) return true
    return false
}
