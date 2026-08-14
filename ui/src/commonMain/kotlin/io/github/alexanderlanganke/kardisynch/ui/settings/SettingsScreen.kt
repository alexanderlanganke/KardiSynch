package io.github.alexanderlanganke.kardisynch.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * _DATA root picker + reindex trigger. Picking the root itself is
 * inherently platform-specific (a native folder dialog on desktop, a SAF
 * `ACTION_OPEN_DOCUMENT_TREE` grant on Android — see the KMP migration
 * plan) — this screen stays a thin, common-code shell around
 * [onPickDataRoot] / [onReindex] callbacks the app shell wires up.
 *
 * [onReprocessUnmatched] is desktop-only (Android has no `_IMPORT`/`_unmatched`
 * folder watcher yet) — pass null to hide that action entirely.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    dataRootLabel: String?,
    isReindexing: Boolean,
    lastReindexSummary: String?,
    onBack: () -> Unit,
    onPickDataRoot: () -> Unit,
    onReindex: () -> Unit,
    onClearLocalIndex: () -> Unit,
    onReprocessUnmatched: (() -> Unit)? = null,
) {
    var showClearConfirm by remember { mutableStateOf(false) }

    if (showClearConfirm) {
        AlertDialog(
            onDismissRequest = { showClearConfirm = false },
            title = { Text("Clear local index?") },
            text = {
                Text(
                    "Removes this device's cached patient/report index. The _DATA folder itself " +
                        "is untouched — reindex to rebuild it, or it happens automatically the next " +
                        "time this device picks a _DATA folder.",
                )
            },
            confirmButton = {
                TextButton(onClick = { showClearConfirm = false; onClearLocalIndex() }) { Text("Clear") }
            },
            dismissButton = {
                TextButton(onClick = { showClearConfirm = false }) { Text("Cancel") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("_DATA root", style = MaterialTheme.typography.titleMedium)
            Text(dataRootLabel ?: "Not set", style = MaterialTheme.typography.bodyMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Button(onClick = onPickDataRoot, modifier = Modifier.fillMaxWidth()) {
                Text(if (dataRootLabel == null) "Choose _DATA folder" else "Change folder")
            }

            Spacer(modifier = Modifier.height(24.dp))
            Text("Local index", style = MaterialTheme.typography.titleMedium)
            Text(
                "Rebuilds this device's local patient/report index from the _DATA folder's " +
                    "patient.xml/visit.xml files — safe to run any time, never writes back to _DATA.",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Button(onClick = onReindex, enabled = dataRootLabel != null && !isReindexing, modifier = Modifier.fillMaxWidth()) {
                Text(if (isReindexing) "Reindexing..." else "Reindex now")
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(onClick = { showClearConfirm = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Clear local index")
            }
            lastReindexSummary?.let {
                Spacer(modifier = Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodySmall)
            }

            if (onReprocessUnmatched != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("Import", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Moves every file currently sitting in _IMPORT/_unmatched back into _IMPORT, " +
                        "so the watcher retries them.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = onReprocessUnmatched, modifier = Modifier.fillMaxWidth()) {
                    Text("Reprocess unmatched files")
                }
            }
        }
    }
}
