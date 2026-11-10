package io.github.alexanderlanganke.kardisynch.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.aliases.AliasKind
import io.github.alexanderlanganke.kardisynch.core.aliases.LeadAliasAttrs
import io.github.alexanderlanganke.kardisynch.core.aliases.SEED_LEAD_ALIASES
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Covers issue #184: the device_types.xml-backed alias store, wired through KardiSynchRepository. */
class KardiSynchRepositoryAliasesTest {
    private lateinit var dataRoot: File
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter

    @BeforeTest
    fun setUp() {
        dataRoot = Files.createTempDirectory("kardisynch-aliases-test").toFile()
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
    }

    @AfterTest
    fun tearDown() {
        dataRoot.deleteRecursively()
    }

    @Test
    fun `listDeviceTypeAliases is empty before device_types xml exists`() = runBlocking {
        assertEquals(emptyList(), repository.listDeviceTypeAliases(reader, dataRoot.absolutePath))
    }

    @Test
    fun `upsertDeviceTypeAlias persists to device_types xml, readable by a fresh call`() = runBlocking {
        repository.upsertDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Medtronic", "ABC123", "ICD", "2024-01-01").getOrThrow()

        assertTrue(File(dataRoot, "device_types.xml").exists())
        val aliases = repository.listDeviceTypeAliases(reader, dataRoot.absolutePath)
        assertEquals(1, aliases.size)
        assertEquals("ICD", aliases[0].type)
        assertEquals(AliasKind.DEVICE, aliases[0].kind)
    }

    @Test
    fun `upsertDeviceTypeAlias replaces an existing entry for the same manufacturer and model`() = runBlocking {
        repository.upsertDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Medtronic", "ABC", "ICD", "2024-01-01").getOrThrow()
        repository.upsertDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Medtronic", "ABC", "Pacemaker", "2024-02-01").getOrThrow()

        val aliases = repository.listDeviceTypeAliases(reader, dataRoot.absolutePath)
        assertEquals(1, aliases.size)
        assertEquals("Pacemaker", aliases[0].type)
    }

    @Test
    fun `resolveDeviceTypeFromAlias finds a persisted device alias`() = runBlocking {
        repository.upsertDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Biotronik", "XYZ", "CRT-D", "2024-01-01").getOrThrow()

        assertEquals("CRT-D", repository.resolveDeviceTypeFromAlias(reader, dataRoot.absolutePath, "biotronik", " xyz "))
        assertNull(repository.resolveDeviceTypeFromAlias(reader, dataRoot.absolutePath, "Biotronik", "Nonexistent"))
    }

    @Test
    fun `upsertLeadTypeAlias and deleteDeviceTypeAlias round-trip a lead entry`() = runBlocking {
        repository.upsertLeadTypeAlias(
            reader, writer, dataRoot.absolutePath, "Medtronic", "6935",
            LeadAliasAttrs(connector = "DF-1"), "2024-01-01",
        ).getOrThrow()

        var aliases = repository.listDeviceTypeAliases(reader, dataRoot.absolutePath)
        assertEquals(1, aliases.size)
        assertEquals(AliasKind.LEAD, aliases[0].kind)
        assertEquals("DF-1", aliases[0].connector)

        repository.deleteDeviceTypeAlias(reader, writer, dataRoot.absolutePath, "Medtronic", "6935", AliasKind.LEAD).getOrThrow()
        aliases = repository.listDeviceTypeAliases(reader, dataRoot.absolutePath)
        assertTrue(aliases.isEmpty())
    }

    @Test
    fun `seedDeviceTypeAliasesIfNeeded adds every seed entry once and is a no-op on a second call`() = runBlocking {
        val added = repository.seedDeviceTypeAliasesIfNeeded(reader, writer, dataRoot.absolutePath, "2024-01-01")
        assertEquals(SEED_LEAD_ALIASES.size, added)

        val addedAgain = repository.seedDeviceTypeAliasesIfNeeded(reader, writer, dataRoot.absolutePath, "2024-02-01")
        assertEquals(0, addedAgain)

        assertEquals(SEED_LEAD_ALIASES.size, repository.listDeviceTypeAliases(reader, dataRoot.absolutePath).size)
    }

    @Test
    fun `seeding never overwrites a clinician-confirmed alias for the same key`() = runBlocking {
        repository.upsertLeadTypeAlias(
            reader, writer, dataRoot.absolutePath, "Medtronic", "6935",
            LeadAliasAttrs(type = "Custom", connector = "IS-1"), "2024-01-01",
        ).getOrThrow()

        repository.seedDeviceTypeAliasesIfNeeded(reader, writer, dataRoot.absolutePath, "2024-02-01")

        val entry = repository.listDeviceTypeAliases(reader, dataRoot.absolutePath)
            .single { it.manufacturer == "Medtronic" && it.model == "6935" }
        assertEquals("Custom", entry.type)
        assertTrue(entry.verified)
    }
}
