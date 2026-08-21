package io.github.alexanderlanganke.kardisynch.core.aliases

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DeviceTypeAliasXmlTest {
    @Test
    fun `an empty or missing file yields no aliases`() {
        assertEquals(emptyList(), parseDeviceTypeAliasesXml(""))
        assertEquals(emptyList(), parseDeviceTypeAliasesXml("not xml at all"))
    }

    @Test
    fun `parses a device alias, defaulting kind and verified`() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <device_types>
              <alias manufacturer="Medtronic" model="ABC123" type="ICD" created_at="2024-01-01T00:00:00.000Z" />
            </device_types>
        """.trimIndent()
        val aliases = parseDeviceTypeAliasesXml(xml)
        assertEquals(1, aliases.size)
        val a = aliases[0]
        assertEquals("Medtronic", a.manufacturer)
        assertEquals("ABC123", a.model)
        assertEquals("ICD", a.type)
        assertEquals(AliasKind.DEVICE, a.kind)
        assertTrue(a.verified, "absent verified attribute means verified")
    }

    @Test
    fun `parses a lead alias with connector, role, and explicit verified=false`() {
        val xml = """
            <device_types>
              <alias manufacturer="Medtronic" model="6935" type="" kind="lead" connector="DF-1" role="LV" verified="false" created_at="2024-01-01T00:00:00.000Z" />
            </device_types>
        """.trimIndent()
        val a = parseDeviceTypeAliasesXml(xml).single()
        assertEquals(AliasKind.LEAD, a.kind)
        assertEquals("DF-1", a.connector)
        assertEquals("LV", a.role)
        assertEquals(false, a.verified)
    }

    @Test
    fun `an entry missing both type and connector is dropped`() {
        val xml = """<device_types><alias manufacturer="X" model="Y" created_at="" /></device_types>"""
        assertEquals(emptyList(), parseDeviceTypeAliasesXml(xml))
    }

    @Test
    fun `round-trips a mixed list of device and lead aliases through XML`() {
        val aliases = listOf(
            DeviceTypeAlias("Medtronic", "M1", "ICD", "2024-01-01", AliasKind.DEVICE),
            DeviceTypeAlias("Boston Scientific", "0127", "", "2024-01-02", AliasKind.LEAD, connector = "DF-1", role = "LV", verified = false),
        )
        val decoded = parseDeviceTypeAliasesXml(encodeDeviceTypeAliasesXml(aliases))
        assertEquals(aliases, decoded)
    }

    @Test
    fun `special characters in field values survive a round-trip`() {
        val aliases = listOf(DeviceTypeAlias("A&B <Co>", "M\"1'", "T", "2024", AliasKind.DEVICE))
        val decoded = parseDeviceTypeAliasesXml(encodeDeviceTypeAliasesXml(aliases))
        assertEquals(aliases, decoded)
    }
}

class DeviceTypeAliasLookupTest {
    private val aliases = listOf(
        DeviceTypeAlias("Medtronic", "ABC", "ICD", "2024-01-01", AliasKind.DEVICE),
        DeviceTypeAlias("Medtronic", "6935", "", "2024-01-01", AliasKind.LEAD, connector = "DF-1", role = "LV"),
    )

    @Test
    fun `lookupDeviceAlias is case and whitespace insensitive`() {
        assertEquals("ICD", lookupDeviceAlias(aliases, "  medtronic ", " abc "))
    }

    @Test
    fun `lookupDeviceAlias never matches a lead-kind entry`() {
        assertNull(lookupDeviceAlias(aliases, "Medtronic", "6935"))
    }

    @Test
    fun `lookupDeviceAlias returns null for a null or blank manufacturer or model`() {
        assertNull(lookupDeviceAlias(aliases, null, "ABC"))
        assertNull(lookupDeviceAlias(aliases, "Medtronic", ""))
    }

    @Test
    fun `lookupLeadAlias returns the connector and type`() {
        val attrs = lookupLeadAlias(aliases, "Medtronic", "6935")
        assertEquals(LeadAliasAttrs(type = null, connector = "DF-1"), attrs)
    }

    @Test
    fun `lookupLeadAlias returns null when there is no match`() {
        assertNull(lookupLeadAlias(aliases, "Medtronic", "nonexistent"))
    }
}

class DeviceTypeAliasMutationTest {
    @Test
    fun `upsertDeviceAlias inserts a new entry`() {
        val result = upsertDeviceAlias(emptyList(), "Medtronic", "ABC", "ICD", "2024-01-01")
        assertEquals(1, result.size)
        assertEquals("ICD", result[0].type)
    }

    @Test
    fun `upsertDeviceAlias replaces an existing entry for the same key`() {
        val existing = listOf(DeviceTypeAlias("Medtronic", "ABC", "ICD", "2024-01-01", AliasKind.DEVICE))
        val result = upsertDeviceAlias(existing, "medtronic", " ABC ", "Pacemaker", "2024-02-01")
        assertEquals(1, result.size)
        assertEquals("Pacemaker", result[0].type)
        assertEquals("2024-02-01", result[0].createdAt)
    }

    @Test
    fun `upsertDeviceAlias rejects blank manufacturer, model, or type`() {
        assertFailsWith<IllegalArgumentException> { upsertDeviceAlias(emptyList(), "", "M", "T", "now") }
        assertFailsWith<IllegalArgumentException> { upsertDeviceAlias(emptyList(), "Mfg", "", "T", "now") }
        assertFailsWith<IllegalArgumentException> { upsertDeviceAlias(emptyList(), "Mfg", "M", "", "now") }
    }

    @Test
    fun `upsertLeadAlias merges connector-only update without dropping a previously learned type`() {
        val existing = listOf(DeviceTypeAlias("Medtronic", "6935", "Bipolar", "2024-01-01", AliasKind.LEAD, connector = null, verified = false))
        val result = upsertLeadAlias(existing, "Medtronic", "6935", LeadAliasAttrs(connector = "DF-1"), "2024-02-01")
        val entry = result.single()
        assertEquals("Bipolar", entry.type, "previously learned type preserved")
        assertEquals("DF-1", entry.connector)
        assertTrue(entry.verified, "a clinician confirming via upsertLeadAlias always marks it verified")
    }

    @Test
    fun `upsertLeadAlias carries forward the seed role, which isn't clinician-editable`() {
        val existing = listOf(DeviceTypeAlias("Medtronic", "6935", "", "2024-01-01", AliasKind.LEAD, connector = "DF-1", role = "LV", verified = false))
        val result = upsertLeadAlias(existing, "Medtronic", "6935", LeadAliasAttrs(type = "Bipolar"), "2024-02-01")
        assertEquals("LV", result.single().role)
    }

    @Test
    fun `upsertLeadAlias requires at least a type or a connector`() {
        assertFailsWith<IllegalArgumentException> { upsertLeadAlias(emptyList(), "Mfg", "M", LeadAliasAttrs(), "now") }
    }

    @Test
    fun `removeAlias deletes only the matching kind and key`() {
        val aliases = listOf(
            DeviceTypeAlias("Medtronic", "ABC", "ICD", "2024-01-01", AliasKind.DEVICE),
            DeviceTypeAlias("Medtronic", "ABC", "", "2024-01-01", AliasKind.LEAD, connector = "DF-1"),
        )
        val result = removeAlias(aliases, "Medtronic", "ABC", AliasKind.DEVICE)
        assertEquals(1, result.size)
        assertEquals(AliasKind.LEAD, result[0].kind)
    }

    @Test
    fun `removeAlias is a no-op when there is no match`() {
        val aliases = listOf(DeviceTypeAlias("Medtronic", "ABC", "ICD", "2024-01-01", AliasKind.DEVICE))
        assertEquals(aliases, removeAlias(aliases, "Other", "Model"))
    }
}

class SeedDeviceTypeAliasesTest {
    @Test
    fun `seeding into an empty store adds every seed entry, unverified`() {
        val added = seedDeviceTypeAliases(emptyList(), "2024-01-01")
        assertEquals(SEED_LEAD_ALIASES.size, added.size)
        assertTrue(added.all { !it.verified })
        assertTrue(added.all { it.kind == AliasKind.LEAD })
    }

    @Test
    fun `seeding never overwrites an existing entry for the same key, seeded or clinician-confirmed`() {
        val clinicianConfirmed = DeviceTypeAlias("Medtronic", "6935", "Custom", "2023-01-01", AliasKind.LEAD, connector = "IS-1", verified = true)
        val added = seedDeviceTypeAliases(listOf(clinicianConfirmed), "2024-01-01")
        assertTrue(added.none { it.manufacturer == "Medtronic" && it.model == "6935" })
    }

    @Test
    fun `seeding twice in a row is idempotent`() {
        val firstPass = seedDeviceTypeAliases(emptyList(), "2024-01-01")
        val secondPass = seedDeviceTypeAliases(firstPass, "2024-02-01")
        assertEquals(emptyList(), secondPass)
    }

    @Test
    fun `every seed model within one manufacturer's connector group is unique`() {
        val keys = SEED_LEAD_ALIASES.map { normalizeAliasKey(it.manufacturer, it.model) }
        assertEquals(keys.size, keys.toSet().size, "no duplicate (manufacturer, model) within the seed table")
    }
}

class GetConnectorFlagTest {
    @Test
    fun `flags DF-1 regardless of role`() {
        val aliases = listOf(DeviceTypeAlias("Medtronic", "6944", "", "2024-01-01", AliasKind.LEAD, connector = "DF-1", role = null, verified = true))
        val flag = getConnectorFlag("Medtronic", "6944", aliases)
        assertEquals(ConnectorFlag("DF-1", confirmed = true), flag)
    }

    @Test
    fun `flags IS-1 only when role is LV`() {
        val aliases = listOf(
            DeviceTypeAlias("Medtronic", "4396", "", "2024-01-01", AliasKind.LEAD, connector = "IS-1", role = "LV", verified = true),
            DeviceTypeAlias("Medtronic", "4193", "", "2024-01-01", AliasKind.LEAD, connector = "IS-1", role = null, verified = true),
        )
        assertEquals(ConnectorFlag("IS-1", confirmed = true), getConnectorFlag("Medtronic", "4396", aliases))
        assertNull(getConnectorFlag("Medtronic", "4193", aliases))
    }

    @Test
    fun `other connectors are not flagged`() {
        val aliases = listOf(DeviceTypeAlias("Biotronik", "Plexa", "", "2024-01-01", AliasKind.LEAD, connector = "IS4", verified = true))
        assertNull(getConnectorFlag("Biotronik", "Plexa", aliases))
    }

    @Test
    fun `unverified seed entries report confirmed=false`() {
        val aliases = listOf(DeviceTypeAlias("Medtronic", "6935", "", "2024-01-01", AliasKind.LEAD, connector = "IS-1", role = "LV", verified = false))
        assertEquals(ConnectorFlag("IS-1", confirmed = false), getConnectorFlag("Medtronic", "6935", aliases))
    }

    @Test
    fun `no matching alias yields no flag`() {
        assertNull(getConnectorFlag("Medtronic", "Unknown-Model", emptyList()))
        assertNull(getConnectorFlag(null, null, emptyList()))
    }
}
