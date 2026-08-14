package io.github.alexanderlanganke.kardisynch.core.parsers.diagnostics

import io.github.alexanderlanganke.kardisynch.core.model.ParseStatus

/**
 * Shared fail-soft extraction infrastructure, ported from
 * `parsers/parseDiagnostics.ts` (issue #193). A parser used to wrap its
 * entire extraction in one outer try/catch, so a single unexpected field
 * anywhere silently discarded the whole report; these helpers isolate
 * failures per field/section instead — a failed extraction is recorded as a
 * diagnostic and the parser keeps going with a fallback, so one bad field no
 * longer costs the whole report.
 *
 * Not yet wired into the 5 already-ported parsers — each is a working,
 * cross-validated-against-real-fixtures implementation of its own error
 * handling today (`safe { } catch { default }`), and retrofitting this
 * framework into them is a separate, larger, higher-regression-risk pass
 * that deserves its own careful review + fixture re-validation, not
 * something to bundle into landing the infrastructure itself. Until that
 * retrofit happens, [ParseStatus.PARTIAL] is never actually produced by any
 * parser — every report is either OK or FAILED, matching what those parsers
 * already do (confirmed in the #193 audit).
 */

data class ParseDiagnostic(
    val stage: String,
    val severity: Severity,
    val message: String,
    val detail: String? = null,
) {
    enum class Severity { WARNING, ERROR }
}

class DiagnosticsCollector {
    private val _diagnostics = mutableListOf<ParseDiagnostic>()
    val diagnostics: List<ParseDiagnostic> get() = _diagnostics
    val hasErrors: Boolean get() = _diagnostics.any { it.severity == ParseDiagnostic.Severity.ERROR }

    fun warn(stage: String, message: String, detail: String? = null) {
        _diagnostics.add(ParseDiagnostic(stage, ParseDiagnostic.Severity.WARNING, message, detail))
    }

    fun error(stage: String, message: String, detail: String? = null) {
        _diagnostics.add(ParseDiagnostic(stage, ParseDiagnostic.Severity.ERROR, message, detail))
    }
}

/**
 * Runs [fn], returning its result. If [fn] throws or returns null, records a
 * warning diagnostic tagged with [stage] and returns [fallback] instead —
 * turning "one bad field kills everything" into "one bad field is just
 * missing".
 */
fun <T> safeExtract(collector: DiagnosticsCollector, stage: String, fallback: T, fn: () -> T?): T = try {
    fn() ?: fallback
} catch (e: Exception) {
    collector.warn(stage, e.message ?: e.toString())
    fallback
}

data class VariantMatch<T>(val value: T, val variant: String)

/**
 * Tries each `(name, test)` candidate in order and returns the first one
 * whose `test()` yields a non-null value, recording which candidate matched
 * (or that none did) as a diagnostic. Makes the format-variant fallbacks
 * already implicit in the parsers (multiple attribute-name spellings,
 * multiple XML context names, coded-vs-freeform detection, etc.) visible
 * instead of silent.
 */
fun <T> detectVariant(collector: DiagnosticsCollector, stage: String, candidates: List<Pair<String, () -> T?>>): VariantMatch<T>? {
    for ((name, test) in candidates) {
        val result = try {
            test()
        } catch (e: Exception) {
            collector.warn(stage, "Variant probe '$name' threw: ${e.message ?: e}")
            continue
        }
        if (result != null) return VariantMatch(result, name)
    }
    collector.warn(stage, "No known variant matched (tried: ${candidates.joinToString(", ") { it.first }})")
    return null
}

/**
 * Derives the coarse-grained [ParseStatus] from collected diagnostics and
 * whether enough identity was recovered to be useful downstream: FAILED
 * when neither patient nor device identity was found at all, OK when
 * nothing went wrong, PARTIAL when identity was recovered but at least one
 * field fell back to a default along the way.
 */
fun deriveParseStatus(collector: DiagnosticsCollector, hasPatientIdentity: Boolean, hasDeviceIdentity: Boolean): ParseStatus = when {
    !hasPatientIdentity && !hasDeviceIdentity -> ParseStatus.FAILED
    collector.diagnostics.isEmpty() -> ParseStatus.OK
    else -> ParseStatus.PARTIAL
}
