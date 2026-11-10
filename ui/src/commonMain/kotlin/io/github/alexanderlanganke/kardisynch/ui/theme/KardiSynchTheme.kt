package io.github.alexanderlanganke.kardisynch.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * The one Material 3 theme the whole app is wrapped in, following the same
 * rules as the rest of the Essentials suite: it follows the OS light/dark
 * setting, uses Material You colours where the platform has them (Android
 * 12+) and the static Material 3 baseline everywhere else (desktop).
 * [darkTheme] is passed explicitly only to honour the user's saved
 * Light/Dark/System choice ([ThemeMode]). Never a bare `MaterialTheme { }` or
 * a hand-picked colour scheme anywhere else in the app.
 */
@Composable
fun KardiSynchTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme: ColorScheme =
        (if (dynamicColor) platformDynamicColorScheme(darkTheme) else null)
            ?: if (darkTheme) darkColorScheme() else lightColorScheme()
    CompositionLocalProvider(LocalStatusPalette provides statusPalette(darkTheme)) {
        MaterialTheme(colorScheme = colorScheme, content = content)
    }
}

/** The platform's own wallpaper-derived scheme, or null where there isn't one (desktop, Android below 12). */
@Composable
internal expect fun platformDynamicColorScheme(darkTheme: Boolean): ColorScheme?
