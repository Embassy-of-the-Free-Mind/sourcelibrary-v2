/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs — its GARBAGE-LEAF GUARD (2026-09-14) is a word-level
 * version of this test (share of a leaf's tokens in the book's model-read vocabulary, cut at 0.4×
 * the book's own median) and stays in place; measured on the 27 hand-graded #4780 pages it clears
 * the Devanagari-as-Latin page (#4784) by 0.03 only (share 0.23 vs cut 0.26) because a whole word
 * of junk rarely matches, but a whole word of a rare REAL term does not match either (readable
 * floor 0.59). scripts/lib/ngram-normalize.mjs tokenises for ngram COUNTING, no judgement;
 * scripts/lib/mojibake.mjs detects encoding damage, not OCR junk; scripts/lib/blank-page-guard.mjs
 * (#4149) is the inverse problem (a model writing prose on a BLANK leaf).
 *
 * ocr-plausibility — is this page's text plausible for THIS book?
 *
 * WHY (#4784). The free OCR lane admits an Archive item when its text agrees with our Gemini
 * sample on the book's reference pages — a BOOK-level gate. It cannot see a page-level switch:
 * a Devanagari leaf in an English-catalogued journal came through as Latin-alphabet junk
 * (`kgg'7^ f<p^ I`) at a book score of 0.859. The test here is language-agnostic and needs no
 * dictionary: the share of the page's in-word letter TRIGRAMS that occur anywhere in the book's
 * own reference text. Sub-word units give a wider margin than whole words because a rare real
 * word is still made of common trigrams while junk is not.
 *
 * Measured 2026-09-16 on the 27 hand-graded pages, leave-one-out with K reference pages:
 *
 *   K (ref pages)  ref trigrams  readable min / p10 / median   Devanagari junk
 *   3              1,142         0.618 / 0.671 / 0.781         0.088
 *   5              1,440         0.722 / 0.758 / 0.838         0.096
 *   10             1,943         0.847 / 0.879 / 0.917         0.081
 *   25             2,626         0.897 / 0.928 / 0.961         0.125
 *
 * The ingester needs 5 reference pages to calibrate at all (MIN_REF_PAGES), so the cut is 0.4:
 * every readable page at K ≥ 5 clears it by ≥ 0.3 and the junk page misses it by ≥ 0.27. Below
 * MIN_REF_TRIGRAMS the score abstains (null) rather than judge against a vocabulary it has not seen.
 *
 * KNOWN BLIND SPOT, by measurement: an out-of-focus scan whose junk is WORD-SHAPED (`Dust tezt
 * w2s fos A ane ooslders`, the second #4784 instance) scores 0.913 here, 0.59 on the word-level
 * guard (cut 0.35), 0.86 on alphabetic-token share and 0.66 on an English-dictionary share against
 * readable pages at 0.68–0.91 — no cheap text statistic separates it with margin. The signal that
 * class does carry is the engine's own per-word confidence (`x_wconf` in the Archive's hOCR file),
 * which this helper does not read; see #4784.
 */

const WORD = /\p{L}+/gu;

/** In-word letter trigrams of a text (lowercased, NFC; tags stripped). */
export function letterTrigrams(text) {
  const out = [];
  const words = String(text || '').replace(/<[^>]+>/g, ' ').toLowerCase().normalize('NFC').match(WORD) || [];
  for (const w of words) if (w.length >= 3) for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3));
  return out;
}

/** Build the reference trigram set once per book from its model-read pages. */
export function referenceTrigramSet(texts) {
  const set = new Set();
  for (const t of texts) for (const g of letterTrigrams(t)) set.add(g);
  return set;
}

export const DEFAULT_MIN_PLAUSIBILITY = 0.4;
/** Fewer distinct reference trigrams than this and the score abstains (≈ 3 pages of prose). */
export const MIN_REF_TRIGRAMS = 1000;
/** Fewer page trigrams than this and the score abstains (a caption or plate label is not junk). */
export const MIN_PAGE_TRIGRAMS = 40;

/**
 * Share of the page's trigrams found in the reference set. `share` is null when either side is
 * too small to judge — a null is an abstention, never a verdict.
 * @returns {{ share: number|null, trigrams: number }}
 */
export function pagePlausibility(text, refSet, { minTrigrams = MIN_PAGE_TRIGRAMS, minRefTrigrams = MIN_REF_TRIGRAMS } = {}) {
  const grams = letterTrigrams(text);
  if (grams.length < minTrigrams || refSet.size < minRefTrigrams) return { share: null, trigrams: grams.length };
  let seen = 0;
  for (const g of grams) if (refSet.has(g)) seen++;
  return { share: seen / grams.length, trigrams: grams.length };
}

/** True when the page should be REFUSED: scored (not abstained) and below the cut. */
export function isImplausible(text, refSet, minShare = DEFAULT_MIN_PLAUSIBILITY) {
  const { share } = pagePlausibility(text, refSet);
  return share !== null && share < minShare;
}
