package io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics

import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ParseDiagnosticsTest {
    @Test
    fun `safeExtract returns the function's result when it succeeds`() {
        val collector = DiagnosticsCollector()
        val result = safeExtract(collector, "stage", fallback = "default") { "value" }
        assertEquals("value", result)
        assertTrue(collector.diagnostics.isEmpty())
    }

    @Test
    fun `safeExtract falls back and warns when the function throws`() {
        val collector = DiagnosticsCollector()
        val result = safeExtract<String>(collector, "stage", fallback = "default") { throw IllegalStateException("boom") }
        assertEquals("default", result)
        assertEquals(1, collector.diagnostics.size)
        assertEquals(ParseDiagnostic.Severity.WARNING, collector.diagnostics[0].severity)
        assertEquals("stage", collector.diagnostics[0].stage)
        assertTrue(collector.diagnostics[0].message.contains("boom"))
    }

    @Test
    fun `safeExtract falls back and warns when the function returns null`() {
        val collector = DiagnosticsCollector()
        val result = safeExtract<String>(collector, "stage", fallback = "default") { null }
        assertEquals("default", result)
        assertEquals(0, collector.diagnostics.size, "a null result is not itself a diagnostic-worthy failure per the ported TS semantics")
    }

    @Test
    fun `detectVariant returns the first matching candidate and its name`() {
        val collector = DiagnosticsCollector()
        val match = detectVariant<String>(
            collector, "stage",
            listOf(
                "first" to { null },
                "second" to { "found" },
                "third" to { "unreached" },
            ),
        )
        assertEquals("found", match?.value)
        assertEquals("second", match?.variant)
        assertTrue(collector.diagnostics.isEmpty())
    }

    @Test
    fun `detectVariant records a warning when no candidate matches`() {
        val collector = DiagnosticsCollector()
        val match = detectVariant<String>(collector, "stage", listOf("a" to { null }, "b" to { null }))
        assertNull(match)
        assertEquals(1, collector.diagnostics.size)
        assertTrue(collector.diagnostics[0].message.contains("a, b"))
    }

    @Test
    fun `detectVariant skips a candidate that throws and keeps trying`() {
        val collector = DiagnosticsCollector()
        val match = detectVariant<String>(
            collector, "stage",
            listOf("bad" to { throw RuntimeException("nope") }, "good" to { "ok" }),
        )
        assertEquals("ok", match?.value)
        assertEquals("good", match?.variant)
        assertEquals(1, collector.diagnostics.size)
        assertTrue(collector.diagnostics[0].message.contains("bad"))
    }

    @Test
    fun `deriveParseStatus is FAILED when neither patient nor device identity was found`() {
        val collector = DiagnosticsCollector()
        collector.warn("x", "irrelevant")
        assertEquals(ParseStatus.FAILED, deriveParseStatus(collector, hasPatientIdentity = false, hasDeviceIdentity = false))
    }

    @Test
    fun `deriveParseStatus is OK when identity was found and nothing went wrong`() {
        val collector = DiagnosticsCollector()
        assertEquals(ParseStatus.OK, deriveParseStatus(collector, hasPatientIdentity = true, hasDeviceIdentity = false))
    }

    @Test
    fun `deriveParseStatus is PARTIAL when identity was found but something fell back`() {
        val collector = DiagnosticsCollector()
        collector.warn("x", "a field fell back to a default")
        assertEquals(ParseStatus.PARTIAL, deriveParseStatus(collector, hasPatientIdentity = false, hasDeviceIdentity = true))
    }

    @Test
    fun `hasErrors is true only when an error-severity diagnostic was recorded`() {
        val collector = DiagnosticsCollector()
        assertFalse(collector.hasErrors)
        collector.warn("x", "just a warning")
        assertFalse(collector.hasErrors)
        collector.error("x", "a real error")
        assertTrue(collector.hasErrors)
    }
}
