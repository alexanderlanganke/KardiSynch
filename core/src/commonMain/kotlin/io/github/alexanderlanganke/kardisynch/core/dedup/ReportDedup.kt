package io.github.alexanderlanganke.kardisynch.core.dedup

/** The fields [scoreReport] weighs — deliberately not the full `Reports` row, to keep this function pure/unit-testable without a `data` module dependency. */
data class ReportRichness(
    val manufacturer: String?,
    val deviceType: String?,
    val deviceModel: String?,
    val deviceSerialNumber: String?,
    val hospitalVisitId: String?,
    val rawText: String?,
    val hasDevice: Boolean,
    val hasLeads: Boolean,
)

/**
 * Scores a report by data richness — higher is better; the keeper in a
 * duplicate group (see `KardiSynchRepository.dedupReports`) is whichever
 * report scores highest, ties broken by on-disk file count. Ported from
 * Electron's `dedupService.ts`'s `scoreReport`, adapted for this port's
 * schema: the TS original's bonus for a populated `data` JSON blob
 * (leads/device/generatedFiles presence) doesn't apply here — that column
 * is never populated in this port, since device/lead data is normalized
 * into real `Devices`/`Leads` tables instead of a JSON blob — replaced with
 * an equivalent [hasDevice]/[hasLeads] bonus sourced from those tables.
 */
fun scoreReport(r: ReportRichness): Double {
    var score = 0.0
    if (!r.manufacturer.isNullOrBlank()) score += 1
    if (!r.deviceType.isNullOrBlank()) score += 1
    if (!r.deviceModel.isNullOrBlank()) score += 1
    if (!r.deviceSerialNumber.isNullOrBlank()) score += 1
    if (!r.hospitalVisitId.isNullOrBlank()) score += 1
    r.rawText?.let { score += minOf(it.length / 1000.0, 5.0) }
    if (r.hasLeads) score += 2
    if (r.hasDevice) score += 1
    return score
}
