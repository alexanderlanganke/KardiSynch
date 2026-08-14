package io.github.alexanderlanganke.kardisynch.apps.desktop

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Covers issue #170's zip layer: extracting Public/PublicDiscreteData.xml out of a .pkg archive. */
class MedtronicPkgParsingTest {
    private val sampleXml = """
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
                              <Field name="Current"><String>PKG-SER-001</String></Field>
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

    private fun zipWith(vararg entries: Pair<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            for ((name, content) in entries) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(content.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test
    fun `extracts and parses Public-PublicDiscreteData xml from the archive`() {
        val pkg = zipWith("Public/PublicDiscreteData.xml" to sampleXml, "Reports/summary.pdf" to "not a real pdf")
        val report = parseMedtronicPkg(pkg)
        assertEquals("PKG-SER-001", report?.device?.serialNumber)
    }

    @Test
    fun `an archive with no matching entry returns null`() {
        val pkg = zipWith("Other/File.xml" to sampleXml)
        assertNull(parseMedtronicPkg(pkg))
    }

    @Test
    fun `not actually a zip file returns null instead of throwing`() {
        assertNull(parseMedtronicPkg("this is not a zip".toByteArray()))
    }
}
