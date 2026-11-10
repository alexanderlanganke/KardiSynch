package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
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
 * Simplified from the original in one way: no PDF search/zoom (a stretch
 * goal per the parity plan, not a blocker for landing this). Drag-and-drop
 * visit-to-pane assignment *is* built (see [TwoPaneViewer]'s doc comment) —
 * this composable is what a pane renders once a visit lands in it, in Raw
 * mode.
 */
@Composable
fun RawFileViewer(
    files: List<DataEntry>,
    onReadBytes: suspend (fileHandle: String) -> ByteArray?,
    onReadText: suspend (fileHandle: String) -> String?,
) {
    var index by remember(files) { mutableStateOf(0) }

    if (files.isEmpty()) {
        Text(tr("No files found for this visit."), style = MaterialTheme.typography.bodySmall)
        return
    }

    val file = files[index.coerceIn(0, files.size - 1)]

    Column(modifier = Modifier.fillMaxWidth()) {
        if (files.size > 1) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { index = (index - 1 + files.size) % files.size }) { Text(tr("◀ Previous")) }
                Text("${file.name} (${index + 1} of ${files.size})", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { index = (index + 1) % files.size }) { Text(tr("Next ▶")) }
            }
        } else {
            Text(file.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 4.dp))
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
            "This is the manufacturer's own file format (${file.name.substringAfterLast('.', "no extension")}), which can't be shown here. Its values are on the Formatted tab.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.heightIn(min = 120.dp),
        )
    }
}

/**
 * When set, every PDF page shown below shares this one scroll position, so two
 * panes comparing two visits scroll together. Null (the default) gives each its
 * own. Provided by the two-pane viewer's "Scroll together" switch.
 */
val LocalSharedPdfScroll = compositionLocalOf<ScrollState?> { null }

/** An open PDF plus the lock that serialises its page renders and its close (PDF libraries are not thread-safe). */
private class PdfSession(val renderer: PdfPageRenderer) {
    val lock = Mutex()
}

/** A rendered page, or null when it could not be rendered. */
private class RenderedPage(val bitmap: ImageBitmap?)

@OptIn(DelicateCoroutinesApi::class)
@Composable
private fun PdfFileContent(file: DataEntry, onReadBytes: suspend (String) -> ByteArray?) {
    var session by remember(file.handle) { mutableStateOf<PdfSession?>(null) }
    var loadFailed by remember(file.handle) { mutableStateOf<String?>(null) }

    // Reading, parsing and rendering a PDF takes anywhere from tens of milliseconds to several seconds
    // (more on a busy machine). All of it runs off the UI thread; doing it inline froze the whole window
    // for as long as it took, once per pane, every time a patient was opened.
    LaunchedEffect(file.handle) {
        val bytes = withContext(Dispatchers.Default) { runCatching { onReadBytes(file.handle) }.getOrNull() }
        val opened = bytes?.let { withContext(Dispatchers.Default) { openPdf(it) } }
        session = opened?.let { PdfSession(it) }
        loadFailed = when {
            opened != null -> null
            bytes == null -> "The file ${file.name} could not be read from disk."
            bytes.isEmpty() -> "The file ${file.name} is empty."
            else -> "The PDF ${file.name} could not be opened (${bytes.size / 1024} KB). It may be damaged or password protected."
        }
    }
    DisposableEffect(file.handle) {
        onDispose {
            val s = session
            if (s != null) GlobalScope.launch(Dispatchers.Default) { s.lock.withLock { s.renderer.close() } }
        }
    }

    val current = session
    when {
        loadFailed != null -> Text(loadFailed!!, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp))
        current == null -> CircularProgressIndicator(modifier = Modifier.heightIn(min = 120.dp))
        else -> {
            val pageCount = current.renderer.pageCount
            val ownScroll = rememberScrollState()
            // Every page in one continuous scroll, like a PDF reader. Pages render one after another
            // (the session lock serialises them) and keep a page-shaped placeholder until ready, so
            // the layout, and with it a linked scroll position, does not jump as pages arrive.
            Column(
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .verticalScroll(LocalSharedPdfScroll.current ?: ownScroll).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                for (page in 0 until pageCount) {
                    val rendered by produceState<RenderedPage?>(null, current, page) {
                        value = withContext(Dispatchers.Default) { RenderedPage(current.lock.withLock { current.renderer.renderPage(page, targetWidthPx = 1100) }) }
                    }
                    val done = rendered
                    val bmp = done?.bitmap
                    when {
                        bmp != null -> Image(bitmap = bmp, contentDescription = "${file.name}, page ${page + 1} of $pageCount", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth())
                        else -> Box(Modifier.fillMaxWidth().aspectRatio(1f / 1.414f).background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
                            if (done == null) CircularProgressIndicator() else Text(tr("Couldn't render page {n}.", "n" to (page + 1)), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TextFileContent(file: DataEntry, onReadText: suspend (String) -> String?) {
    var text by remember(file.handle) { mutableStateOf<String?>(null) }
    LaunchedEffect(file.handle) { text = onReadText(file.handle) ?: tr("Couldn't read this file.") }
    Text(
        text ?: tr("Loading…"),
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
        loadFailed -> Text(tr("Couldn't display this image."), style = MaterialTheme.typography.bodySmall)
        bitmap == null -> CircularProgressIndicator(modifier = Modifier.heightIn(min = 120.dp))
        else -> Image(bitmap = bitmap!!, contentDescription = file.name)
    }
}
