package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.ui.graphics.ImageBitmap

/** Decodes [bytes] (PNG/JPEG/etc.) into a displayable bitmap, or null if they're not a recognized image format — the raw document viewer's image-file case (parity plan Phase 11). */
expect fun decodeImage(bytes: ByteArray): ImageBitmap?
