package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Covers issue #170's end-to-end path: a .pkg file dropped in _IMPORT gets unzipped, parsed, and stored. */
class ImportWatcherPkgTest {
    private lateinit var importDir: File
    private lateinit var dataRoot: File
    private lateinit var reportsRoot: String
    private lateinit var repository: KardiSynchRepository
    private lateinit var reader: DesktopDataRootReader
    private lateinit var writer: DesktopDataRootWriter
    private lateinit var scope: CoroutineScope
    private val events = mutableListOf<String>()

    @BeforeTest
    fun setUp() {
        importDir = Files.createTempDirectory("kardisynch-pkg-import").toFile()
        dataRoot = Files.createTempDirectory("kardisynch-pkg-data").toFile()
        reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        repository = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        writer = DesktopDataRootWriter()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        importDir.deleteRecursively()
        dataRoot.deleteRecursively()
    }

    private fun pkgBytes(xml: String): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("Public/PublicDiscreteData.xml"))
            zip.write(xml.toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        return out.toByteArray()
    }

    private suspend fun runBatch(minEvents: Int = 1, timeoutMs: Long = 20_000) {
        val watcher = ImportWatcher(importDir, reportsRoot, repository, reader, writer, scope, NoOpDirectoryLock) { events.add(it) }
        watcher.start()
        try {
            withTimeout(timeoutMs) {
                while (events.size < minEvents) delay(100)
            }
        } finally {
            watcher.stop()
        }
    }

    @Test
    fun `a pkg file lands in _DATA as a normal visit, not _unmatched`() = runBlocking {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <Composite>
              <Field name="SavedDateTime"><DateTime>2026-07-21T10:00:00</DateTime></Field>
              <Field name="Value">
                <Composite>
                  <Field name="ContextCollection">
                    <Composite>
                      <Array>
                        <Composite>
                          <Field name="Name"><String>NoPendingSettings</String></Field>
                          <Field name="NormalizedParameterCollection">
                            <Composite>
                              <Array>
                                <Composite>
                                  <Field name="Name"><String>DeviceSerialNumber</String></Field>
                                  <Field name="Current"><String>PKG-SER-999</String></Field>
                                </Composite>
                                <Composite>
                                  <Field name="Name"><String>PatientName</String></Field>
                                  <Field name="Current"><String>PKGPATIENT, MAX</String></Field>
                                </Composite>
                                <Composite>
                                  <Field name="Name"><String>PatientBirthDate</String></Field>
                                  <Field name="Current"><String>1970-03-15</String></Field>
                                </Composite>
                              </Array>
                            </Composite>
                          </Field>
                        </Composite>
                      </Array>
                    </Composite>
                  </Field>
                </Composite>
              </Field>
            </Composite>
        """.trimIndent()
        File(importDir, "session.pkg").writeBytes(pkgBytes(xml))

        runBatch(minEvents = 1)

        val patients = repository.observePatients().first()
        assertEquals(1, patients.size)
        assertEquals("PKGPATIENT", patients[0].lastName)
        assertEquals(0, File(importDir, "_unmatched").listFiles { f -> f.isFile }?.size ?: 0)
    }
}
