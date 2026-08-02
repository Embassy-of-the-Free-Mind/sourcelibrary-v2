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
/**
 * A SECOND wrapper family, from the epigraphy/artifact OCR schema.
 *
 * `stripEditorialWrappers` knows the codex families (`<meta>`, `<summary>`,
 * `<scan-quality>`, …). Tablet, papyrus and manuscript-fragment records use a
 * different one — `<condition>`, `<period>`, `<surface>`, `<genre>`, `<notes>`,
 * `<confidence>` — and `<condition>` in particular is a paragraph of English
 * prose describing the artifact:
 *
 *   <language>Akkadian</language>
 *   <condition>The image shows multiple fragments (K.2421, K.2511, K.16765)
 *   from the British Museum collection, joined to form...</condition>
 *
 * Left in, that prose IS the page as far as a word-frequency measure is
 * concerned, and a Neo-Assyrian tablet screens as English. Same bug the header
 * above describes for the codex wrappers, in a family nobody had enumerated.
 *
 * ⚠️ These tags are almost certainly also reaching the quote/search/ngram
 * surfaces, which strip only the families `stripEditorialWrappers` knows — that
 * is the #2232 class and a wider blast radius than this file. Fixed locally here;
 * the global fix belongs in `strip-editorial-wrappers.{ts,mjs}` with its own
 * verification across every snippet surface.
 */
const ARTIFACT_WRAPPER_RE = /<(condition|period|surface|genre|notes|confidence|provenance|material|dimensions)>[\s\S]*?<\/\1>/gi;

export function textWords(s) {
  return String(stripEditorialWrappers(String(s || '')))
    .replace(ARTIFACT_WRAPPER_RE, ' ')
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
 * Minimum judgeable pages before FREQUENCY alone may return `english_source`.
 * See the asymmetry note in `classifySourceLanguage`. Does not apply to the
 * model's declared language, which is direct evidence rather than an estimate.
 */
export const MIN_PAGES_FOR_FREQUENCY_ENGLISH = 3;

/**
 * The OCR model DECLARES the page's language in its metadata envelope —
 * `<language>English</language>` or `<lang>Latin</lang>` — as part of the
 * page-level block CLAUDE.md documents (`<language>`, `<script>`,
 * `<scan-quality>`, `<page-type>`).
 *
 * This is a direct assertion by the model that read the page, and it beats any
 * frequency estimate. Budge's *Seven Tablets of Creation*, catalogued by us as
 * Akkadian, declares `<language>English</language>` on its pages — because the
 * printed page IS English. Our genuinely translated Latin book declares
 * `<lang>Latin</lang>`.
 *
 * Note the field `pages.ocr.language` is NOT a substitute: it is null on exactly
 * the older ingests where this matters, while the tag inside `ocr.data` is
 * present. Read the declaration, not the column.
 */
const LANG_TAG_RE = /<lang(?:uage)?>\s*([^<]{1,40}?)\s*<\/lang(?:uage)?>/i;

export function declaredPageLanguage(ocrData) {
  const m = String(ocrData || '').match(LANG_TAG_RE);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  return v && v !== 'null' && v !== 'unknown' ? v : null;
}

const ENGLISH_DECLARATIONS = new Set(['english', 'eng', 'en', 'modern english', 'early modern english']);

/** Is the declared language English? null when nothing was declared. */
export function declaresEnglish(ocrData) {
  const l = declaredPageLanguage(ocrData);
  if (!l) return null;
  return ENGLISH_DECLARATIONS.has(l);
}

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
  // Prefer the model's own declaration — a direct statement about the page beats
  // a frequency estimate derived from it.
  //
  // ONE declaration is enough. The old floor of 2 meant a single-page record —
  // a tablet, a papyrus, a manuscript leaf — could never use its own declaration
  // and fell through to frequency, which then read the English artifact
  // description and called an Akkadian tablet English. If the model that read the
  // page named the language, that is the best evidence available at any count;
  // requiring a second copy of it discards the only signal on exactly the records
  // that have nothing else.
  const declared = pageTexts.map((t) => declaresEnglish(t)).filter((d) => d !== null);
  if (declared.length >= 1) {
    const englishShare = declared.filter(Boolean).length / declared.length;
    return {
      verdict: englishShare >= 0.5 ? 'english_source' : 'foreign_source',
      basis: 'declared_language',
      english_share: englishShare,
      pages_judged: declared.length,
    };
  }

  // Fall back to function-word frequency only where nothing was declared.
  const fracs = pageTexts.map((t) => englishFraction(t)).filter((f) => f !== null);
  if (!fracs.length) return { verdict: 'undetermined', basis: 'none', mean: null, pages_judged: 0 };
  const mean = fracs.reduce((a, b) => a + b, 0) / fracs.length;
  const english = mean >= ENGLISH_SOURCE_THRESHOLD;

  // Asymmetric floor, deliberately. The two errors do not cost the same: calling a
  // foreign book English silently DROPS a genuine first-translation candidate and
  // nothing downstream will ever revisit it, while calling an English book foreign
  // merely leaves a candidate to be caught later. So a frequency-based
  // `english_source` needs corroboration across pages; `foreign_source` does not.
  if (english && fracs.length < MIN_PAGES_FOR_FREQUENCY_ENGLISH) {
    return { verdict: 'undetermined', basis: 'insufficient_pages_for_frequency', mean, pages_judged: fracs.length };
  }
  return {
    verdict: english ? 'english_source' : 'foreign_source',
    basis: 'function_word_frequency',
    mean,
    pages_judged: fracs.length,
  };
}

/**
 * Scanner/library boilerplate. English by construction, on books in every
 * language, and it is bound into the scan rather than printed in the book — so a
 * page carrying it says nothing about the source language and must not vote.
 *
 * This is not hypothetical: the Zohrab Armenian New Testament was screened
 * `english_source` on three consecutive pages of the Google Books notice.
 */
export const BOILERPLATE_RE = /digital copy of a book that was preserved|make the world'?s books discoverable|public domain (?:book|work) is one that was never subject|google book search|digitized by (?:google|microsoft|the internet archive)/i;

/**
 * Sample pages SPREAD ACROSS the middle of the book.
 *
 * Three things had to be got right here, and the obvious implementation gets all
 * three wrong. It lived in two places — this and `ft-translation-queue.mjs` — and
 * the second copy still had every one of them, which is why it is now ONE
 * function that both callers import.
 *
 *  1. NEGATIVE PAGE NUMBERS ARE SOFT-HIDDEN PAGES. Sorting by `page_number`
 *     ascending starts in them, so "skip 30%" can land entirely inside the hidden
 *     range and never reach the book. The Armenian NT sampled pages -1378..-1376.
 *
 *  2. `skip` MUST BE AN OFFSET INTO THE OCR'd PAGES, NOT INTO `pages_count`.
 *     Sparse OCR makes the two diverge without any error.
 *
 *  3. EIGHT CONSECUTIVE PAGES ARE ONE PLACE IN THE BOOK. Nicholson's *Kitab
 *     al-Luma* is Arabic with an English glossary at the back; a consecutive
 *     sample that lands in the glossary reports the whole book as English. A
 *     spread sample lets the body outvote the apparatus.
 *
 * So: positive page numbers only, offsets computed over the OCR'd set, and the
 * sample spread evenly across the middle 60% (20%–80%) to clear front matter at
 * one end and index/glossary at the other.
 */
export const SAMPLE_SIZE = 10;

export async function samplePagesForLanguage(pages, bookId) {
  const nums = await pages.find(
    { book_id: bookId, page_number: { $gt: 0 }, 'ocr.data': { $exists: true, $ne: null } },
    { projection: { page_number: 1 }, sort: { page_number: 1 } },
  ).toArray();
  if (!nums.length) return { texts: [], available: 0 };

  const lo = Math.floor(nums.length * 0.2);
  const hi = Math.max(lo + 1, Math.floor(nums.length * 0.8));
  const span = hi - lo;
  const picks = [];
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const idx = lo + Math.floor((span * i) / SAMPLE_SIZE);
    if (idx < nums.length && !picks.includes(nums[idx].page_number)) picks.push(nums[idx].page_number);
  }

  const rows = await pages.find(
    { book_id: bookId, page_number: { $in: picks } },
    { projection: { 'ocr.data': 1 } },
  ).toArray();
  const texts = rows.map((p) => p.ocr?.data).filter(Boolean).filter((t) => !BOILERPLATE_RE.test(t));
  return { texts, available: nums.length };
}
