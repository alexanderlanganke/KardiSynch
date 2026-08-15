package io.github.alexanderlanganke.kardisynch.ui.detail

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Phase 11 PDF-rendering spike, made permanent as a real test — verifies
 * `openPdf` actually renders a page to a correctly-sized bitmap, not just
 * that the code compiles. [minimalOnePagePdf] hand-builds a tiny valid PDF
 * (one page, 612x792pt, some text and a rectangle) at the raw byte level
 * rather than checking in a binary fixture, matching this project's
 * existing mock-fixture-over-binary-file convention (see `core.testing`).
 */
class PdfPageRendererTest {
    /** A minimal, valid single-page PDF — hand-assembled xref table and all, no external library needed to produce it. */
    private fun minimalOnePagePdf(): ByteArray {
        val content = "BT /F1 24 Tf 72 700 Td (KardiSynch PDF Render Spike) Tj ET\n1 0 0 RG 72 600 200 50 re S\n"
        val objects = listOf(
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            "<< /Length ${content.toByteArray().size} >>\nstream\n$content\nendstream",
        )

        val out = StringBuilder("%PDF-1.4\n")
        val offsets = mutableListOf(0)
        for ((i, obj) in objects.withIndex()) {
            offsets += out.toString().toByteArray().size
            out.append("${i + 1} 0 obj\n$obj\nendobj\n")
        }
        val xrefOffset = out.toString().toByteArray().size
        out.append("xref\n0 ${objects.size + 1}\n")
        out.append("0000000000 65535 f \n")
        for (off in offsets.drop(1)) out.append("${off.toString().padStart(10, '0')} 00000 n \n")
        out.append("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n$xrefOffset\n%%EOF")
        return out.toString().toByteArray()
    }

    @Test
    fun `openPdf parses a valid PDF and reports its page count`() {
        val renderer = openPdf(minimalOnePagePdf())
        assertNotNull(renderer)
        assertEquals(1, renderer.pageCount)
        renderer.close()
    }

    @Test
    fun `renderPage produces a bitmap scaled to the requested width`() {
        val renderer = openPdf(minimalOnePagePdf())
        assertNotNull(renderer)
        val bitmap = renderer.renderPage(0, targetWidthPx = 400)
        assertNotNull(bitmap)
        assertEquals(400, bitmap.width)
        // 612x792pt page at a width-derived DPI should keep the aspect ratio (792/612 ≈ 1.294).
        assertTrue(bitmap.height in 500..520, "expected height near 517 for a 400px-wide US-Letter page, got ${bitmap.height}")
        renderer.close()
    }

    @Test
    fun `openPdf returns null for bytes that are not a PDF at all`() {
        val renderer = openPdf("not a pdf file".toByteArray())
        assertNull(renderer)
    }
}
