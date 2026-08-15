package io.github.alexanderlanganke.kardisynch.core.news

import io.github.alexanderlanganke.kardisynch.core.xml.XmlParser
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A generic, non-patient-specific cardiac-device news/recall item — ported
 * from `newsService.ts`'s `NewsItem` (issue #192). Informational only:
 * neither the original nor this port joins it against any specific
 * patient's implanted device — it's a browseable feed, not a per-patient
 * alert (that would be [io.github.alexanderlanganke.kardisynch.core.mri.ManufacturerWarningStatus],
 * a wholly separate, unrelated cache field — see its own doc comment).
 */
@Serializable
data class DeviceNewsItem(
    val id: String,
    val type: String, // "news" | "warning" | "study" — mirrors the TS union verbatim rather than an enum, since nothing branches on exhaustiveness here
    val title: String,
    val summary: String,
    val source: String,
    val date: String, // "YYYY-MM-DD", or "" when unparseable
    val url: String,
)

/**
 * Merges one or more news-source result lists, deduplicating by [DeviceNewsItem.url]
 * (last source wins on a collision — mirrors `new Map(items.map(i => [i.url, i]))`'s
 * overwrite semantics) and sorting by [DeviceNewsItem.date] descending.
 */
fun mergeDeviceNews(vararg lists: List<DeviceNewsItem>): List<DeviceNewsItem> {
    val byUrl = LinkedHashMap<String, DeviceNewsItem>()
    for (list in lists) for (item in list) byUrl[item.url] = item
    return byUrl.values.sortedByDescending { it.date }
}

// --- openFDA device-enforcement (recalls) ---

@Serializable
private data class OpenFdaResponse(val results: List<OpenFdaResult> = emptyList())

@Serializable
private data class OpenFdaResult(
    val report_number: String? = null,
    val product_description: String? = null,
    val reason_for_recall: String? = null,
    val recalling_firm: String? = null,
    val recall_initiation_date: String? = null,
    val recall_number: String? = null,
)

private val openFdaJson = Json { ignoreUnknownKeys = true }

/** Parses the openFDA `device/enforcement.json` response body. Ported from `fetchOpenFDARecalls`. */
fun parseOpenFdaRecalls(responseBody: String): List<DeviceNewsItem> {
    val response = try {
        openFdaJson.decodeFromString<OpenFdaResponse>(responseBody)
    } catch (e: Exception) {
        return emptyList()
    }
    // report_number is commonly absent in real openFDA responses (confirmed
    // against the live API, not assumed) — recall_number is the far more
    // reliable identifier, so it's the primary fallback rather than
    // dropping the record entirely the way an earlier version of this
    // parser did.
    return response.results.mapNotNull { r ->
        val id = r.report_number ?: r.recall_number ?: return@mapNotNull null
        DeviceNewsItem(
            id = "fda-$id",
            type = "warning",
            title = "Recall: ${r.product_description.orEmpty().take(100)}...",
            summary = r.reason_for_recall.orEmpty(),
            source = "FDA (${r.recalling_firm ?: "Unknown"})",
            date = formatFdaDate(r.recall_initiation_date),
            url = r.recall_number?.let {
                "https://www.google.com/search?q=" + encodeUrlComponent("site:accessdata.fda.gov \"$it\"")
            } ?: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm",
        )
    }
}

/** `YYYYMMDD` -> `YYYY-MM-DD`; passes through unchanged if it's not that exact 8-digit shape. */
private fun formatFdaDate(raw: String?): String {
    if (raw.isNullOrEmpty()) return "Unknown Date"
    val s = raw.take(10)
    val m = Regex("""^(\d{4})(\d{2})(\d{2})$""").find(s) ?: return s
    val (y, mo, d) = m.destructured
    return "$y-$mo-$d"
}

private fun encodeUrlComponent(s: String): String {
    val sb = StringBuilder()
    for (b in s.encodeToByteArray()) {
        val c = b.toInt().toChar()
        if (c.isLetterOrDigit() || c == '-' || c == '_' || c == '.' || c == '~') {
            sb.append(c)
        } else {
            sb.append('%').append(((b.toInt() and 0xFF)).toString(16).uppercase().padStart(2, '0'))
        }
    }
    return sb.toString()
}

// --- Google News RSS ---

private val monthAbbreviations = mapOf(
    "jan" to "01", "feb" to "02", "mar" to "03", "apr" to "04", "may" to "05", "jun" to "06",
    "jul" to "07", "aug" to "08", "sep" to "09", "oct" to "10", "nov" to "11", "dec" to "12",
)
private val rfc822DateRegex = Regex("""(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})""")

/** Extracts just the `YYYY-MM-DD` date from an RFC-822 `pubDate` (e.g. `"Mon, 15 Jan 2024 12:00:00 GMT"`) — commonMain has no platform date parser, so this only pulls out what's actually used. Returns "" if unparseable. */
private fun parseRfc822Date(raw: String?): String {
    if (raw.isNullOrBlank()) return ""
    val m = rfc822DateRegex.find(raw) ?: return ""
    val (day, monthAbbr, year) = m.destructured
    val month = monthAbbreviations[monthAbbr.lowercase()] ?: return ""
    return "$year-$month-${day.padStart(2, '0')}"
}

private val htmlTagRegex = Regex("<[^>]*>")

/** Parses a Google News RSS response body. Ported from `fetchGoogleDeviceNews`; up to the first 15 items, matching the original. */
fun parseGoogleNewsRss(responseBody: String): List<DeviceNewsItem> {
    val root = try {
        XmlParser.parse(responseBody)
    } catch (e: Exception) {
        return emptyList()
    }
    val channel = root.child("channel") ?: root.child("feed") ?: return emptyList()
    val items = (channel.childrenNamed("item").ifEmpty { channel.childrenNamed("entry") }).take(15)

    return items.mapNotNull { item ->
        val link = item.child("link")?.text?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val title = item.child("title")?.text.orEmpty()
        val guid = item.child("guid")?.text?.takeIf { it.isNotEmpty() } ?: link
        val description = item.child("description")?.text
        val summary = description
            ?.replace(htmlTagRegex, "")
            ?.take(200)
            ?.let { "$it..." }
            ?: "No summary available"

        DeviceNewsItem(
            id = "gn-$guid",
            type = "news",
            title = title,
            summary = summary,
            source = "Google News",
            date = parseRfc822Date(item.child("pubDate")?.text),
            url = link,
        )
    }
}
