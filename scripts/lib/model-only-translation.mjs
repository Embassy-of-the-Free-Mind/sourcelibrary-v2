// PRIOR ART: scripts/lib/stale-translation.mjs `isPlaceholderTranslation` — matches ANY single
// bracketed line, refusals included ("[This page could not be translated due to content recitation
// restrictions.]"), which is a sweep's scope, not a page-type statement the reader may print.
// scripts/lib/scholarly-typst.mjs `isUngroundedTranslation` (PR #5850, unmerged) — the rule below,
// private to the Typst edition; this is its shared home so the reader and the exports agree.
import { stripMarkupTags } from './strip-markup-tags.mjs';

/**
 * Translation text the BOOK never carried (#5903). Two kinds, both in the stored
 * `translation.data`, both rendered by the reader as if they were the book's English:
 *
 *   marker      `[Blank page — no translatable content]` — the pipeline's own placeholder
 *               (translation-processor-logic.ts writes `[<Type> page — no translatable content]`
 *               for every SKIP_TRANSLATION_PAGE_TYPES page). ~1.25% of pages. The reader turned
 *               its brackets into a "Translator's addition" chip. It stays stored on purpose:
 *               page-counts reads it.
 *   ungrounded  the transcription has no text (a plate, a marbled endpaper) and the model wrote
 *               a paragraph describing the picture anyway. 0.6% of pages in the 2026-10-06 draw,
 *               e.g. 697a3055143dc97a39f2a22f p.69, a 1,400-character essay on combed marbling.
 *
 * Display only: nothing here changes stored text.
 */

const MARKER_RE = /^\s*\[\s*([A-Za-z][\w -]*?) page\s+[—–-]\s+no translatable content\s*\]\s*$/i;

/**
 * The page type a pipeline marker names (`'blank'`, `'illustration'` …), or null when the
 * text is not a marker.
 * @param {unknown} text
 * @returns {string | null}
 */
export function noContentMarkerType(text) {
  if (typeof text !== 'string') return null;
  const m = MARKER_RE.exec(text);
  return m ? m[1].trim().toLowerCase().replace(/\s+/g, '-') : null;
}

/** One apparatus tag with its body, holding no nested opener of the same name. */
const APPARATUS_RE = /<(note|meta|vocab|summary|keywords|image-desc|lang|language|page-num|header|sig|page-type|scan-quality|script|warning|columns)\b[^>]*>((?:(?!<\1\b)[\s\S])*?)<\/\1>/g;

/**
 * The words of a page with the model's apparatus taken out: tags and their bodies
 * (notes, metadata, detected images, vocab …), then any remaining markup and punctuation.
 *
 * Unlike the #5850 original, `<margin>` and `<gloss>` keep their words: they are page
 * marks, text physically on the leaf (see src/lib/notes-off.ts). Stripping them flagged
 * 69dbc7cd1040d1d5e20941e6 p.397, a full page of Latin the OCR wrapped in one `<margin>`.
 * @param {unknown} s
 * @returns {string}
 */
export function sourceText(s) {
  let t = String(s || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/g, '');
  // Innermost first, until nothing pairs: a lazy match on a nested `<note>…<note>Anubis</note>…</note>`
  // closes at the inner tag and leaves the rest of the description in as "text"
  // (69c727966a0f3d112faf6ed0 p.159, an engraving whose real caption is two lines).
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(APPARATUS_RE, ''); }
  return stripMarkupTags(t).replace(/[#*|:\-\s>]+/g, ' ').trim();
}

/**
 * Han, kana and Hangul carry a word or more per character: 29 characters of a Chinese
 * colophon (6a3c64a4af3c49b59c5ca6fa p.103) translate to 200 honest English ones.
 * Each counts as four letters, so the 30-character floor means the same amount of text
 * in every script.
 */
const DENSE_SCRIPT_RE = /[\u1100-\u11ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
const DENSE_WEIGHT = 4;
const sourceLength = s => s.length + (DENSE_WEIGHT - 1) * (s.match(DENSE_SCRIPT_RE)?.length ?? 0);

/**
 * A translation with nothing under it: under 30 characters of source text on the page
 * (dense scripts weighted, below), over 200 of "translation". Fludd UCH I had 22 such pages, each checked against the scan.
 * Most are a picture described; some are a page whose OCR failed (69d5ad8f4dc55b8478de0eac
 * p.6: six characters of Japanese, then a run of blank space) under 2,000 characters of
 * English the model wrote anyway. Either way the words are the model's, not the book's.
 * @param {{ ocr?: { data?: string | null } | null, translation?: { data?: string | null } | null }} page
 * @returns {boolean}
 */
export function isUngroundedTranslation(page) {
  if (!page?.ocr?.data || !page?.translation?.data) return false;
  if (noContentMarkerType(page.translation.data)) return false;
  return sourceLength(sourceText(page.ocr.data)) < 30 && sourceText(page.translation.data).length > 200;
}

/**
 * The translation an EXPORT should carry for this page: '' for a marker or an ungrounded
 * description, the stored text otherwise. An export is the book's text; a model's
 * description of an endpaper is not part of it, and a bracketed marker is page information.
 * @param {{ ocr?: { data?: string | null } | null, translation?: { data?: string | null } | null }} page
 * @returns {string}
 */
export function exportableTranslation(page) {
  const data = page?.translation?.data || '';
  if (!data || noContentMarkerType(data) || isUngroundedTranslation(page)) return '';
  return data;
}
