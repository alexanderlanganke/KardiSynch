package io.github.alexanderlanganke.kardisynch.core.util

/**
 * Normalises a typed birth date to the ISO `YYYY-MM-DD` the data store uses. Accepts ISO as well as the
 * German `TT.MM.JJJJ` (also `T.M.JJJJ`, and `/` or `-` as separators). Null when it is not a real calendar date.
 */
fun normalizeDobInput(input: String): String? {
    val t = input.trim()
    val m = Regex("""^(\d{4})-(\d{1,2})-(\d{1,2})$""").matchEntire(t)?.destructured?.let { (y, mo, d) -> Triple(y.toInt(), mo.toInt(), d.toInt()) }
        ?: Regex("""^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$""").matchEntire(t)?.destructured?.let { (d, mo, y) -> Triple(y.toInt(), mo.toInt(), d.toInt()) }
        ?: return null
    val (y, mo, d) = m
    if (y !in 1850..2100 || mo !in 1..12 || d < 1) return null
    val leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    val days = intArrayOf(31, if (leap) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[mo - 1]
    if (d > days) return null
    return "%04d-%02d-%02d".format(y, mo, d)
}
