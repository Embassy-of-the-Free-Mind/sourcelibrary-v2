/**
 * PRIOR ART: none — searched `scripts/`, `src/lib` for a long-s / archaic-orthography
 * detector (`long s`, `longS`, `ſ`, `ſ`) on 2026-09-21 and found only incidental
 * matches in one-off scripts and data files. `scripts/lib/ocr-plausibility.mjs` scores
 * whether a page is JUNK (trigram share against the book's own text) and
 * `scripts/lib/dehyphenate.mjs` repairs line-break hyphens — neither asks whether the
 * orthography is archaic. `src/lib/early-modern-text.ts` is the nearest neighbour but
 * formats early-modern markup for display; it does not measure.
 *
 * Does this page's text use orthography a modern reader cannot comfortably read?
 *
 * WHY (#4958, 2026-09-21). Whether to offer a modernization used to be decided by
 * EDITION YEAR — below 1820 the reader made the modernized text the default view,
 * at or above it there was no panel. A date is a proxy for the thing that actually
 * matters, and it misses in both directions: long ſ left English printing unevenly
 * between roughly 1790 and 1810, presses switched at different times, and antiquarian
 * reprints deliberately set archaic type long afterwards. A 1780 book in clean roman
 * needs nothing; an 1840s facsimile might.
 *
 * The text is right here, so ask it instead. This runs on stored OCR — no model call,
 * no cost — and is used two ways: the reader decides whether to surface "Modernize"
 * on a page, and `/api/pages/[id]/modernize` refuses a page that would be a no-op.
 *
 * WHAT COUNTS AS EVIDENCE. Only markers that do not occur in ordinary modern English:
 *
 *   - `ſ` (U+017F), the long s. The single decisive signal when OCR preserves it.
 *   - u/v and i/j swaps (`vpon`, `haue`, `iudge`). Early modern printers used one
 *     letterform per pair; no modern text contains `vnto`.
 *   - f-for-ſ misreads (`thefe`, `moft`, `firft`). Not archaic spelling but an OCR
 *     artifact OF archaic type — and a page that reads `moft juft` is exactly a page
 *     a reader wants normalised.
 *
 * WHAT IS DELIBERATELY NOT EVIDENCE. `hath`, `doth`, `thou`, `thee`, `saith`, `ye`.
 * These are archaic GRAMMAR, not orthography, and they are perfectly legible; more to
 * the point they appear in scripture quoted by perfectly modern books, which would
 * make the biggest cluster of hits a false one — the failure shape recorded in
 * `lesson_detector_vocabulary_artifact_is_the_biggest_cluster`. A 1907 study of the
 * Talmud quoting the Authorised Version must not read as archaic.
 */

/** U+017F LATIN SMALL LETTER LONG S. */
const LONG_S = 'ſ';

/**
 * Words that exist in early modern printing and essentially nowhere else. Matched
 * whole-word, case-insensitively. Kept deliberately short: every entry has to be a
 * word a modern author would not write, not merely one they write less often.
 */
const SWAPPED_LETTERFORMS = [
  // u written for v
  'vpon', 'vnto', 'vp', 'vs', 'vse', 'vnder', 'vertue',
  // v written for u
  'haue', 'giue', 'loue', 'euery', 'neuer', 'ouer', 'seruant', 'diuers', 'euer',
  // i written for j
  'iudge', 'iust', 'iesus', 'ioy', 'maiestie', 'obiect', 'subiect',
];

/**
 * OCR reading long ſ as f. These are not words in any period — they are the
 * fingerprint of archaic type passed through a transcriber that lacked the glyph.
 */
const LONG_S_MISREADS = [
  'thefe', 'thofe', 'moft', 'firft', 'muft', 'juft', 'laft', 'beft', 'paft',
  'almoft', 'againft', 'himfelf', 'itfelf', 'caufe', 'becaufe', 'ufe', 'fuch',
  'fhall', 'fhould', 'fame', 'fenfe', 'reafon', 'perfon', 'confider',
];

const wordRe = (words: string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi');
const SWAPPED_RE = wordRe(SWAPPED_LETTERFORMS);
const MISREAD_RE = wordRe(LONG_S_MISREADS);

/**
 * Tags the OCR carries (`<header>`, `<vocab>`, `<note>`…) are apparatus, not the
 * page's own words, and their CONTENT can contain anything. Strip before measuring —
 * the same artifact that made a folio detector read "100" out of a `<vocab>` list.
 */
function stripApparatus(raw: string): string {
  return raw
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

export interface ArchaicReading {
  /** True when the page carries enough evidence to be worth offering a modernization. */
  archaic: boolean;
  /** Count of U+017F. Any occurrence at all is decisive. */
  longS: number;
  /** Whole-word u/v and i/j swaps. */
  swapped: number;
  /** Whole-word f-for-ſ misreads. */
  misreads: number;
  /** Words measured, after apparatus is stripped. */
  words: number;
  /** Strong markers per 1,000 words — the figure the threshold applies to. */
  density: number;
}

/**
 * Two markers per thousand words. Calibrated to the shape of the evidence rather
 * than a corpus sweep: the lexicons only contain words modern English does not use,
 * so a handful of hits on a full page is already a page set in archaic type, while
 * one stray hit (an OCR slip, a quoted `vnto`) should not flip a modern book. Any
 * long ſ at all bypasses the threshold — the glyph does not appear by accident.
 */
export const ARCHAIC_MARKERS_PER_1000_WORDS = 2;

/**
 * ...and at least this many markers in absolute terms.
 *
 * Density alone is not enough, measured 2026-09-21: one page of Mead's *Apollonius*
 * (1901, thoroughly modern print) flagged on a SINGLE hit, because a ~240-word page
 * needs just one marker to clear 2-per-1000. The words most likely to produce that
 * one hit are `fame`, `fuch`, `ufe` — which are also the commonest f/s OCR slips in
 * any book of any period. One marker is an OCR slip; three is a typesetter.
 */
const MIN_STRONG_MARKERS = 3;

/** A page shorter than this is too small a sample to judge; plates, blanks, half-titles. */
const MIN_WORDS = 40;

export function readArchaicOrthography(rawText: string | null | undefined): ArchaicReading {
  const text = stripApparatus(rawText ?? '');
  const words = (text.match(/[\p{L}\p{N}']+/gu) ?? []).length;

  const longS = (text.match(new RegExp(LONG_S, 'g')) ?? []).length;
  const swapped = (text.match(SWAPPED_RE) ?? []).length;
  const misreads = (text.match(MISREAD_RE) ?? []).length;

  const strong = swapped + misreads;
  const density = words > 0 ? (strong / words) * 1000 : 0;

  // The long ſ is decisive on its own and needs no density: a page carrying the
  // glyph is set in archaic type whatever its length. Everything else needs enough
  // text under it to mean something.
  const archaic =
    longS > 0 ||
    (words >= MIN_WORDS && strong >= MIN_STRONG_MARKERS && density >= ARCHAIC_MARKERS_PER_1000_WORDS);

  return { archaic, longS, swapped, misreads, words, density };
}

/** Convenience for call sites that only want the verdict. */
export function isArchaicOrthography(rawText: string | null | undefined): boolean {
  return readArchaicOrthography(rawText).archaic;
}
