package io.github.alexanderlanganke.kardisynch.core.util

/** A measurement unit split from the pulse width it was measured at: `V @ 0.4ms` -> (`V`, 0.4). */
data class UnitAndPulse(val unit: String, val pulseWidthMs: Double?)

private val PULSE_UNIT = Regex("""^\s*(.*?)\s*@\s*([0-9]+(?:[.,][0-9]+)?)\s*ms\s*$""", RegexOption.IGNORE_CASE)

/**
 * Pacing thresholds and programmed amplitudes carry their pulse width inside the unit text, `V @ 0.4ms`.
 * That is the convention of the shared `_DATA` files (the Electron app wrote it first), so it stays the
 * storage format; this reads it back out. A unit without a pulse width, or with a dangling `@`, comes back
 * with a null pulse width.
 */
fun splitPulseUnit(unit: String?): UnitAndPulse {
    if (unit.isNullOrBlank()) return UnitAndPulse("", null)
    val m = PULSE_UNIT.matchEntire(unit)
    if (m != null) return UnitAndPulse(m.groupValues[1].ifEmpty { "V" }, m.groupValues[2].replace(',', '.').toDoubleOrNull())
    return UnitAndPulse(unit.substringBefore('@').trim(), null)
}
