package io.github.alexanderlanganke.kardisynch.ui.detail

import androidx.compose.ui.graphics.ImageBitmap

/**
 * A page-at-a-time PDF renderer for the raw document viewer (parity plan
 * Phase 11) — desktop via Apache PDFBox, Android via the platform's own
 * `android.graphics.pdf.PdfRenderer`. A plain function-returning-interface
 * rather than an `expect class` since the two platforms' setup differs too
 * much to share a constructor shape (Android's `PdfRenderer` needs a real
 * file descriptor, not raw bytes directly — [openPdf]'s Android `actual`
 * stages the bytes to a temp file first).
 */
interface PdfPageRenderer {
    val pageCount: Int

    /** Renders page [index] (0-based) scaled to [targetWidthPx] wide, or null if the page can't be rendered. */
    fun renderPage(index: Int, targetWidthPx: Int): ImageBitmap?

    /** Releases the underlying document/file handles — callers must call this when done, there's no finalizer. */
    fun close()
}

/** Opens [bytes] as a PDF, or null if they're not a valid/renderable PDF. */
expect fun openPdf(bytes: ByteArray): PdfPageRenderer?
