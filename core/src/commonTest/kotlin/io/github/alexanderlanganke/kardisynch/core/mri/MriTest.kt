package io.github.alexanderlanganke.kardisynch.core.mri

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MriCheckUrlTest {
    @Test
    fun `matches a manufacturer case-insensitively as a substring`() {
        assertEquals("https://www.promricheck.com", mriCheckUrl("Biotronik"))
        assertEquals("https://www.promricheck.com", mriCheckUrl("BIOTRONIK SE & Co"))
    }

    @Test
    fun `St Jude Medical resolves via the sjm-family entries`() {
        assertEquals("https://mri.merlin.net/", mriCheckUrl("St. Jude Medical"))
    }

    @Test
    fun `an unknown manufacturer returns null`() {
        assertNull(mriCheckUrl("Some Unrelated Company"))
    }

    @Test
    fun `a null or blank manufacturer returns null`() {
        assertNull(mriCheckUrl(null))
        assertNull(mriCheckUrl("   "))
    }
}

class ManufacturerWarningStatusTest {
    @Test
    fun `parses a well-formed warning status blob`() {
        val status = parseManufacturerWarningStatus("""{"status":"advisory","details":"Battery advisory","link":"https://example.com"}""")
        assertEquals(ManufacturerWarningStatus("advisory", "Battery advisory", "https://example.com"), status)
    }

    @Test
    fun `null, blank, or malformed input yields null instead of throwing`() {
        assertNull(parseManufacturerWarningStatus(null))
        assertNull(parseManufacturerWarningStatus(""))
        assertNull(parseManufacturerWarningStatus("not json"))
    }

    @Test
    fun `hasActiveManufacturerWarning is true only for advisory or recall`() {
        assertTrue(hasActiveManufacturerWarning("""{"status":"advisory"}"""))
        assertTrue(hasActiveManufacturerWarning("""{"status":"recall"}"""))
        assertFalse(hasActiveManufacturerWarning("""{"status":"safe"}"""))
        assertFalse(hasActiveManufacturerWarning("""{"status":"manual_check"}"""))
        assertFalse(hasActiveManufacturerWarning(null))
    }
}
