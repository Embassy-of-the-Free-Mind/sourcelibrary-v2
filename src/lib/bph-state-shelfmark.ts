/**
 * Normalise `bph_works.state_shelf_mark` ("State Collection shelf mark").
 *
 * The column was imported from Memorix's `bruikleen_icn` field — "is this copy
 * on loan from the ICN (the Dutch state collection)?" — which is answered
 * either with a real shelf mark (`PH3018`) or with the Dutch word for "no",
 * `neen`. The import mapped the raw answer straight through, so ~19.9K of the
 * 24K populated rows read "neen", i.e. a boolean *no* sitting in a text field
 * that the catalogue renders as a shelf mark. José Bouman (BPH) asked for it to
 * be emptied across the whole catalogue (feedback, 2026-07-15).
 *
 * Multi-value Memorix cells arrive pipe-joined (`neen|Slav`), so this strips
 * per segment rather than testing the whole string, and returns null when
 * nothing real is left.
 *
 * Two callers by design, and they must agree:
 *   - the data sweep + CSV importers (`scripts/lib/bph-state-shelfmark.mjs`)
 *   - the catalogue read paths (this file)
 * Parity is pinned by `tests/unit/bph-state-shelfmark.test.ts` — change both
 * sides together.
 */

/**
 * Values that mean "no", not a shelf mark. Compared case-insensitively.
 *
 * Deliberately limited to the negative answers: `ja` ("yes") also appears in
 * the column (31 rows as of 2026-07-30) and is equally not a shelf mark, but
 * emptying it would discard the only record that those copies ARE on loan from
 * the state collection. That needs a librarian's decision and a column that can
 * express it, so it is left alone here rather than swept.
 */
const NOT_A_SHELFMARK = new Set(['neen', 'nee']);

export function normalizeStateShelfMark(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const kept = String(raw)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !NOT_A_SHELFMARK.has(part.toLowerCase()));
  return kept.length > 0 ? kept.join('|') : null;
}
