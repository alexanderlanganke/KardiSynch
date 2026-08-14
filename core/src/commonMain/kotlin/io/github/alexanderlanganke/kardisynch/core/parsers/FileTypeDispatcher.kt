package io.github.alexanderlanganke.kardisynch.core.parsers

import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.parsers.abbott.parseAbbottLog
import io.github.alexanderlanganke.kardisynch.core.parsers.biotronik.parseBiotronikXML
import io.github.alexanderlanganke.kardisynch.core.parsers.bostonscientific.parseBostonScientificBnk
import io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.parseMedtronicPdd
import io.github.alexanderlanganke.kardisynch.core.parsers.microport.parseMicroportXML

/**
 * Decodes an XML file honoring its BOM / `encoding=` declaration. Ported
 * from `decodeXmlBuffer` (src/main/parser.ts) — reading everything as UTF-8
 * mangles umlauts in the Latin-1/Windows-1252 exports some clinics still
 * produce.
 */
fun decodeXmlBuffer(bytes: ByteArray): String {
    if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
        return bytes.copyOfRange(2, bytes.size).toString(Charsets.UTF_16LE)
    }
    if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
        return bytes.copyOfRange(2, bytes.size).toString(Charsets.UTF_16BE)
    }
    if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) {
        return bytes.copyOfRange(3, bytes.size).toString(Charsets.UTF_8)
    }

    val prologLength = minOf(bytes.size, 200)
    val prolog = bytes.copyOfRange(0, prologLength).toString(Charsets.ISO_8859_1)
    val encMatch = Regex("""encoding=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(prolog)
    if (encMatch != null) {
        when (encMatch.groupValues[1].lowercase()) {
            "iso-8859-1", "latin1", "windows-1252", "cp1252" -> return bytes.toString(Charsets.ISO_8859_1)
            "utf-16", "utf-16le", "ucs-2" -> return bytes.toString(Charsets.UTF_16LE)
        }
    }

    return bytes.toString(Charsets.UTF_8)
}

/**
 * Routes an imported file to the matching parser by extension/naming
 * convention. Ported from `parseFile`'s dispatch table (src/main/parser.ts),
 * scoped to the parsers this KMP port covers: Medtronic `.pdd`, Biotronik
 * `BIOSTD_*.xml`, Microport/Paceart `.xml`, Boston Scientific `.bnk`, Abbott
 * `.log`. Not ported: `.pdf` (needs OCR/text-extraction + the Boston
 * Scientific/Abbott PDF variants) — out of scope for this pass; a `.pdf`
 * is left in `_IMPORT` untouched rather than silently dropped. Medtronic
 * `.pkg` (a zip archive, issue #170) is NOT dispatched from here either,
 * but IS handled — just one layer up, on the desktop app's `ImportWatcher`
 * (`apps:desktopApp`'s `parseMedtronicPkg`), since unzipping needs
 * `java.util.zip`, unreachable from this module's commonMain.
 */
fun dispatchParse(fileName: String, bytes: ByteArray): UnifiedReport? {
    val extension = fileName.substringAfterLast('.', "").lowercase()
    return when (extension) {
        "xml" -> {
            val xml = decodeXmlBuffer(bytes)
            when {
                xml.contains("<Paceart>") -> parseMicroportXML(xml)
                fileName.contains("BIOSTD_") -> parseBiotronikXML(xml).copy(manufacturer = "Biotronik")
                else -> null
            }
        }
        "bnk" -> parseBostonScientificBnk(bytes.toString(Charsets.UTF_8)).copy(manufacturer = "Boston Scientific")
        "pdd" -> parseMedtronicPdd(bytes).copy(manufacturer = "Medtronic")
        "log" -> parseAbbottLog(bytes, fileName)?.copy(manufacturer = "Abbott")
        else -> null
    }
}
