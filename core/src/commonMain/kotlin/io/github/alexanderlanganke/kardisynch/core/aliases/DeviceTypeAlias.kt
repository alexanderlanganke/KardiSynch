package io.github.alexanderlanganke.kardisynch.core.aliases

import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser

/**
 * A clinician-curated (or seeded) mapping from `(manufacturer, model)` to
 * either a device type or a lead's connector/type — a Kotlin port of
 * Electron's `deviceTypeAliases.ts` (issue #184), persisted as
 * `device_types.xml` at the `_DATA` root so it's shared across every
 * workstation pointed at the same folder. This file holds the pure,
 * platform-free pieces: the model, the XML codec, lookup, and the
 * insert/update/delete transforms (each takes and returns a `List` rather
 * than mutating anything — actual file I/O is a desktop/data-layer
 * concern, same split as [io.github.alexanderlanganke.kardisynch.core.matching]).
 *
 * `verified`: entries seeded from [SEED_LEAD_ALIASES] (public manufacturer
 * documentation, not this clinic's own confirmation) are `verified =
 * false`. Anything a clinician has actually confirmed via [upsertDeviceAlias]/
 * [upsertLeadAlias] is `verified = true`.
 */
enum class AliasKind { DEVICE, LEAD }

data class DeviceTypeAlias(
    val manufacturer: String,
    val model: String,
    val type: String,
    val createdAt: String,
    val kind: AliasKind = AliasKind.DEVICE,
    val connector: String? = null,
    /** Seed data only: which port this lead's connector matters for (currently only "LV", for CRT generator-change planning). Not clinician-editable. */
    val role: String? = null,
    val verified: Boolean = true,
)

data class LeadAliasAttrs(val type: String? = null, val connector: String? = null)

/** Case/whitespace-insensitive lookup key. Tolerates a null manufacturer/model rather than throwing, unlike the TS original before its own guard fix. */
fun normalizeAliasKey(manufacturer: String?, model: String?): String =
    "${manufacturer.orEmpty().trim().lowercase()}|${model.orEmpty().trim().lowercase()}"

/** Returns an empty list for a missing/malformed file, matching the original's fail-soft `listAliases`. */
fun parseDeviceTypeAliasesXml(xml: String): List<DeviceTypeAlias> {
    val root = try {
        XmlParser.parse(xml)
    } catch (e: Exception) {
        return emptyList()
    }
    if (root.name != "device_types") return emptyList()
    return root.childrenNamed("alias").mapNotNull { node ->
        val manufacturer = node.attributes["manufacturer"]?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val model = node.attributes["model"]?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val type = node.attributes["type"] ?: ""
        val connector = node.attributes["connector"]?.takeIf { it.isNotEmpty() }
        if (type.isEmpty() && connector == null) return@mapNotNull null
        DeviceTypeAlias(
            manufacturer = manufacturer,
            model = model,
            type = type,
            createdAt = node.attributes["created_at"] ?: "",
            kind = if (node.attributes["kind"] == "lead") AliasKind.LEAD else AliasKind.DEVICE,
            connector = connector,
            role = node.attributes["role"]?.takeIf { it.isNotEmpty() },
            // Absent verified attribute = pre-existing / manually-confirmed entry.
            verified = node.attributes["verified"] != "false",
        )
    }
}

fun encodeDeviceTypeAliasesXml(aliases: List<DeviceTypeAlias>): String {
    val sb = StringBuilder()
    sb.append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
    sb.append("<device_types>\n")
    for (a in aliases) {
        sb.append("  <alias manufacturer=\"${xmlEscapeAttribute(a.manufacturer)}\" model=\"${xmlEscapeAttribute(a.model)}\" type=\"${xmlEscapeAttribute(a.type)}\"")
        if (a.kind == AliasKind.LEAD) sb.append(" kind=\"lead\"")
        a.connector?.let { sb.append(" connector=\"${xmlEscapeAttribute(it)}\"") }
        a.role?.let { sb.append(" role=\"${xmlEscapeAttribute(it)}\"") }
        // Omit the attribute entirely for verified entries — keeps files that
        // predate this field byte-for-byte unchanged, matching the parser's
        // "absent = verified" default above.
        if (!a.verified) sb.append(" verified=\"false\"")
        sb.append(" created_at=\"${xmlEscapeAttribute(a.createdAt)}\" />\n")
    }
    sb.append("</device_types>\n")
    return sb.toString()
}

private fun xmlEscapeAttribute(s: String): String = s
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
    .replace("'", "&apos;")

fun lookupDeviceAlias(aliases: List<DeviceTypeAlias>, manufacturer: String?, model: String?): String? {
    if (manufacturer.isNullOrEmpty() || model.isNullOrEmpty()) return null
    val key = normalizeAliasKey(manufacturer, model)
    val hit = aliases.firstOrNull { it.kind == AliasKind.DEVICE && normalizeAliasKey(it.manufacturer, it.model) == key }
    return hit?.type?.takeIf { it.isNotEmpty() }
}

fun lookupLeadAlias(aliases: List<DeviceTypeAlias>, manufacturer: String?, model: String?): LeadAliasAttrs? {
    if (manufacturer.isNullOrEmpty() || model.isNullOrEmpty()) return null
    val key = normalizeAliasKey(manufacturer, model)
    val hit = aliases.firstOrNull { it.kind == AliasKind.LEAD && normalizeAliasKey(it.manufacturer, it.model) == key } ?: return null
    return LeadAliasAttrs(type = hit.type.takeIf { it.isNotEmpty() }, connector = hit.connector)
}

/** Inserts or replaces the device alias for `(manufacturer, model)`. */
fun upsertDeviceAlias(aliases: List<DeviceTypeAlias>, manufacturer: String, model: String, type: String, createdAt: String): List<DeviceTypeAlias> {
    require(manufacturer.isNotBlank() && model.isNotBlank() && type.isNotBlank()) {
        "upsertDeviceAlias requires manufacturer, model, and type"
    }
    val key = normalizeAliasKey(manufacturer, model)
    val entry = DeviceTypeAlias(manufacturer.trim(), model.trim(), type.trim(), createdAt, AliasKind.DEVICE)
    val idx = aliases.indexOfFirst { it.kind == AliasKind.DEVICE && normalizeAliasKey(it.manufacturer, it.model) == key }
    return if (idx >= 0) aliases.toMutableList().also { it[idx] = entry } else aliases + entry
}

/**
 * Inserts or replaces the lead alias for `(manufacturer, model)`. Merges
 * with any existing entry so setting only the connector doesn't drop a
 * previously learned type (and vice versa) — a clinician confirming a lead
 * here always marks it verified, but the seed data's `role` classification
 * isn't something they're editing, so it carries forward unchanged.
 */
fun upsertLeadAlias(aliases: List<DeviceTypeAlias>, manufacturer: String, model: String, attrs: LeadAliasAttrs, createdAt: String): List<DeviceTypeAlias> {
    val type = attrs.type?.trim().orEmpty()
    val connector = attrs.connector?.trim().orEmpty()
    require(manufacturer.isNotBlank() && model.isNotBlank() && (type.isNotEmpty() || connector.isNotEmpty())) {
        "upsertLeadAlias requires manufacturer, model, and at least one of type/connector"
    }
    val key = normalizeAliasKey(manufacturer, model)
    val idx = aliases.indexOfFirst { it.kind == AliasKind.LEAD && normalizeAliasKey(it.manufacturer, it.model) == key }
    val existing = aliases.getOrNull(idx)
    val entry = DeviceTypeAlias(
        manufacturer = manufacturer.trim(),
        model = model.trim(),
        type = type.ifEmpty { existing?.type.orEmpty() },
        createdAt = createdAt,
        kind = AliasKind.LEAD,
        connector = connector.ifEmpty { existing?.connector.orEmpty() }.takeIf { it.isNotEmpty() },
        role = existing?.role,
        verified = true,
    )
    return if (idx >= 0) aliases.toMutableList().also { it[idx] = entry } else aliases + entry
}

fun removeAlias(aliases: List<DeviceTypeAlias>, manufacturer: String, model: String, kind: AliasKind = AliasKind.DEVICE): List<DeviceTypeAlias> {
    val key = normalizeAliasKey(manufacturer, model)
    return aliases.filterNot { it.kind == kind && normalizeAliasKey(it.manufacturer, it.model) == key }
}

data class ConnectorFlag(val connector: String, val confirmed: Boolean)

/**
 * Decides whether a lead should get the prominent DF-1 / IS-1-in-LV-port
 * highlight. Ported from `getConnectorFlag` (`src/lib/leadConnectorLookup.ts`,
 * issue #198's connector-flag gap). The TS original also checks the lead's
 * own `connector` field before falling back to the alias — omitted here
 * because no parser (Electron's or this port's) ever populates a per-lead
 * `connector` value, so that branch is dead code in practice; the alias
 * lookup is the only real source either way.
 */
fun getConnectorFlag(manufacturer: String?, model: String?, aliases: List<DeviceTypeAlias>): ConnectorFlag? {
    val alias = aliases.firstOrNull {
        it.kind == AliasKind.LEAD && normalizeAliasKey(it.manufacturer, it.model) == normalizeAliasKey(manufacturer, model)
    }
    val connector = alias?.connector ?: return null
    val isFlagged = connector == "DF-1" || (connector == "IS-1" && alias.role == "LV")
    if (!isFlagged) return null
    return ConnectorFlag(connector = connector, confirmed = alias.verified)
}
