package io.github.alexanderlanganke.kardisynch.core.parsers.medtronic

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.model.hasLeadData
import io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics.DiagnosticsCollector
import io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics.deriveParseStatus
import io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics.detectVariant
import io.github.alexanderlanganke.kardisynch.core.util.normalizeDate
import io.github.alexanderlanganke.kardisynch.core.xml.XmlNode
import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser

/**
 * Parses the `Public/PublicDiscreteData.xml` payload inside a Medtronic
 * `.pkg` archive (issue #170), ported from `parseMedtronicXML`
 * (src/main/parsers/medtronic-parser.ts). Unzipping the `.pkg` itself is a
 * platform concern — `java.util.zip` isn't reachable from commonMain even
 * though every current target happens to be JVM-based (Kotlin enforces
 * per-source-set dependencies, not per-configured-target) — see the
 * desktop-side `parseMedtronicPkg` in `apps:desktopApp` for that half.
 *
 * The XML is a generic "Composite/Field" parameter tree (Medtronic's Encore
 * export schema), not a fixed set of top-level elements: every field is
 * looked up by name via [findParam]/[findValueInComposite], mirroring the
 * original 1:1 since there's no more direct path through this schema. Also
 * ported 1:1: [detectVariant]'s "NoPendingSettings" context, falling back
 * to the first context that actually has parameters, so a renamed context
 * in a schema revision degrades gracefully instead of yielding zero fields.
 */
fun parseMedtronicXml(xmlData: String): UnifiedReport? {
    val collector = DiagnosticsCollector()
    return try {
        val root = XmlParser.parse(xmlData)
        val topFields = root.childrenNamed("Field")
        val savedDate = findFieldValue(topFields, "SavedDateTime")

        var params: List<XmlNode> = emptyList()
        var contextVariant = "context=unmatched"

        try {
            val valueField = findInComposite(root, "Value")
            val contextCollection = findInComposite(valueField, "ContextCollection")
            val contexts = contextCollection?.child("Array")?.childrenNamed("Composite") ?: emptyList()

            fun paramsFromContext(context: XmlNode): List<XmlNode> {
                val paramCollection = findInComposite(context, "NormalizedParameterCollection")
                return paramCollection?.child("Array")?.childrenNamed("Composite") ?: emptyList()
            }

            val contextResult = detectVariant(
                collector, "context",
                listOf<Pair<String, () -> List<XmlNode>?>>(
                    "context=NoPendingSettings" to {
                        val named = contexts.firstOrNull { c ->
                            val nameField = findInComposite(c, "Name")
                            textOf(nameField?.child("String")) == "NoPendingSettings"
                        }
                        named?.let(::paramsFromContext)?.takeIf { it.isNotEmpty() }
                    },
                    "context=first-with-params" to {
                        contexts.map(::paramsFromContext).firstOrNull { it.isNotEmpty() }
                    },
                ),
            )
            if (contextResult != null) {
                params = contextResult.value
                contextVariant = contextResult.variant
            }
        } catch (e: Exception) {
            collector.error("context", "Error traversing XML structure: ${e.message}")
        }

        fun findParam(name: String): XmlNode? = params.firstOrNull { p ->
            textOf(findInComposite(p, "Name")?.child("String")) == name
        }

        fun getNumericParam(name: String, unit: String = ""): Measurement? {
            val p = findParam(name) ?: return null
            val v = findValueInComposite(p, "Current") as? String ?: return null
            return v.toDoubleOrNull()?.let { Measurement(it, unit) }
        }

        fun getStatusParamField(paramName: String, subField: String, unit: String = ""): Measurement? {
            val p = findParam(paramName) ?: return null
            val current = findValueInComposite(p, "Current") as? XmlNode ?: return null
            val v = findValueInComposite(current, subField) as? String ?: return null
            return v.toDoubleOrNull()?.let { Measurement(it, unit) }
        }

        // --- Device ---
        val deviceModelParam = findParam("DeviceModelName")
        val deviceSerialParam = findParam("DeviceSerialNumber")
        val deviceTypeParam = findParam("DeviceType")
        val batteryStatusParam = findParam("BatteryStatus")
        val deviceStatusParam = findParam("DeviceStatus")
        val deviceLongevityParam = findParam("DeviceLongevityStatus")

        var deviceModel = ""
        var deviceSerial = ""
        var deviceType = "Unknown"
        var batteryVoltage: Double? = null
        var implantDate: String? = null
        var remainingLongevity: Measurement? = null

        if (deviceModelParam != null) {
            val current = findValueInComposite(deviceModelParam, "Current") as? XmlNode
            if (current != null) {
                val nameField = findInComposite(current, "Name")
                textOf(nameField?.child("String"))?.let { deviceModel = it }
            }
        }
        (findValueInComposite(deviceSerialParam, "Current") as? String)?.let { deviceSerial = it }
        (findValueInComposite(deviceTypeParam, "Current") as? String)?.let { deviceType = it }

        // Normalize the raw XML DeviceType vocabulary to the app's canonical
        // set — anything not in this map is left as-is, or (when there's no
        // DeviceType parameter at all) falls back to model-based inference,
        // same as the .pdd path.
        val rawDeviceTypeMap = mapOf("CRT_D" to "CRT-D", "CRT_P" to "CRT-P", "IPG" to "Pacemaker")
        deviceType = when {
            rawDeviceTypeMap.containsKey(deviceType) -> rawDeviceTypeMap.getValue(deviceType)
            deviceType == "Unknown" && deviceModel.isNotEmpty() -> inferMedtronicDeviceType(deviceModel)
            else -> deviceType
        }
        // A Micra reports its raw DeviceType as 'IPG' like any other
        // pacemaker (it IS one, just without leads) — override on model name.
        if (deviceModel.contains("MICRA", ignoreCase = true)) {
            deviceType = "Leadless Pacemaker"
        }

        if (deviceStatusParam != null) {
            val current = findValueInComposite(deviceStatusParam, "Current") as? XmlNode
            if (current != null) {
                (findValueInComposite(current, "ImplantDateTime") as? String)?.let { implantDate = it }
            }
        }

        if (deviceLongevityParam != null) {
            val current = findValueInComposite(deviceLongevityParam, "Current") as? XmlNode
            if (current != null) {
                val years = findValueInComposite(current, "UserRepresentationAverageRemainingDuration") as? String
                if (years != null) {
                    years.toDoubleOrNull()?.let { remainingLongevity = Measurement(it, "years") }
                } else {
                    val months = findValueInComposite(current, "IDCORepresentationAverageRemainingDuration") as? String
                    months?.toDoubleOrNull()?.let { remainingLongevity = Measurement(it, "months") }
                }
            }
        }

        if (batteryStatusParam != null) {
            val current = findValueInComposite(batteryStatusParam, "Current") as? XmlNode
            if (current != null) {
                val voltageStatusField = findInComposite(current, "VoltageStatus")
                if (voltageStatusField != null) {
                    val voltageComposite = voltageStatusField.child("Composite") ?: voltageStatusField
                    val voltageField = findInComposite(voltageComposite, "Voltage")
                    textOf(voltageField?.child("Real"))?.toDoubleOrNull()?.let { batteryVoltage = it }
                }
            }
        }

        // --- Patient ---
        val patientNameParam = findParam("PatientName")
        val patientDobParam = findParam("PatientBirthDate")
        var firstName = ""
        var lastName = ""
        var dob = ""

        (findValueInComposite(patientNameParam, "Current") as? String)?.let { raw ->
            if (raw.contains(",")) {
                val parts = raw.split(",").map { it.trim() }
                if (parts.size >= 2) {
                    lastName = parts[0]
                    firstName = parts[1]
                } else {
                    lastName = raw
                }
            } else {
                // Space separated: "DOE JOHN" -> last "DOE", first "JOHN" (first token
                // is the last name; the remainder is the first name(s)).
                val parts = raw.split(" ").map { it.trim() }.filter { it.isNotEmpty() }
                if (parts.size > 1) {
                    lastName = parts[0]
                    firstName = parts.drop(1).joinToString(" ")
                } else {
                    lastName = raw
                }
            }
        }
        (findValueInComposite(patientDobParam, "Current") as? String)?.let { dob = it }

        // --- Leads ---
        val leads = mutableListOf<LeadData>()
        for (i in 1..4) {
            val locationParam = findParam("Lead${i}Location")
            val modelParam = findParam("Lead${i}Model")
            val serialParam = findParam("Lead${i}SerialNumber")
            val mfgParam = findParam("Lead${i}Manufacturer")
            val dateParam = findParam("ImplantLead${i}Date")

            val leadLocation = (findValueInComposite(locationParam, "Current") as? String).orEmpty()
            val hasModel = modelParam != null && findValueInComposite(modelParam, "Current") != null

            // Medtronic sometimes has empty strings for unused leads — only
            // build a lead entry when there's a known location or model.
            if (leadLocation.isNotEmpty() || hasModel) {
                val leadModel = (findValueInComposite(modelParam, "Current") as? String).orEmpty()
                val serial = (findValueInComposite(serialParam, "Current") as? String).orEmpty()
                val manufacturer = (findValueInComposite(mfgParam, "Current") as? String).orEmpty()
                val leadImplantDate = (findValueInComposite(dateParam, "Current") as? String).orEmpty()

                var lead = LeadData(
                    name = "$leadLocation Lead",
                    anatomicLocation = leadLocation,
                    model = leadModel,
                    serial = serial,
                    manufacturer = manufacturer.ifEmpty { "Medtronic" },
                    implantDate = leadImplantDate,
                )

                val loc = leadLocation.uppercase()
                lead = when {
                    loc == "RV" || loc.contains("RIGHT VENTRICLE") -> lead.copy(
                        sensing = getNumericParam("VSEventDetectionRVSensingThreshold", "mV") ?: lead.sensing,
                        pacingAmplitude = getNumericParam("VPacingTherapyRVPacingAmplitude", "V") ?: lead.pacingAmplitude,
                        pacingThreshold = getStatusParamField("VPacingTherapyAdaptRVPacingAmplitudeStatus", "PacingThreshold", "V") ?: lead.pacingThreshold,
                    )
                    loc == "RA" || loc == "A" || loc.contains("ATRIUM") -> lead.copy(
                        sensing = getNumericParam("ASEventDetectionRASensingThreshold", "mV") ?: lead.sensing,
                        pacingAmplitude = getNumericParam("APacingTherapyRAPacingAmplitude", "V") ?: lead.pacingAmplitude,
                        pacingThreshold = getStatusParamField("APacingTherapyAdaptRAPacingAmplitudeStatus", "PacingThreshold", "V") ?: lead.pacingThreshold,
                    )
                    loc == "LV" || loc.contains("LEFT VENTRICLE") -> lead.copy(
                        pacingAmplitude = getNumericParam("VPacingTherapyLVPacingPathwayAAmplitude", "V") ?: lead.pacingAmplitude,
                        pacingThreshold = getStatusParamField("VPacingTherapyAdaptLVPacingAmplitudeStatus", "PacingThreshold", "V") ?: lead.pacingThreshold,
                    )
                    else -> lead
                }

                if (hasLeadData(lead)) leads.add(lead)
            }
        }

        // A leadless pacemaker (Micra) has no Lead1-4 params at all, but it
        // still paces/senses a single RV channel via the same RV parameter
        // IDs a transvenous RV lead would use.
        if (leads.isEmpty() && (deviceType == "Leadless Pacemaker" || deviceModel.contains("MICRA", ignoreCase = true))) {
            val virtualLead = LeadData(
                name = "Leadless Pacing/Sensing Channel",
                anatomicLocation = "RV",
                sensing = getNumericParam("VSEventDetectionRVSensingThreshold", "mV"),
                pacingAmplitude = getNumericParam("VPacingTherapyRVPacingAmplitude", "V"),
                pacingThreshold = getStatusParamField("VPacingTherapyAdaptRVPacingAmplitudeStatus", "PacingThreshold", "V"),
            )
            if (hasLeadData(virtualLead)) leads.add(virtualLead)
        }

        UnifiedReport(
            manufacturer = "Medtronic",
            interrogationDate = normalizeDate(savedDate),
            patient = PatientInfo(firstName = firstName, lastName = lastName, dob = normalizeDate(dob)),
            device = DeviceInfo(type = deviceType, model = deviceModel, serialNumber = deviceSerial, implantDate = implantDate),
            battery = BatteryData(voltage = batteryVoltage?.let { Measurement(it, "V") }, remainingLongevity = remainingLongevity),
            leads = leads,
            rawText = xmlData,
            formatVariant = "medtronic-xml:$contextVariant",
            parseStatus = deriveParseStatus(collector, lastName.isNotEmpty() || dob.isNotEmpty(), deviceModel.isNotEmpty() || deviceSerial.isNotEmpty()),
        )
    } catch (e: Exception) {
        null
    }
}

private fun textOf(node: XmlNode?): String? = node?.text?.takeIf { it.isNotEmpty() }

/** Top-level field lookup (used only for `SavedDateTime`, which lives directly under the root `<Composite>`, not inside `Value`). */
private fun findFieldValue(fields: List<XmlNode>, name: String): String? {
    val field = fields.firstOrNull { it.attributes["name"] == name } ?: return null
    field.child("String")?.let { return textOf(it) }
    field.child("DateTime")?.let { return textOf(it) }
    field.child("Boolean")?.let { return textOf(it) }
    field.child("Integer")?.let { return textOf(it) }
    return null
}

/** Finds [name] among [composite]'s `<Field name="...">` children, returning that field's own `<Composite>` child if it has one, else the field node itself. */
private fun findInComposite(composite: XmlNode?, name: String): XmlNode? {
    val field = composite?.childrenNamed("Field")?.firstOrNull { it.attributes["name"] == name } ?: return null
    return field.child("Composite") ?: field
}

/**
 * Finds [name] among [composite]'s `<Field name="...">` children and
 * returns its String/Integer/Real/Discrete/Date/DateTime text (as a
 * [String]) or its `<Composite>` child (as an [XmlNode], for further
 * traversal) — whichever type tag the field actually has, checked in that
 * order. Returns immediately (possibly with a null/empty text) once a type
 * tag is found, rather than falling through to the next tag — an
 * attribute-only, textless `<String charset="..."/>` is a real "this field
 * has no usable value" case in these exports, not "check Integer instead".
 */
private fun findValueInComposite(composite: XmlNode?, name: String): Any? {
    val field = composite?.childrenNamed("Field")?.firstOrNull { it.attributes["name"] == name } ?: return null
    field.child("String")?.let { return textOf(it) }
    field.child("Integer")?.let { return textOf(it) }
    field.child("Real")?.let { return textOf(it) }
    field.child("Discrete")?.let { return textOf(it) }
    field.child("Date")?.let { return textOf(it) }
    field.child("DateTime")?.let { return textOf(it) }
    field.child("Composite")?.let { return it }
    return null
}
