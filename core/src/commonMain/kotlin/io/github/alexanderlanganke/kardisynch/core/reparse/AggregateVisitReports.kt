package io.github.alexanderlanganke.kardisynch.core.reparse

import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport

/**
 * Combines every raw file's parse result from one visit directory into a
 * single best-of-each-field [UnifiedReport] — a Kotlin port of
 * `aggregateVisitFiles`'s merge strategy (src/main/storage.ts, issue #188).
 * Distinct from [io.github.alexanderlanganke.kardisynch.core.matching.mergeReports],
 * which merges exactly two reports (existing-stored vs. one incoming file);
 * this merges an arbitrary number of *sibling* files from the same visit,
 * e.g. a structured export plus a same-visit companion log.
 *
 * [reports] should already be parsed (raw byte reads and dispatch are a
 * platform/data-layer concern — see [io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter]'s
 * doc comment on why binary work bypasses the shared reader/writer
 * abstraction). [visitDirName] is only consulted as a last-resort
 * interrogation-date fallback, matching the original's `YYYY_MM_DD_<id>`
 * directory-name parsing.
 *
 * Returns null for an empty [reports] list — "no parseable files found",
 * mirrored by the caller as a no-op rather than an error.
 */
fun aggregateReports(reports: List<UnifiedReport>, visitDirName: String): UnifiedReport? {
    if (reports.isEmpty()) return null

    val patient = reports.firstOrNull { it.patient.lastName.isNotBlank() }?.patient ?: reports[0].patient
    val device = reports.firstOrNull { it.device.model.isNotBlank() && it.device.model != "Unknown" }?.device
        ?: reports.firstOrNull { it.device.serialNumber.isNotBlank() && it.device.serialNumber != "Unknown" }?.device
        ?: reports[0].device
    val manufacturer = reports.firstOrNull { it.manufacturer.isNotBlank() && it.manufacturer != "Unknown" }?.manufacturer
        ?: reports[0].manufacturer

    var interrogationDate = reports.firstOrNull { it.interrogationDate.isNotBlank() }?.interrogationDate ?: reports[0].interrogationDate
    if (interrogationDate.isBlank()) {
        val match = Regex("""^(\d{4})_(\d{2})_(\d{2})_""").find(visitDirName)
        if (match != null) {
            val (y, m, d) = match.destructured
            interrogationDate = "$y-$m-$d"
        }
    }

    val battery = reports.firstOrNull { it.battery.voltage != null || !it.battery.status.isNullOrEmpty() }?.battery ?: reports[0].battery

    // Dedupe by serial (fallback: model, then name) across every file.
    val leadsByKey = LinkedHashMap<String, LeadData>()
    for (report in reports) {
        for (lead in report.leads) {
            val key = lead.serial?.takeIf { it.isNotEmpty() && it != "Unknown" && it != "." }
                ?: lead.model?.takeIf { it.isNotEmpty() }
                ?: lead.name
            if (key.isNotEmpty() && key !in leadsByKey) leadsByKey[key] = lead
        }
    }

    // Union additional_fields across every file — different source files in
    // the same visit can each contribute different manufacturer-specific fields.
    val additionalFields = mutableMapOf<String, String>()
    for (report in reports) additionalFields.putAll(report.additionalFields)

    return UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = interrogationDate,
        patient = patient,
        device = device,
        battery = battery,
        leads = leadsByKey.values.toList(),
        additionalFields = additionalFields,
    )
}
