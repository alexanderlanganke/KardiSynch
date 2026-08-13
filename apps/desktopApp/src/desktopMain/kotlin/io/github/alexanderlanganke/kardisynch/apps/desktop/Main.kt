package io.github.alexanderlanganke.kardisynch.apps.desktop

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import io.github.alexanderlanganke.kardisynch.data.DatabaseDriverFactory
import io.github.alexanderlanganke.kardisynch.data.DesktopDataRootReader
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp
import kotlinx.coroutines.launch
import java.io.File
import javax.swing.JFileChooser

private const val SETTING_DATA_ROOT = "dataRootPath"

fun main() = application {
    val repository = remember { KardiSynchRepository(DatabaseDriverFactory().createDriver()) }
    val reader = remember { DesktopDataRootReader() }
    val scope = rememberCoroutineScope()

    var dataRoot by remember { mutableStateOf<String?>(null) }
    var isReindexing by remember { mutableStateOf(false) }
    var lastReindexSummary by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        dataRoot = repository.getSetting(SETTING_DATA_ROOT)
    }

    fun runReindex(root: String) {
        scope.launch {
            isReindexing = true
            try {
                val reportsRoot = File(root, "Reports").absolutePath
                repository.reindexFrom(reader, reportsRoot)
                lastReindexSummary = "Reindexed successfully."
            } catch (e: Exception) {
                lastReindexSummary = "Reindex failed: ${e.message}"
            } finally {
                isReindexing = false
            }
        }
    }

    Window(onCloseRequest = ::exitApplication, title = "KardiSynch") {
        KardiSynchApp(
            repository = repository,
            dataRootLabel = dataRoot,
            isReindexing = isReindexing,
            lastReindexSummary = lastReindexSummary,
            onPickDataRoot = {
                val chooser = JFileChooser().apply {
                    fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
                    dialogTitle = "Choose the _DATA folder"
                }
                if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
                    val picked = chooser.selectedFile.absolutePath
                    dataRoot = picked
                    scope.launch { repository.setSetting(SETTING_DATA_ROOT, picked) }
                    runReindex(picked)
                }
            },
            onReindex = { dataRoot?.let(::runReindex) },
        )
    }
}
