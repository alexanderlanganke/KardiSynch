package io.github.alexanderlanganke.kardisynch.ui.duplicates

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.matching.DupTier
import io.github.alexanderlanganke.kardisynch.core.matching.PatientDupGroup
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Patients

private enum class DuplicatesMode { DETECTED, MANUAL }

private fun DupTier.label(): String = when (this) {
    DupTier.EXACT -> "Exact match"
    DupTier.SERIAL -> "Shared device serial"
    DupTier.DOB_FUZZY_NAME, DupTier.NAME_CLOSE_DOB -> "Probable match"
    DupTier.NAME_ONLY -> "Weak match (same surname)"
}

/** Strongest tiers start expanded and pre-checked; the weakest ("same surname" only) starts collapsed — mirrors `PatientMergeModal.tsx`'s per-tier defaults. */
private fun DupTier.defaultExpanded(): Boolean = this != DupTier.NAME_ONLY
private fun DupTier.autoSelectOthers(): Boolean = this == DupTier.EXACT || this == DupTier.SERIAL

/**
 * Reviews probable-duplicate patients (issue #187's detection). Upgraded
 * from a flat single-tier list (issue #178's first pass) to match Electron's
 * `PatientMergeModal.tsx`: groups visually tiered by confidence with
 * per-tier default expand/pre-check state, a keeper choice instead of
 * always keeping [PatientDupGroup.patients]'s first entry, and a manual
 * search-and-merge tab for duplicates the automatic scan doesn't catch
 * (parity plan Phase 7). Still no field-by-field conflict picker on merge
 * itself — the keeper's fields survive as-is, a real, already-documented
 * scope reduction, see [KardiSynchRepository.mergePatients]'s doc comment.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DuplicatesScreen(
    repository: KardiSynchRepository,
    refreshKey: Any,
    onBack: () -> Unit,
    onMerge: (keeperId: String, loserIds: List<String>) -> Unit,
) {
    var groups by remember { mutableStateOf<List<PatientDupGroup>?>(null) }
    var mode by remember { mutableStateOf(DuplicatesMode.DETECTED) }

    LaunchedEffect(refreshKey) {
        groups = repository.findDuplicatePatients()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Possible duplicate patients") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(modifier = Modifier.padding(16.dp, 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = mode == DuplicatesMode.DETECTED, onClick = { mode = DuplicatesMode.DETECTED }, label = { Text("Detected") })
                FilterChip(selected = mode == DuplicatesMode.MANUAL, onClick = { mode = DuplicatesMode.MANUAL }, label = { Text("Manual search") })
            }

            when (mode) {
                DuplicatesMode.DETECTED -> {
                    val current = groups
                    when {
                        current == null -> Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) { CircularProgressIndicator() }

                        current.isEmpty() -> Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) { Text("No probable duplicates found.", style = MaterialTheme.typography.bodyMedium) }

                        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(current, key = { it.patients.map { p -> p.id } }) { group ->
                                DupGroupCard(group, onMerge)
                            }
                        }
                    }
                }

                DuplicatesMode.MANUAL -> ManualMergeSearch(repository, onMerge)
            }
        }
    }
}

@Composable
private fun DupGroupCard(group: PatientDupGroup, onMerge: (keeperId: String, loserIds: List<String>) -> Unit) {
    var expanded by remember(group) { mutableStateOf(group.tier.defaultExpanded()) }
    var keeperId by remember(group) { mutableStateOf(group.patients.first().id) }
    var checkedLosers by remember(group) {
        mutableStateOf(if (group.tier.autoSelectOthers()) group.patients.drop(1).map { it.id }.toSet() else emptySet())
    }
    var dismissed by remember(group) { mutableStateOf(false) }
    if (dismissed) return

    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(group.tier.label(), style = MaterialTheme.typography.titleSmall)
                    Text(group.reason, style = MaterialTheme.typography.bodySmall)
                }
                TextButton(onClick = { dismissed = true }) { Text("Dismiss") }
            }

            if (expanded) {
                for (patient in group.patients) {
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(
                            selected = keeperId == patient.id,
                            onClick = { keeperId = patient.id; checkedLosers = checkedLosers - patient.id },
                        )
                        if (patient.id != keeperId) {
                            Checkbox(
                                checked = patient.id in checkedLosers,
                                onCheckedChange = { checked -> checkedLosers = if (checked) checkedLosers + patient.id else checkedLosers - patient.id },
                            )
                        } else {
                            Spacer(modifier = Modifier.width(48.dp))
                        }
                        Column {
                            Text(
                                "${patient.lastName}, ${patient.firstName.orEmpty()}" + if (patient.id == keeperId) " (keep)" else "",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Text("DOB ${patient.dob} · ${patient.reportCount} report(s)", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                val keeperName = group.patients.first { it.id == keeperId }.let { "${it.lastName}, ${it.firstName.orEmpty()}" }
                Button(
                    onClick = { onMerge(keeperId, checkedLosers.toList()) },
                    enabled = checkedLosers.isNotEmpty(),
                    modifier = Modifier.padding(top = 12.dp),
                ) { Text("Merge ${checkedLosers.size} into $keeperName") }
            }
        }
    }
}

@Composable
private fun ManualMergeSearch(repository: KardiSynchRepository, onMerge: (keeperId: String, loserIds: List<String>) -> Unit) {
    val patients by repository.observePatients().collectAsState(initial = emptyList())
    var query by remember { mutableStateOf("") }
    var keeperId by remember { mutableStateOf<String?>(null) }
    var checkedLosers by remember { mutableStateOf<Set<String>>(emptySet()) }

    val filtered = remember(patients, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) {
            emptyList()
        } else {
            patients.filter { p ->
                "${p.lastName} ${p.firstName.orEmpty()}".lowercase().contains(q) || p.hospitalPatientId?.lowercase()?.contains(q) == true
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp, 0.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search by name or hospital ID") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        when {
            query.isBlank() -> Text(
                "Search for patients to review and merge manually — for duplicates the automatic scan doesn't catch.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 12.dp),
            )

            filtered.isEmpty() -> Text("No matching patients.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 12.dp))

            else -> {
                LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp)) {
                    items(filtered, key = { it.id }) { patient -> ManualMergeRow(patient, keeperId, checkedLosers, onKeeperChange = { keeperId = it }, onCheckedChange = { id, checked -> checkedLosers = if (checked) checkedLosers + id else checkedLosers - id }) }
                }
                val keeper = keeperId?.let { id -> patients.firstOrNull { it.id == id } }
                Button(
                    onClick = { val id = keeperId; if (id != null) onMerge(id, checkedLosers.toList()) },
                    enabled = keeper != null && checkedLosers.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                ) { Text(if (keeper != null) "Merge ${checkedLosers.size} into ${keeper.lastName}, ${keeper.firstName.orEmpty()}" else "Pick a keeper") }
            }
        }
    }
}

@Composable
private fun ManualMergeRow(
    patient: Patients,
    keeperId: String?,
    checkedLosers: Set<String>,
    onKeeperChange: (String) -> Unit,
    onCheckedChange: (id: String, checked: Boolean) -> Unit,
) {
    val isKeeper = patient.id == keeperId
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = isKeeper, onClick = { onKeeperChange(patient.id); onCheckedChange(patient.id, false) })
        if (!isKeeper) {
            Checkbox(checked = patient.id in checkedLosers, onCheckedChange = { checked -> onCheckedChange(patient.id, checked) })
        } else {
            Spacer(modifier = Modifier.width(48.dp))
        }
        Column {
            Text("${patient.lastName}, ${patient.firstName.orEmpty()}" + if (isKeeper) " (keep)" else "", style = MaterialTheme.typography.bodyMedium)
            Text("DOB ${patient.dob}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
