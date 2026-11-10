package io.github.alexanderlanganke.kardisynch.core.webpanel

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WebPortalsTest {
    @Test fun `carelink follows the region and all four remote portals are present`() {
        val eu = defaultPortalCategories(true).first().items
        assertEquals(listOf("CareLink", "Home Monitoring", "Merlin.net", "LATITUDE"), eu.map { it.label })
        assertTrue(eu.first().url.contains("europe"))
        assertTrue(defaultPortalCategories(false).first().items.first().url.contains("carelink.medtronic.com"))
    }

    @Test fun `only finished pdf and zip downloads qualify`() {
        assertTrue(isPortalDownloadType("Report.PDF"))
        assertTrue(isPortalDownloadType("session.zip"))
        assertFalse(isPortalDownloadType("Report.pdf.crdownload"))
        assertFalse(isPortalDownloadType("photo.png"))
        assertFalse(isPortalDownloadType(".hidden.pdf"))
    }

    @Test fun `hosts map to manufacturers including subdomains`() {
        assertEquals("Medtronic", manufacturerForHost("europe.medtroniccarelink.net"))
        assertEquals("Boston Scientific", manufacturerForHost("latitude.bostonscientific.com"))
        assertEquals("Abbott", manufacturerForHost("www.merlin.net"))
        assertNull(manufacturerForHost("evilmerlin.net.example.com"))
        assertNull(manufacturerForHost("notmerlin.net"))
    }

    @Test fun `origin urls are read from a Zone Identifier`() {
        val zone = "[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://europe.medtroniccarelink.net/clinic/report\r\nHostUrl=https://europe.medtroniccarelink.net/download/x.pdf\r\n"
        assertEquals("Medtronic", manufacturerForOrigins(parseOriginUrls(zone)))
        assertNull(manufacturerForOrigins(parseOriginUrls("[ZoneTransfer]\nZoneId=3\nHostUrl=https://example.org/a.pdf")))
        assertEquals("example.org", hostOf("https://user@example.org:8080/a"))
    }
}
