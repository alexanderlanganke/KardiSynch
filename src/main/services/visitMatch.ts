// Decides whether an imported file belongs to an existing same-day report or
// needs a visit of its own.
//
// Two bugs pull in opposite directions here. Issue #140: while a task sat in
// the sort queue, auto-import may already have created the visit for the same
// interrogation — resolving the task must not create a duplicate. Issue #145:
// a patient can genuinely have several visits on one day (e.g. pre- and
// post-MRI interrogations) — date-prefix matching alone silently merged the
// second visit into the first, losing it. So a same-day report is only reused
// when nothing contradicts it being the same interrogation, per the same
// invariant dedupService applies (same date is a duplicate only when the
// device serial doesn't disagree).

/** Reports table row shape (subset relevant for matching). */
interface ReportRow {
  interrogation_date?: string | null;
  device_serial_number?: string | null;
}

// Files from one interrogation session can carry timestamps a few minutes
// apart (e.g. the XML export vs. a PDF printed at the end of the session),
// while genuinely distinct same-day visits are hours apart. Timestamps within
// this window are treated as the same interrogation.
const SAME_INTERROGATION_TOLERANCE_MS = 30 * 60 * 1000;

const normalizeSerial = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const timestampMs = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  // Only a value with a time component can distinguish two same-day visits.
  if (!/T\d/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Pick the existing same-day report an imported file should be merged into,
 * or null when a new visit must be created (or the decision deferred to the
 * user).
 *
 * @param candidates       All of the patient's reports on the target day.
 * @param parsed           The parsed UnifiedReport of the incoming file (null if unparseable).
 * @param explicitNewVisit The user chose "Create New Visit" in the assignment
 *                         dialog. Their choice wins: only a provably identical
 *                         interrogation (timestamps within tolerance) is still
 *                         deduped against the #140 auto-import race.
 */
export function pickSameDayReport<T extends ReportRow>(
  candidates: T[],
  parsed: { interrogation_date?: string; device?: { serial_number?: string } } | null | undefined,
  explicitNewVisit: boolean
): T | null {
  const incomingSerial = normalizeSerial(parsed?.device?.serial_number);
  const incomingTime = timestampMs(parsed?.interrogation_date);

  for (const candidate of candidates || []) {
    const candidateSerial = normalizeSerial(candidate.device_serial_number);
    const candidateTime = timestampMs(candidate.interrogation_date);

    const serialConflict = Boolean(incomingSerial && candidateSerial && incomingSerial !== candidateSerial);
    const bothTimed = incomingTime !== null && candidateTime !== null;
    const sameSession = bothTimed && Math.abs(incomingTime - candidateTime) <= SAME_INTERROGATION_TOLERANCE_MS;

    if (explicitNewVisit) {
      if (sameSession && !serialConflict) return candidate;
    } else if (!serialConflict && (!bothTimed || sameSession)) {
      return candidate;
    }
  }
  return null;
}
