package io.github.alexanderlanganke.kardisynch.apps.desktop

import com.google.zxing.BinaryBitmap
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.common.HybridBinarizer
import java.awt.image.BufferedImage
import kotlin.test.Test
import kotlin.test.assertEquals

/** Round-trips [renderQrCodeImage] through zxing's own decoder — proves the rendered image is a real, scannable QR code, not just black-and-white noise. */
class QrCodeRenderingTest {
    @Test
    fun `a rendered QR code decodes back to the original content`() {
        val content = """{"v":1,"t":"fu","ts":1,"d":{"date":"2026-01-01"}}"""
        val image = renderQrCodeImage(content, sizePx = 200)

        val bitmap = BinaryBitmap(HybridBinarizer(TestLuminanceSource(image)))
        val decoded = MultiFormatReader().decode(bitmap)

        assertEquals(content, decoded.text)
    }
}

/** Minimal grayscale adapter — avoids pulling in the separate zxing:javase artifact just for one test. */
private class TestLuminanceSource(private val image: BufferedImage) : LuminanceSource(image.width, image.height) {
    override fun getRow(y: Int, row: ByteArray?): ByteArray {
        val out = if (row != null && row.size >= width) row else ByteArray(width)
        for (x in 0 until width) {
            val rgb = image.getRGB(x, y)
            val r = (rgb shr 16) and 0xFF
            val g = (rgb shr 8) and 0xFF
            val b = rgb and 0xFF
            out[x] = ((r * 306 + g * 601 + b * 117) shr 10).toByte()
        }
        return out
    }

    override fun getMatrix(): ByteArray {
        val out = ByteArray(width * height)
        for (y in 0 until height) {
            val row = getRow(y, null)
            row.copyInto(out, y * width)
        }
        return out
    }
}
