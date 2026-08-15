package io.github.alexanderlanganke.kardisynch.core.util

/**
 * "Label: prev -> curr unit (+Δ)" — ported verbatim from `trendDelta.ts`'s
 * `formatDelta` (parity plan Phase 11's "Formatted" view). Returns just
 * "Label: curr unit" when there's no previous value to compare against
 * (first visit, or the field wasn't recorded that time), and null when
 * there's no current value at all — nothing to show either way.
 */
fun formatDelta(current: Double?, previous: Double?, unit: String, label: String): String? {
    if (current == null) return null
    if (previous == null) return "$label: ${current.trimTrailingZero()} $unit"
    val diff = current - previous
    val sign = if (diff > 0) "+" else ""
    val roundedDiff = kotlin.math.round(diff * 10) / 10
    return "$label: ${previous.trimTrailingZero()} -> ${current.trimTrailingZero()} $unit ($sign${roundedDiff.trimTrailingZero()})"
}

/** Drops a redundant ".0" so whole numbers print as "500" rather than "500.0", matching the TS original's implicit JS number-to-string coercion. */
private fun Double.trimTrailingZero(): String = if (this == kotlin.math.floor(this) && !this.isInfinite()) toLong().toString() else toString()
