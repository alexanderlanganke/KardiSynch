package io.github.alexanderlanganke.kardisynch.core.util

/**
 * Derives the `YYYY_MM_DD` directory-name component for a visit date.
 * Ported from `visitDirDateString` (src/main/storage.ts). The TS original
 * also falls back to `new Date(dateStr)` with local getters for non-ISO
 * strings; every date this KMP port's own parsers produce is already
 * normalized to ISO ([io.github.alexanderlanganke.kardisynch.core.util.normalizeDate]),
 * so that fallback branch is unreachable for our own writes and isn't ported.
 */
fun visitDirDateString(dateStr: String?): String {
    if (dateStr.isNullOrEmpty()) return "Unknown"
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(dateStr) ?: return "Unknown"
    return "${m.groupValues[1]}_${m.groupValues[2]}_${m.groupValues[3]}"
}
