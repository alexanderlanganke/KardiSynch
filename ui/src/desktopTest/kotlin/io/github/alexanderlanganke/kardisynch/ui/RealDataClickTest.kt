@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package io.github.alexanderlanganke.kardisynch.ui

import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.unit.Density
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.resolveReportsRootHandle
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Opt-in: opens a COPY of a real app database and its real files (KARDISYNCH_REAL_DB, KARDISYNCH_REAL_DATA),
 * clicks through patients exactly as a user does, and fails with the hung thread's stack if the UI stops
 * making progress. Set KARDISYNCH_SCREENSHOT_DIR to keep a PNG after each click.
 */
class RealDataClickTest {
    @Test
    fun clickingPatientsNeverHangs() {
        val dbPath = System.getenv("KARDISYNCH_REAL_DB") ?: return
        val dataRoot = System.getenv("KARDISYNCH_REAL_DATA") ?: return
        val shots = System.getenv("KARDISYNCH_SCREENSHOT_DIR")?.let { File(it).apply { mkdirs() } }

        val repo = KardiSynchRepository(JdbcSqliteDriver("jdbc:sqlite:$dbPath"))
        val reader = DesktopDataRootReader()
        val reportsRoot = checkNotNull(resolveReportsRootHandle(reader, dataRoot)) { "no Reports folder under $dataRoot" }

        val log = StringBuilder()
        var slowest = 0L
        val worker = thread(name = "ui-under-test", isDaemon = true) {
            val scene = ImageComposeScene(1360, 820, Density(1f)) {
                KardiSynchApp(
                    repository = repo, dataRootLabel = dataRoot, isReindexing = false, lastReindexSummary = null,
                    onPickDataRoot = {}, onReindex = {}, onClearLocalIndex = {},
                    todayIso = "2026-11-09", themeMode = io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode.DARK,
                    onGetVisitFiles = { patientId, reportId -> repo.getVisitFiles(reader, reportsRoot, patientId, reportId) },
                    onReadVisitFileBytes = { reader.readBytes(it) },
                    onReadVisitFileText = { reader.readText(it) },
                    onGetMergedAdditionalFields = { patientId -> repo.getMergedAdditionalFields(reader, reportsRoot, patientId) },
                )
            }
            var clock = 0L
            fun frames(n: Int) = repeat(n) {
                val t0 = System.nanoTime()
                scene.render(clock); clock += 16_000_000L
                slowest = maxOf(slowest, (System.nanoTime() - t0) / 1_000_000)
                Thread.sleep(30)
            }
            frames(40)
            for ((i, y) in listOf(345f, 431f, 517f, 603f, 689f).withIndex()) {
                val p = Offset(250f, y)
                scene.sendPointerEvent(PointerEventType.Move, p)
                scene.sendPointerEvent(PointerEventType.Press, p)
                Thread.sleep(40)
                scene.sendPointerEvent(PointerEventType.Release, p)
                val t0 = System.nanoTime()
                frames(60)
                log.appendLine("click ${i + 1}: 60 frames in ${(System.nanoTime() - t0) / 1_000_000} ms")
                shots?.let { File(it, "real-click-${i + 1}.png").writeBytes(scene.render(clock).encodeToData(EncodedImageFormat.PNG)!!.bytes) }
            }
            scene.close()
        }
        worker.join(90_000)
        if (worker.isAlive) {
            val trace = worker.stackTrace.joinToString("\n") { "    at $it" }
            val others = Thread.getAllStackTraces().filter { (t, st) -> t !== worker && st.any { "kardisynch" in it.className } }
                .entries.joinToString("\n") { (t, st) -> "  [${t.name}]\n" + st.take(12).joinToString("\n") { "    at $it" } }
            println("HUNG. UI thread:\n$trace\nOther threads in app code:\n$others")
            kotlin.test.fail("the UI stopped making progress; stack of the UI thread:\n$trace")
        }
        println(log)
        println("slowest single frame: $slowest ms")
        assertTrue(slowest < 5_000, "a single frame took $slowest ms")
    }

    /** Every patient with 2 or more visits (both panes show a visit), plus a few single-visit ones, each opened on its own with a watchdog. */
    @Test
    fun everyPatientDetailRenders() {
        val dbPath = System.getenv("KARDISYNCH_REAL_DB") ?: return
        val dataRoot = System.getenv("KARDISYNCH_REAL_DATA") ?: return
        val shots = System.getenv("KARDISYNCH_SCREENSHOT_DIR")?.let { File(it).apply { mkdirs() } }
        val repo = KardiSynchRepository(JdbcSqliteDriver("jdbc:sqlite:$dbPath"))
        val reader = DesktopDataRootReader()
        val reportsRoot = checkNotNull(resolveReportsRootHandle(reader, dataRoot))
        val counts = kotlinx.coroutines.runBlocking { repo.getPatientsWithSerials() }.sortedByDescending { it.reportCount }
        val chosen = counts.filter { it.reportCount >= 2 } + counts.filter { it.reportCount < 2 }.take(6)
        println("opening ${chosen.size} patients (${chosen.count { it.reportCount >= 2 }} with 2+ visits)")
        val hung = mutableListOf<String>()
        var slowest = 0L
        // A sampling profiler: where is the UI thread while it is NOT sleeping between frames?
        val hot = java.util.concurrent.ConcurrentHashMap<String, Int>()
        val watchedRef = java.util.concurrent.atomic.AtomicReference<Thread?>(null)
        val sampler = thread(name = "sampler", isDaemon = true) {
            while (true) {
                Thread.sleep(8)
                val t = watchedRef.get() ?: continue
                val st = runCatching { t.stackTrace }.getOrNull() ?: continue
                if (st.isEmpty() || st[0].methodName == "sleep") continue
                val app = st.firstOrNull { it.className.startsWith("io.github.alexanderlanganke") }
                val key = (app?.let { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" } ?: "(no app frame)") + "  <- top: ${st[0].className.substringAfterLast('.')}.${st[0].methodName}"
                hot.merge(key, 1, Int::plus)
            }
        }
        for ((n, summary) in chosen.withIndex()) {
            var worst = 0L
            val worker = thread(name = "detail-$n", isDaemon = true) {
                val scene = ImageComposeScene(1360, 820, Density(1f)) {
                    io.github.alexanderlanganke.kardisynch.ui.theme.KardiSynchTheme(darkTheme = true) {
                        io.github.alexanderlanganke.kardisynch.ui.detail.PatientDetailScreen(
                            repository = repo, patientId = summary.id, onBack = null, todayIso = "2026-11-09",
                            onGetVisitFiles = { patientId, reportId -> repo.getVisitFiles(reader, reportsRoot, patientId, reportId) },
                            onReadVisitFileBytes = { reader.readBytes(it) },
                            onReadVisitFileText = { reader.readText(it) },
                            onGetMergedAdditionalFields = { patientId -> repo.getMergedAdditionalFields(reader, reportsRoot, patientId) },
                        )
                    }
                }
                var clock = 0L
                repeat(50) {
                    val t0 = System.nanoTime()
                    scene.render(clock); clock += 16_000_000L
                    worst = maxOf(worst, (System.nanoTime() - t0) / 1_000_000)
                    Thread.sleep(30)
                }
                shots?.let { File(it, "detail-$n.png").writeBytes(scene.render(clock).encodeToData(EncodedImageFormat.PNG)!!.bytes) }
                scene.close()
            }
            watchedRef.set(worker)
            worker.join(25_000)
            if (worker.isAlive) {
                hung += "patient #$n (${summary.reportCount} visits):\n" + worker.stackTrace.take(25).joinToString("\n") { "    at $it" }
            }
            slowest = maxOf(slowest, worst)
            if (n % 10 == 0) println("  ...$n done, slowest frame so far $slowest ms")
        }
        println("slowest frame over all patients: $slowest ms; hung: ${hung.size}")
        println("HOT SPOTS (samples of the UI thread while busy, 8 ms each):")
        hot.entries.sortedByDescending { it.value }.take(14).forEach { println("  %5d  %s".format(it.value, it.key)) }
        hung.forEach { println("HUNG $it") }
        assertTrue(hung.isEmpty(), "these patient screens stopped making progress:\n${hung.joinToString("\n")}")
    }
}
