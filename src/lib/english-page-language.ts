/**
 * Is the text printed on THIS page already English? (#3939)
 *
 * Request-path twin of `scripts/lib/english-source-detect.mjs`, which asks the
 * same question of a whole book for first-translation screening. The two share
 * their signals, thresholds and word list, and `tests/unit/english-page-language.test.ts`
 * pins them together — change both sides at once.
 *
 * WHY A PER-PAGE ANSWER, AND NOT `books.language`
 * -----------------------------------------------
 * `books.language` is the MANIFESTATION language of the whole scan (see
 * `src/lib/edition-language.ts`), and a volume is not uniform. Billingsley's
 * 1570 *Elements of Geometrie* is catalogued `Latin` and holds Dee's
 * *Mathematicall Praeface* — thirty-odd leaves of English — inside it. Asking
 * the book gets the Praeface wrong; asking the leaf gets it right.
 *
 * THE SIGNALS, IN PRIORITY ORDER
 * ------------------------------
 * 1. The OCR model's own `<language>` declaration in the page-level metadata
 *    envelope. A direct assertion by the model that read the leaf beats any
 *    estimate derived from its output. (`pages.ocr.language` the COLUMN is not a
 *    substitute — it is null on exactly the older ingests where this matters,
 *    while the tag inside `ocr.data` is present.)
 * 2. Failing that, the share of English function words in the page text, which
 *    separates already-English from foreign pages by 5-8x with no overlap
 *    between the bands (measurements in the scripts-side twin's header).
 *
 * Used by the quote path to serve a citable verbatim page where the original IS
 * the reader's language and no translation exists — or ever will, there being
 * nothing to translate.
 */
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

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
 * A SECOND wrapper family, from the epigraphy/artifact OCR schema —
 * `<condition>` and friends hold paragraphs of English prose ABOUT the artifact,
 * so left in they make an Akkadian tablet read as English. `stripEditorialWrappers`
 * knows the codex families; this covers the rest. Kept in sync with the
 * scripts-side twin.
 */
const ARTIFACT_WRAPPER_RE = /<(condition|period|surface|genre|notes|confidence|provenance|material|dimensions)>[\s\S]*?<\/\1>/gi;

/**
 * Words from OCR text, with EDITORIAL WRAPPERS REMOVED FIRST — the annotation
 * blocks are AI-written English whatever language the leaf is in, and stripping
 * only the TAGS keeps the prose (the #2232 bug class).
 */
export function textWords(s: string): string[] {
  return stripEditorialWrappers(String(s || ''))
    .replace(ARTIFACT_WRAPPER_RE, ' ')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .match(/[a-z']+/g) ?? [];
}

/**
 * Fraction of a page's words that are English function words. Returns null when
 * there is too little text to judge — an unreadable or blank page must not vote.
 */
export function englishFraction(text: string, minWords = 25): number | null {
  const w = textWords(text);
  if (w.length < minWords) return null;
  return w.filter((x) => ENGLISH_FUNCTION_WORDS.has(x)).length / w.length;
}

/**
 * Threshold separating an already-English page from a foreign one. Sits in the
 * empty band between the two measured populations (foreign tops out near 0.06,
 * already-English starts near 0.15), deliberately nearer the foreign side.
 */
export const ENGLISH_SOURCE_THRESHOLD = 0.15;

const LANG_TAG_RE = /<lang(?:uage)?>\s*([^<]{1,40}?)\s*<\/lang(?:uage)?>/i;

/** The language the OCR model declared for this page, if it declared one. */
export function declaredPageLanguage(ocrData: string | null | undefined): string | null {
  const m = String(ocrData || '').match(LANG_TAG_RE);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  return v && v !== 'null' && v !== 'unknown' ? v : null;
}

const ENGLISH_DECLARATIONS = new Set(['english', 'eng', 'en', 'modern english', 'early modern english']);

/** Is the declared language English? null when nothing was declared. */
export function declaresEnglish(ocrData: string | null | undefined): boolean | null {
  const l = declaredPageLanguage(ocrData);
  if (!l) return null;
  return ENGLISH_DECLARATIONS.has(l);
}

/**
 * Scanner/library boilerplate. English by construction, on books in every
 * language, and bound into the scan rather than printed in the book — so a page
 * carrying it says nothing about the language of the work. Not hypothetical: an
 * Armenian New Testament screened as English on three leaves of Google notice.
 */
export const BOILERPLATE_RE = /digital copy of a book that was preserved|make the world'?s books discoverable|public domain (?:book|work) is one that was never subject|google book search|digitized by (?:google|microsoft|the internet archive)/i;

/**
 * True when the text printed on this leaf is itself English — so a reader asking
 * for it in English is asking for the page, not for a translation.
 *
 * Errs toward `false`: an undeclared, short or boilerplate-only page is "no
 * claim", and the caller then gets the ordinary `no_translation` answer rather
 * than a foreign page served under an English framing.
 */
export function isEnglishOriginalPage(ocrData: string | null | undefined): boolean {
  const declared = declaredPageLanguage(ocrData);
  if (declared) {
    // A leaf can be declared bilingual — `<language>english, latin</language>`
    // is what the model writes for a page of English facing its Latin source.
    // Purely English is a claim; no English at all is the opposite claim; a
    // MIXED declaration is neither, so it defers to frequency below rather than
    // being read as foreign. (Kept here and not in `declaresEnglish`, which is
    // parity-pinned to the scripts-side twin that screens whole books.)
    const parts = declared.split(/[,;/]|\band\b/).map((s) => s.trim()).filter(Boolean);
    if (parts.every((p) => ENGLISH_DECLARATIONS.has(p))) return true;
    if (!parts.some((p) => ENGLISH_DECLARATIONS.has(p))) return false;
  }
  // A page whose only English is the scanner's own notice must not vote.
  if (BOILERPLATE_RE.test(String(ocrData || ''))) return false;
  const frac = englishFraction(String(ocrData || ''));
  return frac !== null && frac >= ENGLISH_SOURCE_THRESHOLD;
}
