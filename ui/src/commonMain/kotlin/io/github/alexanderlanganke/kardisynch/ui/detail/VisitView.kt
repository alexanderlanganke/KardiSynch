package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.ui.format.displayNumber
import io.github.alexanderlanganke.kardisynch.ui.format.displayValueWithUnit
import io.github.alexanderlanganke.kardisynch.ui.format.displayUnit
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.util.formatDelta
import io.github.alexanderlanganke.kardisynch.core.util.isCriticalBatteryStatus
import io.github.alexanderlanganke.kardisynch.core.util.isoDateOnly
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors

/** Which view of a visit a pane shows. */
internal enum class PaneMode(private val en: String) { FORMATTED("Formatted"), RAW("Raw file"), PDF("PDF");
    val label: String get() = tr(en)
}

/** Remembered per person, not per visit: the last choice for each pane. */
private const val SETTING_LEFT = "visit_pane_left"
private const val SETTING_RIGHT = "visit_pane_right"

/** One visit on its own page. Opens on Formatted; a split pane (Formatted left, PDF right) is one tap away. */
@Composable
internal fun VisitView(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    patientName: String,
    report: Reports,
    onBack: () -> Unit,
    onRescan: ((Reports) -> Unit)?,
    onMove: ((Reports) -> Unit)?,
    onDelete: ((Reports) -> Unit)?,
    onEditDevice: ((Reports) -> Unit)?,
    onQr: ((Reports) -> Unit)?,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
    modifier: Modifier = Modifier,
) {
    var split by remember(patientId) { mutableStateOf(false) }
    var leftMode by remember(patientId) { mutableStateOf<PaneMode?>(null) }
    var rightMode by remember(patientId) { mutableStateOf<PaneMode?>(null) }
    var rightVisitId by remember(report.id) { mutableStateOf(report.id) }
    var preSplitMode by remember(patientId) { mutableStateOf<PaneMode?>(null) }
    var linked by remember(patientId) { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    val sharedScroll = rememberScrollState()

    // The last choice a person made for each pane, restored when no explicit choice has been made yet.
    LaunchedEffect(patientId) {
        leftMode = leftMode ?: repository.getSetting(SETTING_LEFT)?.let { s -> PaneMode.entries.firstOrNull { it.name == s } }
        rightMode = rightMode ?: repository.getSetting(SETTING_RIGHT)?.let { s -> PaneMode.entries.firstOrNull { it.name == s } }
    }
    LaunchedEffect(leftMode) { leftMode?.let { repository.setSetting(SETTING_LEFT, it.name) } }
    LaunchedEffect(rightMode) { rightMode?.let { repository.setSetting(SETTING_RIGHT, it.name) } }

    val files = rememberVisitFiles(patientId, report.id, onGetVisitFiles)
    val other = reports.firstOrNull { it.id == rightVisitId } ?: report

    androidx.compose.foundation.layout.BoxWithConstraints(modifier.fillMaxSize()) {
    val compact = maxWidth < 700.dp
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.padding(4.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("Back to the patient overview")) }
            Column(Modifier.weight(1f)) {
                Text(if (compact) tr("Visit {date}", "date" to displayDate(report.interrogationDate)) else "$patientName · " + tr("Visit {date}", "date" to displayDate(report.interrogationDate)), style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(if (compact) patientName else null, report.deviceModel, report.manufacturer).joinToString(" · ").ifEmpty { tr("Unknown device") },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            if (!compact) Box(Modifier.padding(end = 8.dp)) { VisitFileChips(files) }
            if (!split && !compact) {
                ModeSwitch(leftMode ?: autoMode(files)) { leftMode = it }
            }
            if (split && other.id != report.id) {
                IconButton(onClick = { linked = !linked }) {
                    Icon(if (linked) Icons.Filled.Link else Icons.Filled.LinkOff, contentDescription = if (linked) tr("Scrolling is linked; tap to unlink") else tr("Scrolling is separate; tap to link"))
                }
            }
            IconButton(onClick = {
                split = !split
                if (split) {
                    // Comparing means looking at the documents: both panes open on the PDF, the right one on the previous visit.
                    preSplitMode = leftMode
                    leftMode = PaneMode.PDF
                    rightMode = PaneMode.PDF
                    val sorted = reports.sortedByDescending { it.interrogationDate }
                    val i = sorted.indexOfFirst { it.id == report.id }
                    sorted.getOrNull(i + 1)?.let { rightVisitId = it.id }
                } else {
                    leftMode = preSplitMode
                }
            }) {
                Icon(Icons.Filled.ViewColumn, contentDescription = if (split) tr("Close the split view") else tr("Open the split view"), tint = if (split) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (onRescan != null || onMove != null || onDelete != null || onEditDevice != null || onQr != null) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = tr("More options")) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        onRescan?.let { DropdownMenuItem(text = { Text(tr("Rescan this visit")) }, onClick = { menu = false; it(report) }) }
                        onEditDevice?.let { DropdownMenuItem(text = { Text(tr("Edit device and leads")) }, onClick = { menu = false; it(report) }) }
                        onMove?.let { DropdownMenuItem(text = { Text(tr("Move to another patient")) }, onClick = { menu = false; it(report) }) }
                        onQr?.let { DropdownMenuItem(text = { Text(tr("Export QR")) }, onClick = { menu = false; it(report) }) }
                        onDelete?.let { DropdownMenuItem(text = { Text(tr("Delete this visit")) }, onClick = { menu = false; it(report) }) }
                    }
                }
            }
        }
        if (compact) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!split) ModeSwitch(leftMode ?: autoMode(files)) { leftMode = it }
                VisitFileChips(files)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (!split) {
                VisitPaneBody(repository, reports, patientId, report, leftMode ?: autoMode(files), files, onReadVisitFileBytes, onReadVisitFileText)
            } else {
                CompositionLocalProvider(LocalSharedPdfScroll provides (if (linked && other.id != report.id) sharedScroll else null)) {
                    val left: @Composable (Modifier) -> Unit = { m ->
                        PaneColumn(
                            m, repository, reports, patientId, report, leftMode ?: PaneMode.FORMATTED, { leftMode = it },
                            onPickVisit = {}, pickable = false,
                            onGetVisitFiles, onReadVisitFileBytes, onReadVisitFileText,
                        )
                    }
                    val right: @Composable (Modifier) -> Unit = { m ->
                        PaneColumn(
                            m, repository, reports, patientId, other, rightMode ?: PaneMode.PDF, { rightMode = it },
                            onPickVisit = { rightVisitId = it.id }, pickable = true,
                            onGetVisitFiles, onReadVisitFileBytes, onReadVisitFileText,
                        )
                    }
                    val divider = MaterialTheme.colorScheme.outlineVariant
                    if (compact) {
                        Column(Modifier.fillMaxSize()) {
                            left(Modifier.weight(1f))
                            Box(Modifier.fillMaxWidth().height(1.dp).background(divider))
                            right(Modifier.weight(1f))
                        }
                    } else {
                        Row(Modifier.fillMaxSize()) {
                            left(Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(divider))
                            right(Modifier.weight(1f))
                        }
                    }
                }
            }
        }

        if (split && other.id != report.id) {
            VisitChangesStrip(
                repository = repository, reports = reports,
                selections = listOf(PaneSelection.Visit(report.id), PaneSelection.Visit(other.id)),
                scrollTogether = linked, onScrollTogetherChange = { linked = it },
            )
        }
    }
    }
}

private fun autoMode(files: VisitFileSet?): PaneMode =
    if (files != null && files.raws.isEmpty() && files.pdfs.isNotEmpty()) PaneMode.PDF else PaneMode.FORMATTED

@Composable
private fun ModeSwitch(selected: PaneMode, onSelect: (PaneMode) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.padding(end = 4.dp)) {
        PaneMode.entries.forEachIndexed { index, mode ->
            SegmentedButton(
                selected = selected == mode, onClick = { onSelect(mode) },
                shape = SegmentedButtonDefaults.itemShape(index, PaneMode.entries.size),
                icon = { SegmentedButtonDefaults.Icon(active = selected == mode) },
            ) { Text(mode.label, maxLines = 1) }
        }
    }
}

@Composable
private fun PaneColumn(
    modifier: Modifier,
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    report: Reports,
    mode: PaneMode,
    onModeChange: (PaneMode) -> Unit,
    onPickVisit: (Reports) -> Unit,
    pickable: Boolean,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
) {
    val files = rememberVisitFiles(patientId, report.id, onGetVisitFiles)
    var pick by remember { mutableStateOf(false) }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModeSwitch(mode, onModeChange)
            Box(Modifier.weight(1f))
            if (pickable) {
                Box {
                    OutlinedButton(onClick = { pick = true }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) { Text(tr("Compare {date}", "date" to displayDate(report.interrogationDate)) + " ▾", maxLines = 1) }
                    DropdownMenu(expanded = pick, onDismissRequest = { pick = false }) {
                        reports.forEach { r ->
                            DropdownMenuItem(text = { Text("${displayDate(r.interrogationDate)} · ${r.manufacturer ?: tr("Unknown")}") }, onClick = { pick = false; onPickVisit(r) })
                        }
                    }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            VisitPaneBody(repository, reports, patientId, report, mode, files, onReadVisitFileBytes, onReadVisitFileText)
        }
    }
}

@Composable
private fun VisitPaneBody(
    repository: KardiSynchRepository,
    reports: List<Reports>,
    patientId: String,
    report: Reports,
    mode: PaneMode,
    files: VisitFileSet?,
    onReadBytes: (suspend (String) -> ByteArray?)?,
    onReadText: (suspend (String) -> String?)?,
) {
    when (mode) {
        PaneMode.FORMATTED -> {
            val sorted = reports.sortedByDescending { it.interrogationDate }
            val idx = sorted.indexOfFirst { it.id == report.id }
            FormattedVisit(repository, report, if (idx >= 0) sorted.getOrNull(idx + 1) else null)
        }
        PaneMode.RAW, PaneMode.PDF -> {
            val list = if (mode == PaneMode.PDF) files?.pdfs else files?.raws
            when {
                files == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { androidx.compose.material3.CircularProgressIndicator() }
                onReadBytes == null || onReadText == null -> MissingFile(tr("Files can't be shown here"), tr("This build has no access to the report files."), null)
                list.isNullOrEmpty() && mode == PaneMode.PDF -> MissingFile(
                    tr("No PDF for this visit"),
                    if (files.raws.isNotEmpty()) tr("The raw file is here, but no PDF report was filed with it. A PDF that arrives later is attached automatically when its serial number and day match; one waiting in the inbox is offered there.")
                    else tr("This visit holds no PDF."),
                    tr("The parsed values are on the Formatted tab."),
                )
                list.isNullOrEmpty() -> MissingFile(tr("No raw file for this visit"), "Only a PDF was filed. The values on the Formatted tab were read from its text.", "The parsed values are on the Formatted tab.")
                else -> Box(Modifier.fillMaxSize().padding(horizontal = 12.dp)) { RawFileViewer(list, onReadBytes, onReadText) }
            }
        }
    }
}

@Composable
private fun MissingFile(title: String, body: String, action: String?) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.TopCenter) {
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(title, Status.ATTENTION)
                Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (action != null) Text(action, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** A visit's values as tables: the battery, the device and each lead with its change since the previous visit. */
@Composable
internal fun FormattedVisit(repository: KardiSynchRepository, report: Reports, previous: Reports?) {
    var devices by remember(report.id) { mutableStateOf<List<Devices>?>(null) }
    var leads by remember(report.id) { mutableStateOf<List<Leads>?>(null) }
    var previousLeads by remember(report.id) { mutableStateOf<List<Leads>>(emptyList()) }
    LaunchedEffect(report.id, previous?.id) {
        devices = repository.getDevicesForReport(report.id)
        leads = repository.getLeadsForReport(report.id)
        previousLeads = previous?.let { repository.getLeadsForReport(it.id) }.orEmpty()
    }
    val palette = statusColors()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val voltage = formatDelta(report.batteryVoltageValue, previous?.batteryVoltageValue, report.batteryVoltageUnit.orEmpty(), tr("Battery"))
        val status = report.batteryStatus?.takeIf { it.isNotBlank() }
        if (status != null && isCriticalBatteryStatus(status)) {
            Surface(shape = RoundedCornerShape(12.dp), color = palette.attentionContainer, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Status.ATTENTION.icon, contentDescription = tr("Needs attention"), tint = palette.onAttention, modifier = Modifier.size(20.dp))
                    Text(tr("Battery status: {status}.", "status" to status) + (voltage?.let { " $it" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = palette.onAttention, fontWeight = FontWeight.Medium)
                }
            }
        }

        Section(tr("Device")) {
            val d = devices?.firstOrNull()
            KeyValue(tr("Model"), d?.model ?: report.deviceModel ?: "Unknown")
            KeyValue(tr("Manufacturer"), report.manufacturer ?: "Unknown")
            (d?.serialNumber ?: report.deviceSerialNumber)?.let { KeyValue(tr("Serial"), it) }
            d?.type?.takeIf { it.isNotBlank() }?.let { KeyValue(tr("Type"), it) }
            if (voltage != null || status != null) KeyValue(tr("Battery"), listOfNotNull(voltage?.removePrefix(tr("Battery") + ": "), status?.let { tr("status {s}", "s" to it) }).joinToString(" · "))
        }

        val currentLeads = leads.orEmpty()
        if (currentLeads.isNotEmpty()) {
            Section(tr("Leads")) {
                TableRow(listOf(tr("LEAD"), tr("IMP."), tr("THRESH."), tr("STIM. AMPL."), tr("SENS.")), header = true)
                currentLeads.forEach { l ->
                    val before = previousLeads.firstOrNull { it.anatomicLocation != null && it.anatomicLocation == l.anatomicLocation }
                    fun cell(v: Double?, p: Double?, unit: String?, beforeUnit: String? = unit): String {
                        if (v == null) return tr("n/a")
                        val pw = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(unit).pulseWidthMs
                        val pwBefore = io.github.alexanderlanganke.kardisynch.core.util.splitPulseUnit(beforeUnit).pulseWidthMs
                        val comparable = pw == null || pwBefore == null || pw == pwBefore
                        val change = if (comparable && p != null && kotlin.math.abs(v - p) > 1e-9) "  ${if (v > p) "+" else "−"}${formatNumber(kotlin.math.abs(v - p))}" else ""
                        return displayValueWithUnit(v, unit) + change
                    }
                    TableRow(listOf(l.anatomicLocation ?: l.name, cell(l.impedanceValue, before?.impedanceValue, l.impedanceUnit), cell(l.pacingThresholdValue, before?.pacingThresholdValue, l.pacingThresholdUnit, before?.pacingThresholdUnit), cell(l.pacingAmplitudeValue, before?.pacingAmplitudeValue, l.pacingAmplitudeUnit, before?.pacingAmplitudeUnit), cell(l.sensingValue, before?.sensingValue, l.sensingUnit)))
                }
                if (previous != null) Text(tr("Changes are against the visit of {date}.", "date" to displayDate(previous.interrogationDate)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        }

        if (report.afBurdenValue != null || report.vtEpisodes != null) {
            Section(tr("Arrhythmia summary")) {
                report.afBurdenValue?.let { KeyValue(tr("AF burden"), "${displayNumber(it)} ${report.afBurdenUnit.orEmpty()}".trim()) }
                report.vtEpisodes?.let { KeyValue(tr("VT episodes"), "$it") }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(bottom = 4.dp))
        content()
    }
}

@Composable
private fun KeyValue(key: String, value: String) {
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Text(key, Modifier.weight(0.4f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, Modifier.weight(0.6f), style = MaterialTheme.typography.bodyMedium)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}
