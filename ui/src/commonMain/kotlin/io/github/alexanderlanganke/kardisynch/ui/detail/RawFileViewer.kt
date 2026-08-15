package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry

/**
 * A visit's raw source files, one at a time, with prev/next cycling —
 * ported from `ReportViewer.tsx`/`ViewPane.tsx`'s raw-file half (parity
 * plan Phase 11, the single biggest clinical-workflow gap this port had:
 * before this, there was no way to see the actual interrogation document,
 * only its already-parsed summary fields). Dispatches on file extension:
 * PDF via [openPdf] (page-at-a-time, its own prev/next when multi-page),
 * XML/text as plain text, images via [decodeImage]; anything else
 * (manufacturer-proprietary `.pkg`/`.pdd`/`.bnk` formats) gets the same
 * "can't be displayed here" fallback Electron shows.
 *
 * Simplified from the original in two ways: no PDF search/zoom (a stretch
 * goal per the parity plan, not a blocker for landing this), and no
 * drag-and-drop visit-to-pane assignment (tap/select through [RawFileViewer]'s
 * own prev/next instead — this port has no fixed dual-pane layout to drag
 * into, each visit's files live in their own expandable section on its
 * report card).
 */
@Composable
fun RawFileViewer(
    files: List<DataEntry>,
    onReadBytes: suspend (fileHandle: String) -> ByteArray?,
    onReadText: suspend (fileHandle: String) -> String?,
) {
    var index by remember(files) { mutableStateOf(0) }

    if (files.isEmpty()) {
        Text("No files found for this visit.", style = MaterialTheme.typography.bodySmall)
        return
    }

    val file = files[index.coerceIn(0, files.size - 1)]

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { index = (index - 1 + files.size) % files.size }, enabled = files.size > 1) { Text("◀ Prev file") }
            Text(file.name, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { index = (index + 1) % files.size }, enabled = files.size > 1) { Text("Next file ▶") }
        }
        FileContent(file, onReadBytes, onReadText)
    }
}

@Composable
private fun FileContent(file: DataEntry, onReadBytes: suspend (String) -> ByteArray?, onReadText: suspend (String) -> String?) {
    when (file.name.substringAfterLast('.', "").lowercase()) {
        "pdf" -> PdfFileContent(file, onReadBytes)
        "xml", "txt" -> TextFileContent(file, onReadText)
        "png", "jpg", "jpeg", "gif", "bmp" -> ImageFileContent(file, onReadBytes)
        else -> Text(
            "This file type can't be displayed here — use \"Export QR\"/the file's own application to view it.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.heightIn(min = 120.dp),
        )
    }
}

@Composable
private fun PdfFileContent(file: DataEntry, onReadBytes: suspend (String) -> ByteArray?) {
    var renderer by remember(file.handle) { mutableStateOf<PdfPageRenderer?>(null) }
    var loadFailed by remember(file.handle) { mutableStateOf(false) }
    var page by remember(file.handle) { mutableStateOf(0) }

    LaunchedEffect(file.handle) {
        val bytes = onReadBytes(file.handle)
        renderer = bytes?.let { openPdf(it) }
        loadFailed = renderer == null
    }
    DisposableEffect(file.handle) { onDispose { renderer?.close() } }

    val current = renderer
    when {
        loadFailed -> Text("Couldn't render this PDF.", style = MaterialTheme.typography.bodySmall)
        current == null -> CircularProgressIndicator(modifier = Modifier.heightIn(min = 120.dp))
        else -> {
            val bitmap = remember(file.handle, page) { current.renderPage(page, targetWidthPx = 900) }
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                if (current.pageCount > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { page = (page - 1 + current.pageCount) % current.pageCount }) { Text("◀ Page") }
                        Text("${page + 1} / ${current.pageCount}", style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { page = (page + 1) % current.pageCount }) { Text("Page ▶") }
                    }
                }
                bitmap?.let { Image(bitmap = it, contentDescription = file.name) } ?: Text("Couldn't render page ${page + 1}.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun TextFileContent(file: DataEntry, onReadText: suspend (String) -> String?) {
    var text by remember(file.handle) { mutableStateOf<String?>(null) }
    LaunchedEffect(file.handle) { text = onReadText(file.handle) ?: "Couldn't read this file." }
    Text(
        text ?: "Loading…",
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()),
    )
}

@Composable
private fun ImageFileContent(file: DataEntry, onReadBytes: suspend (String) -> ByteArray?) {
    var bitmap by remember(file.handle) { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var loadFailed by remember(file.handle) { mutableStateOf(false) }
    LaunchedEffect(file.handle) {
        val bytes = onReadBytes(file.handle)
        bitmap = bytes?.let { decodeImage(it) }
        loadFailed = bitmap == null
    }
    when {
        loadFailed -> Text("Couldn't display this image.", style = MaterialTheme.typography.bodySmall)
        bitmap == null -> CircularProgressIndicator(modifier = Modifier.heightIn(min = 120.dp))
        else -> Image(bitmap = bitmap!!, contentDescription = file.name)
    }
}
