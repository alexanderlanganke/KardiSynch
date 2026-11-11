package io.github.alexanderlanganke.kardisynch.ui.format


/** "2026-10-14" or "2026-10-14T09:12:00" as "14 Oct 2026"; anything that is not an ISO date comes back unchanged. */
fun displayDate(iso: String?): String {
    if (iso == null) return ""
    val d = iso.take(10)
    val parts = d.split('-')
    if (parts.size != 3) return iso
    val year = parts[0].toIntOrNull() ?: return iso
    val month = parts[1].toIntOrNull()?.takeIf { it in 1..12 } ?: return iso
    val day = parts[2].toIntOrNull() ?: return iso
    val months = io.github.alexanderlanganke.kardisynch.core.i18n.monthAbbreviations()
    return if (io.github.alexanderlanganke.kardisynch.core.i18n.I18n.lang == io.github.alexanderlanganke.kardisynch.core.i18n.Lang.DE) "$day. ${months[month - 1]} $year" else "$day ${months[month - 1]} $year"
}

/** A unit as shown to people: `V @ 0.4ms` becomes `V @ 0,4 ms` (German) or `V @ 0.4 ms`. Units without a pulse width come back unchanged. */
fun displayUnit(unit: String?): String {
    val u = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit)
    val pw = u.pulseWidthMs
    return if (pw == null) u.unit else "${u.unit} @ ${displayNumber(pw)} ms"
}

/** A value with its unit for a table cell; the pulse width, if there is one, goes on a second line (`0,83 V` / `@ 0,4 ms`). */
fun displayValueWithUnit(value: Double, unit: String?): String {
    val u = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit)
    val pw = u.pulseWidthMs
    return (displayNumber(value) + " " + u.unit).trim() + (if (pw != null) "\n@ ${displayNumber(pw)} ms" else "")
}

/** [v] rounded to the two decimals [displayNumber] shows. Compare and rank values with this, never with the raw numbers behind them. */
fun roundedForDisplay(v: Double): Double = kotlin.math.round(v * 100.0) / 100.0

/** A number with at most two decimals, always with a point, without trailing zeros: 512, 0.75, 2.81. */
fun displayNumber(v: Double): String {
    val rounded = roundedForDisplay(v)
    val text = rounded.toString()
    val clean = if (text.contains('E') || text.contains('e')) "%.2f".format(rounded).replace(',', '.') else text
    return clean.trimEnd('0').trimEnd('.').ifEmpty { "0" }.replace('.', io.github.alexanderlanganke.kardisynch.core.i18n.decimalSeparator())
}
