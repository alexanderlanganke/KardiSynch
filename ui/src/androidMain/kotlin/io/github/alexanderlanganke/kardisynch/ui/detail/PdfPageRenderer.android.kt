package io.github.alexanderlanganke.kardisynch.ui.detail

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File

/**
 * `PdfRenderer` needs a real file descriptor, not raw bytes — the incoming
 * [bytes] (already read off `_DATA` via `DataRootReader.readBytes`) are
 * staged to a temp file, which [close] deletes again.
 */
actual fun openPdf(bytes: ByteArray): PdfPageRenderer? = try {
    val tempFile = File.createTempFile("kardisynch-pdf-", ".pdf").apply { writeBytes(bytes) }
    val pfd = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY)
    AndroidPdfPageRenderer(PdfRenderer(pfd), pfd, tempFile)
} catch (e: Exception) {
    null
}

private class AndroidPdfPageRenderer(
    private val renderer: PdfRenderer,
    private val pfd: ParcelFileDescriptor,
    private val tempFile: File,
) : PdfPageRenderer {
    override val pageCount: Int = renderer.pageCount

    override fun renderPage(index: Int, targetWidthPx: Int): ImageBitmap? = try {
        renderer.openPage(index).use { page ->
            val scale = targetWidthPx.toFloat() / page.width
            val targetHeightPx = (page.height * scale).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(targetWidthPx, targetHeightPx, Bitmap.Config.ARGB_8888)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bitmap.asImageBitmap()
        }
    } catch (e: Exception) {
        null
    }

    override fun close() {
        renderer.close()
        pfd.close()
        tempFile.delete()
    }
}
