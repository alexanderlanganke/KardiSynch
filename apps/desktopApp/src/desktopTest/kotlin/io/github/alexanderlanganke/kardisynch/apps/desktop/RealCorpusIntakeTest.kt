package io.github.alexanderlanganke.kardisynch.apps.desktop

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.intake.FileKind
import io.github.alexanderlanganke.kardisynch.core.lock.NoOpDirectoryLock
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.Random
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Opt-in tests over the REAL sample corpus (`test/` in the original checkout:
 * real exports of every manufacturer, real clinic data). They run only when
 * `KARDISYNCH_CORPUS_TESTS=1` and the corpus is found, and they never write
 * anything but counts and masked identifiers to their report: patient names and
 * dates never reach stdout, the report or a commit.
 *
 *  - [replay]: identifies and parses every file and reports accuracy per manufacturer.
 *  - [stress]: several simulated workstations drop many patients' files at once, with
 *    slow growing writes, lag between a data file and its PDF, opaque and renamed files,
 *    duplicates and damaged files, while the real watcher is running. Then it checks that
 *    nothing was lost, nothing was imported twice, damaged files were not imported, and no
 *    file ended up with the wrong patient.
 */
class RealCorpusIntakeTest {
    private val enabled = System.getenv("KARDISYNCH_CORPUS_TESTS") == "1"
    private val reportFile: File? = System.getenv("KARDISYNCH_CORPUS_REPORT")?.let { File(it).apply { parentFile?.mkdirs() } }
    private val log = StringBuilder()

    private fun say(line: String) {
        println(line)
        log.appendLine(line)
    }

    private fun flushReport() {
        reportFile?.writeText(log.toString())
    }

    private fun corpus(): File? {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        repeat(10) {
            val c = File(dir, "test")
            if (c.isDirectory && File(c, "medtronic pkg").isDirectory && File(c, "Biotronik xml").isDirectory) return c
            dir = dir.parentFile ?: return null
        }
        return null
    }

    private class Sample(val file: File, val group: String, val expected: FileKind)

    private fun samples(root: File): List<Sample> {
        fun files(dir: String, ext: Set<String>) = File(root, dir).listFiles { f -> f.isFile && f.extension.lowercase() in ext }.orEmpty().sortedBy { it.name }
        return buildList {
            files("abbott_logfiles", setOf("log")).forEach { add(Sample(it, "abbott", FileKind.ABBOTT_LOG)) }
            files("Biotronik xml", setOf("xml")).forEach { add(Sample(it, "biotronik", FileKind.BIOTRONIK_XML)) }
            files("boston bnk", setOf("bnk")).forEach { add(Sample(it, "boston", FileKind.BOSTON_BNK)) }
            files("medtronic pdd files", setOf("pdd")).forEach { add(Sample(it, "medtronic-pdd", FileKind.MEDTRONIC_PDD)) }
            files("medtronic pkg", setOf("pkg")).forEach { add(Sample(it, "medtronic-pkg", FileKind.MEDTRONIC_PKG)) }
            files("medtronic pkg", setOf("pdf")).forEach { add(Sample(it, "medtronic-pdf", FileKind.DEVICE_PDF)) }
            files("microport xml", setOf("xml")).forEach { add(Sample(it, "microport", FileKind.MICROPORT_XML)) }
        }
    }

    /** A masked, stable label for reports: never the real file name. */
    private fun label(s: Sample, index: Int) = "${s.group}#$index"

    @Test
    fun replay() {
        assumeTrue("set KARDISYNCH_CORPUS_TESTS=1 to run the real-corpus tests", enabled)
        val root = corpus()
        assumeTrue("real sample corpus not found", root != null)
        val all = samples(root!!)
        say("== Replay over ${all.size} real files")

        data class Row(val s: Sample, val kindOk: Boolean, val parsed: Boolean, val complete: Boolean, val millis: Long, val manufacturer: String?)
        val rows = all.map { s ->
            val bytes = s.file.readBytes()
            val t0 = System.nanoTime()
            val p = parseForIntake(s.file.name, bytes)
            val ms = (System.nanoTime() - t0) / 1_000_000
            val f = p.facts
            val complete = if (s.expected == FileKind.DEVICE_PDF) !f.lastName.isNullOrBlank() && !f.serial.isNullOrBlank() else f.hasPatientIdentity && !f.serial.isNullOrBlank()
            Row(s, p.identification.kind == s.expected, p.report != null, complete, ms, p.identification.manufacturer)
        }
        for ((group, list) in rows.groupBy { it.s.group }.toSortedMap()) {
            val n = list.size
            say(
                "%-14s files=%3d  kind ok=%3d  parsed=%3d  facts complete=%3d  avg %d ms  max %d ms".format(
                    group, n, list.count { it.kindOk }, list.count { it.parsed }, list.count { it.complete },
                    list.sumOf { it.millis } / n, list.maxOf { it.millis },
                ),
            )
        }
        val wrong = rows.filter { !it.kindOk }
        wrong.take(10).forEachIndexed { i, r -> say("  MISCLASSIFIED ${label(r.s, i)} expected ${r.s.expected}") }
        val unparsed = rows.filter { !it.parsed && it.s.expected != FileKind.DEVICE_PDF }
        unparsed.take(10).forEachIndexed { i, r -> say("  UNPARSED ${label(r.s, i)} (${r.s.expected})") }
        val pdfNoFacts = rows.filter { it.s.expected == FileKind.DEVICE_PDF && !it.complete }
        say("PDFs without both name and serial in their facts: ${pdfNoFacts.size} of ${rows.count { it.s.expected == FileKind.DEVICE_PDF }}")

        // Do the two files of a real Medtronic pair agree on the facts that bundling depends on?
        val pkgs = all.filter { it.group == "medtronic-pkg" }.associateBy { pairKey(it.file) }
        val pdfs = all.filter { it.group == "medtronic-pdf" }.associateBy { pairKey(it.file) }
        var serialEq = 0
        var dateEq = 0
        var nameEq = 0
        var dobEq = 0
        var pkgNoTime = 0
        var pdfNoTime = 0
        val dateDiffs = mutableListOf<String>()
        var pairs = 0
        for ((k, pkg) in pkgs) {
            val pdf = pdfs[k] ?: continue
            pairs++
            val a = parseForIntake(pkg.file.name, pkg.file.readBytes()).facts
            val b = parseForIntake(pdf.file.name, pdf.file.readBytes()).facts
            if (a.serial.equals(b.serial, true)) serialEq++
            if (a.lastName.equals(b.lastName, true)) nameEq++
            if (a.dob == b.dob) dobEq++
            if (a.interrogation?.take(10) == b.interrogation?.take(10)) dateEq++ else dateDiffs += "pkg=${a.interrogation?.length} pdf=${b.interrogation?.length}"
            if (a.interrogation?.contains('T') != true) pkgNoTime++
            if (b.interrogation?.contains('T') != true) pdfNoTime++
        }
        say("pair agreement over $pairs real pairs: serial=$serialEq last name=$nameEq birth date=$dobEq interrogation DATE=$dateEq (pkg without a time: $pkgNoTime, pdf without a time: $pdfNoTime)")
        say("date mismatches by shape: ${dateDiffs.groupingBy { it }.eachCount()}")
        flushReport()
        assertEquals(0, wrong.size, "every file must be identified as the kind its folder says")
    }

    // ---------------------------------------------------------------------------------------

    private class Dropped(val source: Sample, val destName: String, val folder: String, val truthKey: String?, val damaged: Boolean, val duplicateOf: String?)

    /** Name, serial and timestamp encoded in a Medtronic SmartSync export name: the ground truth that pairs a .pkg with its .pdf. */
    private val medtronicName = Regex("""^(?:[A-Za-z]+_)?[0-9a-fA-F-]{36}_(.+?)-([A-Z0-9]+)-[A-Za-z]+-(\d{2}_[A-Za-z]{3}_\d{4}_\d{2}_\d{2}_\d{2}_\d{3})\.""")

    private fun pairKey(f: File): String? = medtronicName.find(f.name)?.let { "${it.groupValues[1]}|${it.groupValues[2]}|${it.groupValues[3]}" }

    @Test
    fun stress() {
        assumeTrue("set KARDISYNCH_CORPUS_TESTS=1 to run the real-corpus tests", enabled)
        val root = corpus()
        assumeTrue("real sample corpus not found", root != null)
        val all = samples(root!!)
        val rnd = Random(20261109L)

        // ---- choose the bundles ----
        val pkgBySamePair = all.filter { it.group == "medtronic-pkg" }.associateBy { pairKey(it.file) }
        val pdfBySamePair = all.filter { it.group == "medtronic-pdf" }.associateBy { pairKey(it.file) }
        val pairKeys = pkgBySamePair.keys.filterNotNull().filter { it in pdfBySamePair }.sorted().shuffled(rnd).take(30)
        say("== Stress: ${pairKeys.size} Medtronic pkg+pdf pairs found for pairing (of ${pkgBySamePair.size} pkg, ${pdfBySamePair.size} pdf)")
        val singles = (
            all.filter { it.group == "biotronik" }.shuffled(rnd).take(14) +
                all.filter { it.group == "medtronic-pdd" }.shuffled(rnd).take(6) +
                all.filter { it.group == "boston" }.shuffled(rnd).take(4) +
                all.filter { it.group == "abbott" }.shuffled(rnd).take(4) +
                all.filter { it.group == "microport" }.shuffled(rnd).take(3)
            )

        // ---- ground truth: identity of every selected file ----
        fun identityOf(s: Sample): String? {
            val f = parseForIntake(s.file.name, s.file.readBytes()).facts
            val last = f.lastName
            val dob = f.dob
            return if (last != null && dob != null) "${last.lowercase()}|$dob" else null
        }
        val truthBySample = HashMap<File, String?>()
        val pairIdentity = HashMap<String, String?>()
        for (k in pairKeys) {
            val id = identityOf(pkgBySamePair.getValue(k))
            pairIdentity[k] = id
            truthBySample[pkgBySamePair.getValue(k).file] = id
            truthBySample[pdfBySamePair.getValue(k).file] = id
        }
        singles.forEach { truthBySample[it.file] = identityOf(it) }

        // ---- schedule: per workstation a list of (delay, file) ----
        val folders = listOf("ws-a", "ws-b", "ws-c/clinic", "ws-d", "share/2026-11-09", "usb")
        class Job(val atMs: Long, val sample: Sample, val folder: String, val destName: String, val damaged: Boolean, val dupOf: String?, val stallMs: Long)
        val jobs = mutableListOf<Job>()
        fun disguise(s: Sample, i: Int): String {
            val ext = s.file.extension
            return when (rnd.nextInt(10)) {
                0, 1, 2, 3 -> "scan_%04d.%s".format(i, if (rnd.nextBoolean()) ext.uppercase() else ext)
                4 -> "export ($i).$ext"
                5 -> if (s.group == "medtronic-pdf") "IMG_%04d.PDF".format(i) else s.file.name
                else -> s.file.name // many files keep their real, informative names
            }
        }
        var n = 0
        for (k in pairKeys) {
            val pkg = pkgBySamePair.getValue(k)
            val pdf = pdfBySamePair.getValue(k)
            val start = rnd.nextInt(25_000).toLong()
            val folder = folders[rnd.nextInt(folders.size)]
            val pdfFirst = rnd.nextInt(5) == 0
            // The companion arrives 0 to 9 s apart, sometimes well past the settle window, sometimes first, sometimes in another folder.
            val lag = rnd.nextInt(9_000).toLong()
            val pdfFolder = if (rnd.nextInt(4) == 0) folders[rnd.nextInt(folders.size)] else folder
            jobs += Job(start + (if (pdfFirst) lag else 0), pkg, folder, disguise(pkg, n++), false, null, if (rnd.nextInt(4) == 0) 1_200 else 0)
            jobs += Job(start + (if (pdfFirst) 0 else lag), pdf, pdfFolder, disguise(pdf, n++), false, null, if (rnd.nextInt(4) == 0) 1_200 else 0)
        }
        for (s in singles) jobs += Job(rnd.nextInt(30_000).toLong(), s, folders[rnd.nextInt(folders.size)], disguise(s, n++), false, null, if (rnd.nextInt(5) == 0) 1_200 else 0)

        // duplicates: the same content dropped again, elsewhere and later
        val dupSources = jobs.shuffled(rnd).take(8)
        for (j in dupSources) jobs += Job(j.atMs + 12_000 + rnd.nextInt(8_000), j.sample, folders[rnd.nextInt(folders.size)], "copy_of_${n++}_${j.sample.file.extension}.${j.sample.file.extension}", false, j.sample.file.name, 0)

        // ---- the working directories ----
        val importDir = Files.createTempDirectory("kardisynch-stress-import").toFile()
        val dataRoot = Files.createTempDirectory("kardisynch-stress-data").toFile()
        val reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        val repository = KardiSynchRepository(driver)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val events = CopyOnWriteArrayList<String>()
        val dropped = Collections.synchronizedList(mutableListOf<Dropped>())
        val watcher = ImportWatcher(importDir, reportsRoot, repository, DesktopDataRootReader(), DesktopDataRootWriter(), scope, NoOpDirectoryLock) { events.add(it) }

        // damaged files: junk, a truncated XML, an empty-ish text, a real PDF cut in half
        val someXml = all.first { it.group == "biotronik" }.file.readBytes()
        val somePdf = all.first { it.group == "medtronic-pdf" }.file.readBytes()
        val damaged = listOf(
            "junk_a.pdf" to ByteArray(4096).also { rnd.nextBytes(it) },
            "junk_b.xml" to ByteArray(2048).also { rnd.nextBytes(it) },
            "truncated.xml" to someXml.copyOfRange(0, someXml.size / 3),
            "note.txt" to "call the service line".encodeToByteArray(),
            "half.pdf" to somePdf.copyOfRange(0, somePdf.size / 2),
        )

        val started = System.currentTimeMillis()
        try {
            importDir.mkdirs()
            watcher.start()

            val writers = folders.map { folder ->
                thread(name = "writer-$folder") {
                    val mine = jobs.filter { it.folder == folder }.sortedBy { it.atMs }
                    for (job in mine) {
                        val wait = job.atMs - (System.currentTimeMillis() - started)
                        if (wait > 0) Thread.sleep(wait)
                        val dir = File(importDir, job.folder).apply { mkdirs() }
                        val target = File(dir, job.destName)
                        val bytes = job.sample.file.readBytes()
                        // slow, growing write: the watcher can see the file while it is still being written
                        val chunks = 8
                        val stallAt = if (job.stallMs > 0) 3 else -1
                        target.outputStream().use { out ->
                            for (c in 0 until chunks) {
                                val from = bytes.size * c / chunks
                                val to = bytes.size * (c + 1) / chunks
                                out.write(bytes, from, to - from)
                                out.flush()
                                Thread.sleep(40L + rnd.nextInt(110))
                                if (c == stallAt) Thread.sleep(job.stallMs)
                            }
                        }
                        dropped += Dropped(job.sample, job.destName, job.folder, truthBySample[job.sample.file], false, job.dupOf)
                    }
                }
            }
            thread(name = "writer-damaged") {
                damaged.forEachIndexed { i, (name, bytes) ->
                    Thread.sleep(2_000L + i * 4_000L)
                    val dir = File(importDir, "damaged").apply { mkdirs() }
                    File(dir, name).writeBytes(bytes)
                    dropped += Dropped(Sample(File(name), "damaged", FileKind.UNKNOWN), name, "damaged", null, true, null)
                }
            }.also { writers.forEach { w -> w.join() }; it.join() }

            // ---- wait for quiescence: nothing left to process in the import folder ----
            val reserved = setOf("_unmatched", "_pending_sort", "_duplicates")
            fun leftovers() = importDir.walkTopDown().onEnter { it == importDir || it.name !in reserved }.filter { it.isFile }.toList()
            val deadline = System.currentTimeMillis() + 240_000
            var quietSince = 0L
            while (System.currentTimeMillis() < deadline) {
                if (leftovers().isEmpty()) {
                    if (quietSince == 0L) quietSince = System.currentTimeMillis()
                    if (System.currentTimeMillis() - quietSince > 6_000) break
                } else {
                    quietSince = 0L
                }
                Thread.sleep(500)
            }
        } finally {
            watcher.stop()
        }
        val elapsed = (System.currentTimeMillis() - started) / 1000

        // ---- evaluate ----
        val ledger = runBlocking { repository.getRecentIntakeFiles(100_000) }
        val byPath = ledger.associateBy { it.originalPath }
        val patientsById = runBlocking { repository.observePatients().first() }.associateBy { it.id }
        val states = ledger.groupingBy { it.state }.eachCount().toSortedMap()
        say("dropped ${dropped.size} files (${dropped.count { it.duplicateOf != null }} duplicates, ${dropped.count { it.damaged }} damaged) in ${elapsed}s; ledger rows ${ledger.size}")
        say("ledger states: $states")
        say("patients created: ${patientsById.size}")

        // 1. nothing is lost: every dropped file has a ledger row and none is still sitting unprocessed
        val leftovers = importDir.walkTopDown().onEnter { it == importDir || it.name !in setOf("_unmatched", "_pending_sort", "_duplicates") }.filter { it.isFile }.toList()
        val unaccounted = dropped.filter { d -> ledger.none { it.fileName == d.destName } }
        say("LOST/unaccounted files: ${unaccounted.size}; left in the import folder: ${leftovers.size}")
        for (d in unaccounted) {
            val sameContent = if (d.damaged) null else ledger.firstOrNull { it.sha256 == sha256Hex(d.source.file) }
            say("  lost: group=${d.source.group} duplicate=${d.duplicateOf != null} folder=${d.folder.substringBefore('/')} ledger row for the same content: ${sameContent?.state ?: "none"}")
        }

        // 2. damaged files are never imported
        val damagedImported = ledger.filter { it.fileName in damaged.map { d -> d.first } && it.state in setOf("committed", "attached") }
        say("damaged files imported: ${damagedImported.size}")

        // 3. wrong patient: every committed/attached file's patient matches the ground truth of its source file
        val byDest = dropped.groupBy { it.destName }
        var checked = 0
        var wrongPatient = 0
        var unknownTruth = 0
        for (row in ledger.filter { it.state in setOf("committed", "attached") && it.patientId != null }) {
            val d = byDest[row.fileName]?.firstOrNull() ?: continue
            val truth = d.truthKey
            if (truth == null) { unknownTruth++; continue }
            val p = patientsById[row.patientId] ?: continue
            val dbKey = "${p.lastName.lowercase()}|${p.dob}"
            checked++
            if (dbKey != truth) {
                wrongPatient++
                say("  wrong patient: group=${d.source.group} state=${row.state} kind=${row.fileKind} sameLastName=${p.lastName.lowercase() == truth.substringBefore('|')} sameDob=${p.dob == truth.substringAfter('|')} bundleSize=${ledger.count { it.bundleId != null && it.bundleId == row.bundleId }}")
            }
        }
        say("placement checked on $checked files; WRONG PATIENT: $wrongPatient; files with no ground truth: $unknownTruth")

        // 4. one patient per identity, one identity per patient
        val committedByIdentity = HashMap<String, MutableSet<String>>()
        for (row in ledger.filter { it.state in setOf("committed", "attached") && it.patientId != null }) {
            val truth = byDest[row.fileName]?.firstOrNull()?.truthKey ?: continue
            committedByIdentity.getOrPut(truth) { mutableSetOf() }.add(row.patientId!!)
        }
        val split = committedByIdentity.count { it.value.size > 1 }
        say("identities split across several patients: $split of ${committedByIdentity.size}")

        // 5. the same content is not imported twice
        val committedShas = ledger.filter { it.state in setOf("committed", "attached") }.groupBy { it.sha256 }.filter { it.value.size > 1 }
        say("content imported more than once: ${committedShas.size}")

        // 6. where did the Medtronic PDFs go: with their data file, or safely queued
        val pairedPdfRows = pairKeys.mapNotNull { k ->
            val pdfName = dropped.firstOrNull { it.source.file == pdfBySamePair.getValue(k).file && it.duplicateOf == null }?.destName
            val pkgName = dropped.firstOrNull { it.source.file == pkgBySamePair.getValue(k).file && it.duplicateOf == null }?.destName
            if (pdfName == null || pkgName == null) null else ledger.firstOrNull { it.fileName == pdfName } to ledger.firstOrNull { it.fileName == pkgName }
        }
        val sameVisit = pairedPdfRows.count { (pdf, pkg) -> pdf?.reportId != null && pdf.reportId == pkg?.reportId }
        val pdfQueued = pairedPdfRows.count { (pdf, _) -> pdf?.state == "pending" }
        val pdfOtherVisit = pairedPdfRows.count { (pdf, pkg) -> pdf?.state in setOf("committed", "attached") && pdf?.reportId != pkg?.reportId }
        say("Medtronic pairs: ${pairedPdfRows.size}; PDF in the same visit as its data file: $sameVisit; PDF queued for a person: $pdfQueued; PDF in a different visit of the right patient: $pdfOtherVisit")
        // pairs by outcome: how the data file and its PDF each ended up
        val matrix = pairedPdfRows.groupingBy { (pdf, pkg) -> "pkg=${pkg?.state} pdf=${pdf?.state}" }.eachCount().toSortedMap()
        say("pair outcomes: $matrix")
        val queuedDespiteCommittedPkg = pairedPdfRows.count { (pdf, pkg) -> pkg?.state == "committed" && pdf?.state == "pending" }
        say("PDF queued although its data file WAS imported: $queuedDespiteCommittedPkg")
        for ((pdf, pkg) in pairedPdfRows.filter { (pdf, pkg) -> pkg?.state == "committed" && pdf?.state == "pending" }) {
            val pdfFirst = (pdf?.seenAt ?: "") < (pkg?.seenAt ?: "")
            val note = pdf?.message.orEmpty().let { if (it.startsWith("Similar patient")) "Similar patient on file…" else it.take(70) }
            say("  stranded pdf: arrived before its data file=$pdfFirst; reason: $note")
        }
        for (row in ledger.filter { it.state == "error" }) say("  error: ${row.message?.substringAfter(": ")?.take(160)}")
        val pendingReasons = runBlocking { repository.getPendingSortTasks() }.groupingBy { it.note.take(60) }.eachCount().entries.sortedByDescending { it.value }.take(5)
        say("queued for a person, by reason: $pendingReasons")

        val unrecognised = ledger.filter { it.state == "unrecognised" }
        say("unrecognised: ${unrecognised.size} (expected: the damaged files); errors: ${ledger.count { it.state == "error" }}")
        flushReport()

        scope.cancel()
        importDir.deleteRecursively()
        dataRoot.deleteRecursively()

        assertEquals(0, unaccounted.size, "no file may be lost")
        assertEquals(0, leftovers.size, "nothing may be left unprocessed in the import folder")
        assertEquals(0, damagedImported.size, "damaged files must never be imported")
        assertEquals(0, wrongPatient, "no file may end up with the wrong patient")
        assertEquals(0, split, "one identity must not be split over several patients")
        assertEquals(0, committedShas.size, "the same content must not be imported twice")
        assertTrue(checked > 50, "too few files were placed to judge ($checked)")
    }
}
