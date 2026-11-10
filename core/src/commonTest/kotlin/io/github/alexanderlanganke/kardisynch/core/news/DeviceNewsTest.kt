package io.github.alexanderlanganke.kardisynch.core.news

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ParseOpenFdaRecallsTest {
    @Test
    fun `parses a well-formed recall result`() {
        val json = """
            {
              "results": [
                {
                  "report_number": "12345",
                  "product_description": "Pacemaker Model X, single chamber",
                  "reason_for_recall": "Battery may deplete early",
                  "recalling_firm": "Medtronic",
                  "recall_initiation_date": "20240115",
                  "recall_number": "Z-1234-2024"
                }
              ]
            }
        """.trimIndent()
        val items = parseOpenFdaRecalls(json)
        assertEquals(1, items.size)
        val item = items[0]
        assertEquals("fda-12345", item.id)
        assertEquals("warning", item.type)
        assertEquals("Recall: Pacemaker Model X, single chamber...", item.title)
        assertEquals("Battery may deplete early", item.summary)
        assertEquals("FDA (Medtronic)", item.source)
        assertEquals("2024-01-15", item.date)
        assertTrue(item.url.contains("Z-1234-2024"))
    }

    @Test
    fun `a product description longer than 100 chars is truncated`() {
        val longDescription = "A".repeat(150)
        val json = """{"results": [{"report_number": "1", "product_description": "$longDescription"}]}"""
        val item = parseOpenFdaRecalls(json).single()
        assertEquals("Recall: ${"A".repeat(100)}...", item.title)
    }

    @Test
    fun `falls back to a generic FDA URL when recall_number is absent`() {
        val json = """{"results": [{"report_number": "1", "product_description": "X"}]}"""
        val item = parseOpenFdaRecalls(json).single()
        assertEquals("https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm", item.url)
    }

    @Test
    fun `falls back to recall_number as the id when report_number is absent, the common real-world case`() {
        // Confirmed against the live openFDA API: report_number is commonly
        // null/absent in real responses — dropping those records would
        // silently discard most real recalls.
        val json = """{"results": [{"recall_number": "Z-2444-2026", "product_description": "X"}]}"""
        val item = parseOpenFdaRecalls(json).single()
        assertEquals("fda-Z-2444-2026", item.id)
    }

    @Test
    fun `a result with neither report_number nor recall_number is dropped rather than crashing the whole batch`() {
        val json = """
            {"results": [
              {"report_number": "1", "product_description": "Good"},
              {"product_description": "No identifier at all"}
            ]}
        """.trimIndent()
        val items = parseOpenFdaRecalls(json)
        assertEquals(1, items.size)
        assertEquals("fda-1", items[0].id)
    }

    @Test
    fun `malformed JSON yields an empty list instead of throwing`() {
        assertEquals(emptyList(), parseOpenFdaRecalls("not json"))
    }

    @Test
    fun `an empty results array yields an empty list`() {
        assertEquals(emptyList(), parseOpenFdaRecalls("""{"results": []}"""))
    }
}

class ParseGoogleNewsRssTest {
    private fun rss(vararg items: String): String = """
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Google News</title>
            ${items.joinToString("\n")}
          </channel>
        </rss>
    """.trimIndent()

    @Test
    fun `parses a well-formed item`() {
        val xml = rss(
            """
            <item>
              <title>New pacemaker approved</title>
              <link>https://example.com/article1</link>
              <guid>abc-123</guid>
              <pubDate>Mon, 15 Jan 2024 12:00:00 GMT</pubDate>
              <description>&lt;p&gt;Some &lt;b&gt;bold&lt;/b&gt; text&lt;/p&gt;</description>
            </item>
            """.trimIndent(),
        )
        val items = parseGoogleNewsRss(xml)
        assertEquals(1, items.size)
        val item = items[0]
        assertEquals("gn-abc-123", item.id)
        assertEquals("news", item.type)
        assertEquals("New pacemaker approved", item.title)
        assertEquals("Google News", item.source)
        assertEquals("https://example.com/article1", item.url)
        assertEquals("2024-01-15", item.date)
        assertTrue(item.summary.startsWith("Some bold text"), item.summary)
        assertTrue(item.summary.endsWith("..."))
    }

    @Test
    fun `falls back to the link when guid is absent`() {
        val xml = rss("<item><title>T</title><link>https://example.com/x</link></item>")
        assertEquals("gn-https://example.com/x", parseGoogleNewsRss(xml).single().id)
    }

    @Test
    fun `an item with no link is dropped`() {
        val xml = rss("<item><title>No link here</title></item>")
        assertTrue(parseGoogleNewsRss(xml).isEmpty())
    }

    @Test
    fun `missing description falls back to a placeholder summary`() {
        val xml = rss("<item><title>T</title><link>https://example.com/x</link></item>")
        assertEquals("No summary available", parseGoogleNewsRss(xml).single().summary)
    }

    @Test
    fun `caps at 15 items`() {
        val items = (1..20).map { "<item><title>Item $it</title><link>https://example.com/$it</link></item>" }
        assertEquals(15, parseGoogleNewsRss(rss(*items.toTypedArray())).size)
    }

    @Test
    fun `malformed XML yields an empty list instead of throwing`() {
        assertEquals(emptyList(), parseGoogleNewsRss("not xml <<<"))
    }
}

class MergeDeviceNewsTest {
    private fun item(url: String, date: String, source: String = "test") =
        DeviceNewsItem(id = url, type = "news", title = "T", summary = "S", source = source, date = date, url = url)

    @Test
    fun `deduplicates by url, the later source winning`() {
        val a = listOf(item("https://x.com/1", "2024-01-01", source = "first"))
        val b = listOf(item("https://x.com/1", "2024-01-01", source = "second"))
        val merged = mergeDeviceNews(a, b)
        assertEquals(1, merged.size)
        assertEquals("second", merged[0].source)
    }

    @Test
    fun `sorts by date descending`() {
        val a = listOf(item("https://x.com/1", "2024-01-01"))
        val b = listOf(item("https://x.com/2", "2024-06-15"), item("https://x.com/3", "2023-12-31"))
        val merged = mergeDeviceNews(a, b)
        assertEquals(listOf("https://x.com/2", "https://x.com/1", "https://x.com/3"), merged.map { it.url })
    }

    @Test
    fun `merging zero lists yields an empty list`() {
        assertTrue(mergeDeviceNews().isEmpty())
    }
}
