/**
 * Scripts-side twin of `src/lib/english-original-text.ts` (#7100): on an
 * English edition's English leaf, the stored `translation` is a model's
 * rewording of the author's words and must not stand in for them — not in the
 * reader, not in a quote, and not in the embedding row whose `translation`
 * column is the semantic-search snippet.
 *
 * PRIOR ART: src/lib/english-original-text.ts — the request-path original; a
 * node script cannot import TS, so the decision is re-stated here from the
 * scripts-side helpers it was built on (english-source-detect.mjs for the
 * per-page test, page-counts.mjs's isEnglishOriginal for the per-book one,
 * restated below).
 * `tests/unit/english-original-serve.test.ts` pins the two sides together —
 * change both at once.
 */
import {
  declaredPageLanguage,
  englishFraction,
  BOILERPLATE_RE,
  ENGLISH_SOURCE_THRESHOLD,
} from './english-source-detect.mjs';

/**
 * `isEnglishOriginal` from page-counts.mjs, restated: that module also WRITES
 * books, and importing it would make every embed writer a books-writing lane
 * in the lanes registry's eyes. Pinned to it by the parity test.
 */
const ENGLISH_LANGUAGE_TOKENS = new Set(['english', 'en', 'eng']);
export function isEnglishEdition(language) {
  const first = String(language ?? '').toLowerCase()
    .split(/[;,/&+]| and /)[0]
    .trim()
    .replace(/\s*\(.*\)$/, '');
  return ENGLISH_LANGUAGE_TOKENS.has(first);
}

const ENGLISH_DECLARATIONS = new Set(['english', 'eng', 'en', 'modern english', 'early modern english']);

/**
 * Is the text printed on THIS leaf English? Twin of `isEnglishOriginalPage` in
 * `src/lib/english-page-language.ts`, including its handling of a MIXED
 * declaration (`<language>english, latin</language>`), which defers to word
 * frequency rather than being read as foreign.
 */
export function isEnglishOriginalPage(ocrData) {
  const declared = declaredPageLanguage(ocrData);
  if (declared) {
    const parts = declared.split(/[,;/]|\band\b/).map((s) => s.trim()).filter(Boolean);
    if (parts.every((p) => ENGLISH_DECLARATIONS.has(p))) return true;
    if (!parts.some((p) => ENGLISH_DECLARATIONS.has(p))) return false;
  }
  if (BOILERPLATE_RE.test(String(ocrData || ''))) return false;
  const frac = englishFraction(String(ocrData || ''));
  return frac !== null && frac >= ENGLISH_SOURCE_THRESHOLD;
}

/** The stamped `translation_state.english_original`, else the first-language test that stamps it. */
export function isEnglishOriginalBook(book) {
  if (!book) return false;
  const stamped = book.translation_state?.english_original;
  if (typeof stamped === 'boolean') return stamped;
  return isEnglishEdition(book.language);
}

/**
 * True when this page's stored `translation` must not be used: English book,
 * English leaf, and a transcription to use instead.
 */
export function servesTranscriptionInsteadOfTranslation(page, book) {
  const ocr = typeof page?.ocr?.data === 'string' ? page.ocr.data : '';
  const tr = typeof page?.translation?.data === 'string' ? page.translation.data : '';
  if (!tr || !ocr.trim()) return false;
  if (!isEnglishOriginalBook(book)) return false;
  return isEnglishOriginalPage(ocr);
}
