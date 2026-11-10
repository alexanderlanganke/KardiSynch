package io.github.alexanderlanganke.kardisynch.ui.nav

import androidx.compose.runtime.Composable

/**
 * System back pops exactly one level: the Android back gesture/button here,
 * Escape on desktop (handled on the shell's root, see `KardiSynchApp`).
 * Install it with the destination the on-screen back control also uses, so
 * the two can never drift apart. Without it, back from any nested screen
 * closes the app.
 */
@Composable
expect fun AppBackHandler(enabled: Boolean, onBack: () -> Unit)
