package io.github.alexanderlanganke.kardisynch.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * First-run setup wizard — ported from `OnboardingWizard.tsx` (issue #195),
 * shown instead of the normal shell until [onFinish]/[onSkip] fires (see
 * [io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp]'s `showOnboarding`
 * gate). Two steps only, not the original's four: the original's other two
 * steps (an "MRI country" picker, an "automation" toggle) only configure the
 * Medtronic/Boston Scientific MRI-compatibility scrapers — confirmed
 * vestigial in the source app itself (issue #191, no consumer anywhere even
 * there) and not ported to this port at all. Building UI for settings that
 * configure nothing would be actively misleading, not a faithful port.
 *
 * Like the original: nothing here is mandatory (Next/Finish don't validate
 * that a folder was actually picked — [dataRootLabel]/[importDirLabel]
 * reflect whatever the platform layer's pickers already set), "Skip setup"
 * is available on every step, and closing the app mid-wizard does NOT
 * resume — the platform layer only persists "onboarding complete" on
 * Finish/Skip, so a restart shows the wizard again from step 0.
 */
@Composable
fun OnboardingScreen(
    dataRootLabel: String?,
    importDirLabel: String?,
    onPickDataRoot: () -> Unit,
    onPickImportDir: () -> Unit,
    onFinish: () -> Unit,
    onSkip: () -> Unit,
) {
    var step by remember { mutableStateOf(0) }
    val totalSteps = 2

    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            LinearProgressIndicator(
                progress = { (step + 1f) / totalSteps },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(32.dp))

            when (step) {
                0 -> {
                    Text("Welcome to KardiSynch", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Choose the shared _DATA folder where device reports are stored — " +
                            "the same folder every workstation in your clinic points at.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(dataRootLabel ?: "Not set", style = MaterialTheme.typography.bodySmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onPickDataRoot, modifier = Modifier.fillMaxWidth()) {
                        Text(if (dataRootLabel == null) "Choose _DATA folder" else "Change folder")
                    }
                }

                else -> {
                    Text("Import Folder", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Files dropped into this folder are automatically matched to a " +
                            "patient and filed into _DATA — anything that can't be matched " +
                            "lands in its _unmatched subfolder for manual review.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(importDirLabel ?: "Not set", style = MaterialTheme.typography.bodySmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onPickImportDir, modifier = Modifier.fillMaxWidth()) {
                        Text(if (importDirLabel == null) "Choose import folder" else "Change folder")
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onSkip) { Text("Skip setup") }
                Row {
                    if (step > 0) {
                        TextButton(onClick = { step-- }) { Text("Back") }
                    }
                    Button(onClick = { if (step < totalSteps - 1) step++ else onFinish() }) {
                        Text(if (step < totalSteps - 1) "Next" else "Finish")
                    }
                }
            }
        }
    }
}
