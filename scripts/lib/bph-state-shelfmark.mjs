/**
 * Scripts-side twin of `src/lib/bph-state-shelfmark.ts`.
 *
 * Batch consumers (the CSV importers and the one-off sweep) can't import the
 * TypeScript original, so the logic is duplicated here and parity is pinned by
 * `tests/unit/bph-state-shelfmark.test.ts`. Change both sides together.
 *
 * See the TS file for why "neen" ends up in a shelf-mark column at all.
 */

/** Values that mean "no", not a shelf mark. Compared case-insensitively. */
const NOT_A_SHELFMARK = new Set(['neen', 'nee']);

export function normalizeStateShelfMark(raw) {
  if (raw == null) return null;
  const kept = String(raw)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !NOT_A_SHELFMARK.has(part.toLowerCase()));
  return kept.length > 0 ? kept.join('|') : null;
}
