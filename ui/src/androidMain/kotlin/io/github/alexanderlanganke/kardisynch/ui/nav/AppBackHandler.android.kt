package io.github.alexanderlanganke.kardisynch.ui.nav

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable

@Composable
actual fun AppBackHandler(enabled: Boolean, onBack: () -> Unit) = BackHandler(enabled = enabled, onBack = onBack)
