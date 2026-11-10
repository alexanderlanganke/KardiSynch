package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.update.UpdateOffer
import io.github.alexanderlanganke.kardisynch.core.update.findSha256
import io.github.alexanderlanganke.kardisynch.core.update.selectUpdate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Duration

/**
 * Self-update from GitHub Releases. A new version is only ever *offered* here; downloading and
 * installing happen on an explicit tap. The installer is verified against the release's
 * `SHA256SUMS.txt` before it is run, and a download that cannot be verified is deleted.
 */
object Updater {
    const val REPO = "alexanderlanganke/KardiSynch"
    private const val RELEASES_URL = "https://api.github.com/repos/$REPO/releases?per_page=30"

    sealed interface CheckResult {
        data class Available(val offer: UpdateOffer) : CheckResult
        data object UpToDate : CheckResult
        data class Failed(val message: String) : CheckResult
    }

    private val client: HttpClient by lazy {
        HttpClient.newBuilder().followRedirects(HttpClient.Redirect.ALWAYS).connectTimeout(Duration.ofSeconds(15)).build()
    }

    private fun get(url: String, accept: String): HttpRequest =
        HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).header("Accept", accept).header("User-Agent", "KardiSynch-Updater").GET().build()

    /** True when this process is an installed Windows build that can replace itself (not a dev run, not a Flatpak/Linux package). */
    fun canSelfInstall(): Boolean =
        System.getProperty("os.name").orEmpty().startsWith("Windows") && System.getProperty("jpackage.app-path") != null

    suspend fun check(currentVersion: String, includePrereleases: Boolean): CheckResult = withContext(Dispatchers.IO) {
        try {
            val response = client.send(get(RELEASES_URL, "application/vnd.github+json"), HttpResponse.BodyHandlers.ofString())
            when {
                response.statusCode() == 403 || response.statusCode() == 429 -> CheckResult.Failed("GitHub is limiting requests right now. Try again in a little while.")
                response.statusCode() == 404 -> CheckResult.Failed("The release list is not reachable (the repository may be private).")
                response.statusCode() !in 200..299 -> CheckResult.Failed("GitHub answered ${response.statusCode()}.")
                else -> selectUpdate(response.body(), currentVersion, includePrereleases)?.let { CheckResult.Available(it) } ?: CheckResult.UpToDate
            }
        } catch (e: Exception) {
            CheckResult.Failed("Couldn't reach GitHub: ${e.message ?: e::class.simpleName}")
        }
    }

    /** Downloads the installer into a fresh temp folder and verifies its SHA-256. [onProgress] gets 0..1, or null when the size is unknown. */
    suspend fun download(offer: UpdateOffer, onProgress: (Float?) -> Unit): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            val expected = offer.checksumsUrl?.let { url ->
                val body = client.send(get(url, "text/plain"), HttpResponse.BodyHandlers.ofString())
                require(body.statusCode() in 200..299) { "The checksum file could not be downloaded." }
                findSha256(body.body(), offer.installerName)
            } ?: error("This release has no checksum for the installer, so it can't be verified. Download it from the release page instead.")

            val dir = java.nio.file.Files.createTempDirectory("kardisynch-update-").toFile()
            val target = File(dir, offer.installerName)
            val response = client.send(get(offer.installerUrl, "application/octet-stream"), HttpResponse.BodyHandlers.ofInputStream())
            require(response.statusCode() in 200..299) { "The installer download failed (${response.statusCode()})." }
            val total = response.headers().firstValueAsLong("Content-Length").orElse(offer.installerSize).takeIf { it > 0 }
            val digest = MessageDigest.getInstance("SHA-256")
            response.body().use { input ->
                target.outputStream().use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n); digest.update(buffer, 0, n); done += n
                        onProgress(total?.let { (done.toFloat() / it).coerceIn(0f, 1f) })
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != expected) {
                target.delete(); dir.delete()
                error("The downloaded installer did not match its published checksum, so it was not run.")
            }
            target
        }
    }

    /** Starts the installer silently; the caller must exit the app right after so its files can be replaced. */
    fun launchInstaller(installer: File) {
        ProcessBuilder(installer.absolutePath, "/S", "--updated").start()
    }
}
