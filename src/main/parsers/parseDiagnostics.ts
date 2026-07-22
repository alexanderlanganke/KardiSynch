// src/main/parsers/parseDiagnostics.ts
//
// Shared fail-soft extraction helpers for the manufacturer parsers. A parser
// used to wrap its entire extraction in one outer try/catch, so a single
// unexpected field anywhere silently discarded the whole report (return
// null). These helpers isolate failures per field/section instead: a failed
// extraction is recorded as a diagnostic and the parser keeps going with a
// safe fallback, so one bad field no longer costs the whole report.

export interface ParseDiagnostic {
  stage: string;
  severity: 'warning' | 'error';
  message: string;
  detail?: string;
}

export class DiagnosticsCollector {
  private diagnostics: ParseDiagnostic[] = [];

  warn(stage: string, message: string, detail?: string): void {
    this.diagnostics.push({ stage, severity: 'warning', message, detail });
  }

  error(stage: string, message: string, detail?: string): void {
    this.diagnostics.push({ stage, severity: 'error', message, detail });
  }

  get list(): ParseDiagnostic[] {
    return this.diagnostics;
  }

  get hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }
}

/**
 * Runs `fn`, returning its result. If `fn` throws, records a warning
 * diagnostic tagged with `stage` and returns `fallback` instead of
 * propagating the error — turning "one bad field kills everything" into
 * "one bad field is just missing".
 */
export function safeExtract<T>(
  collector: DiagnosticsCollector,
  stage: string,
  fn: () => T,
  fallback: T
): T {
  try {
    const result = fn();
    return result === undefined || result === null ? fallback : result;
  } catch (e) {
    collector.warn(stage, (e as Error).message || String(e));
    return fallback;
  }
}

/**
 * Tries each candidate in order and returns the first one whose `test()`
 * yields a non-null/undefined value, recording which candidate matched (or
 * that none did) as a diagnostic. This is what makes the format-variant
 * fallbacks already implicit in the parsers (multiple attribute-name
 * spellings, multiple XML context names, coded-vs-freeform detection, etc.)
 * visible instead of silent.
 */
export function detectVariant<T>(
  collector: DiagnosticsCollector,
  stage: string,
  candidates: { name: string; test: () => T | null | undefined }[]
): { value: T; variant: string } | null {
  for (const candidate of candidates) {
    let result: T | null | undefined;
    try {
      result = candidate.test();
    } catch (e) {
      collector.warn(stage, `Variant probe '${candidate.name}' threw: ${(e as Error).message || e}`);
      continue;
    }
    if (result !== null && result !== undefined) {
      return { value: result, variant: candidate.name };
    }
  }
  collector.warn(stage, `No known variant matched (tried: ${candidates.map(c => c.name).join(', ')})`);
  return null;
}

/**
 * Derives the coarse-grained parseStatus from collected diagnostics and
 * whether enough identity was recovered to be useful downstream. Mirrors the
 * bar watcher.ts already applies implicitly when deciding whether a report
 * is worth routing to manual sorting vs treating as unusable (issue #133).
 */
export function deriveParseStatus(
  collector: DiagnosticsCollector,
  hasPatientIdentity: boolean,
  hasDeviceIdentity: boolean
): 'ok' | 'partial' | 'failed' {
  if (!hasPatientIdentity && !hasDeviceIdentity) return 'failed';
  if (collector.list.length === 0) return 'ok';
  return 'partial';
}
