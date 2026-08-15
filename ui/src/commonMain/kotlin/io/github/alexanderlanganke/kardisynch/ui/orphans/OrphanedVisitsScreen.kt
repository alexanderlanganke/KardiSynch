package io.github.alexanderlanganke.kardisynch.ui.orphans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import kotlinx.coroutines.launch

/**
 * Reviews visits whose on-disk directory doesn't match the local index's
 * idea of which patient they belong to — wires up [KardiSynchRepository.findOrphanedVisits]/
 * [KardiSynchRepository.moveOrphanedVisits] (issue #186's backend), which
 * had zero UI consumer until now (UI-parity plan, Phase 1). Mirrors
 * Electron's `OrphanVisitsModal.tsx`: auto-scans on open, all found orphans
 * pre-checked, a "Rescan" action, and a bulk move.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrphanedVisitsScreen(
    repository: KardiSynchRepository,
    onBack: () -> Unit,
    onScan: suspend () -> List<KardiSynchRepository.OrphanVisit>,
    onMove: suspend (List<String>) -> KardiSynchRepository.OrphanMoveResult,
) {
    var orphans by remember { mutableStateOf<List<KardiSynchRepository.OrphanVisit>?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var patientNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var isMoving by remember { mutableStateOf(false) }
    var resultMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun rescan() {
        resultMessage = null
        val found = onScan()
        orphans = found
        selected = found.map { it.reportId }.toSet()
        val idsToResolve = (found.map { it.correctPatientId } + found.mapNotNull { it.currentPatientId }).toSet()
        patientNames = idsToResolve.mapNotNull { id ->
            repository.getPatientById(id)?.let { id to "${it.lastName}, ${it.firstName.orEmpty()}" }
        }.toMap()
    }

    LaunchedEffect(Unit) { rescan() }

    fun nameFor(patientId: String?) = patientId?.let { patientNames[it] } ?: patientId ?: "Unknown"

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Misplaced visits") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = { TextButton(onClick = { scope.launch { rescan() } }) { Text("Rescan") } },
            )
        },
    ) { padding ->
        val current = orphans
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            resultMessage?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp, 8.dp)) }
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
                ) { Text("No misplaced visits found.", style = MaterialTheme.typography.bodyMedium) }

                else -> {
                    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        items(current, key = { it.reportId }) { orphan ->
                            Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 6.dp)) {
                                Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = orphan.reportId in selected,
                                        onCheckedChange = { checked ->
                                            selected = if (checked) selected + orphan.reportId else selected - orphan.reportId
                                        },
                                    )
                                    Column {
                                        Text(orphan.date ?: orphan.visitDirName, style = MaterialTheme.typography.titleSmall)
                                        Text(
                                            "Filed under ${nameFor(orphan.currentPatientId)} → belongs to ${nameFor(orphan.correctPatientId)}",
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                        if (!orphan.correctPatientDirExists) {
                                            Text(
                                                "Target patient folder doesn't exist yet — will be created.",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Button(
                        onClick = {
                            scope.launch {
                                isMoving = true
                                val result = onMove(selected.toList())
                                isMoving = false
                                resultMessage = if (result.errors.isEmpty()) {
                                    "Moved ${result.moved} visit(s)."
                                } else {
                                    "Moved ${result.moved} visit(s); ${result.errors.size} error(s): ${result.errors.joinToString("; ")}"
                                }
                                rescan()
                            }
                        },
                        enabled = !isMoving && selected.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                    ) { Text(if (isMoving) "Moving…" else "Move ${selected.size} to correct patient") }
                }
            }
        }
    }
}
