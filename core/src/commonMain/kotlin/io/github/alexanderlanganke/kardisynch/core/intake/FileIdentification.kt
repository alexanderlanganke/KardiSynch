package io.github.alexanderlanganke.kardisynch.core.intake

import io.github.alexanderlanganke.kardisynch.core.parsers.decodeXmlBuffer

/**
 * What an incoming file is, decided from its CONTENT first. The file name and
 * extension only add (weak) confidence — a renamed export is still recognised,
 * and a misleadingly named one is not trusted blindly. The previous dispatcher
 * routed purely by extension and a `BIOSTD_` file-name prefix, so a Biotronik
 * XML without that prefix was silently dropped.
 */
enum class FileKind {
    MEDTRONIC_PDD,
    MEDTRONIC_PKG,
    BIOTRONIK_XML,
    MICROPORT_XML,
    BOSTON_BNK,
    ABBOTT_LOG,
    DEVICE_PDF,

    /** Well-formed XML that no parser claims. */
    UNKNOWN_XML,
    UNKNOWN,
    ;

    val isPdf: Boolean get() = this == DEVICE_PDF
    val isStructured: Boolean get() = this != DEVICE_PDF && this != UNKNOWN && this != UNKNOWN_XML
}

enum class EvidenceStrength { STRONG, WEAK, AGAINST }

data class Evidence(val text: String, val strength: EvidenceStrength)

/**
 * The detectors' verdict for one file: a [kind], the [manufacturer] it implies
 * (null when the file doesn't say), a 0–99 [confidence] and the [evidence]
 * behind it, so the UI can show *why* and a clinician can overrule it.
 */
data class Identification(
    val kind: FileKind,
    val manufacturer: String?,
    val confidence: Int,
    val evidence: List<Evidence>,
) {
    /** Confident enough that the matching parser should be tried. */
    val isUsable: Boolean get() = kind != FileKind.UNKNOWN && kind != FileKind.UNKNOWN_XML && confidence >= IDENTIFY_MIN_CONFIDENCE
}

const val IDENTIFY_MIN_CONFIDENCE = 50

private class Score(val kind: FileKind, val manufacturer: String?) {
    var points = 0
    val evidence = mutableListOf<Evidence>()
    fun strong(points: Int, text: String) { this.points += points; evidence += Evidence(text, EvidenceStrength.STRONG) }
    fun weak(points: Int, text: String) { this.points += points; evidence += Evidence(text, EvidenceStrength.WEAK) }
    fun against(text: String) { evidence += Evidence(text, EvidenceStrength.AGAINST) }
}

private val bnkDeviceLine = Regex("""^#\s*DEVICE\s+MODEL:""", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))
private val bnkTypeLine = Regex("""^#\s*TYPE:""", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))
private val abbottCodedLine = Regex("""^\d{2,5}\u001C""", RegexOption.MULTILINE)
private val abbottConcatenatedLine = Regex("""^\d{2,5}[A-Z]""")
private val medtronicSerial = Regex("""[A-Z]{3}\d{6}[A-Z]""")
private val xmlRoot = Regex("""<([A-Za-z_][\w.\-:]*)[\s>/]""")

/** Manufacturer keywords in PDF text. Order matters only for ties; the strongest count wins. */
internal val PDF_MANUFACTURER_KEYWORDS: List<Pair<String, List<String>>> = listOf(
    "Medtronic" to listOf("medtronic", "carelink", "smartsync"),
    "Biotronik" to listOf("biotronik", "home monitoring"),
    "Abbott" to listOf("abbott", "st. jude", "merlin"),
    "Boston Scientific" to listOf("boston scientific", "bostonscientific", "latitude", "s-icd", "emblem"),
    "Microport" to listOf("microport"),
)

/**
 * Identifies [bytes] (named [fileName]). [pdfText] is the already-extracted
 * text when the file is a PDF — text extraction is a platform concern, so the
 * caller supplies it; without it a PDF is still recognised as a PDF, just with
 * no manufacturer.
 */
fun identifyFile(fileName: String, bytes: ByteArray, pdfText: String? = null): Identification {
    val ext = fileName.substringAfterLast('.', "").lowercase()
    val head = bytes.copyOfRange(0, minOf(bytes.size, 16384)).decodeToString()

    if (bytes.size >= 4 && head.startsWith("%PDF")) return identifyPdf(fileName, pdfText)

    if (bytes.size >= 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte() && bytes[2] == 3.toByte() && bytes[3] == 4.toByte()) {
        val s = Score(FileKind.MEDTRONIC_PKG, "Medtronic")
        s.strong(40, "ZIP container")
        if (ext == "pkg") s.weak(35, "extension .pkg") else s.against("a ZIP without a .pkg extension; not claimed as Medtronic")
        // A bare ZIP isn't enough to claim a manufacturer.
        return if (ext == "pkg") result(s) else Identification(FileKind.UNKNOWN, null, s.points, s.evidence)
    }

    val candidates = mutableListOf<Score>()

    val trimmedHead = head.trimStart('﻿', ' ', '\n', '\r', '\t')
    val looksXml = trimmedHead.startsWith("<")
    if (looksXml) {
        val text = runCatching { decodeXmlBuffer(bytes) }.getOrDefault(head)
        // Real exports namespace their root ("carddas:InterfaceData"); compare the local name only.
        val root = xmlRoot.findAll(text).map { it.groupValues[1].substringAfter(':') }.firstOrNull { !it.startsWith("?") && !it.startsWith("!") }
        when {
            text.contains("<Paceart>") -> candidates += Score(FileKind.MICROPORT_XML, "Microport").also {
                it.strong(75, "XML contains a <Paceart> element")
                if (text.contains("microport", ignoreCase = true)) it.weak(10, "text names MicroPort")
            }
            root.equals("InterfaceData", ignoreCase = true) -> candidates += Score(FileKind.BIOTRONIK_XML, "Biotronik").also {
                it.strong(70, "XML root is <InterfaceData> (Biotronik export)")
                if (text.contains("biotronik", ignoreCase = true)) it.weak(10, "text names Biotronik")
                if (fileName.contains("BIOSTD_")) it.weak(10, "file name starts with BIOSTD_")
            }
            else -> {
                val s = Score(FileKind.UNKNOWN_XML, null)
                s.evidence += Evidence("XML with root <${root ?: "?"}>; no parser claims it", EvidenceStrength.AGAINST)
                if (fileName.contains("BIOSTD_")) {
                    // The name says Biotronik but the content doesn't match: keep the contradiction visible.
                    s.against("file name says Biotronik, content does not look like a Biotronik export")
                }
                candidates += s
            }
        }
    }

    if (bnkDeviceLine.containsMatchIn(head)) {
        val s = Score(FileKind.BOSTON_BNK, "Boston Scientific")
        s.strong(75, "has a '# DEVICE MODEL: … SERIAL:' header")
        if (bnkTypeLine.containsMatchIn(head)) s.weak(10, "has a '# TYPE:' header")
        if (ext == "bnk") s.weak(10, "extension .bnk")
        candidates += s
    }

    run {
        val delimited = abbottCodedLine.findAll(head).take(3).count() >= 3
        val lines = head.split('\n').filter { it.isNotBlank() }
        val concatenated = !delimited && lines.size >= 10 && lines.count { abbottConcatenatedLine.containsMatchIn(it) }.toDouble() / lines.size > 0.7
        if (delimited || concatenated) {
            val s = Score(FileKind.ABBOTT_LOG, "Abbott")
            if (delimited) s.strong(75, "coded lines separated by the 0x1C control character (Abbott log)")
            else s.strong(55, "most lines start with a numeric code followed by a label (Abbott log, no separators)")
            if (ext == "log") s.weak(10, "extension .log")
            candidates += s
        }
    }

    if (!looksXml && (ext == "pdd" || medtronicSerial.containsMatchIn(head))) {
        val s = Score(FileKind.MEDTRONIC_PDD, "Medtronic")
        if (ext == "pdd") s.weak(35, "extension .pdd")
        val body = if (bytes.size <= 1_048_576) bytes.decodeToString() else head
        val serial = medtronicSerial.find(body)
        if (serial != null) s.strong(30, "device serial ${serial.value} found in the file")
        if (body.contains("Medtronic", ignoreCase = true)) s.weak(15, "text names Medtronic")
        if (s.points > 0) candidates += s
    }

    val best = candidates.maxByOrNull { it.points }
    if (best == null) {
        val ev = mutableListOf(Evidence("no known file signature", EvidenceStrength.AGAINST))
        if (ext.isNotEmpty()) ev += Evidence("extension .$ext is not a supported type", EvidenceStrength.AGAINST)
        return Identification(FileKind.UNKNOWN, null, 0, ev)
    }
    // Another detector scored close behind: say so, it may be a misclassification.
    val runnerUp = candidates.filter { it !== best && it.kind != FileKind.UNKNOWN_XML }.maxByOrNull { it.points }
    if (runnerUp != null && runnerUp.points >= best.points - 15) {
        best.against("also resembles ${runnerUp.kind.name.lowercase().replace('_', ' ')} (${runnerUp.points})")
        best.points -= 20
    }
    return result(best)
}

private fun result(s: Score): Identification =
    Identification(s.kind, s.manufacturer, s.points.coerceIn(0, 99), s.evidence.toList())

private fun identifyPdf(fileName: String, pdfText: String?): Identification {
    val s = Score(FileKind.DEVICE_PDF, null)
    s.strong(55, "PDF document")
    var manufacturer: String? = null
    if (pdfText != null && pdfText.isNotBlank()) {
        val lower = pdfText.lowercase()
        val hits = PDF_MANUFACTURER_KEYWORDS
            .map { (name, keywords) -> Triple(name, keywords, keywords.filter { lower.contains(it) }) }
            .filter { it.third.isNotEmpty() }
            .sortedByDescending { it.third.size }
        if (hits.isNotEmpty()) {
            val top = hits.first()
            manufacturer = top.first
            s.strong(25 + 10 * (top.third.size - 1).coerceAtMost(2), "text mentions ${top.third.joinToString(", ") { "\"$it\"" }}")
            if (hits.size > 1 && hits[1].third.size == top.third.size) s.against("text also mentions ${hits[1].first}")
        } else {
            s.against("no manufacturer named in the text")
        }
    } else {
        s.against("no text could be read from this PDF (scanned image?)")
    }
    val fromName = manufacturerFromPdfFileName(fileName)
    if (fromName != null) {
        if (manufacturer == null) {
            manufacturer = fromName
            s.weak(15, "file name follows the $fromName export pattern")
        } else if (manufacturer == fromName) {
            s.weak(10, "file name follows the $fromName export pattern")
        } else {
            s.against("file name suggests $fromName, text says $manufacturer")
        }
    }
    return Identification(FileKind.DEVICE_PDF, manufacturer, s.points.coerceIn(0, 99), s.evidence.toList())
}

/** Evidence as stored text: one line each, prefixed '+' (strong), '~' (weak) or '-' (against). */
fun formatEvidence(evidence: List<Evidence>): String = evidence.joinToString("\n") {
    val mark = when (it.strength) { EvidenceStrength.STRONG -> '+'; EvidenceStrength.WEAK -> '~'; EvidenceStrength.AGAINST -> '-' }
    "$mark ${it.text}"
}

fun parseEvidence(text: String?): List<Evidence> = text.orEmpty().lines().filter { it.length > 2 }.map {
    val strength = when (it[0]) { '+' -> EvidenceStrength.STRONG; '-' -> EvidenceStrength.AGAINST; else -> EvidenceStrength.WEAK }
    Evidence(it.substring(2), strength)
}
