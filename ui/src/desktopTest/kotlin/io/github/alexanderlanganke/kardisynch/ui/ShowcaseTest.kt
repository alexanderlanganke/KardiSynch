@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package io.github.alexanderlanganke.kardisynch.ui

import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.unit.Density
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.github.alexanderlanganke.kardisynch.core.model.ArrhythmiaSummary
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
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.apache.pdfbox.pdmodel.font.Standard14Fonts
import org.jetbrains.skia.EncodedImageFormat
import java.awt.Color
import java.io.File
import java.nio.file.Files
import java.time.LocalDate
import kotlin.math.sin
import kotlin.random.Random
import kotlin.test.Test

/**
 * Builds a believable, entirely fictional clinic (patients, five years of visits, lead and battery trends,
 * mock PDF reports) and renders the real screens to PNG for marketing material. Opt-in: set
 * KARDISYNCH_SHOWCASE_DIR. Everything here is invented; no real patient or manufacturer document is used.
 */
class ShowcaseTest {
    private val outDir: File? = System.getenv("KARDISYNCH_SHOWCASE_DIR")?.let { File(it).apply { mkdirs() } }
    private lateinit var reader: DesktopDataRootReader
    private lateinit var reportsRootPath: String
    private val scale = 2f
    /** KARDISYNCH_SHOWCASE_LANG=en renders English; German is the default (the post is for a German audience). */
    private val de = System.getenv("KARDISYNCH_SHOWCASE_LANG")?.lowercase() != "en"
    private fun L(en: String, german: String) = if (de) german else en
    private fun num(v: Double): String = v.toString().let { if (de) it.replace('.', ',') else it }
    private fun unitText(u: String): String = u.replace("ms", " ms").let { if (de) it.replace('.', ',') else it }
    private fun fmt1(v: Double): String = String.format(java.util.Locale.ROOT, "%.1f", v).let { if (de) it.replace('.', ',') else it }
    private fun fmt2(v: Double): String = String.format(java.util.Locale.ROOT, "%.2f", v).let { if (de) it.replace('.', ',') else it }

    private class Pt(
        val first: String, val last: String, val dob: String, val mfg: String, val model: String, val type: String, val serial: String,
        val implant: String, val leadModel: String, val leads: List<String>, val batt0: Double, val battPerYear: Double, val firstVisit: String,
        val rvImp: Double, val thr: Double, val amp: Double, val af: Double? = null, val vt: Int? = null,
    )

    private val patients = listOf(
        Pt("Hans", "Beispiel", "1948-06-11", "Medtronic", "Azure XT DR MRI", "Pacemaker", "PZK123456P", "2021-02-03", "CapSureFix 5076", listOf("RA", "RV"), 3.00, 0.06, "2023-02-14", 512.0, 0.75, 2.5, 4.1),
        Pt("Erika", "Muster", "1951-09-04", "Biotronik", "Evia 8 DR-T", "Pacemaker", "BIO5551234", "2022-06-20", "Solia S 60", listOf("RA", "RV"), 3.05, 0.025, "2023-07-03", 480.0, 0.50, 2.4),
        Pt("Anna", "Probe", "1944-08-29", "Boston Scientific", "Resonate EL ICD", "ICD", "BSC00441", "2020-11-09", "Reliance 4-SITE", listOf("RA", "RV"), 3.12, 0.03, "2023-03-21", 520.0, 0.60, 3.0, 1.2, 2),
        Pt("Max", "Testpatient", "1970-03-15", "Abbott", "Gallant CRT-D", "CRT-D", "GL4410982", "2023-01-17", "Durata 7122Q", listOf("RA", "RV", "LV"), 3.10, 0.03, "2023-05-09", 495.0, 0.70, 3.5, 0.4, 0),
        Pt("Lena", "Demo", "1983-09-09", "Abbott", "Aveir VR", "Leadless pacemaker", "AV20931", "2024-03-02", "Integrated", listOf("RV"), 3.01, 0.02, "2024-04-16", 505.0, 0.60, 2.0),
        Pt("Karl", "Beispielmann", "1938-09-13", "Biotronik", "Rivacor 7 VR-T DX", "ICD", "BIO5520718", "2019-05-14", "Plexa ProMRI S DX 65", listOf("RV"), 2.96, 0.05, "2023-01-30", 560.0, 0.9, 3.0, null, 5),
        Pt("Gisela", "Musterfrau", "1957-08-07", "Medtronic", "Micra AV", "Leadless pacemaker", "MCR77120AV", "2022-09-12", "Integrated", listOf("RV"), 3.08, 0.02, "2023-04-11", 610.0, 0.38, 1.5),
        Pt("Juergen", "Probst", "1962-02-17", "Boston Scientific", "Accolade MRI DR", "Pacemaker", "BSC99817X", "2021-08-25", "Ingevity+ MRI", listOf("RA", "RV"), 3.04, 0.03, "2023-06-27", 475.0, 0.55, 2.5, 7.9),
    )

    private fun visitDates(p: Pt): List<LocalDate> {
        val out = mutableListOf<LocalDate>()
        var d = LocalDate.parse(p.firstVisit)
        while (d <= LocalDate.parse("2026-10-30")) { out += d; d = d.plusMonths(5).plusDays((out.size * 3L) % 9) }
        return out
    }

    private fun reportFor(p: Pt, date: LocalDate, idx: Int): UnifiedReport {
        val rnd = Random(p.serial.hashCode() + idx)
        val years = (date.toEpochDay() - LocalDate.parse(p.firstVisit).toEpochDay()) / 365.0
        val volts = (p.batt0 - p.battPerYear * years + 0.004 * sin(idx * 1.3)).coerceAtLeast(2.55)
        val status = if (volts < 2.80) "ERI" else "OK"
        // Pulse width the threshold was measured at; one patient is re-tested at a longer pulse width part-way through.
        val pw = if (p.last == "Probe" && idx >= 4) 0.5 else if (p.mfg == "Abbott") 0.5 else 0.4
        val thrUnit = "V @ ${pw}ms"
        val ampUnit = "V @ ${if (p.mfg == "Abbott") 0.5 else 0.4}ms"
        fun lead(name: String): LeadData {
            val chamber = when (name) { "RA" -> 0; "RV" -> 1; else -> 2 }
            val imp = when (name) { "RA" -> 438.0; "LV" -> 690.0; else -> p.rvImp } + 14 * sin(idx * 0.9 + chamber) + rnd.nextDouble(-9.0, 9.0) + years * 6
            val thr = ((when (name) { "RA" -> 0.62; "LV" -> 1.05; else -> p.thr } + rnd.nextDouble(-0.06, 0.06) + years * 0.015) * (if (pw > 0.45 && p.mfg != "Abbott") 0.86 else 1.0)).coerceAtLeast(0.3)
            val sens = when (name) { "RA" -> 3.4 + rnd.nextDouble(-0.5, 0.5); "LV" -> 0.0; else -> 12.4 + rnd.nextDouble(-1.4, 1.4) }
            return LeadData(
                name = name, manufacturer = p.mfg, model = p.leadModel, serial = "${name}${p.serial.takeLast(5)}", anatomicLocation = name, implantDate = p.implant,
                impedance = Measurement(Math.round(imp).toDouble(), "Ohm"),
                pacingThreshold = Measurement(Math.round(thr * 100) / 100.0, thrUnit),
                pacingAmplitude = Measurement(p.amp, ampUnit),
                sensing = if (sens > 0) Measurement(Math.round(sens * 10) / 10.0, "mV") else null,
            )
        }
        return UnifiedReport(
            manufacturer = p.mfg, interrogationDate = String.format(java.util.Locale.ROOT, "%sT%02d:%02d:00", date, 8 + idx % 6, (10 + idx * 7) % 60),
            patient = PatientInfo(p.first, p.last, p.dob, hospitalPatientId = "${(p.serial.hashCode() and 0xFFFFFF) % 9000000 + 1000000}"),
            device = DeviceInfo(p.type, p.model, p.serial, p.implant),
            battery = BatteryData(Measurement(Math.round(volts * 100) / 100.0, "V"), Measurement(Math.round((volts - 2.6) / p.battPerYear * 12).coerceIn(3, 120).toDouble(), "months"), status = status),
            leads = p.leads.map(::lead),
            arrhythmiaSummary = if (p.af != null || p.vt != null) ArrhythmiaSummary(p.af?.let { Measurement((it + rnd.nextDouble(-0.6, 1.4)).coerceAtLeast(0.0), "%") }, p.vt) else null,
        )
    }

    // ---- Mock PDFs --------------------------------------------------------------------------------

    private fun pdf(file: File, p: Pt, r: UnifiedReport, history: List<UnifiedReport>) {
        val bold = PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD); val reg = PDType1Font(Standard14Fonts.FontName.HELVETICA)
        val accent = when (p.mfg) { "Medtronic" -> Color(0, 75, 135); "Biotronik" -> Color(95, 33, 45); "Boston Scientific" -> Color(0, 60, 113); else -> Color(40, 40, 48) }
        PDDocument().use { doc ->
            fun text(cs: PDPageContentStream, s: String, x: Float, y: Float, size: Float = 10f, f: PDType1Font = reg, c: Color = Color(30, 30, 36)) {
                cs.setNonStrokingColor(c); cs.beginText(); cs.setFont(f, size); cs.newLineAtOffset(x, y); cs.showText(s); cs.endText()
            }
            fun band(cs: PDPageContentStream, page: PDPage, title: String) {
                cs.setNonStrokingColor(accent); cs.addRect(0f, 770f, PDRectangle.A4.width, 72f); cs.fill()
                text(cs, L("FICTIONAL SAMPLE  |  ${p.mfg} device", "FIKTIVES BEISPIEL  |  Gerät von ${p.mfg}"), 40f, 812f, 10f, bold, Color.WHITE)
                text(cs, title, 40f, 788f, 18f, bold, Color.WHITE)
            }
            // Page 1: identity, battery, leads
            val p1 = PDPage(PDRectangle.A4); doc.addPage(p1)
            PDPageContentStream(doc, p1).use { cs ->
                band(cs, p1, L("Device Interrogation Report", "Geräteabfrage - Bericht"))
                text(cs, "Patient", 40f, 740f, 9f, bold, Color.GRAY)
                text(cs, "${p.last}, ${p.first}", 40f, 722f, 14f, bold)
                text(cs, L("DOB ", "Geb. ") + "${p.dob}    ${r.patient.hospitalPatientId}", 40f, 706f)
                text(cs, L("Device", "Gerät"), 300f, 740f, 9f, bold, Color.GRAY)
                text(cs, "${p.model} (${L(p.type, p.type.replace("Leadless pacemaker", "Kapsel-Schrittmacher").replace("Pacemaker", "Herzschrittmacher"))})", 300f, 722f, 14f, bold)
                text(cs, L("Serial ", "Seriennr. ") + p.serial + L("    Implanted ", "    Implantiert ") + p.implant, 300f, 706f)
                text(cs, L("Session ", "Sitzung ") + "${r.interrogationDate.take(10)}  ${r.interrogationDate.substring(11, 16)}", 40f, 676f, 10f, bold)

                cs.setNonStrokingColor(Color(238, 241, 246)); cs.addRect(40f, 590f, 515f, 70f); cs.fill()
                text(cs, L("BATTERY", "BATTERIE"), 52f, 642f, 9f, bold, Color.GRAY)
                text(cs, num(r.battery.voltage!!.value) + " V", 52f, 614f, 22f, bold)
                text(cs, "Status: ${r.battery.status}", 200f, 626f, 11f, bold)
                text(cs, L("Estimated remaining longevity: ${r.battery.remainingLongevity!!.value.toInt()} months", "Geschätzte Restlaufzeit: ${r.battery.remainingLongevity!!.value.toInt()} Monate"), 200f, 610f)

                text(cs, L("LEAD MEASUREMENTS", "SONDENMESSUNGEN"), 40f, 560f, 9f, bold, Color.GRAY)
                val cols = listOf(40f, 110f, 215f, 320f, 425f)
                listOf(L("Lead", "Sonde"), L("Impedance", "Impedanz"), L("Threshold", "Reizschwelle"), "Amplitude (prog.)", L("Sensing", "Wahrnehmung")).forEachIndexed { i, h -> text(cs, h, cols[i], 540f, 9f, bold, accent) }
                r.leads.forEachIndexed { row, l ->
                    val y = 518f - row * 22f
                    text(cs, l.name, cols[0], y, 11f, bold)
                    text(cs, "${l.impedance!!.value.toInt()} " + L("ohm", "Ohm"), cols[1], y, 11f)
                    text(cs, num(l.pacingThreshold!!.value) + " " + unitText(l.pacingThreshold!!.unit), cols[2], y, 11f)
                    text(cs, num(l.pacingAmplitude!!.value) + " " + unitText(l.pacingAmplitude!!.unit), cols[3], y, 11f)
                    text(cs, l.sensing?.let { num(it.value) + " mV" } ?: L("n/a", "k. A."), cols[4], y, 11f)
                }
                r.arrhythmiaSummary?.let { a ->
                    text(cs, L("ARRHYTHMIA SUMMARY", "RHYTHMUSÜBERSICHT"), 40f, 410f, 9f, bold, Color.GRAY)
                    a.atrialFibrillationBurden?.let { text(cs, L("AF burden: ", "VHF-Last: ") + fmt1(it.value) + " %", 40f, 390f, 11f) }
                    a.ventricularTachycardiaEpisodes?.let { text(cs, L("VT episodes since last session: $it", "VT-Episoden seit der letzten Sitzung: $it"), 40f, 372f, 11f) }
                }
                text(cs, L("Fictional demonstration data. Not a clinical document.", "Fiktive Demonstrationsdaten. Kein klinisches Dokument."), 40f, 40f, 8f, reg, Color.GRAY)
            }
            // Page 2: trends
            val p2 = PDPage(PDRectangle.A4); doc.addPage(p2)
            PDPageContentStream(doc, p2).use { cs ->
                band(cs, p2, L("Trends since first session", "Verläufe seit der ersten Sitzung"))
                fun chart(title: String, values: List<Double>, top: Float, unit: String) {
                    text(cs, title, 40f, top + 130f, 10f, bold)
                    cs.setNonStrokingColor(Color(246, 247, 250)); cs.addRect(40f, top, 515f, 115f); cs.fill()
                    val lo = values.min(); val hi = values.max().let { if (it - lo < 1e-6) lo + 1 else it }
                    cs.setStrokingColor(accent); cs.setLineWidth(2f)
                    values.forEachIndexed { i, v ->
                        val x = 55f + i * (485f / (values.size - 1).coerceAtLeast(1)); val y = top + 12f + ((v - lo) / (hi - lo)).toFloat() * 90f
                        if (i == 0) cs.moveTo(x, y) else cs.lineTo(x, y)
                    }
                    cs.stroke()
                    text(cs, fmt2(values.last()) + " $unit " + L("now", "aktuell"), 420f, top + 100f, 9f, bold, accent)
                }
                chart(L("Battery voltage", "Batteriespannung"), history.map { it.battery.voltage!!.value }, 620f, "V")
                chart(L("RV impedance", "RV-Impedanz"), history.map { it.leads.first { l -> l.name == "RV" }.impedance!!.value }, 460f, L("ohm", "Ohm"))
                chart(L("RV pacing threshold", "RV-Reizschwelle"), history.map { it.leads.first { l -> l.name == "RV" }.pacingThreshold!!.value }, 300f, "V")
                text(cs, L("Programmed parameters", "Programmierte Parameter"), 40f, 250f, 10f, bold)
                listOf(L("Mode: ", "Modus: ") + (if (p.leads.size == 1) "VVIR" else "DDDR"), L("Lower rate: 60 bpm   Upper sensor rate: 130 bpm", "Untere Frequenz: 60/min   Obere Sensorfrequenz: 130/min"), L("Output: ", "Ausgang: ") + num(p.amp) + " V @ " + (if (de) "0,4" else "0.4") + " ms (RV)", L("MRI mode: available", "MRT-Modus: verfügbar")).forEachIndexed { i, s -> text(cs, s, 40f, 232f - i * 16f, 10f) }
            }
            doc.save(file)
        }
    }

    private fun seed(repo: KardiSynchRepository, writer: DesktopDataRootWriter, reportsRoot: String) = runBlocking {
        val perPatient = mutableMapOf<String, List<UnifiedReport>>()
        patients.forEach { p ->
            val reports = visitDates(p).mapIndexed { i, d -> reportFor(p, d, i) }
            reports.forEach { repo.importReport(reader, writer, reportsRoot, it).getOrThrow() }
            perPatient[p.serial] = reports
        }
        // Files per visit: a raw file for every visit, a PDF for most (the odd one is missing, like real life).
        patients.forEach { p ->
            val patient = repo.observePatients().first().first { it.lastName == p.last }
            val visits = repo.observeReportsForPatient(patient.id).first().sortedBy { it.interrogationDate }
            val patientDir = File(reportsRoot).walkTopDown().first { it.isDirectory && it.name.contains(patient.id) }
            val reports = perPatient.getValue(p.serial)
            visits.forEachIndexed { i, v ->
                val dir = patientDir.listFiles()!!.first { it.isDirectory && it.name.endsWith("_${v.id}") }
                val ext = when (p.mfg) { "Medtronic" -> "pdd"; "Biotronik" -> "xml"; "Boston Scientific" -> "bnk"; else -> "log" }
                val stamp = v.interrogationDate.take(10).replace("-", "")
                if (ext == "xml") File(dir, "${stamp}_${p.last}.xml").writeText("<?xml version=\"1.0\"?><Mock><Note>fictional demonstration data</Note></Mock>")
                else File(dir, "${stamp}_${p.last}.$ext").writeBytes(ByteArray(4096) { (it * 7).toByte() })
                if (!(p.last == "Probe" && i == 1)) pdf(File(dir, "Report_${p.last}_$stamp.pdf"), p, reports[i], reports.take(i + 1))
            }
        }
        val muster = repo.observePatients().first().first { it.lastName == "Muster" }
        val staged = File.createTempFile("staged-", ".pdf")
        val newVisit = patients.first { it.last == "Muster" }.let { pt -> reportFor(pt, LocalDate.parse("2026-11-04"), 9) }
        pdf(staged, patients.first { it.last == "Muster" }, newVisit, perPatient.getValue("BIO5551234") + newVisit)
        val stagedXml = File.createTempFile("staged-", ".xml").apply { writeText("<?xml version=\"1.0\"?><Mock/>") }
        repo.createPendingSortTask(
            createdAt = "2026-11-04T14:02:40Z", sessionId = null, stagedFilePath = stagedXml.absolutePath, originalFileName = "BIOSTD_2026-11-04_Mus0051_E_5551234.xml",
            suggestedPatientId = muster.id, suggestedPatientName = "Muster, Erika", note = L("Device serial matches Muster, Erika on file.", "Seriennummer passt zu Muster, Erika."),
            manufacturer = "Biotronik", deviceModel = "Evia 8 DR-T", deviceSerial = "BIO5551234", interrogationDate = "2026-11-04T09:12:00",
            bundleId = "B1", fileKind = "BIOTRONIK_XML", confidence = 99,
            evidence = L("+ Biotronik XML structure recognised\n+ device serial BIO5551234 found in the file\n+ date of birth matches 1951-09-04", "+ Biotronik-XML-Struktur erkannt\n+ Geräte-Seriennummer BIO5551234 in der Datei gefunden\n+ Geburtsdatum stimmt überein: 1951-09-04"),
            patientLastName = "Muster", patientFirstName = "Erika", patientDob = "1951-09-04",
        )
        repo.createPendingSortTask(
            createdAt = "2026-11-04T14:02:00Z", sessionId = null, stagedFilePath = staged.absolutePath, originalFileName = "Report_Muster_20261104.pdf",
            suggestedPatientId = muster.id, suggestedPatientName = "Muster, Erika", note = L("PDF accompanying the XML.", "PDF zur XML-Datei."),
            manufacturer = "Biotronik", deviceModel = "Evia 8 DR-T", deviceSerial = "BIO5551234", interrogationDate = "2026-11-04T09:12:00",
            bundleId = "B1", fileKind = "DEVICE_PDF", confidence = 95,
            evidence = L("+ PDF document\n+ text names the same serial number\n~ file name does not match the XML", "+ PDF-Dokument\n+ Text nennt dieselbe Seriennummer\n~ Dateiname passt nicht zur XML-Datei"),
            patientLastName = "Muster", patientFirstName = "Erika", patientDob = "1951-09-04",
        )
    }

    private var curScale = scale

    private fun shoot(name: String, wDp: Int, hDp: Int, dark: Boolean, repo: KardiSynchRepository, sc: Float = scale, steps: (ImageComposeScene) -> Unit = {}) {
        val dir = outDir ?: return
        // KARDISYNCH_SHOWCASE_SHOTS=p3,p4 renders only those (each large scene leaves native memory behind, so a long run can be killed).
        System.getenv("KARDISYNCH_SHOWCASE_SHOTS")?.takeIf { it.isNotBlank() }?.split(",")?.let { only -> if (only.none { name.startsWith(it.trim()) }) return }
        curScale = sc
        val scene = ImageComposeScene((wDp * sc).toInt(), (hDp * sc).toInt(), Density(sc)) {
            KardiSynchApp(
                repository = repo, dataRootLabel = "D:\\Clinic\\_DATA", isReindexing = false, lastReindexSummary = null,
                onPickDataRoot = {}, onReindex = {}, onClearLocalIndex = {},
                todayIso = "2026-11-09", themeMode = if (dark) ThemeMode.DARK else ThemeMode.LIGHT,
                language = if (de) io.github.alexanderlanganke.kardisynch.core.i18n.Lang.DE else io.github.alexanderlanganke.kardisynch.core.i18n.Lang.EN,
                appVersion = "3.0.0", pendingSortCount = 2,
                onApprovePendingSort = { _, _ -> }, onDismissPendingSort = { _ -> },
                intakeSources = listOf(
                    IntakeSource(L("Import folder", "Importordner"), "D:\\Clinic\\_IMPORT", true, SourceKind.FOLDER),
                    IntakeSource("PROGRAMMER-STICK", "E:\\", true, SourceKind.USB),
                ),
                onGetVisitFiles = { pid, rid -> repo.getVisitFiles(reader, reportsRootPath, pid, rid) },
                onReadVisitFileBytes = { reader.readBytes(it) },
                onReadVisitFileText = { reader.readText(it) },
                onReadPendingSortFileBytes = { File(it).readBytes() },
                onReadPendingSortFileText = { File(it).readText() },
            )
        }
        fun settle(frames: Int = 40) { repeat(frames) { Thread.sleep(40); scene.render(it * 16_000_000L) } }
        settle(); steps(scene); settle(60)
        File(dir, "$name.png").writeBytes(scene.render(10_000_000_000L).encodeToData(EncodedImageFormat.PNG)!!.bytes)
        scene.close()
    }

    private fun ImageComposeScene.tap(xDp: Float, yDp: Float, wait: Int = 30) {
        val p = Offset(xDp * curScale, yDp * curScale)
        sendPointerEvent(PointerEventType.Move, p); sendPointerEvent(PointerEventType.Press, p); Thread.sleep(60); sendPointerEvent(PointerEventType.Release, p)
        repeat(wait) { n -> Thread.sleep(40); render(n * 16_000_000L) }
    }

    @Test
    fun showcase() {
        if (outDir == null) return
        val dataRoot = Files.createTempDirectory("showcase-data").toFile()
        val reportsRoot = File(dataRoot, "Reports").apply { mkdirs() }.absolutePath
        val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
        KardiSynchDatabase.Schema.create(driver)
        val repo = KardiSynchRepository(driver)
        reader = DesktopDataRootReader(); reportsRootPath = reportsRoot
        seed(repo, DesktopDataRootWriter(), reportsRoot)

        val phoneOnly = System.getenv("KARDISYNCH_SHOWCASE_PHONE") == "1"
        if (!phoneOnly) {
        shoot("a-patients", 1280, 800, false, repo)
        shoot("b-overview-dark", 1280, 800, true, repo) { it.tap(212f, 254f, 60) }
        shoot("g-anna-trend", 1280, 800, false, repo) {
            it.tap(212f, 726f, 60); it.tap(987f, 235f, 90)
        }
        shoot("c-visit-split", 1280, 800, false, repo) {
            it.tap(212f, 254f, 60); it.tap(800f, 733f, 60); it.tap(1248f, 40f, 120)
        }
        shoot("e-bundle", 1280, 900, false, repo) { it.tap(40f, 90f, 60); it.tap(1200f, 374f, 120); it.tap(227f, 277f, 90) }
        shoot("f-phone-overview-dark", 390, 844, true, repo) { it.tap(150f, 254f, 90) }
        }
        if (phoneOnly) {
            // Play Store phone screenshots: 390 x 780 dp at 3x = 1170 x 2340 px (2:1, inside Play's limits).
            shoot("p1-list", 390, 780, false, repo, 3f) { }
            shoot("p2-overview", 390, 780, true, repo, 3f) { it.tap(150f, 254f, 90) }
            shoot("p3-visit", 390, 780, false, repo, 3f) {
                it.tap(150f, 254f, 90)
                it.sendPointerEvent(PointerEventType.Scroll, Offset(200f * 3f, 500f * 3f), scrollDelta = Offset(0f, 30f))
                repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
                it.tap(200f, 700f, 90)
            }
            shoot("p4-visit-pdf", 390, 780, false, repo, 3f) {
                it.tap(150f, 254f, 90)
                it.sendPointerEvent(PointerEventType.Scroll, Offset(200f * 3f, 500f * 3f), scrollDelta = Offset(0f, 30f))
                repeat(25) { n -> Thread.sleep(40); it.render(n * 16_000_000L) }
                it.tap(200f, 700f, 90)
                it.tap(330f, 102f, 120)
            }
        }
        dataRoot.deleteRecursively()
    }
}
