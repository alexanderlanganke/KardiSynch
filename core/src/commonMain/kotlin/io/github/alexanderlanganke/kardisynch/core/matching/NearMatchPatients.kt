package io.github.alexanderlanganke.kardisynch.core.matching

/** Minimal patient identity fields for near-match comparison — lighter than [PatientSummary] (issue #187), which also aggregates report count/serials. */
data class PatientIdentity(
    val id: String,
    val firstName: String,
    val lastName: String,
    val dob: String,
    val hospitalPatientId: String? = null,
)

/**
 * Patients that share exactly ONE identity component with an incoming
 * report — same DOB with a different last name, or same last name with a
 * different DOB — ported from `findNearMatchPatients` (issue #143/#173).
 * Part of the import-identity ladder: a generator change often comes with a
 * name/DOB spelling variant from the new programmer, and silently creating
 * a new patient next to such a near-match produces duplicates.
 *
 * An exact match on both components is deliberately excluded (that's a
 * direct, non-fuzzy lookup the caller does separately, before falling back
 * to this).
 */
fun findNearMatchPatients(candidates: List<PatientIdentity>, lastName: String, dob: String): List<PatientIdentity> {
    val key = normalizeNameKey(lastName)
    return candidates.filter { c ->
        val cKey = normalizeNameKey(c.lastName)
        (c.dob == dob && cKey != key) || (cKey == key && c.dob != dob)
    }
}
