package io.github.alexanderlanganke.kardisynch.ui.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable

/** The one back control for every top bar: an icon with a spoken label. Draws nothing when [onBack] is null (a root destination). */
@Composable
fun BackNavigationIcon(onBack: (() -> Unit)?, description: String = "Back") {
    if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = description) }
}
