package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.Image

actual fun decodeImage(bytes: ByteArray): ImageBitmap? = try {
    Image.makeFromEncoded(bytes).toComposeImageBitmap()
} catch (e: Exception) {
    null
}
