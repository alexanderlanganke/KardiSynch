package io.github.alexanderlanganke.kardisynch.ui.theme

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.GppGood
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Clinical status is DATA colour, so it gets its own light/dark pairs (a
 * single ARGB would be unreadable in one of the two themes), and is never the
 * only signal: [Status.icon] and [Status.label] always travel with it.
 */
enum class Status(val label: String) {
    OK("No advisory"),
    ATTENTION("Needs attention"),
    ALERT("Advisory"),
    ;

    val icon: ImageVector
        get() = when (this) {
            OK -> Icons.Filled.GppGood
            ATTENTION -> Icons.Filled.Warning
            ALERT -> Icons.Filled.Error
        }
}

@Immutable
class StatusPalette(
    val okContainer: Color, val onOk: Color,
    val attentionContainer: Color, val onAttention: Color,
    val alertContainer: Color, val onAlert: Color,
) {
    fun container(status: Status): Color = when (status) {
        Status.OK -> okContainer
        Status.ATTENTION -> attentionContainer
        Status.ALERT -> alertContainer
    }

    fun content(status: Status): Color = when (status) {
        Status.OK -> onOk
        Status.ATTENTION -> onAttention
        Status.ALERT -> onAlert
    }
}

private val LightStatus = StatusPalette(
    okContainer = Color(0xFFDDF3E3), onOk = Color(0xFF14572E),
    attentionContainer = Color(0xFFFFEFC9), onAttention = Color(0xFF6B4400),
    alertContainer = Color(0xFFF9DEDC), onAlert = Color(0xFF8C1D18),
)

private val DarkStatus = StatusPalette(
    okContainer = Color(0xFF14341F), onOk = Color(0xFF8FE3A8),
    attentionContainer = Color(0xFF3D2E00), onAttention = Color(0xFFF5CB5C),
    alertContainer = Color(0xFF8C1D18), onAlert = Color(0xFFF9DEDC),
)

fun statusPalette(darkTheme: Boolean): StatusPalette = if (darkTheme) DarkStatus else LightStatus

val LocalStatusPalette = staticCompositionLocalOf { LightStatus }

/** Convenience for call sites: `statusColors().container(Status.OK)`. */
@Composable
@ReadOnlyComposable
fun statusColors(): StatusPalette = LocalStatusPalette.current

/** Manufacturer brand hues are small identity dots, never text colour. */
fun manufacturerDot(manufacturer: String?): Color = when {
    manufacturer == null -> Color(0xFF8A8A8A)
    manufacturer.contains("medtronic", true) -> Color(0xFF004B87)
    manufacturer.contains("biotronik", true) -> Color(0xFF5F212D)
    manufacturer.contains("boston", true) -> Color(0xFF003C71)
    manufacturer.contains("abbott", true) || manufacturer.contains("jude", true) -> Color(0xFF8A8A8A)
    manufacturer.contains("microport", true) -> Color(0xFF0099CC)
    else -> Color(0xFF8A8A8A)
}
