package io.github.alexanderlanganke.kardisynch.core.util

/** Why a patient is on the "needs attention" list. */
enum class AttentionReason { ADVISORY, BATTERY, OVERDUE }

/** How alarming the worst reason is, for the one-word status on a patient row. */
enum class AttentionLevel { NONE, ATTENTION, ALERT }

/**
 * What the dashboard should flag for one patient. [warningSafe] is true only
 * when the manufacturer check positively says "safe" — an unchecked patient is
 * neither safe nor flagged, so the row shows no status instead of a false "OK".
 */
data class PatientAttention(val reasons: Set<AttentionReason>, val warningSafe: Boolean) {
    val level: AttentionLevel
        get() = when {
            AttentionReason.ADVISORY in reasons -> AttentionLevel.ALERT
            reasons.isNotEmpty() -> AttentionLevel.ATTENTION
            else -> AttentionLevel.NONE
        }
    val needsAttention: Boolean get() = reasons.isNotEmpty()
}

const val DEFAULT_OVERDUE_DAYS = 180

/**
 * @param warningState the manufacturer-warning state string: `safe`, `advisory`, `recall`, `manual_check`, or null if never checked.
 * @param batteryStatus the latest report's battery status text; ERI/EOS/EOL count as attention.
 * @param daysSinceVisit days since the latest visit, or null if unknown (no visits, or no clock).
 */
fun patientAttention(
    warningState: String?,
    batteryStatus: String?,
    daysSinceVisit: Int?,
    overdueDays: Int = DEFAULT_OVERDUE_DAYS,
): PatientAttention {
    val reasons = buildSet {
        if (warningState == "advisory" || warningState == "recall") add(AttentionReason.ADVISORY)
        if (isCriticalBatteryStatus(batteryStatus)) add(AttentionReason.BATTERY)
        if (daysSinceVisit != null && daysSinceVisit > overdueDays) add(AttentionReason.OVERDUE)
    }
    return PatientAttention(reasons, warningSafe = warningState == "safe")
}
