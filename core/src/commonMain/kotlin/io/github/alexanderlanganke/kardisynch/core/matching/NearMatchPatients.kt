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
 * When the report AND the candidate both carry a first name and the two
 * [firstNamesClearlyDiffer], it is a different person who merely shares a last
 * name (or a birth date): such a candidate is not a near-match, so the caller can
 * create the new patient instead of asking the user to merge two strangers.
 * A missing first name on either side keeps the candidate (not enough to tell).
 *
 * An exact match on both components is deliberately excluded (that's a
 * direct, non-fuzzy lookup the caller does separately, before falling back
 * to this).
 */
fun findNearMatchPatients(candidates: List<PatientIdentity>, lastName: String, dob: String, firstName: String? = null): List<PatientIdentity> {
    val key = normalizeNameKey(lastName)
    return candidates.filter { c ->
        val cKey = normalizeNameKey(c.lastName)
        val sharesOneComponent = (c.dob == dob && cKey != key) || (cKey == key && c.dob != dob)
        sharesOneComponent && !firstNamesClearlyDiffer(firstName, c.firstName)
    }
}

/**
 * True only when both first names are present and cannot be the same person's
 * name: not equal, not one a prefix of the other ("Hans" / "Hans-Peter", "H." /
 * "Hans"), and not a single-character typo apart ("Katharina" / "Catharina").
 * Every doubt (a blank side, a near-spelling) answers false, which keeps the
 * conservative "ask the user" behaviour.
 */
fun firstNamesClearlyDiffer(a: String?, b: String?): Boolean {
    val x = normalizeNameKey(a).trimEnd('.').trim()
    val y = normalizeNameKey(b).trimEnd('.').trim()
    if (x.isEmpty() || y.isEmpty()) return false
    if (x == y || x.startsWith(y) || y.startsWith(x)) return false
    return nameDistance(x, y) > 1
}
