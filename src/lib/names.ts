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

/**
 * Levenshtein edit distance between two names, computed on their normalized
 * keys (see {@link normalizeNameKey}). Used to flag "probable duplicate"
 * patients whose last names differ by a small number of typos or a
 * maiden/married-name edit. Returns the number of single-character insertions,
 * deletions or substitutions needed to turn one name into the other; identical
 * (after normalization) names return 0.
 */
export const nameDistance = (a: string | null | undefined, b: string | null | undefined): number => {
  const s = normalizeNameKey(a);
  const t = normalizeNameKey(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  // Single-row dynamic programming: prev[j] holds the distance for the
  // previous row of the edit-distance matrix.
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    let diagonal = prev[0]; // matrix[i-1][j-1]
    prev[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const insertOrDelete = Math.min(prev[j] + 1, prev[j - 1] + 1);
      const substitute = diagonal + cost;
      diagonal = prev[j]; // becomes matrix[i-1][j-1] for the next column
      prev[j] = Math.min(insertOrDelete, substitute);
    }
  }
  return prev[t.length];
};
