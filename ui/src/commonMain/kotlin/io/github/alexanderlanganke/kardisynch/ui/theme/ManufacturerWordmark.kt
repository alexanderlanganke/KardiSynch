package io.github.alexanderlanganke.kardisynch.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The manufacturer's name set as a plain wordmark, as the Electron app's SVG wordmarks in its assets/logos folder did (text only, no brand artwork). */
private data class Wordmark(val text: String, val color: Color)

private fun wordmarkFor(manufacturer: String?): Wordmark = when {
    manufacturer == null || manufacturer.isBlank() -> Wordmark("UNKNOWN", Color(0xFF64748B))
    manufacturer.contains("medtronic", true) -> Wordmark("Medtronic", Color(0xFF004B87))
    manufacturer.contains("biotronik", true) -> Wordmark("BIOTRONIK", Color(0xFF5F212D))
    manufacturer.contains("boston", true) -> Wordmark("Boston Scientific", Color(0xFF003C71))
    manufacturer.contains("abbott", true) || manufacturer.contains("jude", true) -> Wordmark("Abbott", Color(0xFF000000))
    manufacturer.contains("microport", true) || manufacturer.contains("sorin") || manufacturer.contains("livanova") -> Wordmark("MicroPort", Color(0xFF0099CC))
    manufacturer.contains("impulse", true) -> Wordmark("IMPULSE DYNAMICS", Color(0xFF333333))
    else -> Wordmark(manufacturer.uppercase().take(18), Color(0xFF64748B))
}

/**
 * A small light "plate" carrying the manufacturer's wordmark. The plate stays light in dark mode so the
 * brand colours keep their contrast; it never carries meaning by colour alone (the name is the content).
 */
@Composable
fun ManufacturerWordmark(manufacturer: String?, modifier: Modifier = Modifier) {
    val mark = wordmarkFor(manufacturer)
    Surface(
        shape = MaterialTheme.shapes.small,
        color = Color(0xFFF6F6F8),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.semantics { contentDescription = manufacturer ?: "Unknown manufacturer" },
    ) {
        Text(
            mark.text, color = mark.color, fontWeight = FontWeight.Bold, fontFamily = FontFamily.SansSerif,
            fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Clip,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}
