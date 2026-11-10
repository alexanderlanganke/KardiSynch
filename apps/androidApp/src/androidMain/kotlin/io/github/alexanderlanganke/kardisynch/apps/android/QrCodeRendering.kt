package io.github.alexanderlanganke.kardisynch.apps.android

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

/**
 * Renders [content] as a black-on-white QR code bitmap, [sizePx] square —
 * the Android counterpart to desktop's `QrCodeRendering.kt` (issue #199 was
 * desktop-only; Android previously only scanned/imported a follow-up QR, it
 * never rendered one for export — see [QrScanScreen] for the decode
 * direction, same zxing dependency). `android.graphics.Bitmap` stands in for
 * desktop's AWT `BufferedImage`; callers convert via `Bitmap.asImageBitmap()`.
 */
fun renderQrCodeBitmap(content: String, sizePx: Int = 320): Bitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx)
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.RGB_565)
    for (x in 0 until sizePx) {
        for (y in 0 until sizePx) {
            bitmap.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
        }
    }
    return bitmap
}
