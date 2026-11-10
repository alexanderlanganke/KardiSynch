package io.github.alexanderlanganke.kardisynch.core.intake

import io.github.alexanderlanganke.kardisynch.core.matching.normalizeSerial
import io.github.alexanderlanganke.kardisynch.core.matching.timestampMs

/** One file as the bundler sees it. */
data class IntakeItem(
    val id: String,
    val fileName: String,
    val identification: Identification,
    val facts: DocumentFacts,
    /** Directory the file was found in, for the "same burst in the same folder" fallback. */
    val sourceDir: String = "",
    val arrivedAtMs: Long = 0L,
) {
    val isPdf: Boolean get() = identification.kind.isPdf
    val stem: String get() = fileName.substringBeforeLast('.', fileName)
}

/**
 * Files that describe ONE interrogation. [facts] is the best-of-each-field
 * merge, with structured files taking precedence over PDFs.
 */
data class Bundle(
    val id: String,
    val items: List<IntakeItem>,
    val facts: DocumentFacts,
    /** Names of fields on which members of this bundle contradict each other (empty when consistent). */
    val conflicts: List<String> = emptyList(),
) {
    val structured: List<IntakeItem> get() = items.filter { it.identification.kind.isStructured }
    val pdfs: List<IntakeItem> get() = items.filter { it.isPdf }
}

/** Interrogation files from one session can carry timestamps minutes apart; distinct visits are hours apart. */
const val BUNDLE_TIME_TOLERANCE_MS = 30 * 60 * 1000L

/** A file that arrives within this window of its folder-mates, and tells nothing about itself, joins them. */
const val BUNDLE_BURST_WINDOW_MS = 2 * 60 * 1000L

private val genericStems = setOf("report", "bericht", "export", "scan", "document", "dokument", "visit", "data", "file", "datei")

private fun sameSession(a: DocumentFacts, b: DocumentFacts): Boolean? {
    val ta = timestampMs(a.interrogation)
    val tb = timestampMs(b.interrogation)
    if (ta != null && tb != null) return kotlin.math.abs(ta - tb) <= BUNDLE_TIME_TOLERANCE_MS
    val da = a.interrogation?.take(10)
    val db = b.interrogation?.take(10)
    if (da != null && db != null) return da == db
    return null // at least one side has no date at all
}

private fun contradict(a: DocumentFacts, b: DocumentFacts): Boolean {
    val sa = normalizeSerial(a.serial)
    val sb = normalizeSerial(b.serial)
    if (sa.isNotEmpty() && sb.isNotEmpty() && sa != sb) return true
    return compareFacts(a, b).any { it.field != "Device serial" && it.agreement == FactAgreement.CONFLICT }
}

/** Whether two items plausibly belong to the same interrogation. */
private fun linked(a: IntakeItem, b: IntakeItem): Boolean {
    if (contradict(a.facts, b.facts)) return false

    val sa = normalizeSerial(a.facts.serial)
    val sb = normalizeSerial(b.facts.serial)
    if (sa.isNotEmpty() && sa == sb) {
        // Same device: the same interrogation unless the times prove otherwise.
        return sameSession(a.facts, b.facts) != false
    }

    // Companions exported side by side share a base name (12345.pdd + 12345.pdf).
    val stemA = a.stem.lowercase()
    if (stemA == b.stem.lowercase() && stemA !in genericStems && stemA.length >= 3) return true

    // Same patient and day, neither names a serial.
    if (sa.isEmpty() && sb.isEmpty() && a.facts.hasPatientIdentity && b.facts.hasPatientIdentity &&
        normalizeNameKey2(a.facts) == normalizeNameKey2(b.facts) && sameSession(a.facts, b.facts) == true
    ) {
        return true
    }
    return false
}

private fun normalizeNameKey2(f: DocumentFacts) = "${f.lastName?.lowercase()}|${f.dob}"

private class Dsu(n: Int) {
    private val p = IntArray(n) { it }
    fun find(x: Int): Int { var r = x; while (p[r] != r) r = p[r]; var c = x; while (p[c] != r) { val nx = p[c]; p[c] = r; c = nx }; return r }
    fun union(a: Int, b: Int) { p[find(a)] = find(b) }
}

/**
 * Groups [items] into bundles (one per interrogation).
 *
 * Linking is by FACTS — same device serial within the time tolerance, shared
 * base name, or same patient and day — never by in-memory file-name state, so
 * it behaves identically for files arriving together and files arriving
 * minutes apart, and across a restart. Files that contradict each other
 * (different serial, different last name or birth date) are never linked, even
 * when a name matches. A file that tells us nothing about itself (an unreadable
 * PDF) joins its folder-mates only when that is unambiguous: it arrived within
 * [BUNDLE_BURST_WINDOW_MS] of exactly one candidate bundle in the same folder.
 */
fun groupIntoBundles(items: List<IntakeItem>): List<Bundle> {
    if (items.isEmpty()) return emptyList()
    val dsu = Dsu(items.size)
    for (i in items.indices) for (j in i + 1 until items.size) if (linked(items[i], items[j])) dsu.union(i, j)

    // Burst fallback for files that say nothing about themselves.
    val blind = items.indices.filter { items[it].facts.isEmpty && items[it].identification.kind != FileKind.UNKNOWN }
    for (i in blind) {
        val candidates = items.indices
            .filter { it != i && dsu.find(it) != dsu.find(i) && items[it].sourceDir == items[i].sourceDir && !items[it].facts.isEmpty }
            .filter { kotlin.math.abs(items[it].arrivedAtMs - items[i].arrivedAtMs) <= BUNDLE_BURST_WINDOW_MS }
            .map { dsu.find(it) }
            .distinct()
        if (candidates.size == 1) dsu.union(i, candidates.single())
    }

    return items.indices.groupBy { dsu.find(it) }.values.map { idx ->
        val members = idx.map { items[it] }.sortedWith(compareBy({ it.isPdf }, { it.arrivedAtMs }, { it.fileName }))
        buildBundle(members)
    }.sortedBy { b -> b.items.minOf { it.arrivedAtMs } }
}

private fun buildBundle(members: List<IntakeItem>): Bundle {
    fun <T : Any> best(pick: (DocumentFacts) -> T?): T? = members.firstNotNullOfOrNull { pick(it.facts) }
    val facts = DocumentFacts(
        manufacturer = members.firstNotNullOfOrNull { it.identification.manufacturer ?: it.facts.manufacturer },
        lastName = best { it.lastName },
        // Prefer the longest first name: "Erika" over "E.".
        firstName = members.mapNotNull { it.facts.firstName }.maxByOrNull { it.length },
        dob = best { it.dob },
        patientId = best { it.patientId },
        serial = best { it.serial },
        model = best { it.model },
        // The most precise timestamp (one that carries a time) wins.
        interrogation = members.mapNotNull { it.facts.interrogation }.maxByOrNull { it.length },
    )
    val conflicts = buildSet {
        for (i in members.indices) for (j in i + 1 until members.size) {
            compareFacts(members[i].facts, members[j].facts).filter { it.agreement == FactAgreement.CONFLICT }.forEach { add(it.field) }
        }
    }.toList()
    val id = members.first().id
    return Bundle(id, members, facts, conflicts)
}
