package io.github.alexanderlanganke.kardisynch.ui.theme

/**
 * Manual light/dark/system override (parity plan Phase 3) — Electron's
 * `ThemeProvider.tsx` supports all three at the type level but its
 * `ThemeToggle` only ever exercises light/dark (no UI control ever sets
 * `system`), and its hardcoded default is dark. This port's toggle
 * genuinely exercises all three, since the plumbing is cheap once a
 * persisted setting exists at all — but keeps Electron's dark default for
 * a fresh install, so existing behavior doesn't silently change underfoot
 * for anyone already relying on it.
 */
enum class ThemeMode { LIGHT, DARK, SYSTEM }

fun ThemeMode.toSettingValue(): String = name

fun parseThemeMode(value: String?): ThemeMode = when (value) {
    ThemeMode.LIGHT.name -> ThemeMode.LIGHT
    ThemeMode.SYSTEM.name -> ThemeMode.SYSTEM
    else -> ThemeMode.DARK
}
