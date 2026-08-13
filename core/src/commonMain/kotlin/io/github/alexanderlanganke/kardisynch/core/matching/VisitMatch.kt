package io.github.alexanderlanganke.kardisynch.core.matching

/**
 * Decides whether an imported file belongs to an existing same-day report or
 * needs a visit of its own. Ported from `pickSameDayReport`
 * (src/main/services/visitMatch.ts).
 *
 * Two bugs pull in opposite directions here. Issue #140: while a task sat in
 * the sort queue, auto-import may already have created the visit for the
 * same interrogation — resolving the task must not create a duplicate.
 * Issue #145: a patient can genuinely have several visits on one day (e.g.
 * pre- and post-MRI interrogations) — date-prefix matching alone silently
 * merges the second visit into the first, losing it. So a same-day report
 * is only reused when nothing contradicts it being the same interrogation.
 */

data class ReportMatchCandidate(val id: String, val interrogationDate: String?, val deviceSerialNumber: String?)

// Files from one interrogation session can carry timestamps a few minutes
// apart (e.g. the XML export vs. a PDF printed at the end of the session),
// while genuinely distinct same-day visits are hours apart. Timestamps
// within this window are treated as the same interrogation.
private const val SAME_INTERROGATION_TOLERANCE_MS = 30 * 60 * 1000L

private fun normalizeSerial(value: String?): String = (value ?: "").trim().lowercase()

/** Only a value with a time component (`T` followed by a digit) can distinguish two same-day visits. */
private fun timestampMs(value: String?): Long? {
    val s = (value ?: "").trim()
    if (!Regex("""T\d""").containsMatchIn(s)) return null
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})""").find(s) ?: return null
    val (y, mo, d, h, mi, se) = m.destructured
    return try {
        epochMillisUtc(y.toInt(), mo.toInt(), d.toInt(), h.toInt(), mi.toInt(), se.toInt())
    } catch (e: Exception) {
        null
    }
}

/**
 * Days-since-epoch via Howard Hinnant's `days_from_civil` algorithm — avoids
 * pulling in kotlinx-datetime for one timestamp-difference calculation.
 * Treating both sides as UTC (rather than matching the original's
 * local-time `Date.parse` interpretation) doesn't change the result: only
 * the *difference* between two timestamps is ever compared, which is
 * invariant to a constant timezone offset applied consistently to both.
 */
private fun epochMillisUtc(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int): Long {
    val y = if (month <= 2) year - 1 else year
    val era = (if (y >= 0) y else y - 399) / 400
    val yoe = y - era * 400
    val mp = (month + 9) % 12
    val doy = (153 * mp + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    val days = era.toLong() * 146097L + doe.toLong() - 719468L
    return (days * 86400L + hour * 3600L + minute * 60L + second) * 1000L
}

/**
 * @param candidates All of the patient's reports on the target day.
 * @param parsedInterrogationDate The incoming file's parsed interrogation date (null if unparseable).
 * @param parsedDeviceSerial The incoming file's parsed device serial.
 * @param explicitNewVisit The user chose "Create New Visit" in the assignment dialog. Their choice
 *   wins: only a provably identical interrogation (timestamps within tolerance) is still deduped
 *   against the #140 auto-import race.
 */
fun pickSameDayReport(
    candidates: List<ReportMatchCandidate>,
    parsedInterrogationDate: String?,
    parsedDeviceSerial: String?,
    explicitNewVisit: Boolean,
): ReportMatchCandidate? {
    val incomingSerial = normalizeSerial(parsedDeviceSerial)
    val incomingTime = timestampMs(parsedInterrogationDate)

    for (candidate in candidates) {
        val candidateSerial = normalizeSerial(candidate.deviceSerialNumber)
        val candidateTime = timestampMs(candidate.interrogationDate)

        val serialConflict = incomingSerial.isNotEmpty() && candidateSerial.isNotEmpty() && incomingSerial != candidateSerial
        val bothTimed = incomingTime != null && candidateTime != null
        val sameSession = bothTimed && kotlin.math.abs(incomingTime!! - candidateTime!!) <= SAME_INTERROGATION_TOLERANCE_MS

        if (explicitNewVisit) {
            if (sameSession && !serialConflict) return candidate
        } else if (!serialConflict && (!bothTimed || sameSession)) {
            return candidate
        }
    }
    return null
}
