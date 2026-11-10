package io.github.alexanderlanganke.kardisynch.core.update

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ReleaseSelectionTest {
    private fun release(tag: String, pre: Boolean = false, draft: Boolean = false, installer: Boolean = true) = """
        {"tag_name":"$tag","draft":$draft,"prerelease":$pre,"html_url":"https://example/$tag","body":"notes $tag","assets":[
        ${if (installer) """{"name":"KardiSynch-Setup-${tag.removePrefix("v")}.exe","browser_download_url":"https://example/$tag/setup.exe","size":100},""" else ""}
        {"name":"SHA256SUMS.txt","browser_download_url":"https://example/$tag/sums","size":10}]}"""

    @Test fun `parses and orders versions`() {
        assertTrue(parseSemVer("v3.10.0")!! > parseSemVer("3.9.9")!!)
        assertTrue(parseSemVer("3.1.0")!! > parseSemVer("3.1.0-beta.2")!!)
        assertTrue(parseSemVer("3.1.0-beta.10")!! > parseSemVer("3.1.0-beta.2")!!)
        assertNull(parseSemVer("dev"))
    }

    @Test fun `never offers the Electron v2 line, even though it is newer by date`() {
        val json = "[${release("v2.99.0")},${release("v3.0.0")}]"
        assertNull(selectUpdate(json, "3.0.0"))
        assertEquals("3.0.0", selectUpdate(json, "3.0.0-beta.1", includePrereleases = true)?.version.toString())
    }

    @Test fun `offers the newest newer release with its installer and checksums`() {
        val json = "[${release("v3.0.1")},${release("v3.2.0")},${release("v3.1.0")}]"
        val offer = assertNotNull(selectUpdate(json, "3.0.0"))
        assertEquals("3.2.0", offer.version.toString())
        assertEquals("KardiSynch-Setup-3.2.0.exe", offer.installerName)
        assertEquals("https://example/v3.2.0/sums", offer.checksumsUrl)
    }

    @Test fun `skips drafts, prereleases by default, and releases without an installer`() {
        val json = "[${release("v3.3.0", draft = true)},${release("v3.2.0", pre = true)},${release("v3.1.5", installer = false)},${release("v3.1.0")}]"
        assertEquals("3.1.0", selectUpdate(json, "3.0.0")?.version.toString())
        assertEquals("3.2.0", selectUpdate(json, "3.0.0", includePrereleases = true)?.version.toString())
    }

    @Test fun `a dev build or bad json gets no offer`() {
        assertNull(selectUpdate("[${release("v3.1.0")}]", "dev"))
        assertNull(selectUpdate("not json", "3.0.0"))
    }

    @Test fun `finds a checksum by file name`() {
        val hash = "a".repeat(64)
        assertEquals(hash, findSha256("$hash  KardiSynch-Setup-3.0.0.exe\n${"b".repeat(64)} *other.zip", "KardiSynch-Setup-3.0.0.exe"))
        assertNull(findSha256("$hash  other.exe", "KardiSynch-Setup-3.0.0.exe"))
    }
}
