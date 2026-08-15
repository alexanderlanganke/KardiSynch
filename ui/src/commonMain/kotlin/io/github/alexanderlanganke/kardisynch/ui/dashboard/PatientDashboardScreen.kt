package io.github.alexanderlanganke.kardisynch.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.mri.parseManufacturerWarningStatus
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Patients

/**
 * Read-only patient list — the Phase 1 milestone screen (KMP migration
 * plan). Tapping a row navigates to [io.github.alexanderlanganke.kardisynch.ui.detail.PatientDetailScreen].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDashboardScreen(
    repository: KardiSynchRepository,
    onOpenPatient: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenDeviceNews: (() -> Unit)? = null,
) {
    val patients by repository.observePatients().collectAsState(initial = null)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("KardiSynch") },
                actions = {
                    if (onOpenDeviceNews != null) {
                        TextButton(onClick = onOpenDeviceNews) { Text("Device News") }
                    }
                    TextButton(onClick = onOpenSettings) { Text("Settings") }
                },
            )
        },
    ) { padding ->
        val current = patients
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
            ) {
                Text("No patients yet — set a _DATA root and reindex in Settings.", style = MaterialTheme.typography.bodyMedium)
            }

            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(current, key = { it.id }) { patient -> PatientRow(patient, onClick = { onOpenPatient(patient.id) }) }
            }
        }
    }
}

@Composable
private fun PatientRow(patient: Patients, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        onClick = onClick,
    ) {
        Row(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
            Column {
                Text("${patient.lastName}, ${patient.firstName ?: ""}", style = MaterialTheme.typography.titleMedium)
                Text("DOB: ${patient.dob}", style = MaterialTheme.typography.bodySmall)
                // Read-only display of whatever's cached in patient.xml — see
                // core.mri.ManufacturerWarningStatus's doc comment (issue #175).
                parseManufacturerWarningStatus(patient.manufacturerWarningStatus)
                    ?.takeIf { it.status == "advisory" || it.status == "recall" }
                    ?.let { warning ->
                        Text(
                            if (warning.status == "recall") "Manufacturer recall posted" else "Manufacturer advisory posted",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFB3261E),
                        )
                    }
            }
        }
    }
}
