/**
 * Scripts-side twin of `src/lib/facing-translation.ts` (#8321): which leaves of
 * a facing-page edition (a Loeb: original on the left, the published English on
 * the right) pair with each other.
 *
 * PRIOR ART: src/lib/facing-translation.ts — the request-path original; a node
 * script cannot import TS, so the pairing rule is re-stated here on top of
 * english-original-text.mjs's isEnglishOriginalPage (itself the twin of
 * src/lib/english-page-language.ts). `tests/unit/facing-translation.test.ts`
 * pins the two sides together — change both at once.
 */
import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';
import { isEnglishOriginalPage } from './english-original-text.mjs';
import { BOILERPLATE_RE } from './english-source-detect.mjs';

/** The rule name stored in `books.facing_translation.pairing`. */
export const FACING_PAIRING_RULE = 'next-leaf-consecutive-printed';

/** A leaf with less body text than this is a blank, a plate or a half-title. */
export const MIN_LEAF_BODY_CHARS = 200;

/** The leaf's body: the OCR with its tag envelope (and every tagged block) removed. */
function leafBody(ocrData) {
  // The quotable text: envelope and wrapper blocks gone, page marks kept (a few characters).
  return stripEditorialWrappers(String(ocrData || '')).replace(/\s+/g, ' ').trim();
}

/**
 * What a leaf of a facing-page edition is: `translation` (the printed English),
 * `original` (Greek/Latin text), or null (blank, boilerplate, too short to say).
 */
export function leafRole(ocrData) {
  const body = leafBody(ocrData);
  if (body.length < MIN_LEAF_BODY_CHARS) return null;
  if (isEnglishOriginalPage(ocrData)) return 'translation';
  if (BOILERPLATE_RE.test(body)) return null;
  return 'original';
}

/**
 * The arabic page number printed on the leaf: the fitted `printed_page.label`
 * (#4291) when present, else the OCR's own `<page-num>`. Null for roman
 * numerals, folio labels and leaves with no number.
 */
export function printedNumber(page) {
  const label = page?.printed_page?.label;
  if (typeof label === 'string' && /^\d+$/.test(label.trim())) return Number(label.trim());
  if (page?.printed_page) return null; // the fitter spoke and it is not arabic
  const m = String(page?.ocr?.data || '').match(/<page-num>\s*(\d+)\s*<\/page-num>/i);
  return m ? Number(m[1]) : null;
}

/**
 * Does `original` face `next`? The rule in FACING_PAIRING_RULE: the next leaf
 * in scan order, an English leaf, whose printed number is one more.
 */
export function isFacingPair(original, next) {
  if (!original || !next) return false;
  if (next.page_number !== original.page_number + 1) return false;
  if (leafRole(original.ocr?.data) !== 'original') return false;
  if (leafRole(next.ocr?.data) !== 'translation') return false;
  const a = printedNumber(original);
  const b = printedNumber(next);
  return a !== null && b !== null && b === a + 1;
}

/** Is this book flagged as carrying a published facing translation? */
export function hasPublishedFacingTranslation(book) {
  return book?.facing_translation?.source === 'published';
}
