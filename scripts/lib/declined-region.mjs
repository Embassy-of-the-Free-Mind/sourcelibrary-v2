/**
 * PRIOR ART: scripts/audit/detect-fabricated-translation.mjs (`DECLINED`) is the corpus detector for
 * the same marker, but it is inline in an audit script and deliberately counts a bare "[illegible]"
 * (it pairs it with a body-size test this predicate has no use for). scripts/lib/illegible-source-gate.mjs
 * (`LACUNA_RE`) removes lacuna brackets to measure what is LEFT, not whether a region was declined, and
 * is not exported. Neither fits a yes/no "did the OCR decline a region of this page" question.
 *
 * Did the OCR decline a REGION of this page — a block of hieroglyphs, a column of hieratic, a run of
 * numbered lines — rather than read it (#4584)?
 *
 * The OCR says so in one of two ways: the `<lacuna>` tag (#4195 item 5, prompt v17+), or, in output
 * that predates it, an English stand-in in brackets: "[Hieroglyphic text lines x+1 through 20]",
 * "[Hieratic text, approximately 15 lines]", "[Cuneiform inscription arranged in vertical columns]".
 *
 * On such a page the translation had nothing to work from for that region, and Urkunden IV p.24
 * shows what it can do with nothing: twenty lines of fluent funerary formulae, one promoted into the
 * book's `reading_summary.quotes`. Callers use this to keep the page out of anything that presents
 * its text as the book's words — featured quotes first.
 *
 * NOT a declined region (each a false-positive family measured 2026-10-11 over the 235,179 featured
 * quotes in `reading_summary.quotes`, 24 of which sat on a page this matched before the exclusions):
 *   - a bare "[illegible]" — one unread word inside a good transcription (detect-fabricated-translation
 *     v2: 733 hits, mostly this);
 *   - bleed-through / show-through from the other side of the leaf: that text is not this page's.
 */
const DECLINED_BRACKET_RE = /\[[^\]]{0,140}?\b(?:not transcribed|untranscribed|omitted in transcription|undeciphered|(?:hieroglyphic|hieratic|demotic|cuneiform)\s+(?:text|lines?|block|signs|inscription|columns?)|text lines?\b[^\]]{0,40}\b(?:through|\d+\s*[-–]\s*\d+))\b[^\]]{0,140}\]/gi;
const OTHER_SIDE_RE = /\b(?:bleed|show)[-\s]?through\b|\breverse side\b/i;
const LACUNA_TAG_RE = /<lacuna\b/i;

/** @param {string|null|undefined} ocr */
export function declinedRegion(ocr) {
  const text = String(ocr || '');
  if (LACUNA_TAG_RE.test(text)) return true;
  for (const m of text.matchAll(DECLINED_BRACKET_RE)) {
    if (!OTHER_SIDE_RE.test(m[0])) return true;
  }
  return false;
}
