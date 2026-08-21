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

/** Values that mean "no", not a shelf mark. Compared case-insensitively. */
const NOT_A_SHELFMARK = new Set(['neen', 'nee']);

/**
 * `ja` ("yes") is the other Memorix boolean in this column — 31 rows. It is not
 * a shelf mark either, but unlike `neen` it is not noise: it is the only record
 * that those copies ARE on loan from the state collection, so it is translated
 * rather than dropped. José Bouman (BPH) made the call on 2026-08-12, having
 * been asked for exactly this decision by the catalogue worklist:
 *
 *   "This set of 31 is owned by the State, therefore the 'Ja'. Better change
 *    it to 'yes'."
 *
 * Normalised at the write boundary as well as swept in the data, so a Memorix
 * re-import cannot put the Dutch back — the same belt-and-braces the `neen`
 * cleanup used.
 */
const TRANSLATE = new Map([['ja', 'yes']]);

export function normalizeStateShelfMark(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const kept = String(raw)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !NOT_A_SHELFMARK.has(part.toLowerCase()))
    .map((part) => TRANSLATE.get(part.toLowerCase()) ?? part);
  return kept.length > 0 ? kept.join('|') : null;
}
