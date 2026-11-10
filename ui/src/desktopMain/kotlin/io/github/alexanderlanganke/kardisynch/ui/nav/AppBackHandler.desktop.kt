package io.github.alexanderlanganke.kardisynch.ui.nav

import androidx.compose.runtime.Composable

/** Desktop has no system back; Escape is handled by the shell's root key handler. */
@Composable
actual fun AppBackHandler(enabled: Boolean, onBack: () -> Unit) = Unit
