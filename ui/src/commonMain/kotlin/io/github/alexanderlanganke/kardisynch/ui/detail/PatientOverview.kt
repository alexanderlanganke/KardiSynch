package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.ui.format.displayValueWithUnit
import io.github.alexanderlanganke.kardisynch.core.i18n.trn
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.getConnectorFlag
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.mri.ManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.mri.mriCheckUrl
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.core.util.ageInYears
import io.github.alexanderlanganke.kardisynch.core.util.daysBetweenIsoDates
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.ui.format.displayNumber
import io.github.alexanderlanganke.kardisynch.ui.format.displayUnit
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.ManufacturerWordmark
import io.github.alexanderlanganke.kardisynch.ui.theme.manufacturerDot
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors
import kotlinx.coroutines.launch

/** A patient who has not been seen for this long is flagged (the patient list uses the same threshold). */
private const val OVERDUE_DAYS = 180

/** One measurement shown as a tile: its latest value, a sparkline of the recent readings, and the full series for the chart. */
internal class TrendTile(val label: String, val unit: String, val points: List<TrendPoint>) {
    /** The pulse width of the latest reading, for tiles whose value depends on it (thresholds). */
    val latestPulseWidthMs: Double? get() = points.lastOrNull()?.pulseWidthMs
    val latest: Double get() = points.last().value
    val deltaText: String
        get() {
            val recent = points.takeLast(8)
            if (recent.size < 2) return tr("One reading")
            val change = recent.last().value - recent.first().value
            val span = (recent.maxOf { it.value } - recent.minOf { it.value })
            val word = when {
                span <= 0.0 -> tr("Stable")
                kotlin.math.abs(change) < span * 0.25 -> tr("Stable")
                change < 0 -> tr("Falling")
                else -> tr("Rising")
            }
            return tr("{word}, {a} to {b} {unit}", "word" to word, "a" to formatNumber(recent.minOf { it.value }), "b" to formatNumber(recent.maxOf { it.value }), "unit" to unit).trim()
        }
}

internal fun formatNumber(v: Double): String = displayNumber(v)

/**
 * The patient page: identity and device in the header, then the answers a
 * clinician wants first (battery alert, four trends, the leads), then the
 * visits, each showing which files it holds. Replaces the old details
 * strip and the two empty-looking panes. Tapping a visit opens it
 * ([onOpenVisit]); the raw file and the PDF are one tap further.
 */
@Composable
internal fun PatientOverview(
    repository: KardiSynchRepository,
    patient: Patients,
    reports: List<Reports>,
    patientId: String,
    latestDevice: Devices?,
    latestLeads: List<Leads>?,
    deviceTypeAliases: List<DeviceTypeAlias>,
    todayIso: String?,
    reloadKey: Int,
    onBack: (() -> Unit)?,
    onOpenVisit: (Reports) -> Unit,
    onOpenUrl: ((String) -> Unit)?,
    onOpenPatientFolder: (() -> Unit)?,
    onEditPatientInfo: (() -> Unit)?,
    onEditDeviceAndLeads: ((Reports?) -> Unit)?,
    onExportLatestVisitQr: (() -> Unit)?,
    onRescanVisit: ((Reports) -> Unit)?,
    onMoveVisit: ((Reports) -> Unit)?,
    onDeleteVisit: ((Reports) -> Unit)?,
    onExportVisitQr: ((Reports) -> Unit)?,
    onRescanMessage: String?,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
    modifier: Modifier = Modifier,
) {
    val mostRecent = reports.maxByOrNull { it.interrogationDate }
    val tiles by produceTiles(repository, patientId, reports, reloadKey)
    var openTile by remember(patientId) { mutableStateOf<TrendTile?>(null) }
    val warning = parseManufacturerWarningStatus(patient.manufacturerWarningStatus)?.takeIf { it.status == "advisory" || it.status == "recall" }
    val daysSince = todayIso?.let { today -> mostRecent?.let { daysBetweenIsoDates(it.interrogationDate, today) } }

    Column(modifier.verticalScroll(rememberScrollState())) {
        OverviewHeader(
            patient = patient, mostRecent = mostRecent, reportCount = reports.size, latestDevice = latestDevice,
            todayIso = todayIso, warning = warning, onBack = onBack, onOpenUrl = onOpenUrl, onOpenPatientFolder = onOpenPatientFolder,
            onEditPatientInfo = onEditPatientInfo, onEditDeviceAndLeads = onEditDeviceAndLeads?.let { f -> { f(mostRecent) } },
            onExportLatestVisitQr = onExportLatestVisitQr,
        )

        Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            warning?.let { AdvisoryBanner(it, onOpenUrl) }
            if (hasBatteryConcern(reports)) ConcernBanner(reports)
            if (daysSince != null && daysSince > OVERDUE_DAYS) {
                Banner(Status.ATTENTION, tr("Follow-up overdue"), tr("The last interrogation was {n} days ago.", "n" to daysSince))
            }
            onRescanMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            if (tiles.isNotEmpty()) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val columns = if (maxWidth >= 640.dp) minOf(4, tiles.size) else 2
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        tiles.chunked(columns).forEach { rowTiles ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                                rowTiles.forEach { t -> Box(Modifier.weight(1f)) { TrendTileCard(t) { openTile = t } } }
                                repeat(columns - rowTiles.size) { Box(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }

            LeadsTable(repository, reports, latestLeads, deviceTypeAliases)

            var allTrends by remember(patientId) { mutableStateOf(false) }
            if (tiles.isNotEmpty()) {
                TextButton(onClick = { allTrends = !allTrends }) { Text(if (allTrends) tr("Hide all trends") else tr("Show all trends, every lead")) }
                if (allTrends) {
                    TrendChartBattery(reports)
                    LeadTrendSection(repository, patientId)
                }
            }

            onGetMergedAdditionalFields?.let { AdditionalDataCard(patientId, it) }

            SectionTitle(tr("Visits ({n})", "n" to reports.size))
            Column {
                reports.forEachIndexed { index, report ->
                    VisitRow(
                        report = report, patientId = patientId, latest = index == 0, onGetVisitFiles = onGetVisitFiles,
                        onClick = { onOpenVisit(report) },
                        onRescan = onRescanVisit?.let { f -> { f(report) } },
                        onMove = onMoveVisit?.let { f -> { f(report) } },
                        onDelete = onDeleteVisit?.let { f -> { f(report) } },
                        onEditDevice = onEditDeviceAndLeads?.let { f -> { f(report) } },
                        onQr = onExportVisitQr?.let { f -> { f(report) } },
                    )
                }
                if (reports.isEmpty()) Text(tr("No visits on record for this patient."), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 12.dp))
            }
        }
    }

    openTile?.let { tile ->
        AlertDialog(
            onDismissRequest = { openTile = null },
            confirmButton = { TextButton(onClick = { openTile = null }) { Text(tr("Close")) } },
            title = { Text(tile.label) },
            text = { TrendChart(tr("{n} readings", "n" to tile.points.size), tile.unit, tile.points) },
        )
    }
}

@Composable
private fun produceTiles(repository: KardiSynchRepository, patientId: String, reports: List<Reports>, reloadKey: Int) =
    androidx.compose.runtime.produceState(emptyList<TrendTile>(), patientId, reports, reloadKey) {
        val list = mutableListOf<TrendTile>()
        val battery = reports.filter { it.batteryVoltageValue != null }.sortedBy { it.interrogationDate }
            .map { TrendPoint(isoDateOnly(it.interrogationDate), it.batteryVoltageValue!!, it.deviceSerialNumber) }
        if (battery.isNotEmpty()) list += TrendTile(tr("Battery voltage"), reports.firstNotNullOfOrNull { it.batteryVoltageUnit } ?: "V", battery)

        val locations = repository.getLeadLocationsForPatient(patientId)
        fun pick(vararg hints: String) = locations.firstOrNull { l -> hints.any { l.contains(it, ignoreCase = true) } } ?: locations.firstOrNull()
        val ventricle = pick("RV", "ventric")
        val atrium = pick("RA", "atri")
        suspend fun series(location: String?) = location?.let { repository.getLeadTrendByLocation(patientId, it) }.orEmpty()
        val rv = series(ventricle)
        val ra = if (atrium == ventricle) rv else series(atrium)
        fun tile(label: String, loc: String?, pts: List<KardiSynchRepository.LeadTrendPoint>, value: (KardiSynchRepository.LeadTrendPoint) -> Double?, unit: (KardiSynchRepository.LeadTrendPoint) -> String?) {
            val points = pts.mapNotNull { p -> value(p)?.let { TrendPoint(isoDateOnly(p.interrogationDate), it, p.deviceSerialNumber, io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit(p)).pulseWidthMs) } }
            if (points.isNotEmpty()) list += TrendTile(listOfNotNull(loc, label).joinToString(" "), io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(pts.firstNotNullOfOrNull(unit)).unit, points)
        }
        tile(tr("impedance"), ventricle, rv, { it.impedanceValue }, { it.impedanceUnit })
        tile(tr("threshold"), ventricle, rv, { it.pacingThresholdValue }, { it.pacingThresholdUnit })
        tile(tr("sensing"), atrium, ra, { it.sensingValue }, { it.sensingUnit })
        value = list
    }

@Composable
private fun OverviewHeader(
    patient: Patients,
    mostRecent: Reports?,
    reportCount: Int,
    latestDevice: Devices?,
    todayIso: String?,
    warning: ManufacturerWarningStatus?,
    onBack: (() -> Unit)?,
    onOpenUrl: ((String) -> Unit)?,
    onOpenPatientFolder: (() -> Unit)?,
    onEditPatientInfo: (() -> Unit)?,
    onEditDeviceAndLeads: (() -> Unit)?,
    onExportLatestVisitQr: (() -> Unit)?,
) {
    val age = todayIso?.let { ageInYears(patient.dob, it) }
    var menu by remember { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = if (onBack != null) 8.dp else 24.dp, end = 12.dp, top = 8.dp, bottom = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("Back to patients")) }
                Box(Modifier.weight(1f))
                if (onExportLatestVisitQr != null) IconButton(onClick = onExportLatestVisitQr) { Icon(Icons.Filled.QrCode2, contentDescription = tr("Export the latest visit as a QR code")) }
                if (onEditPatientInfo != null || onEditDeviceAndLeads != null || onOpenPatientFolder != null) {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Edit, contentDescription = tr("Edit patient, device and leads, open folder")) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            onEditPatientInfo?.let { DropdownMenuItem(text = { Text(tr("Edit patient info")) }, onClick = { menu = false; it() }) }
                            onEditDeviceAndLeads?.let { DropdownMenuItem(text = { Text(tr("Edit device and leads")) }, onClick = { menu = false; it() }) }
                            onOpenPatientFolder?.let { DropdownMenuItem(text = { Text(tr("Open patient folder")) }, onClick = { menu = false; it() }) }
                        }
                    }
                }
            }
            Column(Modifier.padding(start = if (onBack != null) 16.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${patient.lastName}, ${patient.firstName.orEmpty()}".trim().trimEnd(','), style = MaterialTheme.typography.headlineMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    PlainChip(tr("Born {date}", "date" to displayDate(patient.dob)) + (age?.let { " · " + tr("{n} y", "n" to it) } ?: ""))
                    patient.hospitalPatientId?.takeIf { it.isNotBlank() }?.let { PlainChip(tr("MRN {id}", "id" to it)) }
                    PlainChip(trn(reportCount, "{n} visit", "{n} visits"))
                    if (onOpenUrl != null) mriCheckUrl(mostRecent?.manufacturer)?.let { url ->
                        Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.clickable { onOpenUrl(url) }) {
                            Text(tr("Check MRI status"), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp), color = MaterialTheme.colorScheme.primary)
                        }
                    }
                    if (warning != null) StatusChip(if (warning.status == "recall") tr("Recall") else tr("Advisory"), Status.ALERT)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    mostRecent?.manufacturer?.let { ManufacturerWordmark(it) }
                    val model = latestDevice?.model ?: mostRecent?.deviceModel
                    Text(model ?: tr("No device recorded"), style = MaterialTheme.typography.titleSmall)
                    Text(
                        listOfNotNull(
                            (latestDevice?.serialNumber ?: mostRecent?.deviceSerialNumber)?.let { tr("SN {sn}", "sn" to it) },
                            latestDevice?.implantDate?.takeIf { it.isNotBlank() }?.let { tr("implanted {date}", "date" to displayDate(it)) },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Column {
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 6.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}

@Composable
private fun Banner(status: Status, title: String, body: String) {
    val palette = statusColors()
    Surface(shape = RoundedCornerShape(16.dp), color = palette.container(status), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(status.icon, contentDescription = status.label, tint = palette.content(status), modifier = Modifier.size(24.dp))
            Text(buildAnnotated(title, body), style = MaterialTheme.typography.bodyMedium, color = palette.content(status))
        }
    }
}

private fun buildAnnotated(title: String, body: String) = androidx.compose.ui.text.buildAnnotatedString {
    pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Medium)); append("$title. "); pop(); append(body)
}

@Composable
private fun AdvisoryBanner(warning: ManufacturerWarningStatus, onOpenUrl: ((String) -> Unit)?) {
    val palette = statusColors()
    Surface(shape = RoundedCornerShape(16.dp), color = palette.alertContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Status.ALERT.icon, contentDescription = tr("Advisory"), tint = palette.onAlert, modifier = Modifier.size(24.dp))
            Column(Modifier.weight(1f)) {
                Text(if (warning.status == "recall") tr("Manufacturer recall posted") else tr("Manufacturer advisory posted"), style = MaterialTheme.typography.titleSmall, color = palette.onAlert)
                if (warning.details.isNotBlank()) Text(warning.details, style = MaterialTheme.typography.bodyMedium, color = palette.onAlert)
            }
            val link = warning.link
            if (link != null && onOpenUrl != null) TextButton(onClick = { onOpenUrl(link) }) { Text(tr("View details"), color = palette.onAlert) }
        }
    }
}

@Composable
private fun TrendTileCard(tile: TrendTile, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().clickable(onClickLabel = "Open the full ${tile.label} chart", onClick = onClick)) {
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(tile.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(formatNumber(tile.latest), style = MaterialTheme.typography.headlineSmall)
                Text(tile.unit + (tile.latestPulseWidthMs?.let { " @ ${displayNumber(it)} ms" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 3.dp))
            }
            Sparkline(tile.points.takeLast(8).map { it.value }, Modifier.fillMaxWidth().height(40.dp).padding(vertical = 4.dp))
            Text(tile.deltaText, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
internal fun Sparkline(values: List<Double>, modifier: Modifier = Modifier) {
    val line = MaterialTheme.colorScheme.primary
    val base = MaterialTheme.colorScheme.outlineVariant
    val ring = MaterialTheme.colorScheme.surfaceContainer
    Canvas(modifier) {
        drawLine(base, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1f)
        if (values.size < 2) return@Canvas
        val min = values.min(); val span = (values.max() - min).takeIf { it > 0.0 } ?: 1.0
        val pad = 4.dp.toPx()
        val pts = values.mapIndexed { i, v ->
            Offset(pad + (size.width - 2 * pad) * i / (values.size - 1), (size.height - pad) - ((v - min) / span).toFloat() * (size.height - 2 * pad))
        }
        val path = androidx.compose.ui.graphics.Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) } }
        drawPath(path, line, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawCircle(ring, radius = 5.5.dp.toPx(), center = pts.last())
        drawCircle(line, radius = 3.5.dp.toPx(), center = pts.last())
    }
}

@Composable
private fun LeadsTable(repository: KardiSynchRepository, reports: List<Reports>, latestLeads: List<Leads>?, aliases: List<DeviceTypeAlias>) {
    val leads = latestLeads.orEmpty()
    if (leads.isEmpty()) return
    val latest = reports.maxByOrNull { it.interrogationDate }
    val previous = reports.filter { it.id != latest?.id }.maxByOrNull { it.interrogationDate }
    var previousLeads by remember(previous?.id) { mutableStateOf<List<Leads>>(emptyList()) }
    LaunchedEffect(previous?.id) { previousLeads = previous?.let { repository.getLeadsForReport(it.id) }.orEmpty() }

    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val compact = maxWidth < 600.dp
    Column {
        SectionTitle(tr("Leads"))
        TableRow(if (compact) listOf(tr("LEAD"), tr("IMP."), tr("THRESH."), tr("AMPL."), tr("SENS.")) else listOf(tr("LEAD"), tr("IMPEDANCE"), tr("THRESHOLD"), tr("STIM. AMPLITUDE"), tr("SENSING"), tr("SINCE LAST VISIT")), header = true)
        leads.forEach { l ->
            val before = previousLeads.firstOrNull { it.anatomicLocation != null && it.anatomicLocation == l.anatomicLocation }
            fun value(v: Double?, unit: String?) = v?.let { displayValueWithUnit(it, unit) } ?: tr("n/a")
            val changes = listOfNotNull(
                delta(tr("Impedance"), l.impedanceValue, before?.impedanceValue, l.impedanceUnit),
                delta(tr("Threshold"), l.pacingThresholdValue, before?.pacingThresholdValue, l.pacingThresholdUnit, before?.pacingThresholdUnit),
                delta(tr("Sensing"), l.sensingValue, before?.sensingValue, l.sensingUnit),
            )
            val flag = getConnectorFlag(l.manufacturer, l.model, aliases)
            val cells = listOf(
                    listOfNotNull(l.anatomicLocation, l.model ?: l.name).joinToString(" · ") + (flag?.let { "  (${if (it.connector == "IS-1") "IS-1 in LV port" else it.connector}${if (it.confirmed) "" else "?"})" } ?: ""),
                    value(l.impedanceValue, l.impedanceUnit),
                    value(l.pacingThresholdValue, l.pacingThresholdUnit),
                    value(l.pacingAmplitudeValue, l.pacingAmplitudeUnit),
                    value(l.sensingValue, l.sensingUnit),
                    if (previous == null) tr("First visit") else changes.firstOrNull() ?: tr("No change"),
                )
            TableRow(if (compact) cells.dropLast(1) else cells)
        }
    }
    }
}

private fun delta(name: String, now: Double?, before: Double?, unit: String?, beforeUnit: String? = unit): String? {
    if (now == null || before == null) return null
    // Measured at a different pulse width the two values are not comparable: no change is claimed.
    val pw = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit).pulseWidthMs
    val pwBefore = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(beforeUnit).pulseWidthMs
    if (pw != null && pwBefore != null && pw != pwBefore) return null
    val d = now - before
    if (kotlin.math.abs(d) < 1e-9) return null
    return "$name ${if (d > 0) "+" else "−"}${formatNumber(kotlin.math.abs(d))}${io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit).unit.let { if (it.isEmpty()) "" else " $it" }}"
}

@Composable
internal fun TableRow(cells: List<String>, header: Boolean = false) {
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = if (header) 6.dp else 9.dp), verticalAlignment = Alignment.CenterVertically) {
            cells.forEachIndexed { i, text ->
                Text(
                    text, modifier = Modifier.weight(if (i == 0) 1.3f else 1f).padding(end = 8.dp),
                    style = if (header) MaterialTheme.typography.labelMedium else MaterialTheme.typography.bodyMedium,
                    fontWeight = if (!header && i == 0) FontWeight.Medium else null,
                    color = if (header || i == cells.lastIndex) MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified,
                )
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}

@Composable
private fun VisitRow(
    report: Reports,
    patientId: String,
    latest: Boolean,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onClick: () -> Unit,
    onRescan: (() -> Unit)?,
    onMove: (() -> Unit)?,
    onDelete: (() -> Unit)?,
    onEditDevice: (() -> Unit)?,
    onQr: (() -> Unit)?,
) {
    val files = rememberVisitFiles(patientId, report.id, onGetVisitFiles)
    var menu by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.Description, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(displayDate(report.interrogationDate), style = MaterialTheme.typography.titleSmall)
                Text(report.manufacturer ?: tr("Unknown manufacturer"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            VisitFileChips(files)
            if (latest) Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Text(tr("Latest"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
            }
            if (onRescan != null || onMove != null || onDelete != null || onEditDevice != null || onQr != null) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = tr("More options for this visit")) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        onRescan?.let { DropdownMenuItem(text = { Text(tr("Rescan")) }, onClick = { menu = false; it() }) }
                        onEditDevice?.let { DropdownMenuItem(text = { Text(tr("Edit device and leads")) }, onClick = { menu = false; it() }) }
                        onMove?.let { DropdownMenuItem(text = { Text(tr("Move to another patient")) }, onClick = { menu = false; it() }) }
                        onQr?.let { DropdownMenuItem(text = { Text(tr("Export QR")) }, onClick = { menu = false; it() }) }
                        onDelete?.let { DropdownMenuItem(text = { Text(tr("Delete")) }, onClick = { menu = false; it() }) }
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}

@Composable
private fun TrendChartBattery(reports: List<Reports>) {
    val points = reports.filter { it.batteryVoltageValue != null }.sortedBy { it.interrogationDate }
        .map { TrendPoint(isoDateOnly(it.interrogationDate), it.batteryVoltageValue!!, it.deviceSerialNumber) }
    TrendChart(tr("Battery voltage trend"), reports.firstNotNullOfOrNull { it.batteryVoltageUnit } ?: "V", points)
}
