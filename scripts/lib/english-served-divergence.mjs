/**
 * Does the English we SERVE on an English-original page equal the page's transcription? (#7100)
 *
 * PRIOR ART: src/lib/english-page-language.ts (isEnglishOriginalPage, TS only; ported below on top
 *   of its scripts-side twin scripts/lib/english-source-detect.mjs, which carries the word list and
 *   thresholds but stops at the book level). scripts/lib/leaf-offset-match.mjs (token-bigram Dice
 *   against neighbouring leaves) — a different measure for a different question: it asks which leaf
 *   an IA text belongs to, this asks how much of a served English body is the author's own words.
 *
 * The measure is the one #7100 was measured with: word-bigram OVERLAP of the translation body
 * against the OCR body, tags and editorial wrappers stripped. Overlap is containment, not Dice:
 * the share of the served text's bigrams that occur in the transcription. A near-copy scores ≥ 0.9,
 * a spelling modernisation 0.6–0.9, a paraphrase 0.3–0.6, another text < 0.3.
 *
 * Used by scripts/audit/english-served-divergence.mjs (the weekly detector) and by the #7100
 * triage of the < 0.3 bin. Pure functions; no I/O.
 */
import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';
import {
  declaredPageLanguage, englishFraction, ENGLISH_SOURCE_THRESHOLD, BOILERPLATE_RE,
} from './english-source-detect.mjs';

/** Zero-width characters (the served text carries an invisible watermark). */
const ZERO_WIDTH_RE = /[​-‏⁠-⁤﻿]/g;

/**
 * The words of a page body: wrappers and tags out, long s folded, lower case. A translator's
 * inline `<note>` is the model's gloss, not the page: left in, it reads a verbatim page as a
 * rewrite (Splendor Solis, #7100 triage).
 */
export function bodyWords(text) {
  return String(stripEditorialWrappers(String(text || '')) || '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/<note(?:\s[^>]*)?>[\s\S]*?<\/note>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/ſ/g, 's')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .match(/[a-z]+/g) ?? [];
}

export function wordBigrams(words) {
  const s = new Set();
  for (let i = 1; i < words.length; i++) s.add(`${words[i - 1]} ${words[i]}`);
  return s;
}

/** Minimum bigrams in the served body before an overlap is a measurement. */
export const MIN_BIGRAMS = 20;

/**
 * Share of `served`'s word bigrams found in `ocr`. null when either side is too short to judge.
 * Accepts strings or precomputed bigram Sets.
 */
export function bigramOverlap(served, ocr) {
  const a = served instanceof Set ? served : wordBigrams(bodyWords(served));
  const b = ocr instanceof Set ? ocr : wordBigrams(bodyWords(ocr));
  if (a.size < MIN_BIGRAMS || b.size < MIN_BIGRAMS / 2) return null;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size;
}

const ENGLISH_DECLARATIONS = new Set(['english', 'eng', 'en', 'modern english', 'early modern english']);

/**
 * Port of `isEnglishOriginalPage` (src/lib/english-page-language.ts). Keep the two in step:
 * declared language first (all-English → true, no English → false, mixed defers), then the
 * function-word share, with scanner boilerplate never voting.
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

/** Is a translation body itself English prose? */
export function isEnglishBody(text) {
  const frac = englishFraction(String(text || '').replace(ZERO_WIDTH_RE, ''));
  return frac !== null && frac >= ENGLISH_SOURCE_THRESHOLD;
}

/** At or above this overlap the served text is the transcription, give or take spelling. */
export const SAME_TEXT_OVERLAP = 0.9;

/**
 * Verdict on one probed page.
 *   `verbatim`    served the transcription (text_source ocr_original), or a near-copy of it
 *   `bilingual`   the leaf is not purely English, so serving a translation is legitimate
 *   `diverges`    an English leaf served text whose overlap with its own OCR is below SAME_TEXT_OVERLAP
 *   `unjudged`    too short to measure
 */
export function servedVerdict({ ocrData, servedText, textSource }) {
  if (textSource === 'ocr_original') return { verdict: 'verbatim', overlap: 1 };
  if (!isEnglishOriginalPage(ocrData)) return { verdict: 'bilingual', overlap: null };
  const overlap = bigramOverlap(servedText, ocrData);
  if (overlap === null) return { verdict: 'unjudged', overlap };
  return { verdict: overlap >= SAME_TEXT_OVERLAP ? 'verbatim' : 'diverges', overlap };
}
