@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package io.github.alexanderlanganke.kardisynch.ui

import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.unit.Density
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootWriter
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.KardiSynchDatabase
import io.github.alexanderlanganke.kardisynch.ui.inbox.IntakeSource
import io.github.alexanderlanganke.kardisynch.ui.inbox.SourceKind
import io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import java.nio.file.Files
import kotlin.test.Test

/**
 * Renders the real screens headlessly to PNG so the design can be looked at
 * without launching the app. Opt-in: set KARDISYNCH_SCREENSHOT_DIR to a folder
 * (otherwise this test does nothing).
 */
private const val VISIT_ROW_Y = 670f
private const val SPLIT_X = 1328f

class ScreenshotTest {
    private lateinit var reader: DesktopDataRootReader
    private lateinit var reportsRootPath: String
    private val outDir: File? = System.getenv("KARDISYNCH_SCREENSHOT_DIR")?.let { File(it).apply { mkdirs() } }

    private fun report(first: String, last: String, dob: String, mfg: String, model: String, serial: String, date: String, volts: Double, status: String, rvImp: Double, rvThr: Double) = UnifiedReport(
        manufacturer = mfg, interrogationDate = date,
        patient = PatientInfo(first, last, dob, hospitalPatientId = "MRN${serial.takeLast(5)}"),
        device = DeviceInfo("ICD", model, serial, implantDate = "2021-02-03"),
        battery = BatteryData(voltage = Measurement(volts, "V"), status = status),
        leads = listOf(
            LeadData("RV", model = "5076", serial = "L$serial", anatomicLocation = "RV", impedance = Measurement(rvImp, "Ω"), pacingThreshold = Measurement(rvThr, "V"), sensing = Measurement(12.4, "mV")),
            LeadData("RA", model = "5076", serial = "A$serial", anatomicLocation = "RA", impedance = Measurement(438.0, "Ω"), sensing = Measurement(3.2, "mV")),
        ),
    )

    private fun seed(repo: KardiSynchRepository, reader: DesktopDataRootReader, writer: DesktopDataRootWriter, reportsRoot: String) = runBlocking {
        val rows = listOf(
            report("Hans", "Beispiel", "1948-06-11", "Medtronic", "Azure XT DR MRI", "PZK123456P", "2026-02-09T09:00:00", 2.88, "OK", 509.0, 0.88),
            report("Hans", "Beispiel", "1948-06-11", "Medtronic", "Azure XT DR MRI", "PZK123456P", "2026-10-14T09:12:00", 2.81, "ERI", 512.0, 0.75),
            report("Erika", "Muster", "1951-09-04", "Biotronik", "Evia 8 DR-T", "BIO5551234", "2026-11-02T10:00:00", 3.01, "OK", 480.0, 0.5),
            report("Anna", "Probe", "1944-08-29", "Boston Scientific", "Resonate EL ICD", "BSC00441", "2026-03-11T08:30:00", 3.1, "OK", 520.0, 0.6),
            report("Max", "Testpatient", "1970-03-15", "Abbott", "Gallant ICD", "GL4410982", "2026-10-29T14:00:00", 3.0, "OK", 495.0, 0.7),
            report("Lena", "Demo", "1983-09-09", "Abbott", "Aveir VR", "AV20931", "2026-10-21T11:00:00", 2.9, "OK", 505.0, 0.6),
        )
        rows.forEach { repo.importReport(reader, writer, reportsRoot, it).getOrThrow() }

        val muster = repo.observePatients().first().first { it.lastName == "Muster" }
        suspend fun task(file: String, kind: String, conf: Int, evidence: String) = repo.createPendingSortTask(
            createdAt = "2026-11-04T14:02:00Z", sessionId = null, stagedFilePath = "/staged/$file", originalFileName = file,
            suggestedPatientId = muster.id, suggestedPatientName = "Muster, Erika",
            note = "Device serial matches Muster, Erika on file, but the name on this PDF is abbreviated. Confirm before importing.",
            manufacturer = "Medtronic", deviceModel = "Azure XT DR", deviceSerial = "PZK123456P", interrogationDate = "2026-11-04T09:12:00",
            bundleId = "B1", fileKind = kind, confidence = conf, evidence = evidence,
            patientLastName = "Muster", patientFirstName = if (kind == "DEVICE_PDF") "E." else "Erika", patientDob = "1951-09-04",
        )
        task("20261104_0912.pdd", "MEDTRONIC_PDD", 99, "+ File signature matches a Medtronic PDD\n+ device serial PZK123456P found in the file\n~ file name carries no hint")
        task("Report_Muster.pdf", "DEVICE_PDF", 94, "+ PDF document\n+ text mentions \"medtronic\", \"carelink\"\n- file name does not match the PDD")
        repo.recordIntakeFile("zz1", "export_final.xml", "/in/export_final.xml", "/in/_unmatched/export_final.xml", "Import folder/2026-11-04", 900, "2026-11-04T13:58:00Z", "unrecognised", "UNKNOWN_XML", null, 0, "- XML with root <Export>; no parser claims it", null, message = "Skipped export_final.xml: unsupported or unparseable file type.")
        repo.recordIntakeFile("zz2", "20261029_gallant.log", "/in/g.log", "/data/g.log", "Import folder", 900, "2026-10-29T14:00:00Z", "committed", "ABBOTT_LOG", "Abbott", 97, null, null, message = "Imported 20261029_gallant.log -> Testpatient, Max")
    }

    private fun shoot(name: String, w: Int, h: Int, dark: Boolean, repo: KardiSynchRepository, steps: (ImageComposeScene) -> Unit = {}) {
        val dir = outDir ?: return
        val scene = ImageComposeScene(w, h, Density(1f)) {
            KardiSynchApp(
                repository = repo, dataRootLabel = "/data", isReindexing = false, lastReindexSummary = null,
                onPickDataRoot = {}, onReindex = {}, onClearLocalIndex = {},
                todayIso = "2026-11-09", themeMode = if (dark) ThemeMode.DARK else ThemeMode.LIGHT,
                appVersion = "2.21.0", pendingSortCount = 2,
                onApprovePendingSort = { _, _ -> }, onDismissPendingSort = { _ -> },
                intakeSources = listOf(
                    IntakeSource("Import folder", "/home/clinic/_IMPORT", true, SourceKind.FOLDER),
                    IntakeSource("KARDIO-STICK", "E:\\", true, SourceKind.USB),
                    IntakeSource("cied-export", "\\\\clinic-nas\\cied-export", false, SourceKind.SHARE),
                ),
                onGetVisitFiles = { pid, rid -> repo.getVisitFiles(reader, reportsRootPath, pid, rid) },
                onReadVisitFileBytes = { reader.readBytes(it) },
                onReadVisitFileText = { reader.readText(it) },
            )
        }
        fun settle(frames: Int = 40) { repeat(frames) { Thread.sleep(40); scene.render(it * 16_000_000L) } }
        settle()
        steps(scene)
        settle()
        File(dir, "$name.png").writeBytes(scene.render(10_000_000_000L).encodeToData(EncodedImageFormat.PNG)!!.bytes)
        scene.close()
    }

    private fun click(scene: ImageComposeScene, x: Float, y: Float) {
        val p = Offset(x, y)
        scene.sendPointerEvent(PointerEventType.Move, p)
        scene.sendPointerEvent(PointerEventType.Press, p)
        Thread.sleep(60)
        scene.sendPointerEvent(PointerEventType.Release, p)
    }

    /** Gives Beispiel's two visits a raw file and a PDF (the latest), or only a raw file (the older one). */
    private fun addVisitFiles(repo: KardiSynchRepository, reportsRoot: String) = runBlocking {
        val patient = repo.observePatients().first().first { it.lastName == "Beispiel" }
        val visits = repo.observeReportsForPatient(patient.id).first().sortedByDescending { it.interrogationDate }
        val patientDir = File(reportsRoot).walkTopDown().first { it.isDirectory && it.name.contains(patient.id) }
        fun dirOf(id: String) = patientDir.listFiles()!!.first { it.isDirectory && it.name.endsWith("_$id") }
        File(dirOf(visits[0].id), "20261014_0912.pdd").writeBytes(ByteArray(2048) { it.toByte() })
        File(dirOf(visits[1].id), "20260209_0900.pdd").writeBytes(ByteArray(2048) { it.toByte() })
        org.apache.pdfbox.pdmodel.PDDocument().use { doc ->
            val page = org.apache.pdfbox.pdmodel.PDPage(); doc.addPage(page)
            org.apache.pdfbox.pdmodel.PDPageContentStream(doc, page).use { cs ->
                cs.beginText()
                cs.setFont(org.apache.pdfbox.pdmodel.font.PDType1Font(org.apache.pdfbox.pdmodel.font.Standard14Fonts.FontName.HELVETICA_BOLD), 16f)
                cs.newLineAtOffset(60f, 740f); cs.showText("Medtronic CareLink - Final Session Report"); cs.endText()
                cs.beginText()
                cs.setFont(org.apache.pdfbox.pdmodel.font.PDType1Font(org.apache.pdfbox.pdmodel.font.Standard14Fonts.FontName.HELVETICA), 12f)
                cs.newLineAtOffset(60f, 710f); cs.setLeading(18f)
                listOf("Patient: Beispiel, Hans", "Device: Azure XT DR MRI  PZK123456P", "Session: 14 Oct 2026 09:12", "Battery: 2.81 V  ERI", "RV impedance: 512 ohm", "RV threshold: 0.75 V @ 0.4 ms").forEach { cs.showText(it); cs.newLine() }
                cs.endText()
            }
            doc.save(File(dirOf(visits[0].id), "Report_Beispiel.pdf"))
        }
    }

    @Test
    fun screens() {
        if (outDir == null) return
        val dataRoot = Files.createTempDirectory("shot-data").toFile()
        val reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        val repo = KardiSynchRepository(driver)
        reader = DesktopDataRootReader()
        reportsRootPath = reportsRoot
        seed(repo, reader, DesktopDataRootWriter(), reportsRoot)
        addVisitFiles(repo, reportsRoot)

        shoot("1-desktop-patients", 1360, 820, false, repo)
        shoot("2-phone-patients", 390, 844, false, repo)
        shoot("3-desktop-detail-dark", 1360, 820, true, repo) { click(it, 200f, 264f) }
        shoot("4-desktop-inbox", 1360, 820, false, repo) { click(it, 40f, 88f) }
        shoot("6-desktop-bundle-review", 1360, 820, false, repo) {
            click(it, 40f, 88f)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, 1280f, 373f)
        }
        shoot("7-desktop-overview", 1360, 820, false, repo) { click(it, 200f, 264f) }
        shoot("7b-desktop-overview-dark", 1360, 820, true, repo) { click(it, 200f, 264f) }
        shoot("8-phone-overview", 390, 844, false, repo) { click(it, 150f, 264f) }
        shoot("9-desktop-visit", 1360, 820, false, repo) {
            click(it, 200f, 264f)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, 700f, VISIT_ROW_Y)
        }
        shoot("10-desktop-visit-split", 1360, 820, false, repo) {
            click(it, 200f, 264f)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, 700f, VISIT_ROW_Y)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, SPLIT_X, 40f)
            repeat(60) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
        }
        shoot("11-phone-visit-split", 390, 844, false, repo) {
            click(it, 150f, 264f)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            it.sendPointerEvent(PointerEventType.Scroll, Offset(200f, 500f), scrollDelta = Offset(0f, 30f))
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, 200f, 735f)
            repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
            click(it, 300f, 28f)
            repeat(60) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
        }
        shoot("5-phone-inbox-dark", 390, 844, true, repo) { click(it, 195f, 810f) }
        dataRoot.deleteRecursively()
    }
}
