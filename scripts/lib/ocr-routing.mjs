/**
 * PRIOR ART: scripts/lib/translate-core.mjs — holds the same policy for the
 * TRANSLATION phase (getTranslateModelForBook) and is documented as "the one
 * door" for translation writes. It does not cover OCR, and the OCR side had
 * grown two private copies of the allowlist instead
 * (scripts/workers/pipeline-orchestrator.mjs, scripts/migration/backfill-ocr-near-complete.mjs),
 * neither importable by a test because the orchestrator runs `run()` on import.
 * This module is the importable OCR-side door those copies now share.
 *
 * ocr-routing — which Gemini model OCRs a given book.
 *
 * There were three live copies of this policy (TS for API routes/Lambda, the
 * orchestrator's private copy, a migration script's private copy) and the
 * parity test could only see two of them. The unwatched pair drifted: both
 * carried `malay`/`ms`/`msa`, which the canonical list excludes on purpose,
 * so Malay books were OCR'd on lite (wrong) and translated on flash (right).
 *
 * Parity across every remaining implementation is pinned by
 * tests/unit/translate-core-parity.test.ts.
 */

export const OCR_MODEL_FLASH = 'gemini-3-flash-preview';
export const OCR_MODEL_LITE = 'gemini-3.1-flash-lite';

// Latin-script languages safe for flash-lite. Anything else (Tibetan, Arabic,
// Hebrew, CJK, Cyrillic, Greek, Syriac, etc.) routes to flash because
// flash-lite hallucinates on low-resource scripts — it over-relies on
// linguistic priors when visual decoding is hard, producing plausible-sounding
// content that has nothing to do with the page. See src/app/blog/tibetan-ocr/.
// Must stay in sync with LATIN_SCRIPT_LANGUAGES in src/lib/types/ai-models.ts.
const LATIN_SCRIPT_LANGS_FOR_LITE = new Set([
  'english', 'en', 'eng',
  'latin', 'la', 'lat',
  'french', 'fr', 'fra',
  'italian', 'it', 'ita',
  'spanish', 'es', 'spa',
  'portuguese', 'pt', 'por',
  'romanian', 'ro', 'ron', 'rum',
  'catalan', 'ca', 'cat',
  'german', 'de', 'deu', 'ger',
  'dutch', 'nl', 'nld', 'dut',
  'swedish', 'sv', 'swe',
  'norwegian', 'no', 'nor',
  'danish', 'da', 'dan',
  'finnish', 'fi', 'fin',
  'icelandic', 'is', 'isl', 'ice',
  'welsh', 'cy', 'cym', 'wel',
  'irish', 'ga', 'gle',
  'polish', 'pl', 'pol',
  'czech', 'cs', 'ces', 'cze',
  'slovak', 'sk', 'slk', 'slo',
  'slovenian', 'sl', 'slv',
  'croatian', 'hr', 'hrv',
  'hungarian', 'hu', 'hun',
  'estonian', 'et', 'est',
  'latvian', 'lv', 'lav',
  'lithuanian', 'lt', 'lit',
  'albanian', 'sq', 'sqi', 'alb',
  'turkish', 'tr', 'tur',
  'indonesian', 'id', 'ind',
  'vietnamese', 'vi', 'vie',
  'malay', 'ms', 'msa',
  'tagalog', 'tl', 'tgl', 'filipino',
  'swahili', 'sw', 'swa',
]);

/**
 * THE model routing for OCR. Mirrors getModelForBook in
 * src/lib/types/ai-models.ts and getTranslateModelForBook in translate-core.mjs.
 *
 * - BPH books: full flash (high-quality manuscripts)
 * - Non-Latin scripts: full flash (flash-lite hallucinates)
 * - Latin-script European languages: flash-lite (50% cheaper)
 * - Unknown/null language: full flash (safer default)
 */
export function getOcrModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return OCR_MODEL_FLASH;
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGS_FOR_LITE.has(lang)) return OCR_MODEL_FLASH;
  return OCR_MODEL_LITE;
}
