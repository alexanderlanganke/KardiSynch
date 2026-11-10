package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.ui.theme.Status
import io.github.alexanderlanganke.kardisynch.ui.theme.statusColors

/**
 * A visit's files split into the two things a clinician asks for: the
 * manufacturer's raw file(s) and the PDF report(s). Sorted by name so the
 * order never depends on how the file system happens to list a folder.
 */
internal class VisitFileSet(files: List<DataEntry>) {
    val pdfs: List<DataEntry> = files.filter { it.name.endsWith(".pdf", ignoreCase = true) }.sortedBy { it.name }
    val raws: List<DataEntry> = files.filter { !it.name.endsWith(".pdf", ignoreCase = true) }.sortedBy { it.name }
    val total: Int = files.size

    /** "pdd", "xml", "bnk"… of the first raw file, for chips. */
    val rawLabel: String? get() = raws.firstOrNull()?.name?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.isNotEmpty() }?.let { ".$it" } ?: raws.firstOrNull()?.let { "raw" }
}

/** Loads a visit's files once; null while loading. */
@Composable
internal fun rememberVisitFiles(
    patientId: String,
    reportId: String,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
): VisitFileSet? {
    var set by remember(patientId, reportId, onGetVisitFiles) { mutableStateOf<VisitFileSet?>(null) }
    LaunchedEffect(patientId, reportId, onGetVisitFiles) {
        set = onGetVisitFiles?.let { VisitFileSet(it(patientId, reportId)) } ?: VisitFileSet(emptyList())
    }
    return set
}

/** A small status chip: colour from the status palette, always with an icon and words. */
@Composable
internal fun StatusChip(text: String, status: Status) {
    val palette = statusColors()
    Surface(shape = RoundedCornerShape(8.dp), color = palette.container(status)) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(status.icon, contentDescription = null, tint = palette.content(status), modifier = Modifier.size(14.dp))
            Text(text, style = MaterialTheme.typography.labelMedium, color = palette.content(status))
        }
    }
}

/** A neutral chip (file kind, counts). */
@Composable
internal fun PlainChip(text: String) {
    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
    }
}

/** Which files a visit holds, and what is missing: the answer to "do I have the PDF?" without opening anything. */
@Composable
internal fun VisitFileChips(files: VisitFileSet?) {
    if (files == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            files.total == 0 -> StatusChip(tr("No files"), Status.ATTENTION)
            else -> {
                if (files.raws.isNotEmpty()) PlainChip(files.rawLabel ?: tr("raw"))
                if (files.pdfs.isNotEmpty()) PlainChip(if (files.pdfs.size > 1) tr("{n} PDFs", "n" to files.pdfs.size) else "PDF")
                if (files.raws.isNotEmpty() && files.pdfs.isEmpty()) StatusChip(tr("No PDF"), Status.ATTENTION)
                if (files.raws.isEmpty() && files.pdfs.isNotEmpty()) StatusChip(tr("No raw file"), Status.ATTENTION)
            }
        }
    }
}
