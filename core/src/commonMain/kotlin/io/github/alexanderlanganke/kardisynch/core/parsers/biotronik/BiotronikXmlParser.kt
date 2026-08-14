package io.github.alexanderlanganke.kardisynch.core.parsers.biotronik

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
import io.github.alexanderlanganke.kardisynch.core.xml.XmlNode
import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser

/**
 * Biotronik XML parser, ported from `parseBiotronikXML`
 * (src/main/parsers/biotronik-parser.ts). Reads the proprietary Biotronik
 * "carddas" XML export and transforms it into [UnifiedReport].
 *
 * Diagnostics are simplified from the original — see the equivalent note on
 * [io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.parseMedtronicPdd].
 * `formatVariant`/`parseWarnings` per-field provenance tracking isn't ported;
 * the fail-soft extraction framework it would build on
 * ([io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics.DiagnosticsCollector])
 * exists (issue #193) but isn't retrofitted into this parser yet — see that
 * file's doc comment for why.
 */
fun parseBiotronikXML(xmlData: String): UnifiedReport {
    val xml = XmlParser.parse(xmlData) // root: InterfaceData (namespace-stripped)

    val summaryTable = findTableByAttribute(xml, "MANUFACTURERDESCR")
        ?: findTableByAttribute(xml, "CATAGGREGATDESCR")

    val settingsTable = findTableByAttribute(xml, "Elektrodenmodell")
        ?: findTableByAttribute(xml, "LeadModel")
        ?: findTableByAttribute(xml, "Kanäle")
        ?: findTableByAttribute(xml, "Channels")

    val statsTable = safe({ findTable(xml, "9473") }, null) // arrhythmia stats

    // Battery remaining-capacity sometimes lives in a separate
    // AdditionalMeasurements table (seen as table '9112' on a real Amvia Sky
    // sample) rather than settingsTable — findTableByAttribute already
    // searches AdditionalMeasurements too, so this is found by attribute
    // name, in case a different export uses a different table for it.
    val batteryTable = safe({
        findTableByAttribute(xml, "Batterie-Restkapazität") ?: findTableByAttribute(xml, "BatteryRemainingCapacity")
    }, null)

    // Count 'nsT' episodes from the episode list (if it exists).
    val nsTCount = safe({
        val episodeTable = measurementTables(xml).firstOrNull { it.child("TableName")?.text == "TBU_EPISODE_LIST" }
        val episodeList = episodeTable?.childrenNamed("ForeignKey") ?: emptyList()
        episodeList.count { ep ->
            ep.childrenNamed("TableEntry").any { it.child("CharValue")?.text == "nsT" }
        }
    }, 0)

    val personalData = xml.child("Patient")?.child("PersonalData")

    // Hardware info from the settings table.
    var channels = safe({ findAllEntriesMultilang(settingsTable, "Kanäle", "Channels") }, emptyList())

    // Fallback: pacemaker XMLs use numbered "Kanal 1".."Kanal 4" instead of
    // repeated "Kanäle".
    if (channels.isEmpty() && settingsTable != null) {
        val numberedChannels = safe({
            (1..4).mapNotNull { k ->
                val v = findEntry(settingsTable, "Kanal $k")
                v?.takeIf { it != "." && it != "Unknown" }
            }
        }, emptyList())
        if (numberedChannels.isNotEmpty()) channels = numberedChannels
    }

    val manufacturers = safe({ findAllEntriesMultilang(settingsTable, "Hersteller", "Manufacturer") }, emptyList())
    val models = safe({ findAllEntriesMultilang(settingsTable, "Elektrodenmodell", "LeadModel") }, emptyList())
    val serials = safe({ findAllEntriesMultilang(settingsTable, "Seriennummer", "SerialNumber") }, emptyList())

    // Intelligent alignment fix: Biotronik XMLs sometimes contain multiple
    // blocks of 'Kanäle' (e.g. historical vs. current) but only one block of
    // 'Elektrodenmodell'. Naive index-mapping can align Model[0] with the
    // wrong block's Channel[0]. If channels is a multiple of models, score
    // each block by how well its channel slots agree with real model data
    // and pick the best-scoring block.
    if (models.isNotEmpty() && channels.size > models.size && channels.size % models.size == 0) {
        channels = safe({
            val blockSize = models.size
            val blockCount = channels.size / blockSize
            var bestBlockIndex = 0
            var bestBlockScore = -1
            for (b in 0 until blockCount) {
                val start = b * blockSize
                val chunk = channels.subList(start, start + blockSize)
                var score = 0
                var hasValidChannel = false
                for (i in 0 until blockSize) {
                    val modelExists = models.getOrNull(i)?.let { it != "." && it != "Unknown" } == true
                    val channelExists = chunk.getOrNull(i)?.let { it != "." && it != "Unknown" } == true
                    when {
                        modelExists && channelExists -> score += 5
                        modelExists && !channelExists -> score -= 5
                        channelExists -> hasValidChannel = true
                    }
                }
                if (hasValidChannel) score += 1
                if (score > bestBlockScore) {
                    bestBlockScore = score
                    bestBlockIndex = b
                }
            }
            val bestStart = bestBlockIndex * blockSize
            channels.subList(bestStart, bestStart + blockSize)
        }, channels)
    }

    // Third fallback: some exports leave every Kanäle/Kanal-N entry as a
    // '.' placeholder even though Elektrodenmodell carries real per-lead
    // data, with no channel-identity field anywhere. Infer position from
    // the canonical atrial-then-ventricular(-then-LV) ordering. A single
    // real lead is left generically named: single-chamber devices are
    // genuinely ambiguous between atrial-only and ventricular-only.
    if (channels.isNotEmpty() && channels.none { it.isNotEmpty() && it != "." && it != "Unknown" }) {
        val realModelCount = models.count { it.isNotEmpty() && it != "." && it != "Unknown" }
        val positional = when (realModelCount) {
            3 -> listOf("RA", "RV", "LV")
            2 -> listOf("RA", "RV")
            1 -> listOf("Lead")
            else -> null
        }
        if (positional != null) channels = positional
    }

    // Dynamic lead construction: iterate 'Kanäle' as the installed slots,
    // assuming manufacturers/models/serials start at the same index.
    val leadsFromSettings = safe({
        val built = mutableListOf<LeadData>()
        for (i in channels.indices) {
            val channel = channels[i]
            if (channel.isEmpty() || channel == "." || channel == "Unknown") continue

            val lead = safe({
                var impedance: Measurement? = null
                var sensing: Measurement? = null
                var pacingThreshold: Measurement? = null

                val prefix = when (channel) {
                    "RA" -> "FU_RA"
                    "RV" -> "FU_RV"
                    "LV" -> "FU_LV"
                    else -> ""
                }
                if (prefix.isNotEmpty()) {
                    findEntry(summaryTable, "${prefix}_IMPED")?.toDoubleOrNull()?.let { impedance = Measurement(it, "Ohms") }
                    findEntry(summaryTable, "${prefix}_SENSING")?.toDoubleOrNull()?.let { sensing = Measurement(it, "mV") }

                    val pacingPrefix = when (channel) {
                        "RA" -> "A"
                        "RV" -> "V"
                        "LV" -> "LV"
                        else -> ""
                    }
                    val amp = findEntry(summaryTable, "${pacingPrefix}_AMPLITUDE")
                    val pulse = findEntry(summaryTable, "${pacingPrefix}_IMPDAUER")
                    if (amp != null && pulse != null) {
                        // Composite "amplitude @ pulseWidth" string in the
                        // original (Measurement.value: number|string there).
                        // This port's Measurement is numeric-only (see its
                        // doc comment) — stores the amplitude, matching how
                        // downstream trend charts already read this field
                        // (they parse a leading numeric portion out of the
                        // composite form and ignore pulse width).
                        amp.toDoubleOrNull()?.let { pacingThreshold = Measurement(it, "V @ ${pulse}ms") }
                    }
                }

                LeadData(
                    name = if (channel == "Lead") "Lead" else "$channel-Lead",
                    manufacturer = manufacturers.getOrNull(i)?.takeIf { it != "." } ?: "Unknown",
                    model = models.getOrNull(i)?.takeIf { it != "." },
                    serial = serials.getOrNull(i)?.takeIf { it != "." },
                    impedance = impedance,
                    sensing = sensing,
                    pacingThreshold = pacingThreshold,
                )
            }, LeadData(name = "$channel-Lead"))

            if (hasLeadData(lead)) built.add(lead)
        }
        built
    }, emptyList())

    // Alternate schema (Ecuro/Entovis/Evia/Effecta families): no
    // Elektrodenmodell/Kanäle/LeadModel/Channels attributes at all
    // (settingsTable never resolves) — instead a TBU_HSM_IMPLANT_SO table
    // repeats once per implanted lead, each with an explicit LOKALISATION
    // (RA/RV/LV). Per-lead measurements live in a separate shared table
    // ('9115' on every real sample seen), positionally aligned with the
    // TBU_HSM_IMPLANT_SO table order.
    val leadsFromImplantTables = if (leadsFromSettings.isNotEmpty()) {
        emptyList()
    } else {
        safe({
            val implantTables = findAllTables(xml, "TBU_HSM_IMPLANT_SO")
            if (implantTables.isEmpty()) {
                emptyList()
            } else {
                val measurementEntries = findTable(xml, "9115") ?: emptyList()
                fun byAttribute(name: String): List<String> = measurementEntries
                    .filter { (it.child("AttributeName")?.text ?: "").trim().equals(name, ignoreCase = true) }
                    .map { it.child("CharValue")?.text ?: "" }
                val impedances = byAttribute("Elektrodenimpedanz")
                val sensings = byAttribute("P-/R-Wellenamplitude")
                val thresholds = byAttribute("Reizschwelle")
                val pulseWidths = byAttribute("Impulsdauer")

                val built = mutableListOf<LeadData>()
                implantTables.forEachIndexed { i, table ->
                    val location = findEntry(table, "LOKALISATION")
                    if (location.isNullOrEmpty() || location == "." || location == "Unknown") return@forEachIndexed

                    val lead = safe({
                        var impedance: Measurement? = null
                        var sensing: Measurement? = null
                        var pacingThreshold: Measurement? = null

                        val imp = impedances.getOrNull(i)
                        if (imp != null && imp != "." && imp != "-----") imp.toDoubleOrNull()?.let { impedance = Measurement(it, "Ohms") }
                        val sense = sensings.getOrNull(i)
                        if (sense != null && sense != "." && sense != "-----") sense.toDoubleOrNull()?.let { sensing = Measurement(it, "mV") }
                        val amp = thresholds.getOrNull(i)
                        val pulse = pulseWidths.getOrNull(i)
                        if (amp != null && amp != "." && amp != "-----") {
                            pacingThreshold = if (pulse != null && pulse != "." && pulse != "-----") {
                                amp.toDoubleOrNull()?.let { Measurement(it, "V @ ${pulse}ms") }
                            } else {
                                amp.toDoubleOrNull()?.let { Measurement(it, "V") }
                            }
                        }

                        LeadData(
                            name = "$location-Lead",
                            manufacturer = findEntry(table, "MANUFACTURERDESCR") ?: findEntry(table, "MANUFACTURER") ?: "Unknown",
                            model = findEntry(table, "CATLEADDESCR") ?: findEntry(table, "CATLEAD"),
                            impedance = impedance,
                            sensing = sensing,
                            pacingThreshold = pacingThreshold,
                        )
                    }, LeadData(name = "$location-Lead"))

                    if (hasLeadData(lead)) built.add(lead)
                }
                built
            }
        }, emptyList())
    }

    val leads = leadsFromSettings.ifEmpty { leadsFromImplantTables }

    // Infer device type from model name.
    val deviceModelStr = safe({ findEntry(summaryTable, "CATAGGREGATDESCR") ?: "" }, "")
    val deviceType = safe({
        val u = deviceModelStr.uppercase()
        when {
            u.contains("CRT-D") || u.contains("HF-T") -> "CRT-D"
            u.contains("CRT-P") || u.contains("HF-P") -> "CRT-P"
            u.contains("ICD") || u.contains("DEFI") || u.contains("LUMAX") || u.contains("IFORIA") ||
                u.contains("ILIVIA") || u.contains("RIVACOR") || u.contains("INTICA") -> "ICD"
            // Insertable cardiac monitor — leadless, checked before the
            // FunctionalDomain=HSM pacemaker fallback below since real
            // BIOMONITOR exports are also tagged FunctionalDomain 'HSM'.
            u.contains("BIOMONITOR") -> "ICM"
            u.contains("HSM") || u.contains("ENTOVIS") || u.contains("EDORA") || u.contains("EFFECTA") || u.contains("AMVIA") -> "Pacemaker"
            xml.child("Examination")?.child("FunctionalDomain")?.text == "HSM" -> "Pacemaker"
            else -> "Unknown"
        }
    }, "Unknown")

    val patientLastName = safe({
        personalData?.child("Name")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("LastName")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("Nachname")?.text?.takeIf { it.isNotEmpty() }
            ?: ""
    }, "")
    val patientFirstName = safe({
        personalData?.child("FirstName")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("Vorname")?.text?.takeIf { it.isNotEmpty() }
            ?: ""
    }, "")
    val patientDob = safe({
        val raw = personalData?.child("DOB")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("DateOfBirth")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("Geburtsdatum")?.text?.takeIf { it.isNotEmpty() }
            ?: personalData?.child("BirthDate")?.text?.takeIf { it.isNotEmpty() }
            ?: ""
        normalizeDate(raw, DateLocaleHint.EU)
    }, "")

    val deviceSerial = safe({ findEntry(summaryTable, "SERHSM") ?: "" }, "")

    val batteryVoltage = safe({ findEntry(summaryTable, "ACTBATTERYVOLTAGE")?.toDoubleOrNull() }, null)
    val batteryLongevity = safe({
        (findEntryMultilang(settingsTable, "Batterie-Restkapazität", "BatteryRemainingCapacity")
            ?: findEntryMultilang(batteryTable, "Batterie-Restkapazität", "BatteryRemainingCapacity"))
            // The raw value sometimes carries its own trailing '%' alongside
            // the separate unit field, so strip it to avoid duplication.
            ?.replace(Regex("""%\s*$"""), "")
            ?.toDoubleOrNull()
    }, null)
    val batteryStatus = safe({ findEntryMultilang(summaryTable, "FU1BATTERYSTATUS", "BATTERYSTATUS") ?: "Unknown" }, "Unknown")

    val manufacturer = safe({ findEntry(summaryTable, "MANUFACTURERDESCR") ?: "Biotronik" }, "Biotronik")
    val interrogationDate = safe({ normalizeDate(xml.child("Examination")?.child("ExaminationDate")?.text, DateLocaleHint.EU) }, "")

    val hasPatientIdentity = patientLastName.isNotEmpty() || patientDob.isNotEmpty()
    val hasDeviceIdentity = deviceModelStr.isNotEmpty() || deviceSerial.isNotEmpty()

    // arrhythmiaSummary (atrial fibrillation burden, VT episode count) isn't
    // carried on this port's UnifiedReport yet (see its doc comment) — nsTCount
    // and the AF-burden lookup are computed above but not attached anywhere.

    return UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = interrogationDate,
        patient = PatientInfo(firstName = patientFirstName, lastName = patientLastName, dob = patientDob),
        device = DeviceInfo(type = deviceType, model = deviceModelStr, serialNumber = deviceSerial),
        battery = BatteryData(
            voltage = batteryVoltage?.let { Measurement(it, "V") },
            remainingLongevity = batteryLongevity?.let { Measurement(it, "%") },
            status = batteryStatus,
        ),
        leads = leads,
        rawText = xmlData,
        formatVariant = "biotronik",
        parseStatus = if (!hasPatientIdentity && !hasDeviceIdentity) ParseStatus.FAILED else ParseStatus.OK,
    )
}

// --- XML table/entry navigation helpers ---

private fun measurementTables(root: XmlNode): List<XmlNode> {
    val examination = root.child("Examination") ?: return emptyList()
    val tables = mutableListOf<XmlNode>()
    examination.child("Measurements")?.let { tables.addAll(it.childrenNamed("Table")) }
    examination.child("AdditionalMeasurements")?.let { tables.addAll(it.childrenNamed("Table")) }
    return tables
}

/** Finds a specific table's entries by TableName. Ported from `findTable`. */
private fun findTable(root: XmlNode, tableName: String): List<XmlNode>? =
    measurementTables(root).firstOrNull { it.child("TableName")?.text == tableName }?.childrenNamed("TableEntry")

/**
 * Like [findTable], but returns ALL tables matching [tableName] instead of
 * just the first (e.g. TBU_HSM_IMPLANT_SO repeats once per implanted
 * lead). Ported from `findAllTables`.
 */
private fun findAllTables(root: XmlNode, tableName: String): List<List<XmlNode>> =
    measurementTables(root).filter { it.child("TableName")?.text == tableName }.map { it.childrenNamed("TableEntry") }

private fun entryValue(entry: XmlNode): String? {
    entry.child("CharValue")?.let { if (it.text.isNotEmpty()) return it.text }
    entry.child("DecimalValue")?.let { if (it.text.isNotEmpty()) return it.text }
    entry.child("SmallIntValue")?.let { if (it.text.isNotEmpty()) return it.text }
    entry.child("DateValue")?.let { if (it.text.isNotEmpty()) return it.text }
    return null
}

/** Finds a value from a table's entries by attribute name. Ported from `findEntry`. */
private fun findEntry(entries: List<XmlNode>?, attributeName: String): String? =
    entries?.firstOrNull { (it.child("AttributeName")?.text ?: "").equals(attributeName, ignoreCase = true) }?.let(::entryValue)

/** Ported from `findAllEntries`. */
private fun findAllEntries(entries: List<XmlNode>?, attributeName: String): List<String> =
    entries?.filter { (it.child("AttributeName")?.text ?: "").equals(attributeName, ignoreCase = true) }?.map { entryValue(it) ?: "" }
        ?: emptyList()

/**
 * Finds the first table that contains a specific attribute name — useful
 * when table names vary but content schema is consistent. Ported from
 * `findTableByAttribute`.
 */
private fun findTableByAttribute(root: XmlNode, attributeName: String): List<XmlNode>? {
    for (table in measurementTables(root)) {
        val entries = table.childrenNamed("TableEntry")
        if (entries.isEmpty()) continue
        val hasAttribute = entries.any { (it.child("AttributeName")?.text ?: "").equals(attributeName, ignoreCase = true) }
        if (hasAttribute) return entries
    }
    return null
}

/** Ported from `findEntryMultilang`. */
private fun findEntryMultilang(entries: List<XmlNode>?, vararg names: String): String? =
    names.firstNotNullOfOrNull { findEntry(entries, it) }

/** Ported from `findAllEntriesMultilang`. */
private fun findAllEntriesMultilang(entries: List<XmlNode>?, vararg names: String): List<String> =
    names.map { findAllEntries(entries, it) }.firstOrNull { it.isNotEmpty() } ?: emptyList()

/** Minimal stand-in for the original's `safeExtract`: run a block, fall back to [default] on any exception. */
private fun <T> safe(block: () -> T, default: T): T = try { block() } catch (e: Exception) { default }
