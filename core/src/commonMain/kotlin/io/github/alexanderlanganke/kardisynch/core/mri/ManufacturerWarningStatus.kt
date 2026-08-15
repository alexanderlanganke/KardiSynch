package io.github.alexanderlanganke.kardisynch.core.mri

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The one real consumer of `patient.xml`'s `manufacturer_warning_status`
 * cache field (issue #175) — ported from `clinicalPriority.ts`'s
 * `hasActiveWarning`/`getPatientFlags`. Nothing in this app (KMP or the
 * original Electron one) ever actually populates this from a live
 * recall/advisory feed; it's read-only display of whatever happens to
 * already be cached in `patient.xml` (see [io.github.alexanderlanganke.kardisynch.core.datastore.IndexedPatient]'s
 * doc comment).
 */
@Serializable
data class ManufacturerWarningStatus(val status: String, val details: String = "", val link: String? = null)

/** `status == "advisory"` or `"recall"` — mirrors `hasActiveWarning`. Any other status (or a missing/malformed field) is not active. */
fun hasActiveManufacturerWarning(raw: String?): Boolean =
    parseManufacturerWarningStatus(raw)?.status.let { it == "advisory" || it == "recall" }

/** Decodes the opaque `manufacturer_warning_status` JSON blob, or null if absent/malformed. */
fun parseManufacturerWarningStatus(raw: String?): ManufacturerWarningStatus? {
    if (raw.isNullOrBlank()) return null
    return try {
        Json { ignoreUnknownKeys = true }.decodeFromString<ManufacturerWarningStatus>(raw)
    } catch (e: Exception) {
        null
    }
}

private val WARNING_URGENCY_RANK = mapOf("recall" to 0, "advisory" to 1, "manual_check" to 2, "safe" to 3)

/**
 * Ranks [raw] so sorting ascending surfaces the most clinically urgent
 * patients first — ported from `PatientDashboard.tsx`'s `WARNING_SORT_ORDER`
 * (issue #197's dashboard urgency sort). `manual_check`/`safe` are real
 * `manufacturer_warning_status.status` values distinct from the
 * `advisory`/`recall` pair [hasActiveManufacturerWarning] treats as active —
 * an unset or unrecognized status ranks last (4).
 */
fun warningUrgencyRank(raw: String?): Int {
    val status = parseManufacturerWarningStatus(raw)?.status ?: "unknown"
    return WARNING_URGENCY_RANK[status] ?: 4
}
