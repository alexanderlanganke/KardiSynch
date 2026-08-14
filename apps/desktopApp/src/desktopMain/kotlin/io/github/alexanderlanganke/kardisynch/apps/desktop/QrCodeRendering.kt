package io.github.alexanderlanganke.kardisynch.apps.desktop

import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.awt.image.BufferedImage

/**
 * Renders [content] as a black-on-white QR code image, [sizePx] square —
 * the desktop-only rendering half of issue #199 (Android has no equivalent
 * yet; it only scans/imports, via [io.github.alexanderlanganke.kardisynch.apps.android.QrScanScreen]).
 * zxing's `QRCodeWriter` is the encoder counterpart to the `MultiFormatReader`
 * decoder already used there — same dependency, opposite direction.
 */
fun renderQrCodeImage(content: String, sizePx: Int = 320): BufferedImage {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx)
    val image = BufferedImage(sizePx, sizePx, BufferedImage.TYPE_INT_RGB)
    for (x in 0 until sizePx) {
        for (y in 0 until sizePx) {
            image.setRGB(x, y, if (matrix.get(x, y)) 0x000000 else 0xFFFFFF)
        }
    }
    return image
}
