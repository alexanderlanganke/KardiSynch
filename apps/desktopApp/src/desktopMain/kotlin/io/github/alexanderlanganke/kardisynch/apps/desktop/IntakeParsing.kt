package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.intake.DocumentFacts
import io.github.alexanderlanganke.kardisynch.core.intake.FileKind
import io.github.alexanderlanganke.kardisynch.core.intake.Identification
import io.github.alexanderlanganke.kardisynch.core.intake.extractPdfFacts
import io.github.alexanderlanganke.kardisynch.core.intake.identifyFile
import io.github.alexanderlanganke.kardisynch.core.intake.toFacts
import io.github.alexanderlanganke.kardisynch.core.intake.toPartialReport
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.parsers.dispatchParse
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Reads the text out of a PDF. Platform work (PDFBox), so the shared core only ever sees its result. */
fun interface PdfTextExtractor {
    /** The document's text, or null when it can't be read (encrypted, damaged, image only). */
    fun extract(bytes: ByteArray): String?
}

/** Text of the first pages via PDFBox; null on any failure so a bad PDF is a finding, never a crash. */
object PdfBoxTextExtractor : PdfTextExtractor {
    override fun extract(bytes: ByteArray): String? = runCatching {
        Loader.loadPDF(bytes).use { doc ->
            PDFTextStripper().apply { endPage = minOf(doc.numberOfPages, 6) }.getText(doc).takeIf { it.isNotBlank() }
        }
    }.getOrNull()
}

/** Everything the intake pipeline learns about one file from its bytes. */
data class ParsedIntake(
    val identification: Identification,
    /** A full report for structured files, a [partial][io.github.alexanderlanganke.kardisynch.core.model.ParseStatus.PARTIAL] one for PDFs, null when nothing could be read. */
    val report: UnifiedReport?,
    val facts: DocumentFacts,
    val pdfText: String?,
)

/**
 * Identifies and parses [bytes] in one step: content-based identification,
 * then the matching parser (or PDF text extraction for a PDF). `.pkg`
 * archives are unzipped here because that needs `java.util.zip`, which the
 * shared core can't reach.
 */
fun parseForIntake(fileName: String, bytes: ByteArray, pdfText: PdfTextExtractor = PdfBoxTextExtractor): ParsedIntake {
    val head = bytes.copyOfRange(0, minOf(bytes.size, 5)).decodeToString()
    if (head.startsWith("%PDF")) {
        val text = pdfText.extract(bytes)
        val ident = identifyFile(fileName, bytes, text)
        val facts = extractPdfFacts(text.orEmpty(), fileName).let { f ->
            if (f.manufacturer == null && ident.manufacturer != null) f.copy(manufacturer = ident.manufacturer) else f
        }
        return ParsedIntake(ident, if (facts.isEmpty) null else facts.toPartialReport(text), facts, text)
    }
    val ident = identifyFile(fileName, bytes)
    val report = if (ident.kind == FileKind.MEDTRONIC_PKG) {
        parseMedtronicPkg(bytes)?.copy(manufacturer = "Medtronic")
    } else {
        dispatchParse(fileName, bytes, ident)
    }
    return ParsedIntake(ident, report, report?.toFacts() ?: DocumentFacts(manufacturer = ident.manufacturer), null)
}

fun sha256Hex(file: File): String = file.inputStream().use { sha256Hex(it) }

fun sha256Hex(stream: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) {
        val n = stream.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
