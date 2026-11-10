package io.github.alexanderlanganke.kardisynch.ui.webpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.i18n.I18n
import io.github.alexanderlanganke.kardisynch.core.i18n.Lang
import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import io.github.alexanderlanganke.kardisynch.core.webpanel.Portal
import io.github.alexanderlanganke.kardisynch.core.webpanel.defaultPortalCategories
import io.github.alexanderlanganke.kardisynch.ui.detail.PlainChip
import io.github.alexanderlanganke.kardisynch.ui.theme.ManufacturerWordmark

/** A downloaded report found in the downloads folder, waiting for the person to decide. */
data class DetectedDownload(
    val id: String,
    val fileName: String,
    val sizeText: String,
    /** The manufacturer, when the file's origin is a known portal; null when only the timing suggested it. */
    val manufacturer: String?,
)

/**
 * What the portals screen needs from the platform. Null where downloads can't be watched (the screen then
 * shows only the portal links).
 */
class PortalsController(
    val downloads: List<DetectedDownload>,
    val importedNames: List<String>,
    val watching: Boolean,
    val folderLabel: String?,
    val onWatchingChange: ((Boolean) -> Unit)?,
    val onPickFolder: (() -> Unit)?,
    /** Called when a portal is opened, so downloads that follow can be linked to it. */
    val onPortalOpened: (Portal) -> Unit,
    val onImport: (id: String) -> Unit,
    val onIgnore: (id: String) -> Unit,
)

@Composable
fun WebPortalsScreen(onOpenUrl: (String) -> Unit, controller: PortalsController?, modifier: Modifier = Modifier) {
    val europe = I18n.lang == Lang.DE
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 880.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(tr("Web portals"), style = MaterialTheme.typography.headlineSmall)
            Text(
                tr("Portals open in your own browser, where your saved logins work. KardiSynch stores no passwords. When you download a report there, it shows up below and can be imported with one tap."),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (controller != null) DownloadsSection(controller)

            defaultPortalCategories(europe).forEach { category ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(tr(category.title), style = MaterialTheme.typography.titleMedium)
                    category.items.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            pair.forEach { portal -> PortalCard(portal, Modifier.weight(1f)) { controller?.onPortalOpened?.invoke(portal); onOpenUrl(portal.url) } }
                            if (pair.size == 1) Box(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PortalCard(portal: Portal, modifier: Modifier, onOpen: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = modifier) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(portal.label, style = MaterialTheme.typography.titleSmall)
                portal.manufacturer?.let { ManufacturerWordmark(it) }
            }
            OutlinedButton(onClick = onOpen) { Text(tr("Open in browser")) }
        }
    }
}

@Composable
private fun DownloadsSection(c: PortalsController) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(tr("Downloaded reports"), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            if (c.downloads.isEmpty()) {
                Text(
                    if (c.watching) tr("Nothing new yet. PDF and ZIP files you download from a portal appear here.") else tr("Watching the downloads folder is off."),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            c.downloads.forEach { d ->
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(d.fileName, style = MaterialTheme.typography.titleSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                PlainChip(d.sizeText)
                                if (d.manufacturer != null) ManufacturerWordmark(d.manufacturer)
                                else Text(tr("Probably from the portal you just opened"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Button(onClick = { c.onImport(d.id) }) { Text(tr("Import")) }
                        TextButton(onClick = { c.onIgnore(d.id) }) { Text(tr("Ignore")) }
                    }
                }
            }
            if (c.importedNames.isNotEmpty()) {
                Text(tr("Sent to the inbox: {names}", "names" to c.importedNames.takeLast(3).joinToString(", ")), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                c.onWatchingChange?.let { change ->
                    Checkbox(c.watching, onCheckedChange = change)
                    Text(tr("Watch the downloads folder"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                c.folderLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer) }
                c.onPickFolder?.let { TextButton(onClick = it) { Text(tr("Change folder")) } }
            }
        }
    }
}
