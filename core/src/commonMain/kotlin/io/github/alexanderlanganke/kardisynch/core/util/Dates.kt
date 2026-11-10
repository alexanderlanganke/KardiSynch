package io.github.alexanderlanganke.kardisynch.core.util

/**
 * Ambiguous numeric date forms (both numbers <= 12) are resolved by this
 * hint: US = first number is month (M/D/Y), EU = first number is day
 * (D/M/Y), AUTO = dots/dashes -> EU, slashes -> US. Ported from
 * `DateLocaleHint` (src/lib/dates.ts).
 */
enum class DateLocaleHint { US, EU, AUTO }

private val isoRegex = Regex("""^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$""")
private val dmyRegex = Regex("""^(\d{1,2})[\s.]+([A-Za-zÄäÖöÜü]{3,})\.?[\s.]+(\d{4})$""")
private val mdyRegex = Regex("""^([A-Za-zÄäÖöÜü]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$""")
private val numRegex = Regex("""^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})$""")

private val monthAbbreviations = mapOf(
    "jan" to 1, "feb" to 2, "mar" to 3, "apr" to 4, "may" to 5, "jun" to 6,
    "jul" to 7, "aug" to 8, "sep" to 9, "oct" to 10, "nov" to 11, "dec" to 12,
    // German abbreviations that differ from English.
    "mär" to 3, "mrz" to 3, "mai" to 5, "okt" to 10, "dez" to 12,
)

/**
 * Canonical date normalizer, ported from `normalizeDate` (src/lib/dates.ts).
 * Every parser pipes extracted dates through this so what gets stored is
 * always `YYYY-MM-DD`. Returns `""` on empty/unparseable input.
 *
 * [assumedCurrentYear] replaces the original's `new Date().getFullYear()`
 * (used only to window 2-digit years, e.g. "52" -> 1952 not 2052) since
 * commonMain has no platform clock without adding a dependency — pass the
 * real current year from a platform actual if 2-digit-year windowing near
 * the current date boundary matters for a given call site.
 */
fun normalizeDate(
    input: String?,
    hint: DateLocaleHint = DateLocaleHint.AUTO,
    assumedCurrentYear: Int = 2026,
): String {
    if (input.isNullOrBlank()) return ""
    val str = input.trim()
    if (str.isEmpty()) return ""

    isoRegex.matchEntire(str)?.let { m ->
        val (y, mo, d) = m.destructured
        return canonicalize(y, mo, d)
    }
    dmyRegex.matchEntire(str)?.let { m ->
        val (d, monthName, y) = m.destructured
        val mo = monthAbbreviations[monthName.take(3).lowercase()]
        if (mo != null) return canonicalize(y, mo.toString(), d)
    }
    mdyRegex.matchEntire(str)?.let { m ->
        val (monthName, d, y) = m.destructured
        val mo = monthAbbreviations[monthName.take(3).lowercase()]
        if (mo != null) return canonicalize(y, mo.toString(), d)
    }
    numRegex.matchEntire(str)?.let { m ->
        val (aStr, sep, bStr, yRaw) = m.destructured
        val a = aStr.toInt()
        val b = bStr.toInt()
        var y = yRaw
        if (y.length == 2) {
            var yi = 2000 + y.toInt()
            if (yi > assumedCurrentYear) yi -= 100
            y = yi.toString()
        }
        val (day, month) = when {
            a > 12 && b <= 12 -> a to b
            b > 12 && a <= 12 -> b to a
            else -> {
                val localeDefault = if (sep == "/") DateLocaleHint.US else DateLocaleHint.EU
                val effective = if (hint == DateLocaleHint.AUTO) localeDefault else hint
                // US = month/day (a/b), so the (day, month) pair is (b, a); EU = day/month (a/b) as-is.
                if (effective == DateLocaleHint.US) b to a else a to b
            }
        }
        return canonicalize(y, month.toString(), day.toString())
    }

    return ""
}

private fun canonicalize(y: String, m: String, d: String): String {
    val yi = y.toIntOrNull() ?: return ""
    val mi = m.toIntOrNull() ?: return ""
    val di = d.toIntOrNull() ?: return ""
    if (mi < 1 || mi > 12 || di < 1 || !isValidDayOfMonth(yi, mi, di)) return ""
    return "${yi.toString().padStart(4, '0')}-${mi.toString().padStart(2, '0')}-${di.toString().padStart(2, '0')}"
}

private fun isValidDayOfMonth(year: Int, month: Int, day: Int): Boolean {
    val daysInMonth = intArrayOf(31, if (isLeapYear(year)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    return day in 1..daysInMonth[month - 1]
}

private fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
