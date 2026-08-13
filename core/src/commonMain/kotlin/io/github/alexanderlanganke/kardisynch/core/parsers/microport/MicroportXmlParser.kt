package io.github.alexanderlanganke.kardisynch.core.parsers.microport

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.util.normalizeDate
import io.github.alexanderlanganke.kardisynch.core.xml.XmlNode
import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser

/**
 * Microport/Paceart XML parser, ported from `parseMicroportXML`
 * (src/main/parsers/microport-parser.ts). Paceart is a multi-vendor
 * remote-monitoring platform (Sorin/ELA Medical/MicroPort CRM share history
 * but the schema allows any vendor) — almost every real data value in this
 * format lives in XML *attributes*, not child element text (see [field]).
 *
 * `raw_text` stores the original XML source rather than the original's
 * `JSON.stringify(parsed)` debug dump (this port has no generic
 * XmlNode-to-JSON serializer, and the original XML is arguably more
 * useful). Diagnostics are otherwise simplified as in the other ported
 * parsers.
 */
fun parseMicroportXML(xmlContent: String): UnifiedReport? {
    val paceart = XmlParser.parse(xmlContent)
    if (paceart.name != "Paceart") return null

    val patientRecord = paceart.child("PatientRecords")?.childrenNamed("PatientRecord")?.firstOrNull() ?: return null

    val demographics = patientRecord.child("Demographics")
    val devices = patientRecord.child("Devices")
    val tests = patientRecord.child("Tests")
    val lookupTables = paceart.child("LookupTables")

    // 1. Patient info. Real exports only ever populate `nameLast` as
    // "Last, First" (no separate nameFirst) but the schema allows a
    // first/last split — try that first, then comma-split, then treat
    // nameLast as a bare surname.
    val nameFirstField = demographics?.field("nameFirst")
    val nameLastField = demographics?.field("nameLast")
    val (firstName, lastName) = when {
        !nameFirstField.isNullOrEmpty() -> nameFirstField to (nameLastField ?: "Unknown")
        nameLastField?.contains(',') == true -> {
            val parts = nameLastField.split(',')
            (parts.getOrElse(1) { "" }.trim()) to parts[0].trim()
        }
        !nameLastField.isNullOrEmpty() -> "" to nameLastField
        else -> "" to "Unknown"
    }
    val rawDob = demographics?.field("BirthDate") ?: ""

    // 2. Device info — resolved from LookupTables by GUID reference.
    val pacemakerNode = devices?.child("Pacemaker")
    val serial = pacemakerNode?.field("SerialNumber")?.trim()?.takeIf { it.isNotEmpty() } ?: "Unknown"

    val pacemakerGuid = pacemakerNode?.child("PacemakerLookup")?.child("PacemakerReference")?.field("GUID")
    val pacemakerDetails = lookupTables?.child("Devices")?.child("Pacemakers")?.childrenNamed("PacemakerDetail") ?: emptyList()
    val deviceLookup = pacemakerGuid?.let { guid -> pacemakerDetails.firstOrNull { it.field("GUID") == guid } }
    val model = deviceLookup?.field("Model") ?: "Unknown"
    val manufacturer = deviceLookup?.field("Manufacturer") ?: "Microport"

    // 3. Interrogation date + evaluation data.
    val clinics = tests?.childrenNamed("PacemakerClinic") ?: emptyList()
    val latestClinic = clinics.lastOrNull()
    val interrogationDate = latestClinic?.field("Date") ?: ""
    val evaluation = latestClinic?.child("Evaluation")
    val telemetry = evaluation?.child("PacemakerTelemetry")
    val thresholds = evaluation?.child("Thresholds")

    // 4. Battery. Real exports carry BatteryImpedance_ohms, not a voltage —
    // stashed in `status` since BatteryData has no dedicated impedance slot.
    val batteryVoltage = telemetry?.field("BatteryVoltage")?.toDoubleOrNull()
    val batteryImpedance = telemetry?.field("BatteryImpedance_ohms")?.toDoubleOrNull()
    val battery = BatteryData(
        voltage = batteryVoltage?.let { Measurement(it, "V") },
        status = batteryImpedance?.let { "Impedance: ${jsNumberString(it)} Ohm" },
    )

    // 5. Leads.
    val leadDetails = lookupTables?.child("Devices")?.child("Leads")?.childrenNamed("LeadDetail") ?: emptyList()
    val leads = mutableListOf<LeadData>()
    for (l in devices?.childrenNamed("Lead") ?: emptyList()) {
        val implantInfo = l.child("ImplantInformation")
        val chamber = implantInfo?.field("Chamber") ?: ""
        // Map "Atrium" -> "RA", "Ventricle" -> "RV"; anything else (e.g. a
        // future "LV" for CRT devices) passes through unchanged.
        val measureChamber = when (chamber) {
            "Atrium" -> "RA"
            "Ventricle" -> "RV"
            else -> chamber
        }

        val leadGuid = l.child("LeadLookup")?.child("LeadReference")?.field("GUID")
        val match = leadGuid?.let { guid -> leadDetails.firstOrNull { it.field("GUID") == guid } }

        var sensing: Measurement? = null
        var pacingThreshold: Measurement? = null
        var impedance: Measurement? = null
        if (measureChamber.isNotEmpty()) {
            findByChamber(thresholds, "Sensing", measureChamber)?.field("Amplitude_millivolts")?.toDoubleOrNull()?.let {
                sensing = Measurement(it, "mV")
            }

            val capture = findByChamber(thresholds, "Capture", measureChamber)
            val captureAmp = capture?.field("Amplitude_volts")?.toDoubleOrNull()
            val captureDur = capture?.field("Duration_ms")?.toDoubleOrNull()
            if (captureAmp != null) {
                pacingThreshold = Measurement(captureAmp, if (captureDur != null) "V @ ms" else "V")
            }

            findByChamber(telemetry, "Lead", measureChamber)?.field("BipolarImpedance_ohms")?.toDoubleOrNull()?.let {
                impedance = Measurement(it, "Ohm")
            }
        }

        val leadData = LeadData(
            name = measureChamber.ifEmpty { "Unknown" },
            model = match?.field("Model") ?: "Unknown",
            manufacturer = match?.field("Manufacturer"),
            serial = l.field("SerialNumber"),
            anatomicLocation = chamber.ifEmpty { null },
            implantDate = implantInfo?.field("Date")?.let { normalizeDate(it).ifEmpty { null } },
            sensing = sensing,
            pacingThreshold = pacingThreshold,
            impedance = impedance,
        )
        if (hasLeadData(leadData)) leads.add(leadData)
    }

    // Infer device type from model name.
    val modelUpper = model.uppercase()
    val deviceType = when {
        modelUpper.contains("CRT-D") -> "CRT-D"
        modelUpper.contains("CRT-P") || modelUpper.contains("CRT") -> "CRT-P"
        modelUpper.contains("ICD") -> "ICD"
        else -> "Pacemaker"
    }

    val hasPatientIdentity = lastName != "Unknown" || rawDob.isNotEmpty()
    val hasDeviceIdentity = model != "Unknown" || serial != "Unknown"

    return UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = normalizeDate(interrogationDate),
        patient = PatientInfo(firstName = firstName, lastName = lastName, dob = normalizeDate(rawDob)),
        device = DeviceInfo(type = deviceType, model = model, serialNumber = serial),
        battery = battery,
        leads = leads,
        rawText = xmlContent,
        formatVariant = "microport-paceart",
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}

/** Almost every real data value in this format is an XML attribute, not child element text — check both, attributes first. */
private fun XmlNode.field(name: String): String? = attributes[name] ?: child(name)?.text?.takeIf { it.isNotEmpty() }

/** Formats a Double the way JS's `${value}` template-literal coercion would — no trailing ".0" for whole numbers — since the original constructs the battery status string via JS string interpolation. */
private fun jsNumberString(d: Double): String =
    if (d == d.toLong().toDouble()) d.toLong().toString() else d.toString()

/** Finds the child named [tag] whose Chamber attribute matches [chamber] (e.g. a Sensing/Capture/Lead telemetry entry). */
private fun findByChamber(parent: XmlNode?, tag: String, chamber: String): XmlNode? =
    parent?.childrenNamed(tag)?.firstOrNull { it.field("Chamber") == chamber }
