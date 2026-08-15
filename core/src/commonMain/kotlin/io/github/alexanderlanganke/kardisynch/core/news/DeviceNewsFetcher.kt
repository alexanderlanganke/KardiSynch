package io.github.alexanderlanganke.kardisynch.core.news

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

private const val USER_AGENT = "KardiSynch/1.0"
private val REQUEST_TIMEOUT = 8.seconds

/** What [CachedDeviceNewsService] depends on — kept separate from the concrete [DeviceNewsFetcher] so tests can fake it without a real [HttpClient]. */
fun interface DeviceNewsSource {
    suspend fun fetchAll(): List<DeviceNewsItem>
}

/**
 * Fetches device-related news/recalls from the two public sources
 * `newsService.ts` used (issue #192) — the openFDA device-enforcement API
 * and a Google News RSS search. Each source fails soft to an empty list
 * (matching the original's per-source try/catch), so one source being
 * down/rate-limited never blocks the other.
 */
class DeviceNewsFetcher(private val httpClient: HttpClient) : DeviceNewsSource {
    suspend fun fetchOpenFdaRecalls(): List<DeviceNewsItem> = try {
        val body = httpClient.get("https://api.fda.gov/device/enforcement.json") {
            parameter("search", "product_description:pacemaker")
            parameter("limit", 15)
            parameter("sort", "recall_initiation_date:desc")
            header(HttpHeaders.UserAgent, USER_AGENT)
            timeout { requestTimeoutMillis = REQUEST_TIMEOUT.inWholeMilliseconds }
        }.bodyAsText()
        parseOpenFdaRecalls(body)
    } catch (e: Exception) {
        emptyList()
    }

    suspend fun fetchGoogleDeviceNews(): List<DeviceNewsItem> = try {
        val body = httpClient.get("https://news.google.com/rss/search") {
            parameter("q", "cardiac implants pacemaker defibrillator")
            parameter("hl", "en-US")
            parameter("gl", "US")
            parameter("ceid", "US:en")
            header(HttpHeaders.UserAgent, USER_AGENT)
            timeout { requestTimeoutMillis = REQUEST_TIMEOUT.inWholeMilliseconds }
        }.bodyAsText()
        parseGoogleNewsRss(body)
    } catch (e: Exception) {
        emptyList()
    }

    /** Runs both fetches concurrently (mirrors `Promise.allSettled`) and merges the results. */
    override suspend fun fetchAll(): List<DeviceNewsItem> = coroutineScope {
        val fda = async { fetchOpenFdaRecalls() }
        val google = async { fetchGoogleDeviceNews() }
        mergeDeviceNews(fda.await(), google.await())
    }
}

/** A plain [HttpClient] with the request-timeout plugin installed — the one Ktor feature [DeviceNewsFetcher] actually uses. */
fun createDeviceNewsHttpClient(): HttpClient = HttpClient {
    install(HttpTimeout)
}

/**
 * 1-hour in-memory result cache (mirrors `newsService.ts`'s module-level
 * `newsCache`/`lastFetch`) — keyed off elapsed time via [TimeSource] rather
 * than a wall-clock timestamp, so it's deterministically testable with a
 * [kotlin.time.TestTimeSource] instead of needing to wait a real hour.
 * A fetch that comes back empty (e.g. both sources down) does NOT
 * overwrite a non-empty cache, matching the original.
 */
class CachedDeviceNewsService(
    private val fetcher: DeviceNewsSource,
    private val timeSource: TimeSource = TimeSource.Monotonic,
    private val cacheTtl: Duration = 1.hours,
) {
    private var cache: List<DeviceNewsItem> = emptyList()
    private var lastFetchMark: TimeMark? = null

    suspend fun getDeviceNews(forceRefresh: Boolean = false): List<DeviceNewsItem> {
        val mark = lastFetchMark
        if (!forceRefresh && cache.isNotEmpty() && mark != null && mark.elapsedNow() < cacheTtl) {
            return cache
        }
        val fresh = fetcher.fetchAll()
        if (fresh.isNotEmpty()) {
            cache = fresh
            lastFetchMark = timeSource.markNow()
        }
        return fresh
    }
}
