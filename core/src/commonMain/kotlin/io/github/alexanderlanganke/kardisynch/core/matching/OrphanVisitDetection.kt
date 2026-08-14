package io.github.alexanderlanganke.kardisynch.core.matching

/**
 * Small, pure directory-name-matching helpers behind orphaned-visit
 * detection (issue #186) — ported from `services/orphanService.ts`. A visit
 * is "orphaned" when it physically sits under one patient's `_DATA`
 * directory but the local index's report row says it belongs to a
 * different patient (residue of an interrupted merge/move). The actual
 * scan + repair lives on `KardiSynchRepository` (needs filesystem access);
 * these are just the string-matching pieces, kept here so they're
 * unit-testable without one.
 */

/** Matches a top-level patient directory name to a known patient ID — dir names are `{id}_{safeName}` or bare `{id}`. */
fun patientIdForDir(dirName: String, patientIds: List<String>): String? =
    patientIds.firstOrNull { dirName == it || dirName.startsWith("${it}_") }

/** The `YYYY-MM-DD` date prefix of a visit dir name (`YYYY_MM_DD_...`), or null if it doesn't have one. */
fun visitDatePrefix(dirName: String): String? {
    val m = Regex("""^(\d{4}_\d{2}_\d{2})_""").find(dirName) ?: return null
    return m.groupValues[1].replace("_", "-")
}

/** Strips a visit dir name's date/`Unknown` prefix to recover its report ID — the fallback when `visit.xml`'s own `<report_id>` isn't available. */
fun reportIdFromDirName(dirName: String): String? {
    val stripped = dirName.replace(Regex("""^(\d{4}_\d{2}_\d{2}|Unknown)_"""), "")
    return stripped.takeIf { it.isNotEmpty() && it != dirName }
}
