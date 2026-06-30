/**
 * Canonical key used to match patient last names across import sources.
 *
 * SQLite (via the `sqlite3` driver) can only case-fold ASCII with COLLATE
 * NOCASE, so accented names ("Müller" vs "müller") and the same character in
 * different Unicode normalization forms (precomposed "ü" vs "u"+combining
 * diaeresis) would otherwise be treated as different people. We compute a
 * normalized key in JS — where full Unicode case folding is available — and
 * store/match on that instead.
 *
 *  - NFC: collapse canonically-equivalent codepoint sequences to one form
 *  - whitespace: collapse runs and trim ends
 *  - toLowerCase: Unicode default (locale-independent) case folding
 */
export const normalizeNameKey = (name: string | null | undefined): string =>
  (name ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
