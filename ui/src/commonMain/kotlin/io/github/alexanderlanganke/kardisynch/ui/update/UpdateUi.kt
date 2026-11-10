package io.github.alexanderlanganke.kardisynch.ui.update

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Where an update stands, from the point of view of the person using the app. */
sealed interface UpdateUiState {
    data object Idle : UpdateUiState
    data object Checking : UpdateUiState
    data object UpToDate : UpdateUiState
    data class Available(val version: String, val notes: String) : UpdateUiState
    /** [fraction] is 0..1, or null when the size is unknown. */
    data class Downloading(val version: String, val fraction: Float?) : UpdateUiState
    data class Failed(val message: String) : UpdateUiState
}

/**
 * Everything the app shell needs to show updates. [onInstall] is null where the app can't replace
 * itself (a Flatpak, a dev build): there the offer only links to the release page via [onOpenPage].
 */
class UpdateController(
    val state: UpdateUiState,
    val onCheck: () -> Unit,
    val onInstall: (() -> Unit)?,
    val onOpenPage: (() -> Unit)?,
    val autoCheck: Boolean = true,
    val onAutoCheckChange: ((Boolean) -> Unit)? = null,
    val includePrereleases: Boolean = false,
    val onIncludePrereleasesChange: ((Boolean) -> Unit)? = null,
)

/** A slim bar above the app when a newer version is waiting. Nothing is installed without a tap. */
@Composable
fun UpdateBanner(update: UpdateController?, modifier: Modifier = Modifier) {
    val state = update?.state
    if (update == null || (state !is UpdateUiState.Available && state !is UpdateUiState.Downloading)) return
    Surface(color = MaterialTheme.colorScheme.primaryContainer, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            when (state) {
                is UpdateUiState.Available -> {
                    Text(tr("KardiSynch {v} is available.", "v" to state.version), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.weight(1f))
                    if (update.onInstall != null) TextButton(onClick = update.onInstall) { Text(tr("Install and restart")) }
                    else update.onOpenPage?.let { TextButton(onClick = it) { Text(tr("View release")) } }
                }
                is UpdateUiState.Downloading -> {
                    Text(tr("Downloading {v}…", "v" to state.version), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    if (state.fraction != null) LinearProgressIndicator(progress = { state.fraction }, modifier = Modifier.weight(1f)) else LinearProgressIndicator(Modifier.weight(1f))
                }
                else -> Unit
            }
        }
    }
}

/** The "Updates" block of Settings. */
@Composable
fun UpdateSettingsSection(update: UpdateController, currentVersion: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(tr("Updates"), style = MaterialTheme.typography.titleMedium)
        val state = update.state
        Text(
            when (state) {
                UpdateUiState.Idle -> tr("Version {v}.", "v" to (currentVersion ?: tr("unknown")))
                UpdateUiState.Checking -> tr("Checking for a newer version…")
                UpdateUiState.UpToDate -> tr("KardiSynch {v} is up to date.", "v" to (currentVersion ?: "")).replace("  ", " ")
                is UpdateUiState.Available -> tr("Version {v} is available (you have {cur}).", "v" to state.version, "cur" to (currentVersion ?: tr("an older version")))
                is UpdateUiState.Downloading -> tr("Downloading version {v}…", "v" to state.version)
                is UpdateUiState.Failed -> state.message
            },
            style = MaterialTheme.typography.bodyMedium,
        )
        if (state is UpdateUiState.Available && state.notes.isNotBlank()) {
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                Text(state.notes.take(1200), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state is UpdateUiState.Checking || state is UpdateUiState.Downloading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else {
                if (state is UpdateUiState.Available && update.onInstall != null) Button(onClick = update.onInstall) { Text(tr("Install and restart")) }
                if (state is UpdateUiState.Available && update.onInstall == null) update.onOpenPage?.let { Button(onClick = it) { Text(tr("View release")) } }
                OutlinedButton(onClick = update.onCheck) { Text(tr("Check for updates")) }
            }
        }
        update.onAutoCheckChange?.let { change ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.Checkbox(update.autoCheck, onCheckedChange = change)
                Text(tr("Check for updates when the app starts"))
            }
        }
        update.onIncludePrereleasesChange?.let { change ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.Checkbox(update.includePrereleases, onCheckedChange = change)
                Text(tr("Include beta versions"))
            }
        }
    }
}
