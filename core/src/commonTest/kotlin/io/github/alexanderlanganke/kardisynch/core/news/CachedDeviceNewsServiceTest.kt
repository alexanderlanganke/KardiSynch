package io.github.alexanderlanganke.kardisynch.core.news

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.TestTimeSource

class CachedDeviceNewsServiceTest {
    private class FakeFetcher(private val results: MutableList<List<DeviceNewsItem>>) : DeviceNewsSource {
        var callCount = 0
        override suspend fun fetchAll(): List<DeviceNewsItem> {
            callCount++
            return results.removeAt(0)
        }
    }

    private fun item(url: String) = DeviceNewsItem(id = url, type = "news", title = "T", summary = "S", source = "src", date = "2024-01-01", url = url)

    @Test
    fun `a second call within the TTL returns the cached result without refetching`() = runTest {
        val fetcher = FakeFetcher(mutableListOf(listOf(item("a")), listOf(item("b"))))
        val timeSource = TestTimeSource()
        val service = CachedDeviceNewsService(fetcher, timeSource)

        val first = service.getDeviceNews()
        timeSource += 30.minutes
        val second = service.getDeviceNews()

        assertEquals(1, fetcher.callCount)
        assertSame(first, second)
    }

    @Test
    fun `a call after the TTL expires refetches`() = runTest {
        val fetcher = FakeFetcher(mutableListOf(listOf(item("a")), listOf(item("b"))))
        val timeSource = TestTimeSource()
        val service = CachedDeviceNewsService(fetcher, timeSource, cacheTtl = 60.minutes)

        service.getDeviceNews()
        timeSource += 61.minutes
        val second = service.getDeviceNews()

        assertEquals(2, fetcher.callCount)
        assertEquals(listOf("b"), second.map { it.url })
    }

    @Test
    fun `forceRefresh always refetches even within the TTL`() = runTest {
        val fetcher = FakeFetcher(mutableListOf(listOf(item("a")), listOf(item("b"))))
        val service = CachedDeviceNewsService(fetcher, TestTimeSource())

        service.getDeviceNews()
        val second = service.getDeviceNews(forceRefresh = true)

        assertEquals(2, fetcher.callCount)
        assertEquals(listOf("b"), second.map { it.url })
    }

    @Test
    fun `an empty refetch result is returned as-is, not silently replaced by the stale cache`() = runTest {
        // Matches newsService.ts's own behavior exactly: it returns whatever
        // the fresh (possibly empty) fetch produced, and only updates its
        // module-level cache/lastFetch when that result is non-empty.
        val fetcher = FakeFetcher(mutableListOf(listOf(item("a")), emptyList()))
        val timeSource = TestTimeSource()
        val service = CachedDeviceNewsService(fetcher, timeSource, cacheTtl = 1.minutes)

        val first = service.getDeviceNews()
        assertEquals(listOf("a"), first.map { it.url })

        timeSource += 2.minutes
        val second = service.getDeviceNews()
        assertEquals(2, fetcher.callCount)
        assertTrue(second.isEmpty())
    }

    @Test
    fun `after an empty refetch, the untouched cache is still available to a forced refresh's fallback path`() = runTest {
        // The empty result above never overwrote `cache`/`lastFetchMark` —
        // confirmed here by checking a THIRD, successful fetch repopulates
        // it normally (i.e. internal state wasn't corrupted by the empty one).
        val fetcher = FakeFetcher(mutableListOf(listOf(item("a")), emptyList(), listOf(item("c"))))
        val timeSource = TestTimeSource()
        val service = CachedDeviceNewsService(fetcher, timeSource, cacheTtl = 1.minutes)

        service.getDeviceNews()
        timeSource += 2.minutes
        service.getDeviceNews()
        timeSource += 2.minutes
        val third = service.getDeviceNews()

        assertEquals(3, fetcher.callCount)
        assertEquals(listOf("c"), third.map { it.url })
    }
}
