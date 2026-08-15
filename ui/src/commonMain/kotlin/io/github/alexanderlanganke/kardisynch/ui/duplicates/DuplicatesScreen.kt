package io.github.alexanderlanganke.kardisynch.ui.duplicates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.matching.PatientDupGroup
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository

/**
 * Reviews probable-duplicate patients (issue #187's detection, wired to a
 * screen for the first time here per issue #178) — each group's first
 * patient is [io.github.alexanderlanganke.kardisynch.core.matching.findDuplicatePatientGroups]'s
 * suggested keeper (most reports, then most recent, then oldest record —
 * see that function's sort). Merge keeps the group's fields exactly as the
 * keeper already has them (no field-by-field conflict picker, unlike
 * Electron's `PatientMergeModal.tsx` — a real, documented scope reduction:
 * see [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.mergePatients]'s
 * doc comment for what else that original also did that this doesn't).
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
        val current = groups
        when {
            current == null -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }

            current.isEmpty() -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { Text("No probable duplicates found.", style = MaterialTheme.typography.bodyMedium) }

            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(current, key = { it.patients.map { p -> p.id } }) { group ->
                    Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(group.reason, style = MaterialTheme.typography.titleSmall)
                            for (patient in group.patients) {
                                Text(
                                    "${patient.lastName}, ${patient.firstName.orEmpty()} — DOB ${patient.dob} — ${patient.reportCount} report(s)",
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                            val keeper = group.patients.firstOrNull()
                            val losers = group.patients.drop(1)
                            if (keeper != null && losers.isNotEmpty()) {
                                Button(
                                    onClick = { onMerge(keeper.id, losers.map { it.id }) },
                                    modifier = Modifier.padding(top = 12.dp),
                                ) { Text("Merge into ${keeper.lastName}, ${keeper.firstName.orEmpty()}") }
                            }
                        }
                    }
                }
            }
        }
    }
}
