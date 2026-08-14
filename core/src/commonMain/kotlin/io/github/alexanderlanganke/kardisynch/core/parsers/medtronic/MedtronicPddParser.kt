package io.github.alexanderlanganke.kardisynch.core.parsers.medtronic

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.util.normalizeDate

/**
 * Legacy Medtronic .pdd parser, ported from `parseMedtronicPdd`
 * (src/main/parsers/medtronic-parser.ts). Extracts header info and
 * measurements via binary structure analysis — no known field schema exists
 * for this format, only byte-offset/pattern heuristics reverse-engineered
 * against real samples (see comments throughout, ported verbatim).
 *
 * File I/O is intentionally not this function's job (`core` has zero
 * platform dependencies) — callers read the file and pass the bytes.
 *
 * Diagnostics are simplified from the original: the TS version threads a
 * `DiagnosticsCollector` through every extraction step to record per-field
 * warnings and format-variant provenance (`parseWarnings`, `formatVariant`).
 * That bookkeeping isn't ported yet — only [UnifiedReport.parseStatus] is
 * derived (ok/failed, not the original's ok/partial/failed three-way split).
 * The Kotlin equivalent of that collector
 * ([io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics.DiagnosticsCollector])
 * exists (issue #193) but retrofitting it into this parser — and the other
 * 4 already-ported ones — is separate, larger follow-up work; see that
 * file's doc comment for why it isn't bundled with landing the
 * infrastructure itself.
 */
fun parseMedtronicPdd(buffer: ByteArray): UnifiedReport {
    val entries = safe({ parsePddStructure(buffer) }, emptyList())

    var lastName = ""
    var firstName = ""
    var dob = ""
    var deviceModel = ""
    var deviceType = "Unknown"
    var deviceSerial = ""
    var interrogationDate = ""
    var batteryVoltage: Measurement? = null

    val strings = safe({ extractPrintableStrings(buffer) }, emptyList())
    val rawText = strings.joinToString("\n")

    // A. Patient name: a fixed-offset length-prefixed ASCII field (0x03) is
    // the primary/most common location; a fixed-offset UTF-16BE field
    // (0x77) when that's blank (apparently written by different software);
    // falls back to scanning all strings for a "Word, Word" pattern.
    val nameCandidate =
        parsePersonName(readLenPrefixedAscii(buffer, 0x03))
            ?: parsePersonName(readLenPrefixedUtf16Be(buffer, 0x77))
            ?: run {
                val nameRegex = Regex("""^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+),\s+([A-Za-zÀ-ÿ].*)$""")
                strings.firstNotNullOfOrNull { s ->
                    nameRegex.matchEntire(s)?.let { PersonName(last = it.groupValues[1], first = it.groupValues[2]) }
                }
            }
    if (nameCandidate != null) {
        lastName = nameCandidate.last
        firstName = nameCandidate.first
    }

    // B. Device model: a fixed-offset field (0x22 length byte, 0x23 string,
    // always exactly 15 bytes, truncating longer names) is far more
    // reliable than scanning for a hardcoded family name — it catches
    // models ("Astra", "Serena", "Azure") that aren't in any known-family
    // list at all. The family scan is a fallback for files where the fixed
    // offset doesn't hold a name.
    val knownFamilies = listOf(
        "Protecta", "Visia", "Evera", "Viva", "Brava", "Claria", "Amplia",
        "Consulta", "Secura", "Maximo", "Concerto", "Virtuoso", "Reveal", "LINQ",
    )
    val modelCandidate = readLenPrefixedAscii(buffer, 0x22).trim().ifEmpty { null }
        ?: strings.firstOrNull { s -> knownFamilies.any { f -> s.uppercase().contains(f.uppercase()) } }
    if (modelCandidate != null) {
        deviceModel = modelCandidate
        deviceType = inferMedtronicDeviceType(modelCandidate)
    }

    // C. Serial number & date: 3 chars, 6 digits, 1 char (S/P/etc), optional
    // 14-digit YYYYMMDDHHMMSS date suffix.
    run {
        val serialRegex = Regex("""([A-Z]{3}\d{6}[A-Z])(\d{14})?""")
        val serialString = strings.firstOrNull { serialRegex.containsMatchIn(it) }
        if (serialString != null) {
            val match = serialRegex.find(serialString)
            if (match != null) {
                deviceSerial = match.groupValues[1]
                val dateSuffix = match.groupValues.getOrNull(2)?.takeIf { it.isNotEmpty() }
                fun timestampToDate(ts: String) = normalizeDate("${ts.substring(0, 4)}-${ts.substring(4, 6)}-${ts.substring(6, 8)}")
                if (dateSuffix != null) {
                    interrogationDate = timestampToDate(dateSuffix)
                } else {
                    val dateRegex = Regex("""^(20\d{12})$""")
                    val dateString = strings.firstOrNull { dateRegex.matches(it) }
                    if (dateString != null) interrogationDate = timestampToDate(dateString)
                }
            }
        }
    }

    // --- Measurements (binary structure) ---

    // Battery voltage (type 4, 2.0-3.5V). This byte layout has no field
    // names — real .pdd files consistently carry SEVERAL type-4 entries in
    // this range (current voltage alongside fixed BOL/ERI/EOL reference
    // constants, which fall in the same numeric band). Only assert a
    // voltage when every in-range type-4 entry agrees; a wrong guess is
    // worse than no data point (can fabricate an "increasing" trend).
    run {
        val candidates = entries.filter { it.type == 4 && it.value in 2000..3500 }
        val distinctValues = candidates.map { it.value }.toSet()
        if (distinctValues.size == 1) {
            batteryVoltage = Measurement(value = distinctValues.first() / 1000.0, unit = "V")
        }
        // distinctValues.size > 1: ambiguous, left unset (original records a
        // diagnostic warning here — not ported, see class doc).
    }

    // Leads (best-effort snapshot analysis).
    val leads = safe({
        val built = mutableListOf<LeadData>()

        // Atrial impedance: type 3, ~342 Ohm encoded as 737342 (value in
        // last 3 digits).
        val type3Entries = entries.filter { it.type == 3 && it.value in 737000 until 738000 }
        val validType3 = type3Entries.firstOrNull { (it.value % 1000) in 201..1999 }
        val aImp = validType3?.let { it.value % 1000 }

        // Thresholds: type 2, 7374xx -> 737450 -> 50 -> 0.5V. Heuristic:
        // first found value is atrial, second (if present) is RV.
        val type2Entries = entries.filter { it.type == 2 && it.value in 737400 until 737600 }
        val threshValues = type2Entries.map { (it.value % 100) / 100.0 }.filter { it > 0 && it < 5 }
        val aThresh = threshValues.getOrNull(0)
        val rvThresh = threshValues.getOrNull(1)

        if (aImp != null || aThresh != null) {
            built.add(
                LeadData(
                    name = "Atrial Lead",
                    anatomicLocation = "A",
                    impedance = aImp?.let { Measurement(it.toDouble(), "Ohm") },
                    pacingThreshold = aThresh?.let { Measurement(it, "V") },
                ),
            )
        }

        // RV impedance is tricky in .pdd — relies on the '589...' raw-value
        // cluster with a doubled 0xFF 0xFF prefix.
        val rawEntries = safe({ parseRawValues(buffer) }, emptyList())
        val rvImpEntry = rawEntries.firstOrNull { it.isDoubleFF && it.value in 589200 until 589900 }
        if (rvImpEntry != null) {
            val rvImp = rvImpEntry.value % 1000
            built.add(
                LeadData(
                    name = "RV Lead",
                    anatomicLocation = "RV",
                    impedance = Measurement(rvImp.toDouble(), "Ohm"),
                    pacingThreshold = rvThresh?.let { Measurement(it, "V") },
                ),
            )
        } else if (rvThresh != null) {
            built.add(LeadData(name = "RV Lead", anatomicLocation = "RV", pacingThreshold = Measurement(rvThresh, "V")))
        }
        built.filter(::hasLeadData)
    }, emptyList())

    val hasPatientIdentity = lastName.isNotEmpty() || dob.isNotEmpty()
    val hasDeviceIdentity = deviceModel.isNotEmpty() || deviceSerial.isNotEmpty()
    val structureVariant = if (entries.isNotEmpty()) "medtronic-pdd" else "pdd-unrecognized-structure"

    return UnifiedReport(
        manufacturer = "Medtronic",
        interrogationDate = interrogationDate,
        patient = PatientInfo(firstName = firstName, lastName = lastName, dob = dob.ifEmpty { "1900-01-01" }),
        device = DeviceInfo(type = deviceType, model = deviceModel, serialNumber = deviceSerial),
        battery = BatteryData(voltage = batteryVoltage),
        leads = leads,
        rawText = rawText,
        formatVariant = structureVariant,
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}

/**
 * Infers a device type from its model name, using product families whose
 * line unambiguously implies a type even when the model string is
 * truncated. Ported verbatim from `inferMedtronicDeviceType`
 * (src/main/parsers/medtronic-parser.ts) — shared with the .pkg/XML path
 * there (not yet ported here).
 */
fun inferMedtronicDeviceType(modelString: String): String {
    val modelUpper = modelString.uppercase()
    val familyType = listOf(
        "REVEAL" to "ICM", "LINQ" to "ICM",
        "MICRA" to "Leadless Pacemaker",
        "AMPLIA" to "CRT-D",
        "PROTECTA" to "ICD", "VISIA" to "ICD", "EVERA" to "ICD",
    )
    familyType.firstOrNull { (family, _) -> modelUpper.contains(family) }?.let { return it.second }
    if (modelUpper.contains("CRT-D")) return "CRT-D"
    if (modelUpper.contains("CRT-P")) return "CRT-P"
    if (modelUpper.contains("CRT")) return "CRT"
    if (modelUpper.contains("ICD") || (modelUpper.contains("DR") && modelUpper.contains("PROTECTA"))) return "ICD"
    return "Pacemaker"
}

// --- Byte-level helpers ---

private fun Byte.u(): Int = toInt() and 0xFF

/**
 * Reads a 1-byte-length-prefixed ASCII/Latin-1 string. Ported from
 * `readLenPrefixedAscii`.
 */
internal fun readLenPrefixedAscii(buffer: ByteArray, offset: Int): String {
    if (offset >= buffer.size) return ""
    val len = buffer[offset].u()
    if (len == 0 || offset + 1 + len > buffer.size) return ""
    return String(CharArray(len) { buffer[offset + 1 + it].u().toChar() })
}

/**
 * Reads a 1-byte-length-prefixed UTF-16BE string where every pair is a
 * plain ASCII char (0x00 high byte). Ported from `readLenPrefixedUtf16Be`.
 */
internal fun readLenPrefixedUtf16Be(buffer: ByteArray, offset: Int): String {
    if (offset >= buffer.size) return ""
    val len = buffer[offset].u()
    if (len == 0 || len % 2 != 0 || offset + 1 + len > buffer.size) return ""
    val sb = StringBuilder()
    var i = offset + 1
    while (i < offset + 1 + len) {
        val hi = buffer[i].u()
        val lo = buffer[i + 1].u()
        if (hi != 0x00 || lo < 0x20 || lo > 0x7e) return ""
        sb.append(lo.toChar())
        i += 2
    }
    return sb.toString()
}

internal data class PersonName(val last: String, val first: String)

/** Ported from `parsePersonName`. */
internal fun parsePersonName(raw: String): PersonName? {
    val trimmed = raw.trim().replace(Regex("""\s+"""), " ")
    if (trimmed.isEmpty()) return null
    if (trimmed.contains(',')) {
        val parts = trimmed.split(',', limit = 2)
        return PersonName(last = parts[0].trim(), first = parts.getOrElse(1) { "" }.trim())
    }
    val parts = trimmed.split(' ')
    return if (parts.size >= 2) {
        PersonName(last = parts[0], first = parts.drop(1).joinToString(" "))
    } else {
        PersonName(last = trimmed, first = "")
    }
}

internal data class PddEntry(val offset: Int, val value: Int, val type: Int)
internal data class RawValue(val offset: Int, val value: Int, val isDoubleFF: Boolean)

private fun String.toBoundedIntOrNull(): Int? =
    toLongOrNull()?.takeIf { it in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() }?.toInt()

/**
 * Scans for `0xFF <digits> 0x0A 0xFF <digits> 0x0A` value/type marker pairs
 * — the .pdd format's only structural signal. Ported from
 * `parsePDDStructure`.
 */
internal fun parsePddStructure(buffer: ByteArray): List<PddEntry> {
    val entries = mutableListOf<PddEntry>()
    var i = 0
    while (i < buffer.size) {
        if (buffer[i].u() == 0xFF) {
            var j = i + 1
            val valStr = StringBuilder()
            while (j < buffer.size && buffer[j].u() in 0x30..0x39) {
                valStr.append(buffer[j].u().toChar())
                j++
            }
            if (valStr.isNotEmpty() && j < buffer.size && buffer[j].u() == 0x0A) {
                if (j + 1 < buffer.size && buffer[j + 1].u() == 0xFF) {
                    var k = j + 2
                    val typeStr = StringBuilder()
                    while (k < buffer.size && buffer[k].u() in 0x30..0x39) {
                        typeStr.append(buffer[k].u().toChar())
                        k++
                    }
                    if (typeStr.isNotEmpty() && k < buffer.size && buffer[k].u() == 0x0A) {
                        val value = valStr.toString().toBoundedIntOrNull()
                        val type = typeStr.toString().toBoundedIntOrNull()
                        if (value != null && type != null) {
                            entries.add(PddEntry(offset = i, value = value, type = type))
                        }
                        i = k
                        continue
                    }
                }
            }
        }
        i++
    }
    return entries
}

/** Ported from `parseRawValues`. */
internal fun parseRawValues(buffer: ByteArray): List<RawValue> {
    val values = mutableListOf<RawValue>()
    var i = 0
    while (i < buffer.size) {
        if (buffer[i].u() == 0xFF) {
            var isDoubleFF = false
            if (i + 1 < buffer.size && buffer[i + 1].u() == 0xFF) {
                isDoubleFF = true
                i++
            }
            var j = i + 1
            val valStr = StringBuilder()
            while (j < buffer.size && buffer[j].u() in 0x30..0x39) {
                valStr.append(buffer[j].u().toChar())
                j++
            }
            if (valStr.isNotEmpty() && j < buffer.size && buffer[j].u() == 0x0A) {
                val value = valStr.toString().toBoundedIntOrNull()
                if (value != null) {
                    values.add(RawValue(offset = i, value = value, isDoubleFF = isDoubleFF))
                }
                i = j
                continue
            }
        }
        i++
    }
    return values
}

/**
 * Extracts all printable strings >= 4 chars, UTF-8 aware (multi-byte
 * sequences kept intact). Ported from the anonymous `strings` extractor
 * inside `parseMedtronicPdd`.
 */
internal fun extractPrintableStrings(buffer: ByteArray): List<String> {
    val found = mutableListOf<String>()
    fun flushRun(start: Int, end: Int) {
        if (end <= start) return
        val s = decodeUtf8(buffer, start, end).trim()
        if (s.length >= 4) found.add(s)
    }
    var runStart = -1
    var i = 0
    while (i < buffer.size) {
        val b = buffer[i].u()
        var seqLen = when {
            b in 32..126 -> 1
            b in 0xC2..0xDF -> 2
            b in 0xE0..0xEF -> 3
            b in 0xF0..0xF4 -> 4
            else -> 0
        }
        if (seqLen > 1) {
            for (k in 1 until seqLen) {
                val cont = if (i + k < buffer.size) buffer[i + k].u() else -1
                if (cont < 0x80 || cont > 0xBF) {
                    seqLen = 0
                    break
                }
            }
        }
        if (seqLen > 0) {
            if (runStart == -1) runStart = i
            i += seqLen
        } else {
            if (runStart != -1) {
                flushRun(runStart, i)
                runStart = -1
            }
            i++
        }
    }
    if (runStart != -1) flushRun(runStart, buffer.size)
    return found
}

private fun decodeUtf8(buffer: ByteArray, start: Int, end: Int): String {
    val sb = StringBuilder()
    var i = start
    while (i < end) {
        val b0 = buffer[i].u()
        val (codepoint, len) = when {
            b0 <= 0x7F -> b0 to 1
            b0 in 0xC2..0xDF -> ((b0 and 0x1F) shl 6 or (buffer[i + 1].u() and 0x3F)) to 2
            b0 in 0xE0..0xEF -> (
                (b0 and 0x0F shl 12) or
                    (buffer[i + 1].u() and 0x3F shl 6) or
                    (buffer[i + 2].u() and 0x3F)
                ) to 3
            b0 in 0xF0..0xF4 -> (
                (b0 and 0x07 shl 18) or
                    (buffer[i + 1].u() and 0x3F shl 12) or
                    (buffer[i + 2].u() and 0x3F shl 6) or
                    (buffer[i + 3].u() and 0x3F)
                ) to 4
            else -> b0 to 1
        }
        if (codepoint <= 0xFFFF) {
            sb.append(codepoint.toChar())
        } else {
            val cp = codepoint - 0x10000
            sb.append(((cp shr 10) + 0xD800).toChar())
            sb.append(((cp and 0x3FF) + 0xDC00).toChar())
        }
        i += len
    }
    return sb.toString()
}

/** Minimal stand-in for the original's `safeExtract`: run a block, fall back to [default] on any exception. */
private fun <T> safe(block: () -> T, default: T): T = try { block() } catch (e: Exception) { default }
