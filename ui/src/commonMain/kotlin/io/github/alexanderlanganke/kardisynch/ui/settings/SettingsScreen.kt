package io.github.alexanderlanganke.kardisynch.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode

/**
 * _DATA root picker + reindex trigger. Picking the root itself is
 * inherently platform-specific (a native folder dialog on desktop, a SAF
 * `ACTION_OPEN_DOCUMENT_TREE` grant on Android — see the KMP migration
 * plan) — this screen stays a thin, common-code shell around
 * [onPickDataRoot] / [onReindex] callbacks the app shell wires up.
 *
 * [onReprocessUnmatched]/[onPickImportDir] are desktop-only (Android has no
 * `_IMPORT` folder watcher yet) — pass null to hide those actions entirely.
 * Likewise [onAddUsbSourceDir]/[onPickUsbTargetDir] (issue #189's USB
 * watcher, also desktop-only: it copies plain files off a mounted volume,
 * which isn't how Android exposes removable storage).
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
    importDirLabel: String? = null,
    onPickImportDir: (() -> Unit)? = null,
    onReprocessUnmatched: (() -> Unit)? = null,
    usbSourceDirs: List<String> = emptyList(),
    onAddUsbSourceDir: (() -> Unit)? = null,
    onRemoveUsbSourceDir: ((String) -> Unit)? = null,
    usbTargetDirLabel: String? = null,
    onPickUsbTargetDir: (() -> Unit)? = null,
    isReparsing: Boolean = false,
    onReparseAll: (() -> Unit)? = null,
    pendingSortCount: Int = 0,
    onOpenPendingSort: (() -> Unit)? = null,
    onOpenDuplicates: (() -> Unit)? = null,
    onOpenOrphanedVisits: (() -> Unit)? = null,
    onOpenImportHistory: (() -> Unit)? = null,
    onOpenAliasSettings: (() -> Unit)? = null,
    isDeduping: Boolean = false,
    onDedupReports: (() -> Unit)? = null,
    appVersion: String? = null,
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    onThemeModeChange: ((ThemeMode) -> Unit)? = null,
) {
    var showClearConfirm by remember { mutableStateOf(false) }
    var showReparseConfirm by remember { mutableStateOf(false) }
    var showDedupConfirm by remember { mutableStateOf(false) }

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

    if (showReparseConfirm) {
        AlertDialog(
            onDismissRequest = { showReparseConfirm = false },
            title = { Text("Reparse every visit?") },
            text = {
                Text(
                    "Re-reads every visit's raw device files with the current parser and rewrites " +
                        "visit.xml — lets a fixed or improved parser reach visits imported before " +
                        "the fix shipped. Can take a while on a large _DATA folder.",
                )
            },
            confirmButton = {
                TextButton(onClick = { showReparseConfirm = false; onReparseAll?.invoke() }) { Text("Reparse") }
            },
            dismissButton = {
                TextButton(onClick = { showReparseConfirm = false }) { Text("Cancel") }
            },
        )
    }

    if (showDedupConfirm) {
        AlertDialog(
            onDismissRequest = { showDedupConfirm = false },
            title = { Text("Deduplicate reports?") },
            text = {
                Text(
                    "Finds visits that were imported more than once (same patient, day, and " +
                        "device) and merges each group down to one, keeping the most complete " +
                        "copy. Files are only removed once verified byte-identical to the kept copy.",
                )
            },
            confirmButton = {
                TextButton(onClick = { showDedupConfirm = false; onDedupReports?.invoke() }) { Text("Deduplicate") }
            },
            dismissButton = {
                TextButton(onClick = { showDedupConfirm = false }) { Text("Cancel") }
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
            if (onOpenDuplicates != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onOpenDuplicates, modifier = Modifier.fillMaxWidth()) {
                    Text("Review possible duplicate patients")
                }
            }
            if (onOpenOrphanedVisits != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onOpenOrphanedVisits, modifier = Modifier.fillMaxWidth()) {
                    Text("Review misplaced visits")
                }
            }
            if (onOpenImportHistory != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onOpenImportHistory, modifier = Modifier.fillMaxWidth()) {
                    Text("Import history")
                }
            }
            if (onOpenAliasSettings != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onOpenAliasSettings, modifier = Modifier.fillMaxWidth()) {
                    Text("Device & lead type aliases")
                }
            }
            if (onDedupReports != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = { showDedupConfirm = true }, enabled = !isDeduping, modifier = Modifier.fillMaxWidth()) {
                    Text(if (isDeduping) "Deduplicating..." else "Deduplicate reports")
                }
            }

            if (onPickImportDir != null || onReprocessUnmatched != null || onReparseAll != null || onOpenPendingSort != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("Import folder", style = MaterialTheme.typography.titleMedium)
                if (onPickImportDir != null) {
                    Text(importDirLabel ?: "Not set", style = MaterialTheme.typography.bodyMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onPickImportDir, modifier = Modifier.fillMaxWidth()) {
                        Text("Change import folder")
                    }
                }
                if (onReprocessUnmatched != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Moves every file currently sitting in _unmatched back into the import " +
                            "folder, so the watcher retries them.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onReprocessUnmatched, modifier = Modifier.fillMaxWidth()) {
                        Text("Reprocess unmatched files")
                    }
                }
                if (onReparseAll != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Re-parses every stored visit's raw files with the current parser — lets a " +
                            "fixed parser reach visits imported before the fix shipped.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = { showReparseConfirm = true }, enabled = !isReparsing, modifier = Modifier.fillMaxWidth()) {
                        Text(if (isReparsing) "Reparsing..." else "Reparse everything")
                    }
                }
                if (onOpenPendingSort != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Files the importer wasn't confident enough to file automatically — a " +
                            "similar patient already on file, or a device serial with no name/DOB " +
                            "to confirm it.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onOpenPendingSort, modifier = Modifier.fillMaxWidth()) {
                        Text(if (pendingSortCount > 0) "Review pending sort ($pendingSortCount)" else "Review pending sort")
                    }
                }
            }

            if (onAddUsbSourceDir != null || onPickUsbTargetDir != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("USB watcher", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Files found in USB source folders are copied to the target folder, then " +
                        "on to the import folder above.",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (onPickUsbTargetDir != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Target folder", style = MaterialTheme.typography.bodyMedium)
                    Text(usbTargetDirLabel ?: "Not set", style = MaterialTheme.typography.bodySmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onPickUsbTargetDir, modifier = Modifier.fillMaxWidth()) {
                        Text("Change target folder")
                    }
                }
                if (onAddUsbSourceDir != null) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Source folders", style = MaterialTheme.typography.bodyMedium)
                    for (dir in usbSourceDirs) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(dir, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            if (onRemoveUsbSourceDir != null) {
                                TextButton(onClick = { onRemoveUsbSourceDir(dir) }) { Text("Remove") }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onAddUsbSourceDir, modifier = Modifier.fillMaxWidth()) {
                        Text("Add source folder")
                    }
                }
            }

            if (onThemeModeChange != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("Appearance", style = MaterialTheme.typography.titleMedium)
                Row(modifier = Modifier.padding(top = 8.dp)) {
                    TextButton(onClick = { onThemeModeChange(ThemeMode.LIGHT) }) {
                        Text(if (themeMode == ThemeMode.LIGHT) "● Light" else "○ Light")
                    }
                    TextButton(onClick = { onThemeModeChange(ThemeMode.DARK) }) {
                        Text(if (themeMode == ThemeMode.DARK) "● Dark" else "○ Dark")
                    }
                    TextButton(onClick = { onThemeModeChange(ThemeMode.SYSTEM) }) {
                        Text(if (themeMode == ThemeMode.SYSTEM) "● System" else "○ System")
                    }
                }
            }

            if (appVersion != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Text("About", style = MaterialTheme.typography.titleMedium)
                Text("KardiSynch $appVersion", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
