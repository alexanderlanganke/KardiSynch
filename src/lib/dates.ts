/**
 * Canonical date selector for parser/storage code.
 *
 * Every parser must pipe extracted patient.dob and report.interrogation_date
 * through `normalizeDate` so what gets written to visit.xml / patient.xml is
 * always `YYYY-MM-DD`. The renderer's `formatDate` then has a single, well-
 * defined input to work from.
 *
 * Returns `''` (matches the existing "no date" sentinel) on empty or
 * unparseable input so existing callers continue to behave correctly.
 *
 * Accepted inputs:
 *   - `YYYY-MM-DD` and `YYYY-MM-DD[T ]HH:MM:SS[.sss][Z]` (ISO)
 *   - `DD.MM.YYYY` (EU dotted)
 *   - `DD-MM-YYYY` / `DD/MM/YYYY` (EU dashed/slashed)
 *   - `MM/DD/YYYY` (US slashed)
 *   - `D MMM YYYY` and `MMM D, YYYY` (e.g. `25 Sep 1952`, `Sep 25, 1952`)
 *
 * Ambiguous numeric forms (both numbers ≤ 12) are resolved by `hint`:
 *   - 'us'   — first number is month (M/D/Y)
 *   - 'eu'   — first number is day (D/M/Y)
 *   - 'auto' (default) — dots/dashes → EU, slashes → US
 */
export type DateLocaleHint = 'us' | 'eu' | 'auto';

export function normalizeDate(input: string | null | undefined, hint: DateLocaleHint = 'auto'): string {
  if (!input) return '';
  const str = String(input).trim();
  if (!str) return '';

  // ISO date or datetime
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(str);
  if (iso) return canonicalize(iso[1], iso[2], iso[3]);

  // Month-name forms
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(str);
  if (dmy) {
    const m = months[dmy[2].slice(0, 3).toLowerCase()];
    if (m) return canonicalize(dmy[3], String(m), dmy[1]);
  }
  const mdy = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(str);
  if (mdy) {
    const m = months[mdy[1].slice(0, 3).toLowerCase()];
    if (m) return canonicalize(mdy[3], String(m), mdy[2]);
  }

  // Numeric with separator
  const num = /^(\d{1,2})([\/\.\-])(\d{1,2})\2(\d{4})$/.exec(str);
  if (num) {
    const a = parseInt(num[1], 10);
    const sep = num[2];
    const b = parseInt(num[3], 10);
    const y = num[4];

    let day: number, month: number;
    if (a > 12 && b <= 12) {
      day = a; month = b;
    } else if (b > 12 && a <= 12) {
      day = b; month = a;
    } else {
      const localeDefault: DateLocaleHint = sep === '/' ? 'us' : 'eu';
      const effective = hint === 'auto' ? localeDefault : hint;
      if (effective === 'us') { month = a; day = b; }
      else { day = a; month = b; }
    }
    return canonicalize(y, String(month), String(day));
  }

  return '';
}

function canonicalize(y: string, m: string, d: string): string {
  const yi = parseInt(y, 10);
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || !Number.isFinite(di)) return '';
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return '';
  const dt = new Date(yi, mi - 1, di);
  if (dt.getFullYear() !== yi || dt.getMonth() !== mi - 1 || dt.getDate() !== di) return '';
  return `${String(yi).padStart(4, '0')}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
}
