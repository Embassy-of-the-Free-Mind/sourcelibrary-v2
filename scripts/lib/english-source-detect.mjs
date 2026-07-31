/**
 * english-source-detect.mjs — is the SOURCE page already in English? (#3459)
 *
 * THE QUESTION THIS ANSWERS, AND WHY THE OBVIOUS ONE FAILS
 * -------------------------------------------------------
 * A first-translation claim only makes sense if we rendered a foreign text into
 * English. Much of the ancient-Near-East holding is not that: Budge's *Seven
 * Tablets of Creation*, Langdon's *Babylonian Liturgies*, the Papyrus of Ani —
 * these are modern scholarly editions that PRINT the ancient text alongside an
 * English translation. `books.language` records the ancient script; the book in
 * hand is largely English.
 *
 * The intuitive test is provenance: did OUR pipeline produce the translation?
 * Measured, that fails — those books carry `translation.source: ["ai"]` with a
 * model stamped on 93-100% of translated pages, exactly like a Latin book we
 * genuinely translated. The pipeline did run. It simply ran on pages that were
 * already English, producing English from English. Provenance of the TRANSLATION
 * is the wrong signal; the language of the SOURCE is the right one.
 *
 * Neither do the other obvious candidates:
 *   - `text_role` is 'original' for all of them (it describes the artifact)
 *   - `pages.ocr.language` is null/auto-detect on the older ingests
 *   - OCR/translation word overlap does not separate: Sumerian 0.41 sits among
 *     German 0.43 and French 0.47, because editorial wrappers and proper nouns
 *     create a baseline overlap everywhere
 *   - `gemini_usage` holds no translation rows even for books we certainly
 *     translated, so it is not complete per-book provenance
 *
 * WHAT DOES WORK: the proportion of common English function words in the OCR
 * text. Measured over sampled content pages, 2026-07-31:
 *
 *     Akkadian (Budge et al.)   0.295      Latin, badged    0.043
 *     Sumerian                  0.230      German, badged   0.046
 *     Egyptian                  0.322      Greek, badged    0.037
 *
 * A 5-8x gap with no overlap between the bands. Function words are the right
 * feature precisely because they are untranslatable filler — a Latin page has
 * almost none whatever its subject, an English page is full of them.
 */

import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';

/**
 * Common English function words. Deliberately closed-class (articles,
 * prepositions, pronouns, auxiliaries) — these carry no subject matter, so the
 * measure tracks the LANGUAGE of the page and not its topic.
 */
const ENGLISH_FUNCTION_WORDS = new Set(
  ('the of and to in a is that was for it with as his he be not by but they this had have from are '
  + 'which one you were her all she there would their we him been has when who will more no if out so '
  + 'said what up its about into than them can only other new some could time these two may then do '
  + 'first any my now such like our over man me even most made after also did many before must through '
  + 'back years where much your way well down should because each just those people how too little '
  + 'state good very make world still own see men work long get here between both life being under '
  + 'never day same another know while last might us great old year off come since against go came '
  + 'right used take three upon shall thus hath unto').split(' '),
);

/**
 * Words from OCR text, with EDITORIAL WRAPPERS REMOVED FIRST.
 *
 * This is load-bearing and was got wrong on the first attempt. `pages.ocr.data`
 * embeds AI-written English annotation blocks — `<meta>`, `<scan-quality>`,
 * `<page-type>` and friends — describing the page in English regardless of what
 * language the page is in. Stripping only the TAGS (`replace(/<[^>]*>/g, '')`)
 * keeps that prose, which is precisely the bug CLAUDE.md documents: the tag goes,
 * the editorial English stays.
 *
 * Measured cost of getting it wrong: a Greek manuscript of the Corpus Hermeticum
 * scored 0.26-0.36 English on annotated pages and 0.00 on pages of actual Greek;
 * a Hebrew Zohar scored 0.32 on an annotated page and 0.00 on real Hebrew. The
 * detector was reading our own annotations and calling the source English.
 */
export function textWords(s) {
  return String(stripEditorialWrappers(String(s || '')))
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .match(/[a-z']+/g) ?? [];
}

/**
 * Fraction of a page's words that are English function words.
 * Returns null when there is too little text to judge — an unreadable or blank
 * page must not vote.
 */
export function englishFraction(text, minWords = 25) {
  const w = textWords(text);
  if (w.length < minWords) return null;
  return w.filter((x) => ENGLISH_FUNCTION_WORDS.has(x)).length / w.length;
}

/**
 * Threshold separating an already-English source from a foreign one.
 *
 * Sits in the empty band between the two measured populations (foreign tops out
 * near 0.06, already-English starts near 0.15). Deliberately nearer the foreign
 * side: misclassifying a genuine foreign source as English would silently drop a
 * real first-translation candidate, which is the costlier error.
 */
export const ENGLISH_SOURCE_THRESHOLD = 0.15;

/**
 * Classify a book from a sample of its OCR pages.
 *
 * @param {string[]} pageTexts - OCR text from sampled content pages
 * @returns {{verdict: string, mean: number|null, pages_judged: number}}
 *   `english_source`  the printed page is already largely English — a
 *                     first-translation claim does not apply
 *   `foreign_source`  a genuine foreign-language source
 *   `undetermined`    not enough legible text to say
 */
export function classifySourceLanguage(pageTexts) {
  const fracs = pageTexts.map((t) => englishFraction(t)).filter((f) => f !== null);
  if (!fracs.length) return { verdict: 'undetermined', mean: null, pages_judged: 0 };
  const mean = fracs.reduce((a, b) => a + b, 0) / fracs.length;
  return {
    verdict: mean >= ENGLISH_SOURCE_THRESHOLD ? 'english_source' : 'foreign_source',
    mean,
    pages_judged: fracs.length,
  };
}
