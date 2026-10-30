// PRIOR ART: scripts/lib/legacy-note-syntax.mjs holds the reader's rules (what is hidden); this file only DETECTS
// each syntax on a stored page, for prevalence counts and fixture selection. src/components/reader/NotesRenderer.tsx
// `extractMetadata` / `preprocessBracketTags` are where every detector below comes from (cited per row).
/**
 * #5942 legacy syntaxes: one detector per note syntax ever emitted by a prompt or read by the reader.
 * `detect(data)` → the ids present on a page. `from` says where the syntax comes from (the prompt history
 * on #5942, 2026-10-29): which prompt asked for it, or "invented" when no prompt ever did.
 */
import { BRACKETED_PARAGRAPH, INTERP_PATTERN, isLacunaMark, looksLikeImageDescription } from '../../lib/legacy-note-syntax.mjs';

const br = (label) => new RegExp(`\\[\\[${label}:`, 'i');

/** id, regex or predicate, provenance. Order is the table's. */
export const SYNTAXES = [
  ['[[notes:]]', br('notes?'), 'OCR + translation, 2025-12-12 → 12-27 (translation v0)'],
  ['[[meta:]]', br('meta'), 'OCR, 2025-12-21 → 12-27'],
  ['[[warning:]]', br('warning'), 'OCR, 2025-12-24 → 12-27'],
  ['[[language:]]', br('language'), 'OCR, 2025-12-17 → 12-27'],
  ['[[page number:]]', br('page\\s*number'), 'OCR, 2025-12-12 → 12-27'],
  ['[[folio:]]', br('folio'), 'OCR, 2025-12-21 → 12-27'],
  ['[[signature:]]', br('signature'), 'OCR, 2025-12-25 → 12-27'],
  ['[[abbrev:]]', br('abbrev'), 'OCR, 2025-12-21 → 12-27'],
  ['[[summary:]]', br('summary'), 'translation, 2025-12-21 → 12-27'],
  ['[[keywords:]]', br('keywords'), 'translation, 2025-12-21 → 12-27'],
  ['[[vocabulary:]]', br('vocabulary'), 'OCR, 2025-12-21 → 12-27'],
  ['[[image:]]', br('image'), 'OCR, 2025-12-25 → 12-27'],
  ['[[header:]]', br('header'), 'OCR, 2025-12-21 → 12-27'],
  ['[[markup:]]', br('markup'), 'translation placeholder, 2025-12-18 → 12-27'],
  ['[[page type:]]', br('page\\s*type'), 'invented'],
  ['[[margin:]]', br('margin'), 'OCR (translation keeps), 2025-12-18 → 12-27'],
  ['[[gloss:]]', br('gloss'), 'OCR (translation keeps), 2025-12-18 → 12-27'],
  ['[[insert:]]', br('insert'), 'OCR (translation keeps), 2025-12-18 → 12-27'],
  ['[[unclear:]]', br('unclear'), 'OCR (translation keeps), 2025-12-18 → 12-27'],
  ['[[term:]]', br('term'), 'OCR + translation, 2025-12-21 → 12-27'],
  ['[[original page:]] / [[catchword:]] / [[sig:]] / [[vocab:]] / [[heading:]] / [[crossed out:]]', /\[\[(?:original\s*page|page|catchword|sig|signature\s*mark|vocab|heading|crossed\s*out):/i, 'invented; no reader rule reads it'],
  ['[[other label:]]', /\[\[(?!(?:notes?|meta|warning|language|page\s*number|folio|signature|abbrev|summary|keywords|vocabulary|image|header|markup|page\s*type|margin|gloss|insert|unclear|term|original\s*page|page|catchword|sig|signature\s*mark|vocab|heading|crossed\s*out):)[a-z][a-z ]{0,20}:/i, 'invented'],
  ['bracketed image paragraph', (d) => [...d.matchAll(BRACKETED_PARAGRAPH)].some((m) => looksLikeImageDescription(m[2])), 'invented'],
  ['[interpolation]', (d) => [...d.matchAll(INTERP_PATTERN)].some((m) => !isLacunaMark(m[1])), 'invented; banned from translation v7/v8 (2026-03-25)'],
  ['[Note: …]', /(?<!\[)\[(?:translator'?s\s+)?note:/i, 'invented'],
  ['[…] lacuna', (d) => [...d.matchAll(INTERP_PATTERN)].some((m) => isLacunaMark(m[1])), 'invented'],
  ['plain Summary: line', /^Summary:\s*\S/im, 'invented'],
  ['preamble ("Here is the translation")', /^\s*(?:```\w*\s*)?(?:\*\*)?(?:here (?:is|are)|here's|below is|i have (?:translated|transcribed)|the following is|sure[,!:]|certainly)\b/i, 'invented'],
  ['"# Title Page"-style heading', /^#{1,3}\s*#{0,3}\s*(?:Title Page|Frontispiece|Colophon|Table of Contents|Index|Blank Page|Cover)\b/im, 'invented'],
  ['code fence', /^\s*```|```\s*$/, 'invented'],
  ['free-text Vocabulary section', /\n*\*{0,2}(?:Vocabulary(?:\s+used)?(?:\s+in\s+this\s+passage)?|Key\s+(?:vocabulary|terms|words))(?:\s+(?:used\s+)?(?:in|on|from)\s+this\s+page)?:?\*{0,2}\s*\n/i, 'invented'],
  ['(Note: …)', /\((?:translator'?s\s+)?note:/i, 'invented'],
  ["Translator's note:", /translator'?s note/i, 'invented'],
  ['<<…>>', /<<[^<>\n]{1,200}>>/, 'invented'],
  ['«…»', /«[^»\n]{1,200}»/, 'invented (also ordinary quotation marks)'],
  ['{{…}}', /\{\{[^{}\n]{1,200}\}\}/, 'invented'],
  ['→ in a term', /<term>[^<]*→[^<]*<\/term>|\[\[term:[^\]]*→/i, 'OCR [[term: X → Y]], 2025-12-21 → 12-27'],
  ['<lacuna>', /<lacuna>/i, 'OCR v17 (2026-09-03, non-default)'],
  ['<interp>', /<interp>/i, 'invented (the reader emits it; no prompt does)'],
];

/** @param {string} data @returns {string[]} */
export function detect(data) {
  const out = [];
  for (const [id, re] of SYNTAXES) if (typeof re === 'function' ? re(data) : re.test(data)) out.push(id);
  return out;
}

/** Prompt-version label for a page, as stored (13, "13" and "v13" are kept apart: two writers number them). */
export function versionOf(row) {
  return row.prompt_version == null || String(row.prompt_version).trim() === '' ? 'none' : String(row.prompt_version).trim();
}

const block = (label) => (d) => d.replace(new RegExp(`\\[\\[${label}:[\\s\\S]*?\\]\\]`, 'gi'), '');
/**
 * For the differential check: the page with every occurrence of one syntax deleted. If the reader and the parser
 * disagree on the same words with and without it, that syntax is not why they disagree. Syntaxes not listed here
 * are judged on the whole page only.
 */
export const REMOVE = {
  '[[notes:]]': block('notes?'), '[[meta:]]': block('meta'), '[[warning:]]': block('warning'), '[[language:]]': block('language'),
  '[[page number:]]': block('page\\s*number'), '[[folio:]]': block('folio'), '[[signature:]]': block('signature'), '[[abbrev:]]': block('abbrev'),
  '[[summary:]]': block('summary'), '[[keywords:]]': block('keywords'), '[[vocabulary:]]': block('vocabulary'), '[[image:]]': block('image'),
  '[[header:]]': block('header'), '[[markup:]]': block('markup'), '[[page type:]]': block('page\\s*type'), '[[margin:]]': block('margin'),
  '[[gloss:]]': block('gloss'), '[[insert:]]': block('insert'), '[[unclear:]]': block('unclear'), '[[term:]]': block('term'),
  'bracketed image paragraph': (d) => d.replace(BRACKETED_PARAGRAPH, (m, lead, inner) => (looksLikeImageDescription(inner) ? lead : m)),
  '[interpolation]': (d) => d.replace(INTERP_PATTERN, (m, inner) => (isLacunaMark(inner) ? m : '')),
  '[Note: …]': (d) => d.replace(INTERP_PATTERN, (m, inner) => (/^(?:translator'?s\s+)?note:/i.test(inner) ? '' : m)),
  'plain Summary: line': (d) => d.replace(/^Summary:.*$/gim, ''),
};
