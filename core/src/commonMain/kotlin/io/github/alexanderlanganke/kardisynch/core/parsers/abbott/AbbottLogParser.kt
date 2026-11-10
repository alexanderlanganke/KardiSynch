package io.github.alexanderlanganke.kardisynch.core.parsers.abbott

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.util.DateLocaleHint
import io.github.alexanderlanganke.kardisynch.core.util.normalizeDate

/**
 * Abbott log parser, ported from `parseAbbottLog`
 * (src/main/parsers/abbott-parser.ts). Covers the "coded log" text format
 * (both the real 0x1C-delimited variant and the plain-concatenated
 * fallback) and the freeform-text regex fallback.
 *
 * The DOCX-wrapped variant (`extractTextFromDocx`, ZIP-magic-byte-detected)
 * is NOT ported — none of the real samples in test/abbott_logfiles/ are
 * DOCX-wrapped (all are plain coded-log text), and DOCX extraction pulls in
 * a ZIP-library dependency this pass hasn't scoped. [parseAbbottLog] returns
 * null for a ZIP-magic-byte file, same as a genuine parse failure.
 *
 * Diagnostics are simplified as in the other ported parsers.
 */

// ASCII File Separator (0x1C) — the real field delimiter used by Merlin.net
// "Detailed Log" exports: `{code}<FS>{Label}<FS>{Value}<FS>{Unit}<FS>`.
// Invisible in a plain text viewer/editor.
private const val UNIT_SEPARATOR = ''

private val ABBOTT_CODES = mapOf(
    "2430" to "PatientName", "2431" to "PatientDOB", "204" to "PatientID",
    "200" to "DeviceModelName", "201" to "DeviceModelNumber", "202" to "DeviceSerialNumber",
    "105" to "SessionTimestamp", "203" to "LastInterrogation",
    "519" to "BatteryVoltage", "533" to "LongevityEstimate", "520" to "BatteryCurrent",
    "512" to "AtrialLeadImpedance", "507" to "RVLeadImpedance",
    "2722" to "VentricularSignalAmplitude", "2721" to "AtrialSignalAmplitude",
    "2468" to "AtrialLeadSerial", "2470" to "RVLeadSerial",
    "2457" to "AtrialLeadModel", "2461" to "RVLeadModel",
    "2456" to "AtrialLeadManufacturer", "2460" to "RVLeadManufacturer",
    "2459" to "AtrialLeadImplantDate", "2463" to "RVLeadImplantDate",
    "2442" to "DeviceImplantDate", "301" to "Mode",
    "1610" to "AtrialCaptureThreshold", "1606" to "RVCaptureThreshold",
    "2440" to "EjectionFraction", "2441" to "IndicationsForImplant",
    "1611" to "AtrialCapturePulseWidth", "1607" to "RVCapturePulseWidth",
    "2464" to "LVLeadManufacturer", "2465" to "LVLeadModel",
    "2467" to "LVLeadImplantDate", "2471" to "LVLeadSerial",
    "2720" to "LVLeadImpedance", "1616" to "LVCaptureThreshold", "1617" to "LVCapturePulseWidth",
)

private val CODE_LABEL_PREFIXES = mapOf(
    "2430" to "Patient Name", "2431" to "Patient Date of Birth", "204" to "Patient ID",
    "200" to "Device Model Name", "201" to "Device Model Number", "202" to "Device Serial Number",
    "105" to "Session Timestamp", "203" to "Device Last Interrogation Date and Time",
    "519" to "Unloaded Battery Voltage", "533" to "Longevity Estimate", "520" to "Battery Current",
    "512" to "Atrial Pacing Lead Impedance", "507" to "RV Pacing Lead Impedance",
    "2722" to "Ventricular Signal Amplitude", "2721" to "Atrial Signal Amplitude",
    "2468" to "Atrial Lead Serial Number", "2470" to "RV Lead Serial Number",
    "2457" to "Model Number: SJM Atrial Lead", "2461" to "Model Number: SJM RV Pace/Sense Lead",
    "2456" to "Manufacturer: Atrial Lead", "2460" to "Manufacturer: RV Lead",
    "2459" to "Implant Date: Atrial Lead", "2463" to "Implant Date: RV Lead",
    "2442" to "Implant Date: Device", "301" to "Mode",
    "1610" to "A. Capture Test Threshold Amplitude", "1606" to "RV. Capture Test Threshold Amplitude",
    "2440" to "Ejection Fraction", "2441" to "Indications for Implant: List",
    "1611" to "A. Capture Test Pulse Width", "1607" to "RV. Capture Test Pulse Width",
    "2464" to "Manufacturer: LV Lead", "2465" to "Model Number: SJM LV Lead",
    "2467" to "Implant Date: LV Lead", "2471" to "LV Lead Serial Number",
    "2720" to "LV Pacing Lead Impedance", "1616" to "LV. Capture Test Threshold Amplitude", "1617" to "LV. Capture Test Pulse Width",
)

/** Coded logs have most lines starting with a numeric code — either the real 0x1C-delimited variant or the plain concatenated variant. */
private fun isCodedFormat(text: String): Boolean = isDelimitedCodedFormat(text) || isConcatenatedCodedFormat(text)

/**
 * Every real Abbott coded-log export (Merlin.net "Detailed Log" exports)
 * delimits each line's fields with an 0x1C (ASCII File Separator) control
 * character: `{code}<FS>{Label}<FS>{Value}<FS>{Unit}<FS>`.
 */
private fun isDelimitedCodedFormat(text: String): Boolean {
    val lines = text.split('\n').filter { it.trim().isNotEmpty() }
    if (lines.size < 10) return false
    val codedLines = lines.count { Regex("""^\d{2,5}$UNIT_SEPARATOR""").containsMatchIn(it) }
    return codedLines.toDouble() / lines.size > 0.7
}

/** Fallback for a concatenated variant (`{code}{Label}{Value}`) with no delimiter at all. */
private fun isConcatenatedCodedFormat(text: String): Boolean {
    val lines = text.split('\n').filter { it.trim().isNotEmpty() }
    if (lines.size < 10) return false
    val codedLines = lines.count { Regex("""^\d{2,5}[A-Z]""").containsMatchIn(it) }
    return codedLines.toDouble() / lines.size > 0.7
}

/**
 * Parses an 0x1C-delimited coded log into a field map. The code alone
 * identifies the field — immune to label wording changing across
 * code/label revisions.
 */
private fun parseDelimitedCodedLog(text: String): Map<String, String> {
    val fields = mutableMapOf<String, String>()
    for (line in text.split('\n')) {
        if (!line.contains(UNIT_SEPARATOR)) continue
        val parts = line.split(UNIT_SEPARATOR)
        val code = parts[0].trim()
        val fieldName = ABBOTT_CODES[code] ?: continue
        if (fields.containsKey(fieldName)) continue
        // Recombine value + unit into one string (e.g. "0.4" + "mV" ->
        // "0.4mV") so downstream extraction keeps working unchanged
        // regardless of which variant matched.
        val value = parts.getOrNull(2)?.trim() ?: ""
        val unit = parts.getOrNull(3)?.trim() ?: ""
        fields[fieldName] = if (unit.isNotEmpty()) "$value$unit" else value
    }
    return fields
}

/** Parses a concatenated-variant coded Abbott log (`{code}{LabelText}{Value}`) into a field map. */
private fun parseConcatenatedCodedLog(text: String): Map<String, String> {
    val fields = mutableMapOf<String, String>()
    for (line in text.split('\n')) {
        val trimmed = line.trim()
        if (trimmed.isEmpty()) continue
        for ((code, label) in CODE_LABEL_PREFIXES) {
            if (trimmed.startsWith(code + label)) {
                val value = trimmed.substring(code.length + label.length).trim()
                val fieldName = ABBOTT_CODES[code]
                if (fieldName != null && !fields.containsKey(fieldName)) fields[fieldName] = value
                break
            }
        }
    }
    return fields
}

/** Parses an MM/DD/YYYY date string (with optional time) into ISO format. */
private fun parseAbbottDate(dateStr: String): String {
    val m = Regex("""(\d{1,2})/(\d{1,2})/(\d{4})""").find(dateStr) ?: return ""
    return normalizeDate("${m.groupValues[1]}/${m.groupValues[2]}/${m.groupValues[3]}", DateLocaleHint.US)
}

/** Parses MM/DD/YYYY HH:MM:SS into ISO datetime, falling back to a date-only parse when no full time is present. */
private fun parseAbbottDateTime(dateStr: String): String {
    val m = Regex("""(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})""").find(dateStr)
    if (m != null) {
        val date = parseAbbottDate(dateStr)
        return if (date.isNotEmpty()) "${date}T${m.groupValues[4].padStart(2, '0')}:${m.groupValues[5]}:${m.groupValues[6]}" else ""
    }
    return parseAbbottDate(dateStr)
}

/** Extracts a numeric value from a string like "375.0Ohm", "12.0mV", "3.008V". */
private fun extractNumeric(str: String): Double? =
    Regex("""(\d+(?:\.\d+)?)""").find(str)?.groupValues?.get(1)?.toDoubleOrNull()

private fun pacingThreshold(amplitude: Double?, pulseWidth: Double?): Measurement? {
    if (amplitude == null) return null
    return Measurement(amplitude, if (pulseWidth != null) "V @ ${pulseWidth}ms" else "V")
}

/** Session ID from the filename's trailing digits before ".log". */
private fun sessionIdFromFilename(fileName: String): String? =
    Regex("""_?(\d+)\.log$""", RegexOption.IGNORE_CASE).find(fileName)?.groupValues?.get(1)

private fun buildReportFromCodedLog(fields: Map<String, String>, fileName: String, rawText: String): UnifiedReport {
    val nameParts = (fields["PatientName"] ?: "").split(',')
    val lastName = nameParts.getOrNull(0)?.trim() ?: ""
    val firstName = nameParts.getOrNull(1)?.trim() ?: ""
    val dob = parseAbbottDate(fields["PatientDOB"] ?: "")

    val interrogationDate = parseAbbottDateTime(fields["SessionTimestamp"] ?: fields["LastInterrogation"] ?: "")

    val modelName = fields["DeviceModelName"] ?: ""
    val modelNumber = fields["DeviceModelNumber"] ?: ""
    val deviceModel = modelName.ifEmpty { modelNumber }.ifEmpty { "Unknown" }
    val deviceSerial = fields["DeviceSerialNumber"] ?: "Unknown"
    val deviceImplantDate = parseAbbottDate(fields["DeviceImplantDate"] ?: "")

    var deviceType = "Pacemaker"
    val modelUpper = deviceModel.uppercase()
    if (modelUpper.contains("ICM") || modelUpper.contains("ASSERT")) {
        // Insertable Cardiac Monitor (e.g. "Assert-IQ") — leadless, checked
        // before the lead-derived CRT-D/CRT-P bump below.
        deviceType = "ICM"
    } else if (modelUpper.contains("CRT-D") || modelUpper.contains("QUADRA")) {
        deviceType = "CRT-D"
    } else if (modelUpper.contains("CRT-P")) {
        deviceType = "CRT-P"
    } else if (modelUpper.contains("ICD") || modelUpper.contains("FORTIFY") || modelUpper.contains("ELLIPSE") || modelUpper.contains("UNIFY")) {
        deviceType = "ICD"
    }

    val batteryVoltage = extractNumeric(fields["BatteryVoltage"] ?: "")

    val leads = mutableListOf<LeadData>()

    val rvLead = LeadData(
        name = "RV",
        serial = fields["RVLeadSerial"]?.takeIf { it.isNotEmpty() },
        model = fields["RVLeadModel"]?.takeIf { it.isNotEmpty() },
        manufacturer = fields["RVLeadManufacturer"]?.takeIf { it.isNotEmpty() },
        implantDate = parseAbbottDate(fields["RVLeadImplantDate"] ?: "").ifEmpty { null },
        impedance = extractNumeric(fields["RVLeadImpedance"] ?: "")?.let { Measurement(it, "Ohm") },
        sensing = extractNumeric(fields["VentricularSignalAmplitude"] ?: "")?.let { Measurement(it, "mV") },
        pacingThreshold = pacingThreshold(extractNumeric(fields["RVCaptureThreshold"] ?: ""), extractNumeric(fields["RVCapturePulseWidth"] ?: "")),
    )
    if (hasLeadData(rvLead)) leads.add(rvLead)

    val atrialLead = LeadData(
        name = "Atrium",
        serial = fields["AtrialLeadSerial"]?.takeIf { it.isNotEmpty() },
        model = fields["AtrialLeadModel"]?.takeIf { it.isNotEmpty() },
        manufacturer = fields["AtrialLeadManufacturer"]?.takeIf { it.isNotEmpty() },
        implantDate = parseAbbottDate(fields["AtrialLeadImplantDate"] ?: "").ifEmpty { null },
        impedance = extractNumeric(fields["AtrialLeadImpedance"] ?: "")?.let { Measurement(it, "Ohm") },
        sensing = extractNumeric(fields["AtrialSignalAmplitude"] ?: "")?.let { Measurement(it, "mV") },
        pacingThreshold = pacingThreshold(extractNumeric(fields["AtrialCaptureThreshold"] ?: ""), extractNumeric(fields["AtrialCapturePulseWidth"] ?: "")),
    )
    if (hasLeadData(atrialLead)) leads.add(atrialLead)

    // LV Lead (CRT devices only — most Abbott reports won't have one).
    val lvLead = LeadData(
        name = "LV",
        serial = fields["LVLeadSerial"]?.takeIf { it.isNotEmpty() },
        model = fields["LVLeadModel"]?.takeIf { it.isNotEmpty() },
        manufacturer = fields["LVLeadManufacturer"]?.takeIf { it.isNotEmpty() },
        implantDate = parseAbbottDate(fields["LVLeadImplantDate"] ?: "").ifEmpty { null },
        impedance = extractNumeric(fields["LVLeadImpedance"] ?: "")?.let { Measurement(it, "Ohm") },
        pacingThreshold = pacingThreshold(extractNumeric(fields["LVCaptureThreshold"] ?: ""), extractNumeric(fields["LVCapturePulseWidth"] ?: "")),
    )
    if (hasLeadData(lvLead)) leads.add(lvLead)

    // An LV lead means this is a CRT device even when the model name/number
    // doesn't spell that out.
    if (leads.any { it.name == "LV" }) {
        deviceType = if (deviceType == "ICD") "CRT-D" else "CRT-P"
    }

    val hasPatientIdentity = lastName.isNotEmpty() || dob.isNotEmpty()
    val hasDeviceIdentity = deviceModel != "Unknown" || deviceSerial != "Unknown"

    val additionalFields = mutableMapOf<String, String>()
    fields["EjectionFraction"]?.let { if (it.isNotEmpty()) additionalFields["ejection_fraction"] = it }
    fields["IndicationsForImplant"]?.let { if (it.isNotEmpty()) additionalFields["indications_for_implant"] = it }

    return UnifiedReport(
        manufacturer = "Abbott",
        interrogationDate = normalizeDate(interrogationDate, DateLocaleHint.US),
        sessionId = sessionIdFromFilename(fileName),
        patient = PatientInfo(
            firstName = firstName,
            lastName = lastName,
            dob = normalizeDate(dob, DateLocaleHint.US),
            hospitalPatientId = fields["PatientID"]?.takeIf { it.isNotEmpty() },
        ),
        device = DeviceInfo(type = deviceType, model = deviceModel, serialNumber = deviceSerial, implantDate = deviceImplantDate.ifEmpty { null }),
        battery = BatteryData(voltage = batteryVoltage?.let { Measurement(it, "V") }),
        leads = leads,
        additionalFields = additionalFields,
        rawText = rawText,
        formatVariant = "abbott-coded-log",
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}

/** Freeform-text regex fallback for logs that don't match the coded format at all. */
private fun parseAbbottText(text: String, fileName: String): UnifiedReport {
    val patientMatch = Regex("""Patient Name\s+(.+)""", RegexOption.IGNORE_CASE).find(text)
    val nameParts = patientMatch?.groupValues?.get(1)?.trim()?.split(',') ?: emptyList()
    val lastName = nameParts.getOrNull(0)?.trim() ?: ""
    val firstName = nameParts.getOrNull(1)?.trim() ?: ""

    val dateMatch = Regex("""Session Timestamp\s+(\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)""", RegexOption.IGNORE_CASE).find(text)
    val interrogationDate = dateMatch?.let { parseAbbottDateTime(it.groupValues[1]) } ?: ""

    val dobMatch = Regex("""Date of Birth:?\s*(\d{1,2}/\d{1,2}/\d{4})""", RegexOption.IGNORE_CASE).find(text)
    val dob = dobMatch?.let { parseAbbottDate(it.groupValues[1]) } ?: ""

    val modelMatch = Regex("""Model Number:?\s*(.+)""", RegexOption.IGNORE_CASE).find(text)
    // Anchored away from lead serial lines ("Atrial Lead Serial Number ...") via a negative lookbehind.
    val serialMatch = Regex("""(?<!Lead\s)Serial Number(?::\s*|\s+)([A-Z0-9]+)""", RegexOption.IGNORE_CASE).find(text)
    val voltageMatch = Regex("""Unloaded Battery Voltage\s+([0-9.]+)\s*V""", RegexOption.IGNORE_CASE).find(text)

    val atrialSerial = Regex("""Atrial Lead Serial Number\s+([A-Z0-9]+)""", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1) ?: ""
    val rvSerial = Regex("""RV Lead Serial Number\s+([A-Z0-9]+)""", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1) ?: ""
    val lvSerial = Regex("""LV Lead Serial Number\s+([A-Z0-9]+)""", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1) ?: ""
    val rvImp = Regex("""RV Pacing Lead Impedance\s+([0-9.]+)\s*Ohm""", RegexOption.IGNORE_CASE).find(text)
    val rvSense = Regex("""Ventricular Signal Amplitude\s+([0-9.]+)\s*mV""", RegexOption.IGNORE_CASE).find(text)
    val atrialSense = Regex("""Atrial Signal Amplitude\s+([0-9.]+)\s*mV""", RegexOption.IGNORE_CASE).find(text)

    val leads = mutableListOf<LeadData>()
    if (rvSerial.isNotEmpty() || rvImp != null || rvSense != null) {
        leads.add(
            LeadData(
                name = "RV",
                serial = rvSerial.ifEmpty { null },
                impedance = rvImp?.groupValues?.get(1)?.toDoubleOrNull()?.let { Measurement(it, "Ohm") },
                sensing = rvSense?.groupValues?.get(1)?.toDoubleOrNull()?.let { Measurement(it, "mV") },
            ),
        )
    }
    if (atrialSerial.isNotEmpty() || atrialSense != null) {
        leads.add(
            LeadData(
                name = "Atrium",
                serial = atrialSerial.ifEmpty { null },
                sensing = atrialSense?.groupValues?.get(1)?.toDoubleOrNull()?.let { Measurement(it, "mV") },
            ),
        )
    }
    if (lvSerial.isNotEmpty()) {
        leads.add(LeadData(name = "LV", serial = lvSerial))
    }

    var deviceType = "Pacemaker"
    val modelStr = modelMatch?.groupValues?.get(1)?.trim()?.uppercase() ?: ""
    if (modelStr.contains("CRT-D") || modelStr.contains("QUADRA")) {
        deviceType = "CRT-D"
    } else if (modelStr.contains("CRT-P")) {
        deviceType = "CRT-P"
    } else if (modelStr.contains("ICD") || modelStr.contains("FORTIFY") || modelStr.contains("ELLIPSE") || modelStr.contains("UNIFY")) {
        deviceType = "ICD"
    }

    val hasPatientIdentity = lastName.isNotEmpty() || dob.isNotEmpty()
    val hasDeviceIdentity = modelMatch != null || serialMatch != null

    return UnifiedReport(
        manufacturer = "Abbott",
        interrogationDate = normalizeDate(interrogationDate, DateLocaleHint.US),
        sessionId = sessionIdFromFilename(fileName),
        patient = PatientInfo(firstName = firstName, lastName = lastName, dob = normalizeDate(dob, DateLocaleHint.US)),
        device = DeviceInfo(
            type = deviceType,
            model = modelMatch?.groupValues?.get(1)?.trim() ?: "Unknown",
            serialNumber = serialMatch?.groupValues?.get(1)?.trim() ?: "Unknown",
        ),
        battery = BatteryData(voltage = voltageMatch?.groupValues?.get(1)?.toDoubleOrNull()?.let { Measurement(it, "V") }),
        leads = leads,
        rawText = text,
        formatVariant = "abbott-freeform-text",
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}

/**
 * Main entry point. [content] is the raw file bytes (checked for a ZIP magic
 * header — DOCX-wrapped logs aren't supported yet, see the class doc — and
 * otherwise decoded as UTF-8 text), [fileName] is the basename (used for
 * session-ID extraction).
 */
fun parseAbbottLog(content: ByteArray, fileName: String): UnifiedReport? {
    val isZip = content.size > 4 && content[0] == 0x50.toByte() && content[1] == 0x4B.toByte() &&
        content[2] == 0x03.toByte() && content[3] == 0x04.toByte()
    if (isZip) return null // DOCX-wrapped logs not supported yet.

    val rawText = content.decodeToString()

    if (isCodedFormat(rawText)) {
        val delimited = if (isDelimitedCodedFormat(rawText)) parseDelimitedCodedLog(rawText) else null
        val fields = delimited ?: parseConcatenatedCodedLog(rawText)
        val report = buildReportFromCodedLog(fields, fileName, rawText)
        return report.copy(formatVariant = "abbott:source=plain-text;${report.formatVariant}")
    }

    val report = parseAbbottText(rawText, fileName)
    return report.copy(formatVariant = "abbott:source=plain-text;${report.formatVariant}")
}
