package io.github.alexanderlanganke.kardisynch.core.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** A semantic version: `3.1.0`, `3.1.0-beta.2`. A pre-release sorts below its release. */
data class SemVer(val major: Int, val minor: Int, val patch: Int, val pre: String? = null) : Comparable<SemVer> {
    override fun compareTo(other: SemVer): Int {
        if (major != other.major) return major.compareTo(other.major)
        if (minor != other.minor) return minor.compareTo(other.minor)
        if (patch != other.patch) return patch.compareTo(other.patch)
        return when {
            pre == other.pre -> 0
            pre == null -> 1
            other.pre == null -> -1
            else -> comparePre(pre, other.pre)
        }
    }

    override fun toString() = "$major.$minor.$patch" + (pre?.let { "-$it" } ?: "")

    private fun comparePre(a: String, b: String): Int {
        val pa = a.split('.'); val pb = b.split('.')
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrNull(i) ?: return -1
            val y = pb.getOrNull(i) ?: return 1
            val nx = x.toIntOrNull(); val ny = y.toIntOrNull()
            val c = when {
                nx != null && ny != null -> nx.compareTo(ny)
                nx != null -> -1
                ny != null -> 1
                else -> x.compareTo(y)
            }
            if (c != 0) return c
        }
        return 0
    }
}

/** Parses `v3.1.0`, `3.1.0`, `3.1.0-beta.2`; null for anything else (including "dev"). */
fun parseSemVer(text: String): SemVer? {
    val m = Regex("""^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$""").matchEntire(text.trim()) ?: return null
    return SemVer(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt(), m.groupValues[4].ifEmpty { null })
}

@Serializable
data class GithubAsset(
    val name: String,
    @SerialName("browser_download_url") val browserDownloadUrl: String,
    val size: Long = 0,
)

@Serializable
data class GithubRelease(
    @SerialName("tag_name") val tagName: String,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    @SerialName("html_url") val htmlUrl: String = "",
    val body: String? = null,
    val assets: List<GithubAsset> = emptyList(),
)

/** An update worth offering: where to get the installer and how to verify it. */
data class UpdateOffer(
    val version: SemVer,
    val notes: String,
    val pageUrl: String,
    val installerName: String,
    val installerUrl: String,
    val installerSize: Long,
    /** URL of the `SHA256SUMS.txt` asset the installer's hash is looked up in; null when the release has none. */
    val checksumsUrl: String?,
)

/** The first release line this app updates within: the Electron app (v2.x) lives in the same repository and must never be offered. */
const val FIRST_NATIVE_MAJOR = 3

/**
 * Picks the newest release newer than [current] that carries a Windows installer
 * (`KardiSynch-Setup-<version>.exe`). Drafts are ignored, pre-releases only when
 * [includePrereleases]. Returns null when up to date, when [current] is not a release
 * version (a dev build), or when the JSON can't be read.
 */
fun selectUpdate(releasesJson: String, current: String, includePrereleases: Boolean = false): UpdateOffer? {
    val now = parseSemVer(current) ?: return null
    val releases = runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<List<GithubRelease>>(releasesJson) }.getOrNull() ?: return null
    return releases.asSequence()
        .filter { !it.draft && (includePrereleases || !it.prerelease) }
        .mapNotNull { r -> parseSemVer(r.tagName)?.takeIf { it.major >= FIRST_NATIVE_MAJOR && it > now }?.let { r to it } }
        .filter { (r, _) -> includePrereleases || parseSemVer(r.tagName)?.pre == null }
        .sortedByDescending { it.second }
        .firstNotNullOfOrNull { (r, v) ->
            val installer = r.assets.firstOrNull { it.name.startsWith("KardiSynch-Setup-") && it.name.endsWith(".exe", ignoreCase = true) } ?: return@firstNotNullOfOrNull null
            UpdateOffer(
                version = v, notes = r.body.orEmpty().trim(), pageUrl = r.htmlUrl,
                installerName = installer.name, installerUrl = installer.browserDownloadUrl, installerSize = installer.size,
                checksumsUrl = r.assets.firstOrNull { it.name.equals("SHA256SUMS.txt", ignoreCase = true) }?.browserDownloadUrl,
            )
        }
}

/** Looks [fileName]'s SHA-256 up in `sha256sum` output (`<hex>  <name>` or `<hex> *<name>`); lower-case hex, or null. */
fun findSha256(checksums: String, fileName: String): String? =
    checksums.lineSequence().mapNotNull { line ->
        val m = Regex("""^([0-9A-Fa-f]{64})\s+\*?(.+?)\s*$""").matchEntire(line.trim()) ?: return@mapNotNull null
        if (m.groupValues[2] == fileName) m.groupValues[1].lowercase() else null
    }.firstOrNull()
