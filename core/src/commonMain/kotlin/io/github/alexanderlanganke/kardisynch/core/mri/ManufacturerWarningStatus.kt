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
