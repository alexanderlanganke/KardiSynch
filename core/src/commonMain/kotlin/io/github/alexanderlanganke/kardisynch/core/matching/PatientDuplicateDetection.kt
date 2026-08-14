package io.github.alexanderlanganke.kardisynch.core.matching

/**
 * Duplicate/probable-duplicate patient detection, ported from
 * `services/patientMergeService.ts`'s `findDuplicatePatientGroups` (issue
 * #187) — five confidence tiers, strongest to weakest, each pairwise link
 * unioned into connected groups so transitively-related patients (A~B, B~C)
 * end up in one group instead of three overlapping pairs.
 */

enum class DupTier { EXACT, SERIAL, DOB_FUZZY_NAME, NAME_CLOSE_DOB, NAME_ONLY }

private val TIER_ORDER = listOf(DupTier.EXACT, DupTier.SERIAL, DupTier.DOB_FUZZY_NAME, DupTier.NAME_CLOSE_DOB, DupTier.NAME_ONLY)

private val TIER_LABELS = mapOf(
    DupTier.EXACT to "Same name and date of birth",
    DupTier.SERIAL to "Shared device serial number",
    DupTier.DOB_FUZZY_NAME to "Same date of birth, similar last name",
    DupTier.NAME_CLOSE_DOB to "Same last name, near-identical date of birth",
    DupTier.NAME_ONLY to "Same last name",
)

private const val LAST_NAME_FUZZY_MAX_DISTANCE = 2
private const val DOB_CLOSE_MAX_DAYS = 3

data class PatientSummary(
    val id: String,
    val firstName: String?,
    val lastName: String?,
    val dob: String?,
    val hospitalPatientId: String?,
    val reportCount: Int,
    val lastReportDate: String?,
    val serials: List<String>,
)

data class PatientDupGroup(val tier: DupTier, val reason: String, val patients: List<PatientSummary>)

/**
 * Collapses whitespace and lowercases — a documented simplification of
 * `normalizeNameKey`'s TS original, which also applies Unicode NFC
 * normalization first (`String.normalize('NFC')`); `commonMain` has no
 * platform-agnostic NFC normalizer without an `expect`/`actual` for one
 * extra edge case (pre-composed vs. decomposed accented characters
 * comparing unequal). Matches the `.trim().lowercase()` key already used
 * elsewhere in this codebase (e.g. `KardiSynchRepository`'s `lastNameKey`).
 */
fun normalizeNameKey(name: String?): String = (name ?: "").replace(Regex("""\s+"""), " ").trim().lowercase()

/**
 * Levenshtein edit distance between two names, computed on their
 * [normalizeNameKey] keys. Single-row dynamic programming, ported verbatim
 * from `lib/names.ts`'s `nameDistance`.
 */
fun nameDistance(a: String?, b: String?): Int {
    val s = normalizeNameKey(a)
    val t = normalizeNameKey(b)
    if (s == t) return 0
    if (s.isEmpty()) return t.length
    if (t.isEmpty()) return s.length

    var prev = IntArray(t.length + 1) { it }
    for (i in 1..s.length) {
        var diagonal = prev[0]
        prev[0] = i
        for (j in 1..t.length) {
            val cost = if (s[i - 1] == t[j - 1]) 0 else 1
            val insertOrDelete = minOf(prev[j] + 1, prev[j - 1] + 1)
            val substitute = diagonal + cost
            diagonal = prev[j]
            prev[j] = minOf(insertOrDelete, substitute)
        }
    }
    return prev[t.length]
}

/** Whole-day difference between two `YYYY-MM-DD` dates, or null if either is unparseable — ported from `dobDayDiff`. */
internal fun dobDayDiff(a: String?, b: String?): Double? {
    if (a.isNullOrEmpty() || b.isNullOrEmpty()) return null
    val ta = parseIsoDateMillis(a) ?: return null
    val tb = parseIsoDateMillis(b) ?: return null
    return kotlin.math.abs(ta - tb) / (1000.0 * 60 * 60 * 24)
}

private fun parseIsoDateMillis(date: String): Long? {
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(date) ?: return null
    val (y, mo, d) = m.destructured
    return try {
        epochMillisUtc(y.toInt(), mo.toInt(), d.toInt())
    } catch (e: Exception) {
        null
    }
}

/** Days-since-epoch via Howard Hinnant's `days_from_civil` algorithm — see [pickSameDayReport] for the same technique/rationale. */
private fun epochMillisUtc(year: Int, month: Int, day: Int): Long {
    val y = if (month <= 2) year - 1 else year
    val era = (if (y >= 0) y else y - 399) / 400
    val yoe = y - era * 400
    val mp = (month + 9) % 12
    val doy = (153 * mp + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    val days = era.toLong() * 146097L + doe.toLong() - 719468L
    return days * 86400L * 1000L
}

/** A minimal union-find over patient IDs, ported from the TS original's `UnionFind`. */
private class UnionFind {
    private val parent = mutableMapOf<String, String>()

    fun find(x: String): String {
        if (x !in parent) parent[x] = x
        var root = x
        while (parent[root] != root) root = parent[root]!!
        var cur = x
        while (parent[cur] != root) {
            val next = parent[cur]!!
            parent[cur] = root
            cur = next
        }
        return root
    }

    fun union(a: String, b: String) {
        val ra = find(a)
        val rb = find(b)
        if (ra != rb) parent[ra] = rb
    }
}

fun findDuplicatePatientGroups(patients: List<PatientSummary>): List<PatientDupGroup> {
    fun rank(t: DupTier) = TIER_ORDER.indexOf(t)

    val pairTier = mutableMapOf<String, DupTier>()
    val pairReason = mutableMapOf<String, String>()

    fun pairKey(a: String, b: String) = if (a < b) "$a|$b" else "$b|$a"
    fun link(a: String, b: String, tier: DupTier, reason: String) {
        if (a == b) return
        val key = pairKey(a, b)
        val existing = pairTier[key]
        if (existing == null || rank(tier) < rank(existing)) {
            pairTier[key] = tier
            pairReason[key] = reason
        }
    }

    val serialIndex = mutableMapOf<String, MutableList<String>>()
    for (p in patients) {
        for (s in p.serials) {
            serialIndex.getOrPut(s) { mutableListOf() }.add(p.id)
        }
    }
    for ((serial, ids) in serialIndex) {
        if (ids.size < 2) continue
        for (i in ids.indices) {
            for (j in i + 1 until ids.size) {
                link(ids[i], ids[j], DupTier.SERIAL, "${TIER_LABELS[DupTier.SERIAL]} ($serial)")
            }
        }
    }

    val byId = patients.associateBy { it.id }
    for (i in patients.indices) {
        val a = patients[i]
        val aKey = normalizeNameKey(a.lastName)
        for (j in i + 1 until patients.size) {
            val b = patients[j]
            val bKey = normalizeNameKey(b.lastName)
            if (aKey.isEmpty() && bKey.isEmpty()) continue

            val sameName = aKey.isNotEmpty() && bKey.isNotEmpty() && aKey == bKey
            val sameDob = !a.dob.isNullOrEmpty() && !b.dob.isNullOrEmpty() && a.dob == b.dob

            if (sameName && sameDob) {
                link(a.id, b.id, DupTier.EXACT, TIER_LABELS[DupTier.EXACT]!!)
                continue
            }
            if (sameDob) {
                val dist = nameDistance(a.lastName, b.lastName)
                if (dist in 1..LAST_NAME_FUZZY_MAX_DISTANCE) {
                    link(a.id, b.id, DupTier.DOB_FUZZY_NAME, "${TIER_LABELS[DupTier.DOB_FUZZY_NAME]} (edit distance $dist)")
                    continue
                }
            }
            if (sameName) {
                val dayDiff = dobDayDiff(a.dob, b.dob)
                if (dayDiff != null && dayDiff > 0 && dayDiff <= DOB_CLOSE_MAX_DAYS) {
                    link(a.id, b.id, DupTier.NAME_CLOSE_DOB, "${TIER_LABELS[DupTier.NAME_CLOSE_DOB]} ($dayDiff day diff)")
                    continue
                }
                link(a.id, b.id, DupTier.NAME_ONLY, TIER_LABELS[DupTier.NAME_ONLY]!!)
            }
        }
    }

    val uf = UnionFind()
    for (key in pairTier.keys) {
        val (x, y) = key.split("|")
        uf.union(x, y)
    }

    val componentMembers = mutableMapOf<String, MutableSet<String>>()
    val componentTier = mutableMapOf<String, DupTier>()
    val componentReason = mutableMapOf<String, String>()

    fun addMember(root: String, id: String) {
        componentMembers.getOrPut(root) { mutableSetOf() }.add(id)
    }

    for ((key, tier) in pairTier) {
        val (x, y) = key.split("|")
        val root = uf.find(x)
        addMember(root, x)
        addMember(root, y)
        val existing = componentTier[root]
        if (existing == null || rank(tier) < rank(existing)) {
            componentTier[root] = tier
            componentReason[root] = pairReason[key]!!
        }
    }

    val groups = componentMembers.entries
        .filter { it.value.size >= 2 }
        .map { (root, members) ->
            val summaries = members.mapNotNull { byId[it] }.sortedByDescending { it.reportCount }
            PatientDupGroup(tier = componentTier[root]!!, reason = componentReason[root]!!, patients = summaries)
        }
        .sortedBy { rank(it.tier) }

    return groups
}
