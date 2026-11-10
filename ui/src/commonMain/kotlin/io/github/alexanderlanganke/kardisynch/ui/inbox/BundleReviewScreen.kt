package io.github.alexanderlanganke.kardisynch.ui.inbox

import io.github.alexanderlanganke.kardisynch.core.i18n.trn
import io.github.alexanderlanganke.kardisynch.ui.format.displayDate
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clip
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.ui.detail.RawFileViewer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.intake.DocumentFacts
import io.github.alexanderlanganke.kardisynch.core.intake.EvidenceStrength
import io.github.alexanderlanganke.kardisynch.core.intake.FactAgreement
import io.github.alexanderlanganke.kardisynch.core.intake.compareFacts
import io.github.alexanderlanganke.kardisynch.core.intake.parseEvidence
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Patients
import io.github.alexanderlanganke.kardisynch.data.db.PendingSortTasks
import io.github.alexanderlanganke.kardisynch.ui.picker.PatientPickerDialog
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors

/**
 * Reviews one bundle (the queued files of one interrogation): how each file was
 * identified and why, what the files say about the patient next to what is on
 * file, and who to assign the whole bundle to. [onAssign] acts on every file of
 * the bundle at once, structured files first, so a PDF merges into the visit of
 * the file it belongs with. Creating a new patient or typing device details by
 * hand stays in the per-file sorter ([onOpenFileSorter]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BundleReviewScreen(
    repository: KardiSynchRepository,
    bundleKey: String,
    refreshKey: Any,
    onBack: () -> Unit,
    onAssign: (bundleId: String?, allTaskIds: List<String>, assignments: List<Pair<String, String>>) -> Unit,
    onDismiss: (bundleId: String?, taskIds: List<String>) -> Unit,
    onOpenFileSorter: () -> Unit,
    /** Read a queued (staged) file, so each card can show what is inside it. Null hides the preview. */
    onReadFileBytes: (suspend (stagedFilePath: String) -> ByteArray?)? = null,
    onReadFileText: (suspend (stagedFilePath: String) -> String?)? = null,
) {
    var tasks by remember(bundleKey) { mutableStateOf<List<PendingSortTasks>?>(null) }
    LaunchedEffect(bundleKey, refreshKey) {
        tasks = groupQueue(repository.getPendingSortTasks()).firstOrNull { it.key == bundleKey }?.tasks.orEmpty()
    }
    val list = tasks
    val bundleId = list?.firstOrNull()?.bundleId

    var suggested by remember(bundleKey) { mutableStateOf<Patients?>(null) }
    var chosen by remember(bundleKey) { mutableStateOf<Patients?>(null) }
    var useChosen by remember(bundleKey) { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var pickedId by remember(bundleKey) { mutableStateOf<String?>(null) }
    LaunchedEffect(pickedId) {
        val id = pickedId ?: return@LaunchedEffect
        chosen = repository.getPatientById(id)
        useChosen = chosen != null
    }
    // Per-file decisions that differ from the bundle's patient: a patient, or LATER (leave queued).
    var overrides by remember(bundleKey) { mutableStateOf<Map<String, FileTarget>>(emptyMap()) }
    var pickingForFile by remember { mutableStateOf<String?>(null) }
    var pickedForFile by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(pickedForFile) {
        val (taskId, patientId) = pickedForFile ?: return@LaunchedEffect
        repository.getPatientById(patientId)?.let { p -> overrides = overrides + (taskId to FileTarget.Patient(p)) }
    }
    LaunchedEffect(list) {
        val id = list?.firstNotNullOfOrNull { it.suggestedPatientId }
        suggested = id?.let { repository.getPatientById(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tr("Review bundle")) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("Back to the inbox")) } },
            )
        },
    ) { padding ->
        when {
            list == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            list.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(tr("This bundle has been dealt with."), style = MaterialTheme.typography.bodyLarge)
                    TextButton(onClick = onBack) { Text(tr("Back to the inbox")) }
                }
            }
            else -> {
                val target = if (useChosen) chosen else suggested
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.widthIn(max = 1000.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Section(tr("Files in this bundle ({n})", "n" to list.size)) {
                        Text(
                            if (list.size == 1) tr("One file. Choose who it belongs to below.")
                            else tr("These {n} files arrived together. By default they all go to the patient chosen below, but each file can be sent to a different patient, or left for later, with its own button.", "n" to list.size),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        list.forEachIndexed { index, task ->
                            FileCard(
                                number = index + 1, task = task, bundlePatient = target, override = overrides[task.id],
                                onChange = { pickingForFile = task.id },
                                onLater = { overrides = overrides + (task.id to FileTarget.Later) },
                                onFollowBundle = { overrides = overrides - task.id },
                                onReadBytes = onReadFileBytes, onReadText = onReadFileText,
                            )
                        }
                    }
                    Section(tr("What the files say about the patient")) { FactsTable(list, suggested) }
                    Section(if (list.size > 1) tr("Default patient for the files") else tr("Assign to")) {
                        PatientOption(
                            selected = !useChosen && suggested != null, enabled = suggested != null,
                            title = suggested?.let { "${it.lastName}, ${it.firstName.orEmpty()}" } ?: tr("No suggestion"),
                            subtitle = suggested?.let { tr("Born {date}", "date" to displayDate(it.dob)) + (it.hospitalPatientId?.let { id -> " · " + tr("MRN {id}", "id" to id) } ?: "") } ?: tr("Nothing on file matched well enough."),
                            onSelect = { useChosen = false },
                        )
                        PatientOption(
                            selected = useChosen && chosen != null, enabled = true,
                            title = chosen?.let { "${it.lastName}, ${it.firstName.orEmpty()}" } ?: tr("Choose another patient"),
                            subtitle = chosen?.let { tr("Born {date}", "date" to displayDate(it.dob)) } ?: tr("Search the patients on file"),
                            onSelect = { picking = true },
                        )
                        Text(
                            summarise(list, overrides, target),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        val assignments = resolveAssignments(list, overrides, target)
                        Button(enabled = assignments.isNotEmpty(), onClick = { onAssign(bundleId, list.map { t -> t.id }, assignments) }) {
                            Text(if (assignments.size == list.size) (if (list.size == 1) tr("Import file") else tr("Import all {n} files", "n" to list.size)) else tr("Import {a} of {b} files", "a" to assignments.size, "b" to list.size))
                        }
                        OutlinedButton(onClick = onBack) { Text(tr("Skip for now")) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = onOpenFileSorter) { Text(tr("Create a new patient or enter details…")) }
                        TextButton(onClick = { onDismiss(bundleId, list.map { t -> t.id }) }) { Text(tr("Dismiss bundle")) }
                    }
                }
                }
            }
        }
    }

    pickingForFile?.let { taskId ->
        PatientPickerDialog(
            repository = repository, title = tr("Which patient does this file belong to?"),
            onDismiss = { pickingForFile = null },
            onPicked = { id ->
                pickingForFile = null
                pickedForFile = taskId to id
            },
        )
    }

    if (picking) {
        PatientPickerDialog(
            repository = repository, title = tr("Assign this bundle to which patient?"),
            onDismiss = { picking = false },
            onPicked = { id ->
                picking = false
                pickedId = id
            },
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

/** Where one file of a bundle goes when the user imports. */
private sealed interface FileTarget {
    data class Patient(val patient: Patients) : FileTarget
    data object Later : FileTarget
}

private fun name(p: Patients) = "${p.lastName}, ${p.firstName.orEmpty()}".trim().trimEnd(',')

/** The file-to-patient pairs that an import would carry out now; files left for later are omitted. */
private fun resolveAssignments(tasks: List<PendingSortTasks>, overrides: Map<String, FileTarget>, bundlePatient: Patients?): List<Pair<String, String>> =
    tasks.mapNotNull { t ->
        when (val o = overrides[t.id]) {
            is FileTarget.Patient -> t.id to o.patient.id
            FileTarget.Later -> null
            null -> bundlePatient?.let { t.id to it.id }
        }
    }

private fun summarise(tasks: List<PendingSortTasks>, overrides: Map<String, FileTarget>, bundlePatient: Patients?): String {
    val byId = tasks.associateBy { it.id }
    val assignments = resolveAssignments(tasks, overrides, bundlePatient)
    if (assignments.isEmpty()) return tr("Pick a patient to continue.")
    val patients = (overrides.values.filterIsInstance<FileTarget.Patient>().map { it.patient } + listOfNotNull(bundlePatient)).associateBy { it.id }
    val parts = assignments.groupBy({ it.second }, { byId.getValue(it.first) }).map { (pid, files) ->
        trn(files.size, "{n} file to {who}", "{n} files to {who}").replace("{who}", patients[pid]?.let(::name) ?: tr("the chosen patient"))
    }
    val later = tasks.size - assignments.size
    return tr("Imports") + " " + parts.joinToString(", ") + if (later > 0) "; " + tr("{n} left in the inbox.", "n" to later) else "."
}

@Composable
private fun FileCard(
    number: Int,
    task: PendingSortTasks,
    bundlePatient: Patients?,
    override: FileTarget?,
    onChange: () -> Unit,
    onLater: () -> Unit,
    onFollowBundle: () -> Unit,
    onReadBytes: (suspend (String) -> ByteArray?)?,
    onReadText: (suspend (String) -> String?)?,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr("File {n}", "n" to number) + " · ${task.originalFileName}", style = MaterialTheme.typography.titleSmall)
            KindChip(task.originalFileName, task.fileKind, task.confidence?.toInt())
            val says = listOfNotNull(
                listOfNotNull(task.patientLastName, task.patientFirstName).joinToString(", ").ifEmpty { null }?.let { tr("Name: {v}", "v" to it) },
                task.patientDob?.let { tr("Born {date}", "date" to displayDate(it)) }, task.deviceSerial?.let { tr("Serial {v}", "v" to it) },
            )
            Text(
                if (says.isEmpty()) tr("This file does not name a patient.") else tr("The file says:") + " " + says.joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
            )
            // What is actually in the file, so it can be compared with the patient it is being matched to.
            if (onReadBytes != null && onReadText != null) {
                var showContents by remember(task.id) { mutableStateOf(true) }
                TextButton(onClick = { showContents = !showContents }) { Text(if (showContents) tr("Hide contents") else tr("Show contents")) }
                if (showContents) {
                    // Fixed height: the page itself scrolls, and a PDF scrolls inside this frame.
                    // A PDF needs room to read; a short text file should not leave a tall empty frame.
                    val isPdf = task.originalFileName.endsWith(".pdf", ignoreCase = true)
                    Box((if (isPdf) Modifier.fillMaxWidth().height(560.dp) else Modifier.fillMaxWidth().heightIn(max = 240.dp)).clip(RoundedCornerShape(10.dp))) {
                        RawFileViewer(listOf(DataEntry(task.originalFileName, task.stagedFilePath, false)), onReadBytes, onReadText)
                    }
                }
            }
            val evidence = parseEvidence(task.evidence)
            if (evidence.isEmpty()) {
                Text(tr("No detection details were recorded for this file."), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            evidence.forEach { e ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                    val palette = statusColors()
                    when (e.strength) {
                        EvidenceStrength.STRONG -> Icon(Icons.Filled.CheckCircle, contentDescription = tr("Evidence for"), tint = palette.onOk, modifier = Modifier.size(18.dp))
                        EvidenceStrength.WEAK -> Icon(Icons.Filled.Info, contentDescription = tr("Weak evidence"), tint = palette.onAttention, modifier = Modifier.size(18.dp))
                        EvidenceStrength.AGAINST -> Icon(Icons.Filled.Cancel, contentDescription = tr("Evidence against"), tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    }
                    Text(e.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val destination = when (override) {
                        is FileTarget.Patient -> tr("Goes to {who} (chosen for this file)", "who" to name(override.patient))
                        FileTarget.Later -> tr("Stays in the inbox for now")
                        null -> bundlePatient?.let { tr("Goes to {who} (bundle default)", "who" to name(it)) } ?: tr("Goes to: no patient chosen yet")
                    }
                    Text(destination, style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = onChange) { Text(tr("Send to another patient…")) }
                        if (override != FileTarget.Later) TextButton(onClick = onLater) { Text(tr("Leave for later")) }
                        if (override != null) TextButton(onClick = onFollowBundle) { Text(tr("Use the default")) }
                    }
                }
            }
        }
    }
}

@Composable
private fun FactsTable(tasks: List<PendingSortTasks>, onFile: Patients?) {
    val read = DocumentFacts(
        lastName = tasks.firstNotNullOfOrNull { it.patientLastName }, firstName = tasks.mapNotNull { it.patientFirstName }.maxByOrNull { it.length },
        dob = tasks.firstNotNullOfOrNull { it.patientDob }, serial = tasks.firstNotNullOfOrNull { it.deviceSerial },
    )
    if (onFile == null) {
        Text(
            listOfNotNull(read.lastName?.let { tr("Name: {v}", "v" to "$it ${read.firstName.orEmpty()}".trim()) }, read.dob?.let { tr("Born {date}", "date" to displayDate(it)) }, read.serial?.let { tr("Serial {v}", "v" to it) })
                .joinToString(" · ").ifEmpty { tr("The files did not name a patient or device.") },
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }
    val comparisons = compareFacts(read, DocumentFacts(lastName = onFile.lastName, firstName = onFile.firstName, dob = onFile.dob, patientId = onFile.hospitalPatientId))
        .filter { it.field != "Device serial" && it.field != "Patient ID" }
    val palette = statusColors()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(tr("Field"), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(tr("In the files"), Modifier.weight(1.2f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(tr("On file"), Modifier.weight(1.2f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(tr("Result"), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        comparisons.forEach { c ->
            val (status, word) = when (c.agreement) {
                FactAgreement.AGREE -> if (c.a != null && c.b != null && c.a != c.b && !c.a.equals(c.b, true)) Status.ATTENTION to tr("Close") else Status.OK to tr("Match")
                FactAgreement.CONFLICT -> Status.ALERT to tr("Differs")
                null -> Status.ATTENTION to tr("Missing")
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(c.field, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(c.a ?: "not stated", Modifier.weight(1.2f), style = MaterialTheme.typography.bodyMedium)
                Text(c.b ?: "none", Modifier.weight(1.2f), style = MaterialTheme.typography.bodyMedium)
                Surface(shape = RoundedCornerShape(8.dp), color = palette.container(status), modifier = Modifier.weight(1f, fill = false)) {
                    Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(status.icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = palette.content(status))
                        Text(word, style = MaterialTheme.typography.labelMedium, color = palette.content(status))
                    }
                }
            }
        }
    }
}

@Composable
private fun PatientOption(selected: Boolean, enabled: Boolean, title: String, subtitle: String, onSelect: () -> Unit) {
    Surface(
        onClick = onSelect, enabled = enabled, shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = null, modifier = Modifier.padding(8.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
