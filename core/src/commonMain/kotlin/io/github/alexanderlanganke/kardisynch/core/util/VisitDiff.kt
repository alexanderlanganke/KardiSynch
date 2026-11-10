package io.github.alexanderlanganke.kardisynch.core.util

import io.github.alexanderlanganke.kardisynch.core.i18n.tr

/** One lead's headline measurements at a visit. Null = not recorded. */
data class LeadSnapshot(
    val name: String,
    val impedance: Double? = null,
    val threshold: Double? = null,
    val sensing: Double? = null,
)

/** The numbers worth comparing between two visits of the same patient. */
data class VisitSnapshot(
    val batteryVoltage: Double? = null,
    val batteryStatus: String? = null,
    val leads: List<LeadSnapshot> = emptyList(),
)

/** A field that differs between two visits, ready to show as "Battery 2.88 → 2.81 V". */
data class VisitChange(val label: String, val from: String, val to: String) {
    val text: String get() = "$label $from → $to"
}

private fun fmt(v: Double): String {
    val r = kotlin.math.round(v * 100) / 100
    return (if (r == kotlin.math.floor(r)) r.toLong().toString() else r.toString().trimEnd('0')).replace('.', io.github.alexanderlanganke.kardisynch.core.i18n.decimalSeparator())
}

/**
 * What changed from [from] (left pane) to [to] (right pane). Differences below
 * a small tolerance are noise from rounding in the exports and are not
 * reported; leads are matched by name, and a lead present on only one side is
 * skipped (a changed lead set is a device story, not a measurement trend).
 */
fun diffVisits(from: VisitSnapshot, to: VisitSnapshot): List<VisitChange> = buildList {
    fun num(label: String, a: Double?, b: Double?, unit: String, tolerance: Double) {
        if (a == null || b == null || kotlin.math.abs(a - b) < tolerance) return
        add(VisitChange(label, fmt(a), "${fmt(b)} $unit"))
    }
    num(tr("Battery"), from.batteryVoltage, to.batteryVoltage, "V", 0.005)
    val sa = from.batteryStatus?.trim().orEmpty()
    val sb = to.batteryStatus?.trim().orEmpty()
    if (sa.isNotEmpty() && sb.isNotEmpty() && !sa.equals(sb, ignoreCase = true)) add(VisitChange(tr("Battery status"), sa, sb))
    for (l in to.leads) {
        val before = from.leads.firstOrNull { it.name.equals(l.name, ignoreCase = true) } ?: continue
        num("${l.name} " + tr("impedance"), before.impedance, l.impedance, "Ω", 1.0)
        num("${l.name} " + tr("threshold"), before.threshold, l.threshold, "V", 0.02)
        num("${l.name} " + tr("sensing"), before.sensing, l.sensing, "mV", 0.1)
    }
}
