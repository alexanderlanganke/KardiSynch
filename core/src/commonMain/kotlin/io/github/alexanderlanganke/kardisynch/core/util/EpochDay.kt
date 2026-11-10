package io.github.alexanderlanganke.kardisynch.core.util

/**
 * Days since the Unix epoch, via Howard Hinnant's `days_from_civil`
 * algorithm — commonMain has no platform date/calendar API, so date-diff
 * math throughout this port (same-day visit matching, near-match patient
 * detection, and now "days since last visit" display) all goes through
 * this one shared implementation instead of each caller hand-rolling it.
 */
fun epochDay(year: Int, month: Int, day: Int): Long {
    val y = if (month <= 2) year - 1 else year
    val era = (if (y >= 0) y else y - 399) / 400
    val yoe = y - era * 400
    val mp = (month + 9) % 12
    val doy = (153 * mp + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era.toLong() * 146097L + doe.toLong() - 719468L
}

/** Parses a `YYYY-MM-DD`-prefixed date string to its epoch day, or null if it doesn't start with that shape. */
fun parseIsoEpochDay(date: String): Long? {
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(date) ?: return null
    val (y, mo, d) = m.destructured
    return try {
        epochDay(y.toInt(), mo.toInt(), d.toInt())
    } catch (e: Exception) {
        null
    }
}

/**
 * Trims an ISO instant (`2025-11-04T08:13:54.615Z`) or plain date down to
 * just its `YYYY-MM-DD` portion. commonMain has no cross-platform locale
 * date formatter (this port already avoids pulling in kotlinx-datetime for
 * lesser reasons, see `VisitMatch.kt`'s doc comment), so this is a
 * deliberately simple display transform rather than a "Nov 4, 2025"-style
 * formatter — it exists purely to stop raw timestamps (with seconds and a
 * trailing `Z`) from showing up in visit dates throughout the UI.
 */
fun isoDateOnly(raw: String): String = raw.substringBefore('T')

/** `toIso` minus `fromIso`, in whole days — null if either date doesn't parse. */
fun daysBetweenIsoDates(fromIso: String, toIso: String): Int? {
    val from = parseIsoEpochDay(fromIso) ?: return null
    val to = parseIsoEpochDay(toIso) ?: return null
    return (to - from).toInt()
}

/**
 * Whole years between `dobIso` and `asOfIso` (birthday-aware, not a plain
 * `/365.25` — a patient born 2020-08-14 is 5, not 6, on 2026-08-13). Null
 * if either date doesn't parse.
 */
fun ageInYears(dobIso: String, asOfIso: String): Int? {
    val dobMatch = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(dobIso) ?: return null
    val asOfMatch = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(asOfIso) ?: return null
    val (dobY, dobM, dobD) = dobMatch.destructured
    val (asOfY, asOfM, asOfD) = asOfMatch.destructured
    var age = asOfY.toInt() - dobY.toInt()
    if (asOfM.toInt() < dobM.toInt() || (asOfM.toInt() == dobM.toInt() && asOfD.toInt() < dobD.toInt())) age--
    return age
}
