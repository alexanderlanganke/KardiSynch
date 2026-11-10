package io.github.alexanderlanganke.kardisynch.core.intake

import io.github.alexanderlanganke.kardisynch.core.matching.normalizeNameKey
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.util.DateLocaleHint
import io.github.alexanderlanganke.kardisynch.core.util.normalizeDate

/**
 * The few facts about an interrogation that are enough to decide which
 * patient and which visit a file belongs to — whether they came from a parsed
 * structured export or were read out of a PDF's text. Everything is nullable:
 * "the file doesn't say" must stay distinct from "Unknown".
 */
data class DocumentFacts(
    val manufacturer: String? = null,
    val lastName: String? = null,
    val firstName: String? = null,
    /** ISO `YYYY-MM-DD`. */
    val dob: String? = null,
    val patientId: String? = null,
    val serial: String? = null,
    val model: String? = null,
    /** ISO `YYYY-MM-DD`, with `THH:MM:SS` when the file carries a time. */
    val interrogation: String? = null,
) {
    val hasPatientIdentity: Boolean get() = !lastName.isNullOrBlank() && !dob.isNullOrBlank()
    val isEmpty: Boolean get() = lastName == null && dob == null && serial == null && interrogation == null
}

private fun String?.clean(): String? = this?.trim()?.takeIf { it.isNotEmpty() && !it.equals("unknown", true) && it != "." }

/** Facts from a successfully parsed structured report. */
fun UnifiedReport.toFacts(): DocumentFacts = DocumentFacts(
    manufacturer = manufacturer.clean(),
    lastName = patient.lastName.clean(),
    firstName = patient.firstName.clean(),
    dob = patient.dob.clean(),
    patientId = patient.hospitalPatientId.clean(),
    serial = device.serialNumber.clean(),
    model = device.model.clean(),
    interrogation = interrogationDate.clean(),
)

/**
 * A minimal, clearly-partial report built from a PDF's facts, so a PDF can
 * start (or be merged into) a visit on its own. Electron did the same with
 * `extractStructuredData`. Marked [ParseStatus.PARTIAL] and carrying no
 * measurements, so it can never overwrite structured data (see `mergeReports`).
 */
fun DocumentFacts.toPartialReport(rawText: String?): UnifiedReport = UnifiedReport(
    manufacturer = manufacturer ?: "Unknown",
    interrogationDate = interrogation ?: "",
    patient = PatientInfo(firstName ?: "Unknown", lastName ?: "Unknown", dob ?: "", patientId),
    device = DeviceInfo(type = "Unknown", model = model ?: "Unknown", serialNumber = serial ?: "Unknown"),
    rawText = rawText,
    parseStatus = ParseStatus.PARTIAL,
)

private const val LETTERS = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00f6\\u00f8-\\u00ff"

// Medtronic SmartSync: Prefix_Lastname,_Firstname-Serial-Type-DD_Mon_YYYY…
private val medtronicNameA = Regex("""_(?<last>[$LETTERS]+)(?:_|, ?)(?<first>[$LETTERS]+)-(?<serial>[A-Z0-9]+)-(?<type>[A-Za-z0-9]+)-(?<day>\d{2})_(?<month>[A-Za-z]{3})_(?<year>\d{4})""")
private val medtronicNameB = Regex("""(?:^|_)(?<last>[$LETTERS]+)(?:_|, ?_?)(?<first>[$LETTERS]+)-(?<serial>[A-Z0-9]+)-(?<type>[A-Za-z0-9]+)-(?<day>\d{2})_(?<month>[A-Za-z]{3})_(?<year>\d{4})""")

// Biotronik: BIOSTD_YYYY-MM-DD_HH-MM-SS_Lastname_Firstname_Serial
private val biotronikName = Regex("""BIOSTD_(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})_(?<hour>\d{2})-(?<minute>\d{2})-(?<second>\d{2})_(?<last>[$LETTERS]+)_(?<first>[$LETTERS]+)_(?<serial>[A-Z0-9]+)""")

/** Which manufacturer's export pattern a PDF file name follows, if any. */
fun manufacturerFromPdfFileName(fileName: String): String? = when {
    medtronicNameA.containsMatchIn(fileName) || medtronicNameB.containsMatchIn(fileName) -> "Medtronic"
    biotronikName.containsMatchIn(fileName) -> "Biotronik"
    else -> null
}

private val invalidNames = setOf("NA", "Software", "Cardiac", "Patient", "Arztes", "Enaktivität", "Enidentifikation", "Analyse", "Bericht", "Report", "Device", "Model", "Serial")

private fun validName(last: String, first: String) =
    last.length >= 2 && first.length >= 2 && last !in invalidNames && first !in invalidNames

private val nameLastFirst = Regex("""(?:Patient(?: Name)?|Name|Patientenname):?\s*(?<last>[$LETTERS'-]+)[,]\s*(?<first>[$LETTERS'-]+)""", RegexOption.IGNORE_CASE)
private val nameFirstLast = Regex("""(?:Patient(?: Name)?|Name|Patientenname):?\s*(?!Name)(?<first>[$LETTERS'-]+)\s+(?<last>[$LETTERS'-]+)""", RegexOption.IGNORE_CASE)
private val dobIsoRegex = Regex("""(?:DOB|Date of Birth|Geburtsdatum|Born):?\s*(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})""", RegexOption.IGNORE_CASE)
private val dobRegex = Regex("""(?:DOB|Date of Birth|Geburtsdatum|Born):?\s*(?<a>\d{1,2})(?<sep>[./-])(?<b>\d{1,2})\k<sep>(?<year>\d{2,4})""", RegexOption.IGNORE_CASE)
private val interrogationIsoRegex = Regex(
    """(?:Interrogation Date|Session Date|Unters\.datum|Untersuchungsdatum|Messdatum|Report Date|Date):?\s*(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})(?:[T\s]+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?""",
    RegexOption.IGNORE_CASE,
)
// Medtronic SmartSync PDFs: "Interrogation Date: 24 Jul 2024 09 15 03 123" (space separated, with a time and milliseconds)
private val interrogationSpacedRegex = Regex(
    """(?:Interrogation Date|Session Date|Unters\.datum|Untersuchungsdatum|Messdatum|Report Date|Date):?\s*(?<day>\d{1,2})\s+(?<month>[A-Za-z]{3,9})\.?\s+(?<year>\d{4})(?:\s+(?<hour>\d{2})\s+(?<minute>\d{2})\s+(?<second>\d{2})(?:\s+\d{1,3})?)?""",
    RegexOption.IGNORE_CASE,
)
private val interrogationRegex = Regex(
    """(?:Interrogation Date|Session Date|Unters\.datum|Untersuchungsdatum|Messdatum|Report Date|Date):?\s*(?<day>\d{1,2})[./-](?<month>[A-Za-z]{3}|\d{1,2})[./-](?<year>\d{4})(?:\s+(?:at\s+)?(?<hour>\d{1,2})[:.](?<minute>\d{2})(?:[:.](?<second>\d{2}))?\s*(?<ampm>AM|PM)?)?""",
    RegexOption.IGNORE_CASE,
)
// A serial has at least 4 characters and at least one digit, so "Serial number is ..." can't yield "is".
private val serialRegex = Regex("""(?:\bSerial(?:\s+(?:Number|No\.?))?|Seriennummer|\bSN)(?::\s*|\s+)(?<serial>(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})""", RegexOption.IGNORE_CASE)
private val modelRegex = Regex("""(?:Device Model|Model|Gerät|Device):?[ \t]*(?<model>[A-Za-z0-9 \t\-.]+?)(?=\s{2,}|\r|\n|$)""", RegexOption.IGNORE_CASE)
private val mrnRegex = Regex("""(?:MRN|Patient ?ID|Patienten-?ID|Fallnummer):?\s*(?<id>[A-Z0-9][A-Z0-9-]{3,})""", RegexOption.IGNORE_CASE)

// Boston Scientific LATITUDE programmer reports (German layout). The header carries
//   "Last, First", "Geburtsdatum 15 Sep 1950", "Bericht erstel. 03 Nov 2026" and
//   "Aggregat ESSENTIO MRI L111/ 123456" (model, model code / serial).
// "Bericht erstel." is the day the report was printed from the programmer, which is the
// session's own day; "Letzte Abfrage in der Praxis" is the PREVIOUS in-office visit.
private val bostonAggregat = Regex("""Aggregat[ \t]+(?<model>[^\n\r/]*?)[ \t]*(?<code>[A-Z]\d{3})[ \t]*/[ \t]*(?<serial>\d{4,})""")
private val bostonDobText = Regex("""(?:Geburtsdatum|Date of Birth|DOB)[ \t]+(?<d>\d{1,2})[ \t]+(?<m>[$LETTERS]{3,9})\.?[ \t]+(?<y>\d{4})""", RegexOption.IGNORE_CASE)
private val bostonReportDate = Regex("""(?:Bericht[ \t]+erstel\.?|Report[ \t]+Created)[ \t]+(?<d>\d{1,2})[ \t]+(?<m>[$LETTERS]{3,9})\.?[ \t]+(?<y>\d{4})""", RegexOption.IGNORE_CASE)
private val bostonHeaderName = Regex(
    // Up to three words before the comma: surnames can be compound ("Von Muster", "Muster Beispiel"). Header words
    // that share the line are trimmed off the left afterwards.
    """(?<last>[$LETTERS'-]{2,}(?:[ \t]+[$LETTERS'-]{2,}){0,2}),[ \t]*(?<first>[$LETTERS'-]{2,}(?:[ \t]+[$LETTERS'-]{2,})?)""",
    RegexOption.IGNORE_CASE,
)
private val bostonHeaderWords = setOf(
    "letzte", "abfrage", "bericht", "patientendaten", "geburtsdatum", "aggregat", "praxis", "system", "programming",
    "latitude", "patient", "name", "date", "dat", "implant", "last", "interrogation",
)

private data class BostonHeader(val last: String?, val first: String?, val dob: String?, val serial: String?, val model: String?, val reportDate: String?)

/** Facts from a LATITUDE report header, or null when [text] is not one. Every field stays null when it isn't found. */
private fun extractBostonHeader(text: String): BostonHeader? {
    if (!text.contains("LATITUDE", ignoreCase = true) && !text.contains("Boston Scientific", ignoreCase = true)) return null

    val dobMatch = bostonDobText.find(text)
    val dob = dobMatch?.let { m -> normalizeDate("${m.groups["d"]!!.value} ${m.groups["m"]!!.value} ${m.groups["y"]!!.value}") }?.takeIf { it.isNotEmpty() }

    // The name sits in the header just before the birth date; the closest "Last, First" wins.
    var last: String? = null
    var first: String? = null
    if (dobMatch != null) {
        val window = text.substring(maxOf(0, dobMatch.range.first - 300), dobMatch.range.first)
        for (m in bostonHeaderName.findAll(window).toList().asReversed()) {
            val l = m.groups["last"]!!.value.trim().split(Regex("""\s+""")).takeLastWhile { it.lowercase() !in bostonHeaderWords }.joinToString(" ")
            val f = m.groups["first"]!!.value.trim().split(Regex("""\s+""")).takeWhile { it.lowercase() !in bostonHeaderWords }.joinToString(" ")
            if (l.isEmpty() || f.isEmpty() || !validName(l, f)) continue
            last = l
            first = f
            break
        }
    }

    val agg = bostonAggregat.find(text)
    val serial = agg?.groups?.get("serial")?.value
    val model = agg?.let { listOf(it.groups["model"]!!.value.trim(), it.groups["code"]!!.value).filter { p -> p.isNotEmpty() }.joinToString(" ") }

    val reportDate = bostonReportDate.find(text)?.let { m -> normalizeDate("${m.groups["d"]!!.value} ${m.groups["m"]!!.value} ${m.groups["y"]!!.value}") }?.takeIf { it.isNotEmpty() }
    return BostonHeader(last, first, dob, serial, model, reportDate)
}

private fun buildDate(month: String, day: String, year: String): String =
    if (month.toIntOrNull() == null) normalizeDate("$day $month $year") else normalizeDate("$day.$month.$year", DateLocaleHint.EU)

/** The manufacturer named by [text] (keyword scan), or null. */
fun manufacturerFromText(text: String): String? {
    val lower = text.lowercase()
    return PDF_MANUFACTURER_KEYWORDS
        .map { (name, keywords) -> name to keywords.count { lower.contains(it) } }
        .filter { it.second > 0 }
        .maxByOrNull { it.second }
        ?.first
}

/**
 * Reads the facts out of a PDF's [text] and [fileName]. Ported from
 * Electron's `extractStructuredData` (src/main/utils/pdf-utils.ts): the file
 * name is tried first (high confidence for the Medtronic and Biotronik export
 * patterns), then labelled fields in the text. Best effort by design: a field
 * that isn't found stays null instead of becoming a wrong value.
 */
fun extractPdfFacts(text: String, fileName: String? = null): DocumentFacts {
    var manufacturer: String? = null
    var last: String? = null
    var first: String? = null
    var serial: String? = null
    var interrogation: String? = null

    if (fileName != null) {
        val med = medtronicNameA.find(fileName) ?: medtronicNameB.find(fileName)
        val bio = biotronikName.find(fileName)
        if (med != null) {
            last = med.groups["last"]?.value
            first = med.groups["first"]?.value
            serial = med.groups["serial"]?.value
            manufacturer = "Medtronic"
            interrogation = buildDate(med.groups["month"]!!.value, med.groups["day"]!!.value, med.groups["year"]!!.value).takeIf { it.isNotEmpty() }
        } else if (bio != null) {
            last = bio.groups["last"]?.value
            first = bio.groups["first"]?.value
            serial = bio.groups["serial"]?.value
            manufacturer = "Biotronik"
            val g = bio.groups
            interrogation = "${g["year"]!!.value}-${g["month"]!!.value}-${g["day"]!!.value}T${g["hour"]!!.value}:${g["minute"]!!.value}:${g["second"]!!.value}"
        }
    }

    // LATITUDE headers first: the generic "Patient Name First Middle Last" fallback below would
    // read a middle name as the surname and make the PDF contradict its own data file.
    val boston = extractBostonHeader(text)
    if (last == null && boston?.last != null) {
        last = boston.last
        first = boston.first
    }

    if (last == null) {
        val lf = nameLastFirst.find(text)
        val lfLast = lf?.groups?.get("last")?.value
        val lfFirst = lf?.groups?.get("first")?.value
        if (lfLast != null && lfFirst != null && validName(lfLast, lfFirst)) {
            last = lfLast
            first = lfFirst
        } else {
            val fl = nameFirstLast.find(text)
            val flLast = fl?.groups?.get("last")?.value
            val flFirst = fl?.groups?.get("first")?.value
            if (flLast != null && flFirst != null && validName(flLast, flFirst)) {
                last = flLast
                first = flFirst
            }
        }
    }

    val dob = (boston?.dob ?: dobIsoRegex.find(text)?.let { m -> normalizeDate("${m.groups["y"]!!.value}-${m.groups["m"]!!.value}-${m.groups["d"]!!.value}") } ?: dobRegex.find(text)?.let { m ->
        val g = m.groups
        val sep = g["sep"]!!.value
        normalizeDate("${g["a"]!!.value}$sep${g["b"]!!.value}$sep${g["year"]!!.value}")
    })?.takeIf { it.isNotEmpty() }

    if (interrogation == null) interrogation = boston?.reportDate
    if (interrogation == null) {
        interrogationIsoRegex.find(text)?.let { m ->
            val g = m.groups
            val date = normalizeDate("${g["y"]!!.value}-${g["m"]!!.value}-${g["d"]!!.value}")
            val hour = g["hour"]?.value
            interrogation = when {
                date.isEmpty() -> null
                hour != null -> "${date}T${hour.padStart(2, '0')}:${g["minute"]!!.value}:${g["second"]?.value ?: "00"}"
                else -> date
            }
        }
    }
    if (interrogation == null) {
        interrogationSpacedRegex.find(text)?.let { m ->
            val g = m.groups
            val date = buildDate(g["month"]!!.value, g["day"]!!.value, g["year"]!!.value)
            val hour = g["hour"]?.value
            interrogation = when {
                date.isEmpty() -> null
                hour != null -> "${date}T$hour:${g["minute"]!!.value}:${g["second"]!!.value}"
                else -> date
            }
        }
    }
    if (interrogation == null) {
        interrogationRegex.find(text)?.let { m ->
            val g = m.groups
            var date = buildDate(g["month"]!!.value, g["day"]!!.value, g["year"]!!.value)
            val hourStr = g["hour"]?.value
            val minute = g["minute"]?.value
            if (date.isNotEmpty() && hourStr != null && minute != null) {
                var hour = hourStr.toInt()
                when (g["ampm"]?.value?.uppercase()) {
                    "PM" -> if (hour < 12) hour += 12
                    "AM" -> if (hour == 12) hour = 0
                }
                date += "T${hour.toString().padStart(2, '0')}:$minute:${g["second"]?.value ?: "00"}"
            }
            interrogation = date.takeIf { it.isNotEmpty() }
        }
    }

    if (serial == null) serial = boston?.serial ?: serialRegex.find(text)?.groups?.get("serial")?.value
    val model = boston?.model?.takeIf { it.isNotEmpty() } ?: modelRegex.find(text)?.groups?.get("model")?.value?.trim()?.takeIf { it.isNotEmpty() }
    val patientId = mrnRegex.find(text)?.groups?.get("id")?.value
    if (manufacturer == null) manufacturer = manufacturerFromText(text)

    return DocumentFacts(manufacturer, last, first, dob, patientId, serial, model, interrogation)
}

/**
 * Whether two first names can be the same person's: equal, or one is just an
 * initial of the other ("E." vs "Erika"), or one side is blank. Reports from
 * different exports abbreviate differently; that must not read as a conflict.
 */
fun firstNamesCompatible(a: String?, b: String?): Boolean {
    val x = normalizeNameKey(a?.replace(".", "")).takeIf { it.isNotEmpty() } ?: return true
    val y = normalizeNameKey(b?.replace(".", "")).takeIf { it.isNotEmpty() } ?: return true
    return x == y || (x.length == 1 && y.startsWith(x)) || (y.length == 1 && x.startsWith(y))
}

/** How two sets of facts about (supposedly) the same interrogation relate. */
enum class FactAgreement { AGREE, CONFLICT }

data class FactComparison(val field: String, val a: String?, val b: String?, val agreement: FactAgreement?)

/**
 * Field-by-field comparison used both to refuse bundling files that
 * contradict each other and to show the clinician *which* field disagrees.
 * A null [FactComparison.agreement] means one side doesn't say.
 */
fun compareFacts(a: DocumentFacts, b: DocumentFacts): List<FactComparison> {
    fun cmp(field: String, x: String?, y: String?, same: (String, String) -> Boolean = { p, q -> normalizeNameKey(p) == normalizeNameKey(q) }) =
        FactComparison(field, x, y, if (x == null || y == null) null else if (same(x, y)) FactAgreement.AGREE else FactAgreement.CONFLICT)
    return listOf(
        cmp("Last name", a.lastName, b.lastName),
        FactComparison("First name", a.firstName, b.firstName, if (a.firstName == null || b.firstName == null) null else if (firstNamesCompatible(a.firstName, b.firstName)) FactAgreement.AGREE else FactAgreement.CONFLICT),
        cmp("Birth date", a.dob, b.dob),
        cmp("Patient ID", a.patientId, b.patientId),
        cmp("Device serial", a.serial, b.serial),
    )
}

fun List<FactComparison>.hasConflict(): Boolean = any { it.agreement == FactAgreement.CONFLICT }
