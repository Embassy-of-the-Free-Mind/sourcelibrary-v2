// Available Gemini models for processing
export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Best Quality - Use for BPH and complex content' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Cost-Efficient - 50% cheaper, comparable quality' },
] as const;

// Full-quality model (BPH books, complex scripts, image extraction)
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

// Cost-efficient model for standard OCR and translation
export const DEFAULT_LITE_MODEL = 'gemini-3.1-flash-lite';

// There is deliberately NO "default batch model". Batch vs realtime is a
// lane, not a quality tier; the model is the book's (`getModelForBook`). A
// flash constant here let three batch routes ignore the router (#4729).

/**
 * Languages written in Latin script that are well-represented in flash-lite's
 * pretraining. Books in these languages can safely use the cheaper model.
 *
 * Anything outside this allowlist (Tibetan, Sanskrit, Arabic, Hebrew, Greek,
 * CJK, Cyrillic, Syriac, Ge'ez, etc.) goes to full flash. Per the Tibetan-OCR
 * blog post: flash-lite hallucinated an entire genre ("ritual manual for
 * weather control") on a Bhutanese astrological text — it over-relies on
 * linguistic priors when visual decoding is hard, writing plausible-sounding
 * content that has nothing to do with the page. Worse than failing.
 *
 * Allowlist (not denylist) so unknown/null defaults to the safer model.
 */
const LATIN_SCRIPT_LANGUAGES: ReadonlySet<string> = new Set([
  // English
  'english', 'en', 'eng',
  // Latin
  'latin', 'la', 'lat',
  // Romance
  'french', 'fr', 'fra',
  'italian', 'it', 'ita',
  'spanish', 'es', 'spa',
  'portuguese', 'pt', 'por',
  'romanian', 'ro', 'ron', 'rum',
  'catalan', 'ca', 'cat',
  // Germanic
  'german', 'de', 'deu', 'ger',
  'dutch', 'nl', 'nld', 'dut',
  'swedish', 'sv', 'swe',
  'norwegian', 'no', 'nor',
  'danish', 'da', 'dan',
  'finnish', 'fi', 'fin',
  'icelandic', 'is', 'isl', 'ice',
  // Celtic
  'welsh', 'cy', 'cym', 'wel',
  'irish', 'ga', 'gle',
  // Slavic (Latin-script subset)
  'polish', 'pl', 'pol',
  'czech', 'cs', 'ces', 'cze',
  'slovak', 'sk', 'slk', 'slo',
  'slovenian', 'sl', 'slv',
  'croatian', 'hr', 'hrv',
  // Baltic + Finno-Ugric + Albanian + Turkic
  'hungarian', 'hu', 'hun',
  'estonian', 'et', 'est',
  'latvian', 'lv', 'lav',
  'lithuanian', 'lt', 'lit',
  'albanian', 'sq', 'sqi', 'alb',
  'turkish', 'tr', 'tur',
  // Latinized Asian
  // NOTE: Malay is deliberately absent. Our Malay holdings are mostly Jawi
  // (Arabic-script) manuscripts from Leiden — flash-lite garbles them into
  // confident nonsense (2026-07-18 Hikayat Tanah Hitu pilot, same failure
  // mode as the Tibetan case above). Malay must route to full flash.
  'indonesian', 'id', 'ind',
  'vietnamese', 'vi', 'vie',
  'tagalog', 'tl', 'tgl', 'filipino',
  // African (Latin-script)
  'swahili', 'sw', 'swa',
]);

function isLatinScriptLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return LATIN_SCRIPT_LANGUAGES.has(language.toLowerCase().trim());
}

/** The two book fields the routers read. Project exactly these when looking a book up for routing. */
export type RoutableBook = { image_source?: { provider?: string }; language?: string | null };

/**
 * Select the model for a book's OCR (image-in). .mjs twin: getOcrModelForBook
 * in scripts/lib/ocr-routing.mjs.
 *
 * - BPH books: full flash (high-quality manuscripts)
 * - Non-Latin scripts (Tibetan, Arabic, Hebrew, CJK, Cyrillic, etc.): full flash
 *   to avoid the flash-lite hallucination problem documented in the
 *   Tibetan-OCR blog post (a VISION failure — see the allowlist comment).
 * - Latin-script European languages: flash-lite (50% cheaper, comparable quality)
 * - Unknown/null language: full flash (safer default)
 *
 * NOT for translation — use getTranslateModelForBook below. The two policies
 * diverged on purpose in #4759; a translation call site that reaches for this
 * function pays 2x for a carve-out whose evidence is about reading images.
 */
export function getModelForBook(book: RoutableBook | null): string {
  if (book?.image_source?.provider === 'bph') {
    return DEFAULT_MODEL;
  }
  if (!isLatinScriptLanguage(book?.language)) {
    return DEFAULT_MODEL;
  }
  return DEFAULT_LITE_MODEL;
}

/**
 * Select the model for a book's TRANSLATION (text-in). .mjs twin:
 * getTranslateModelForBook in scripts/lib/translate-core.mjs; parity pinned by
 * tests/unit/translate-core-parity.test.ts.
 *
 * - BPH books: full flash.
 * - Everything else, INCLUDING non-Latin scripts: flash-lite.
 *
 * Why this differs from getModelForBook (issue #4759): #1726 carved non-Latin
 * scripts out to full flash on evidence that was entirely about visual
 * decoding, and swept translation along without translation evidence.
 * Translation reads `ocr.data` as text. The only translation A/B on record
 * (#467) favoured lite, and the observational read over the Mar 27 – May 12
 * 2026 lite era (scripts/eval/results/translation-model-obs-*) found no
 * faithfulness gap. Do not re-sync this with OCR routing without new evidence.
 */
export function getTranslateModelForBook(book: RoutableBook | null): string {
  if (book?.image_source?.provider === 'bph') {
    return DEFAULT_MODEL;
  }
  return DEFAULT_LITE_MODEL;
}
