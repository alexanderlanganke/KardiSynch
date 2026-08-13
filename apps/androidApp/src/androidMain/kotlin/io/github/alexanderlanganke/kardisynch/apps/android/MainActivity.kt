package io.github.alexanderlanganke.kardisynch.apps.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.github.alexanderlanganke.kardisynch.core.qrimport.parseFollowUpQrPayload
import io.github.alexanderlanganke.kardisynch.data.AndroidDataRootReader
import io.github.alexanderlanganke.kardisynch.data.DatabaseDriverFactory
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.resolveReportsRootHandle
import io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp
import kotlinx.coroutines.launch

private const val SETTING_DATA_ROOT = "dataRootPath"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val repository = KardiSynchRepository(DatabaseDriverFactory(applicationContext).createDriver())
        val reader = AndroidDataRootReader(applicationContext)

        setContent {
            val scope = rememberCoroutineScope()
            var dataRoot by remember { mutableStateOf<String?>(null) }
            var isReindexing by remember { mutableStateOf(false) }
            var lastReindexSummary by remember { mutableStateOf<String?>(null) }
            var showScanner by remember { mutableStateOf(false) }
            var hasCameraPermission by remember {
                mutableStateOf(ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            }

            LaunchedEffect(Unit) {
                dataRoot = repository.getSetting(SETTING_DATA_ROOT)
            }

            fun runReindex(root: String) {
                scope.launch {
                    isReindexing = true
                    val reportsRoot = resolveReportsRootHandle(reader, root)
                    lastReindexSummary = if (reportsRoot == null) {
                        "No \"Reports\" folder found under the selected location yet — nothing to index."
                    } else {
                        repository.reindexFrom(reader, reportsRoot)
                        "Reindexed successfully."
                    }
                    isReindexing = false
                }
            }

            val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                hasCameraPermission = granted
                if (granted) showScanner = true
            }

            val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
                if (uri != null) {
                    contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                    val root = uri.toString()
                    dataRoot = root
                    scope.launch { repository.setSetting(SETTING_DATA_ROOT, root) }
                    runReindex(root)
                }
            }

            MaterialTheme {
                if (showScanner) {
                    QrScanScreen(
                        onDecoded = { text ->
                            showScanner = false
                            val import = parseFollowUpQrPayload(text)
                            val root = dataRoot
                            when {
                                import == null -> lastReindexSummary = "That QR code wasn't a recognized follow-up export."
                                root == null -> lastReindexSummary = "Set a _DATA folder in Settings before importing."
                                else -> scope.launch {
                                    val reportsRoot = resolveReportsRootHandle(reader, root)
                                    if (reportsRoot == null) {
                                        lastReindexSummary = "No \"Reports\" folder found under the selected location."
                                    } else {
                                        val result = repository.importFollowUp(reader, reader, reportsRoot, import)
                                        lastReindexSummary = if (result.isSuccess) {
                                            "Imported ${import.patientLastName}, ${import.patientFirstName}'s visit."
                                        } else {
                                            "Import failed: ${result.exceptionOrNull()?.message}"
                                        }
                                    }
                                }
                            }
                        },
                        onCancel = { showScanner = false },
                    )
                } else {
                    Box(modifier = Modifier.fillMaxSize()) {
                        KardiSynchApp(
                            repository = repository,
                            dataRootLabel = dataRoot,
                            isReindexing = isReindexing,
                            lastReindexSummary = lastReindexSummary,
                            onPickDataRoot = { folderPicker.launch(null) },
                            onReindex = { dataRoot?.let(::runReindex) },
                        )
                        if (dataRoot != null) {
                            FloatingActionButton(
                                onClick = {
                                    if (hasCameraPermission) showScanner = true else permissionLauncher.launch(Manifest.permission.CAMERA)
                                },
                                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                            ) { Text("QR") }
                        }
                    }
                }
            }
        }
    }
}
