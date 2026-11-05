/**
 * Which half of a spread is read first? Decide it from the printed page numbers on the two halves, not
 * from the book's language (#5699).
 *
 * PRIOR ART: scripts/eval/page-marker-order.mjs `pageMarkers()` (the #5699 detector's reader of running
 * heads, centred and bare numerals; it never reads `<page-num>`), reused here unchanged.
 * scripts/split-book.mjs's `RIGHT_FIRST` guessed the order from the language: both Maqrizi volumes are
 * Arabic and bound left to right, so every spread of both was stored backwards (#5699 section B). The
 * Archive's `page-progression` cannot be used instead (7 of 13 `rl` items descend, all 6 `lr` items do).
 *
 * voteSpreadOrder(pairs): pairs = [{ left: ocrText, right: ocrText }] for spreads cut in two. A pair votes
 * `ltr` when the right half's printed number is the left's + 1, `rtl` when the left's is the right's + 1;
 * anything else (no number on either half, unrelated numbers) does not vote. The verdict needs at least
 * MIN_VOTES votes and AGREE of them on one side; otherwise it is `unreadable` and the caller flags the
 * book instead of guessing.
 */
import { pageMarkers } from '../eval/page-marker-order.mjs';

export const MIN_VOTES = 3;
export const AGREE = 0.8;

/** Printed page number of one leaf from its OCR text (head and tail), or null. */
export function printedNumber(text) {
  if (!text) return null;
  const s = String(text);
  return pageMarkers(s.slice(0, 1500), s.slice(-600)).P;
}

export function voteSpreadOrder(pairs, { minVotes = MIN_VOTES, agree = AGREE } = {}) {
  let ltr = 0, rtl = 0, readable = 0;
  for (const { left, right } of pairs) {
    const l = printedNumber(left), r = printedNumber(right);
    if (l == null || r == null) continue;
    readable++;
    if (r === l + 1) ltr++;
    else if (l === r + 1) rtl++;
  }
  const votes = ltr + rtl;
  let verdict = 'unreadable';
  if (votes >= minVotes) {
    if (ltr / votes >= agree) verdict = 'ltr';
    else if (rtl / votes >= agree) verdict = 'rtl';
  }
  return { verdict, ltr, rtl, readable, pairs: pairs.length };
}
