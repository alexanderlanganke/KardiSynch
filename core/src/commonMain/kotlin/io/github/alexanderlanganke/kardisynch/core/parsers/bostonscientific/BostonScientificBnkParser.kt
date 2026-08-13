package io.github.alexanderlanganke.kardisynch.core.parsers.bostonscientific

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
 * Boston Scientific BNK parser, ported from `parseBostonScientificBnk`
 * (src/main/parsers/boston-scientific-parser.ts). Reads the proprietary
 * PACEART key/value dump export.
 *
 * The PDF-report side of the original file (`parseBostonScientificPdf` and
 * its Standard/S-ICD variants) is NOT ported: `test/boston bnk/` has no PDF
 * samples to cross-validate against, and PDF text extraction pulls in a
 * platform-specific dependency this pass hasn't scoped. Port when real PDF
 * samples are available.
 *
 * Diagnostics are simplified as in the other ported parsers.
 */

/** German "keine Angabe" (no data) sentinel PACEART uses for empty fields. */
private const val NO_DATA = "K.A"
private fun hasValue(v: String?): Boolean = !v.isNullOrEmpty() && v != NO_DATA

/** Extracts a numeric value from a string like "500.0 Ω", "0.4 ms", ">132 months". Null for missing-data sentinels. */
private fun extractBnkNumeric(str: String?): Double? {
    if (!hasValue(str)) return null
    return Regex("""(\d+(?:\.\d+)?)""").find(str!!)?.groupValues?.get(1)?.toDoubleOrNull()
}

/**
 * PACEART spells every date as a `{Prefix}Day` / `{Prefix}Month` /
 * `{Prefix}Year` triplet rather than one combined field. Per-lead implant
 * dates only ever carry month+year (no day), so [dayKey] is optional and
 * defaults to the 1st.
 */
private fun buildPartsDate(dataMap: Map<String, String>, dayKey: String?, monthKey: String, yearKey: String): String {
    val month = dataMap[monthKey]
    val year = dataMap[yearKey]
    if (!hasValue(month) || !hasValue(year)) return ""
    val day = dayKey?.let { dataMap[it] }
    return normalizeDate("${if (hasValue(day)) day else "1"} $month $year")
}

private data class BnkHeader(val interrogationDate: String, val deviceModel: String, val deviceSerial: String)

/**
 * Every real PACEART export starts with '#' comment lines carrying the
 * interrogation date and device model/serial:
 * ```
 * # TYPE: PACEART           SAVE DATE: 29 Jun 2026
 * # PROGRAMMER      MODEL: 3300 SERIAL: 000000 APP   MODEL: 3868 VERSION: 2.03
 * # DEVICE          MODEL: D321-200-0  SERIAL: 000000
 * ```
 */
private fun parseBnkHeader(bnkData: String): BnkHeader {
    var interrogationDate = ""
    var deviceModel = ""
    var deviceSerial = ""

    // Month token may itself be corrupted to '?' in the source export (seen
    // on ~1/3 of real samples, always as literal "M?r" — the export's
    // encoding step apparently can't round-trip 'ä'). Still capture the raw
    // token so it can be repaired below, or fail soft through normalizeDate
    // if it's some other, unrecognized corruption.
    val saveDateRegex = Regex("""^#\s*TYPE:.*?SAVE DATE:\s*(\d{1,2})\s+([A-Za-zÄäÖöÜü?]+)\s+(\d{4})""", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))
    saveDateRegex.find(bnkData)?.let { m ->
        val rawMonth = m.groupValues[2]
        val month = if (rawMonth == "M?r") "Mär" else rawMonth
        interrogationDate = normalizeDate("${m.groupValues[1]} $month ${m.groupValues[3]}")
    }

    val deviceRegex = Regex("""^#\s*DEVICE\s+MODEL:\s*(\S+)\s+SERIAL:\s*(\S+)""", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))
    deviceRegex.find(bnkData)?.let { m ->
        deviceModel = m.groupValues[1]
        deviceSerial = m.groupValues[2]
    }

    return BnkHeader(interrogationDate, deviceModel, deviceSerial)
}

private data class BnkLeadSlot(val manufacturer: String?, val model: String?, val serial: String?, val position: String?)

/** Reads one `PatientLead{key}*` slot (key is 'A' or 'V1'..'V5'). Null if the slot is unpopulated. */
private fun readLeadSlot(dataMap: Map<String, String>, key: String): BnkLeadSlot? {
    val manufacturer = dataMap["PatientLead${key}Manufacturer"]
    val model = dataMap["PatientLead${key}ModelNum"]
    val serial = dataMap["PatientLead${key}SerialNum"]
    val position = dataMap["PatientLead${key}Position"]
    // A lead with a known chamber position but no model/serial (older/
    // partial exports) must still be built — otherwise the caller's
    // impedance/threshold lookups for that slot never run at all.
    if (!hasValue(model) && !hasValue(serial) && !hasValue(position)) return null
    return BnkLeadSlot(
        manufacturer = if (hasValue(manufacturer)) manufacturer else null,
        model = if (hasValue(model)) model else null,
        serial = if (hasValue(serial)) serial else null,
        position = if (hasValue(position)) position else null,
    )
}

/**
 * Infers the clinical chamber from a lead's Position text ("Rechter Vorhof",
 * "Rechter Ventrikel", "LV Mitte (poster.)") rather than trusting the slot
 * key (A vs V1-V5) it was stored under — real exports don't reliably keep
 * those in sync. Null when the position text itself doesn't say, so the
 * caller's slot-based default still applies.
 */
private fun chamberFromPosition(position: String?): String? {
    if (position == null) return null
    if (Regex("""\bLV\b""", RegexOption.IGNORE_CASE).containsMatchIn(position)) return "LV"
    if (Regex("""vorhof|atrial|atrium""", RegexOption.IGNORE_CASE).containsMatchIn(position)) return "Atrium"
    if (Regex("""ventrikel|ventric""", RegexOption.IGNORE_CASE).containsMatchIn(position)) return "RV"
    return null
}

/** mV amplitude + ms pulse width -> the "V @ Xms" pacing_threshold convention used across parsers. */
private fun buildPacingThreshold(amplitudeMv: Double?, pulseWidthMs: Double?): Measurement? {
    if (amplitudeMv == null) return null
    val amplitudeV = amplitudeMv / 1000
    return Measurement(amplitudeV, if (pulseWidthMs != null) "V @ ${pulseWidthMs}ms" else "V")
}

fun parseBostonScientificBnk(bnkData: String): UnifiedReport {
    val dataMap = mutableMapOf<String, String>()
    for (line in bnkData.split(Regex("""\r?\n"""))) {
        val trimmed = line.trim()
        if (trimmed.startsWith("#") || trimmed.isEmpty()) continue
        val commaIndex = trimmed.indexOf(',')
        if (commaIndex == -1) continue
        dataMap[trimmed.substring(0, commaIndex).trim()] = trimmed.substring(commaIndex + 1).trim()
    }

    val header = parseBnkHeader(bnkData)
    val patientLastName = dataMap["PatientLastName"] ?: ""
    val patientDob = buildPartsDate(dataMap, "PatientBirthDay", "PatientBirthMonth", "PatientBirthYear")
    val deviceModel = header.deviceModel
    val deviceSerial = header.deviceSerial

    // Leads. PACEART keys the atrial lead as "A" and the ventricular lead(s)
    // as "V1".."V5" (CRT devices carry a second/third V-lead for LV, and
    // occasionally a backup RV lead) — which slot is the LV lead varies
    // between exports, so it's identified by its Position text rather than
    // a fixed slot number.
    val leads = mutableListOf<LeadData>()

    readLeadSlot(dataMap, "A")?.let { slot ->
        val impedance = extractBnkNumeric(dataMap["PatientAtrialImped"])
        val threshAmpl = extractBnkNumeric(dataMap["PatientAtrialThreshAmpl"])
        val threshPw = extractBnkNumeric(dataMap["PatientAtrialThreshPW"])
        val lead = LeadData(
            name = chamberFromPosition(slot.position) ?: "Atrium",
            manufacturer = slot.manufacturer,
            model = slot.model,
            serial = slot.serial,
            anatomicLocation = slot.position,
            implantDate = buildPartsDate(dataMap, null, "PatientData.LeadA.ImplantMonth", "PatientData.LeadA.ImplantYear").ifEmpty { null },
            impedance = impedance?.let { Measurement(it, "Ohms") },
            pacingThreshold = buildPacingThreshold(threshAmpl, threshPw),
        )
        if (hasLeadData(lead)) leads.add(lead)
    }

    var attachedGenericV = false // PatientVImped/VThreshAmpl/PatientShockImped describe one lead only
    for (i in 1..5) {
        val slot = readLeadSlot(dataMap, "V$i") ?: continue
        // Default 'RV' when position doesn't say — measurement set below
        // (generic V vs LV-specific) still keys off isLV either way.
        val chamber = chamberFromPosition(slot.position) ?: "RV"
        val isLV = chamber == "LV"

        var impedance: Measurement? = null
        var pacingThreshold: Measurement? = null
        var shockImpedance: Measurement? = null

        if (isLV) {
            impedance = extractBnkNumeric(dataMap["PatientData.LVMsmts.LeadImped"])?.let { Measurement(it, "Ohms") }
            pacingThreshold = buildPacingThreshold(
                extractBnkNumeric(dataMap["PatientData.LVMsmts.PaceThreshAmpl"]),
                extractBnkNumeric(dataMap["PatientData.LVMsmts.PaceThreshPW"]),
            )
        } else if (!attachedGenericV) {
            attachedGenericV = true
            impedance = extractBnkNumeric(dataMap["PatientVImped"])?.let { Measurement(it, "Ohms") }
            pacingThreshold = buildPacingThreshold(
                extractBnkNumeric(dataMap["PatientVThreshAmpl"]),
                extractBnkNumeric(dataMap["PatientVThreshPW"]),
            )
            shockImpedance = extractBnkNumeric(dataMap["PatientShockImped"])?.let { Measurement(it, "Ohms") }
        }

        val lead = LeadData(
            name = chamber,
            manufacturer = slot.manufacturer,
            model = slot.model,
            serial = slot.serial,
            anatomicLocation = slot.position,
            implantDate = buildPartsDate(dataMap, null, "PatientData.Lead$i.ImplantMonth", "PatientData.Lead$i.ImplantYear").ifEmpty { null },
            impedance = impedance,
            pacingThreshold = pacingThreshold,
            shockImpedance = shockImpedance,
        )
        if (hasLeadData(lead)) leads.add(lead)
    }

    // Device type: real PACEART model codes ("D321-200-0", "G247-200-0") are
    // internal part numbers, not marketing names — none of the keyword
    // checks below will ever match them (kept for other/future export
    // variants that might carry a human-readable model or an explicit
    // Device.DeviceType key). When that yields nothing, fall back to
    // inferring from what the leads/measurements actually show: an LV lead
    // means CRT, a DFT/shock-impedance measurement means ICD-capable.
    var deviceType = run {
        val modelUpper = deviceModel.uppercase()
        val deviceTypeValue = dataMap["Device.DeviceType"]
        when {
            !deviceTypeValue.isNullOrEmpty() -> deviceTypeValue
            modelUpper.contains("CRT-D") -> "CRT-D"
            modelUpper.contains("CRT-P") -> "CRT-P"
            modelUpper.contains("S-ICD") || modelUpper.contains("EMBLEM") || modelUpper.contains("SQ-RX") -> "S-ICD"
            modelUpper.contains("ICD") || modelUpper.contains("DYNAGEN") || modelUpper.contains("ORIGEN") || modelUpper.contains("AUTOGEN") -> "ICD"
            modelUpper.contains("ACCOLADE") || modelUpper.contains("FORMIO") || modelUpper.contains("PROPONENT") -> "Pacemaker"
            else -> "Unknown"
        }
    }
    if (deviceType == "Unknown") {
        val hasIcdCapability = hasValue(dataMap["PatientDFT"]) || hasValue(dataMap["PatientShockImped"])
        val hasLvLead = leads.any { it.name == "LV" }
        deviceType = when {
            hasLvLead -> if (hasIcdCapability) "CRT-D" else "CRT-P"
            hasIcdCapability -> "ICD"
            else -> "Pacemaker"
        }
    }

    // Fields with no dedicated UnifiedReport slot — captured verbatim
    // rather than dropped. Ejection Fraction and NYHA class are baseline
    // facts recorded at implant, not re-measured per visit.
    val additionalFields = mutableMapOf<String, String>()
    dataMap["PatientLeftVentEjectFraction"]?.let { if (hasValue(it)) additionalFields["ejection_fraction"] = it }
    dataMap["PatientFuncHeartClass"]?.let { if (hasValue(it)) additionalFields["nyha_class"] = it }

    val hasPatientIdentity = patientLastName.isNotEmpty() || patientDob.isNotEmpty()
    val hasDeviceIdentity = deviceModel.isNotEmpty() || deviceSerial.isNotEmpty()

    return UnifiedReport(
        manufacturer = "Boston Scientific",
        interrogationDate = header.interrogationDate,
        patient = PatientInfo(firstName = dataMap["PatientFirstName"] ?: "", lastName = patientLastName, dob = patientDob),
        device = DeviceInfo(
            type = deviceType,
            model = deviceModel,
            serialNumber = deviceSerial,
            implantDate = buildPartsDate(dataMap, "PatientData.ImplantDay", "PatientData.ImplantMonth", "PatientData.ImplantYear").ifEmpty { null },
        ),
        battery = BatteryData(
            remainingLongevity = extractBnkNumeric(dataMap["BatteryLongevityParams.TimeToERI"])?.let { Measurement(it, "months") },
            status = dataMap["BatteryStatus.BatteryPhase"] ?: "Unknown",
        ),
        leads = leads,
        additionalFields = additionalFields,
        rawText = bnkData,
        formatVariant = "boston-scientific-bnk",
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}
