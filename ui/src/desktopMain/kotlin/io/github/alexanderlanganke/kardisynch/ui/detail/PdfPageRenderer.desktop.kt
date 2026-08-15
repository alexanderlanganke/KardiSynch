package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.apache.pdfbox.Loader
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.rendering.PDFRenderer

actual fun openPdf(bytes: ByteArray): PdfPageRenderer? = try {
    DesktopPdfPageRenderer(Loader.loadPDF(bytes))
} catch (e: Exception) {
    null
}

private class DesktopPdfPageRenderer(private val document: PDDocument) : PdfPageRenderer {
    private val renderer = PDFRenderer(document)
    override val pageCount: Int = document.numberOfPages

    override fun renderPage(index: Int, targetWidthPx: Int): ImageBitmap? = try {
        val pageWidthPt = document.getPage(index).mediaBox.width
        val dpi = (72f * (targetWidthPx.toFloat() / pageWidthPt)).coerceIn(36f, 300f)
        renderer.renderImageWithDPI(index, dpi).toComposeImageBitmap()
    } catch (e: Exception) {
        null
    }

    override fun close() = document.close()
}
