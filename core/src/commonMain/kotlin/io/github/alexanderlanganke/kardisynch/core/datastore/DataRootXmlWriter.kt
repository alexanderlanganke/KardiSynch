package io.github.alexanderlanganke.kardisynch.core.datastore

import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.xml.XmlNode

/**
 * Writers for `patient.xml`/`visit.xml`, matching the exact schema
 * [parsePatientXml]/[parseVisitXml] read (and Electron's `storage.ts`
 * writes) — this is the byte-for-byte compatibility contract the KMP
 * migration plan requires.
 *
 * NOT yet covered by the advisory lock-file convention (migration plan
 * Decision 4, tracked as its own follow-up) — a write from here racing a
 * concurrent Electron write to the same patient/visit isn't guarded yet.
 * Safe for the current additive-only use (QR-scan-to-new-visit always
 * creates a brand new visit directory, never rewrites an existing one).
 */

/**
 * [mriStatus]/[mriDataHash]/[manufacturerWarningStatus]/[manufacturerWarningHash]
 * (issue #175) should always be whatever [io.github.alexanderlanganke.kardisynch.core.datastore.IndexedPatient]
 * already had for this patient — callers that don't have a reason to
 * change them should read the existing `patient.xml` first (via
 * [parsePatientXml]) and pass its values straight through, the same way
 * Electron's `refreshVisitMetadata` preserves them across every rewrite.
 * Nothing computes a real value for either field anywhere in this app
 * (see [IndexedPatient]'s doc comment) — this is pass-through-only.
 */
fun generatePatientXml(
    id: String,
    firstName: String,
    lastName: String,
    dob: String,
    hospitalPatientId: String?,
    mriStatus: String? = null,
    mriDataHash: String? = null,
    manufacturerWarningStatus: String? = null,
    manufacturerWarningHash: String? = null,
    /** The `<devices>`/`<leads>` history blocks — see [IndexedPatient]'s doc comment. Pass the existing `patient.xml`'s [IndexedPatient.devicesXml]/[IndexedPatient.leadsXml] straight through on any read-merge-write; leave null only when there's no existing file (brand-new patient). */
    devicesXml: XmlNode? = null,
    leadsXml: XmlNode? = null,
): String {
    val sb = StringBuilder()
    sb.append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
    sb.append("<patient>\n")
    sb.append("  <id>${xmlEscapeText(id)}</id>\n")
    sb.append("  <first_name>${xmlEscapeText(firstName)}</first_name>\n")
    sb.append("  <last_name>${xmlEscapeText(lastName)}</last_name>\n")
    sb.append("  <dob>${xmlEscapeText(dob)}</dob>\n")
    if (!hospitalPatientId.isNullOrEmpty()) {
        sb.append("  <hospitalPatientId>${xmlEscapeText(hospitalPatientId)}</hospitalPatientId>\n")
    }
    devicesXml?.let { sb.append(serializeXmlNode(it, depth = 1)) }
    leadsXml?.let { sb.append(serializeXmlNode(it, depth = 1)) }
    if (!mriStatus.isNullOrEmpty()) sb.append("  <mri_status>${xmlEscapeText(mriStatus)}</mri_status>\n")
    if (!mriDataHash.isNullOrEmpty()) sb.append("  <mri_data_hash>${xmlEscapeText(mriDataHash)}</mri_data_hash>\n")
    if (!manufacturerWarningStatus.isNullOrEmpty()) {
        sb.append("  <manufacturer_warning_status>${xmlEscapeText(manufacturerWarningStatus)}</manufacturer_warning_status>\n")
    }
    if (!manufacturerWarningHash.isNullOrEmpty()) {
        sb.append("  <manufacturer_warning_hash>${xmlEscapeText(manufacturerWarningHash)}</manufacturer_warning_hash>\n")
    }
    sb.append("</patient>\n")
    return sb.toString()
}

fun generateVisitXml(reportId: String, report: UnifiedReport): String {
    val sb = StringBuilder()
    sb.append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
    sb.append("<visit>\n")
    sb.append("  <report_id>${xmlEscapeText(reportId)}</report_id>\n")
    sb.append("  <interrogation_date>${xmlEscapeText(report.interrogationDate)}</interrogation_date>\n")
    sb.append("  <manufacturer>${xmlEscapeText(report.manufacturer)}</manufacturer>\n")
    sb.append("  <device_type>${xmlEscapeText(report.device.type)}</device_type>\n")
    sb.append("  <device_model>${xmlEscapeText(report.device.model)}</device_model>\n")
    sb.append("  <device_serial>${xmlEscapeText(report.device.serialNumber)}</device_serial>\n")

    val battery = report.battery
    if (battery.voltage != null || battery.lastChargeTime != null || !battery.status.isNullOrEmpty()) {
        sb.append("  <battery>\n")
        battery.voltage?.let { sb.append("    ").append(measurementElement("voltage", it)).append('\n') }
        battery.lastChargeTime?.let { sb.append("    ").append(measurementElement("last_charge_time", it)).append('\n') }
        battery.status?.takeIf { it.isNotEmpty() }?.let { sb.append("    <status>${xmlEscapeText(it)}</status>\n") }
        sb.append("  </battery>\n")
    }

    if (report.leads.isNotEmpty()) {
        sb.append("  <leads>\n")
        for (lead in report.leads) sb.append(leadElement(lead))
        sb.append("  </leads>\n")
    }

    if (report.additionalFields.isNotEmpty()) {
        sb.append("  <additional_fields>\n")
        for ((key, value) in report.additionalFields) {
            sb.append("    <field name=\"${xmlEscapeAttribute(key)}\">${xmlEscapeText(value)}</field>\n")
        }
        sb.append("  </additional_fields>\n")
    }

    sb.append("</visit>\n")
    return sb.toString()
}

private fun leadElement(lead: LeadData): String {
    val sb = StringBuilder()
    sb.append("    <lead>\n")
    sb.append("      <name>${xmlEscapeText(lead.name)}</name>\n")
    lead.model?.takeIf { it.isNotEmpty() }?.let { sb.append("      <model>${xmlEscapeText(it)}</model>\n") }
    lead.serial?.takeIf { it.isNotEmpty() }?.let { sb.append("      <serial>${xmlEscapeText(it)}</serial>\n") }
    lead.anatomicLocation?.takeIf { it.isNotEmpty() }?.let { sb.append("      <anatomic_location>${xmlEscapeText(it)}</anatomic_location>\n") }
    lead.impedance?.let { sb.append("      ").append(measurementElement("impedance", it)).append('\n') }
    lead.sensing?.let { sb.append("      ").append(measurementElement("sensing", it)).append('\n') }
    lead.pacingThreshold?.let { sb.append("      ").append(measurementElement("pacing_threshold", it)).append('\n') }
    lead.pacingAmplitude?.let { sb.append("      ").append(measurementElement("pacing_amplitude", it)).append('\n') }
    lead.shockImpedance?.let { sb.append("      ").append(measurementElement("shock_impedance", it)).append('\n') }
    sb.append("    </lead>\n")
    return sb.toString()
}

private fun measurementElement(tag: String, measurement: Measurement): String =
    "<$tag value=\"${xmlEscapeAttribute(measurement.value.toString())}\" unit=\"${xmlEscapeAttribute(measurement.unit)}\" />"

private fun xmlEscapeText(s: String): String = s
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")

private fun xmlEscapeAttribute(s: String): String = xmlEscapeText(s).replace("\"", "&quot;")

/**
 * Re-serializes a parsed [XmlNode] subtree back to XML text, indented
 * [depth] levels (2 spaces each) — how [generatePatientXml] passes the
 * `<devices>`/`<leads>` history block through unchanged (see
 * [IndexedPatient]'s doc comment). Not byte-for-byte identical to whatever
 * originally produced [node] (attribute order/whitespace can differ), but
 * semantically identical and correctly re-parseable by both this port's own
 * [XmlParser] and Electron's fast-xml-parser — element order and structure
 * are what round-trips, not literal formatting.
 */
internal fun serializeXmlNode(node: XmlNode, depth: Int): String {
    val indent = "  ".repeat(depth)
    val sb = StringBuilder()
    sb.append(indent).append('<').append(node.name)
    for ((key, value) in node.attributes) sb.append(" $key=\"${xmlEscapeAttribute(value)}\"")
    return if (node.children.isEmpty() && node.text.isEmpty()) {
        sb.append(" />\n").toString()
    } else if (node.children.isEmpty()) {
        sb.append('>').append(xmlEscapeText(node.text)).append("</").append(node.name).append(">\n").toString()
    } else {
        sb.append(">\n")
        for (child in node.children) sb.append(serializeXmlNode(child, depth + 1))
        sb.append(indent).append("</").append(node.name).append(">\n").toString()
    }
}
