// PRIOR ART: scripts/eval/translation-notes-free/run-arms.mjs (#5919) — its PLAIN list of anchored in-memory edits to the
// live v13 prompt (each anchor found exactly once, else throw; no prompt row seeded) is the pattern here. #5919 kept
// <summary>, <keywords>, <term> and <meta>; #6728 removes those too (the issue: "notes/summary/keywords/terms/gloss/meta
// removed; keep structural tags"). bodyOf() below is new: the one tag strip both arms are judged through.
/**
 * #6728 prompts: CURRENT = the live default translation prompt (translate-core's buildTranslationPrompt, page-break
 * devices scoped, as cli-translate.mjs sends it); PLAIN = the same text with the interpretive instructions edited out.
 */
import crypto from 'node:crypto';

export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// Each [find, replace] must match exactly once in the live v13 text.
export const PLAIN_EDITS = [
  // Output contract: remarks went to <meta>; plain has no remark channel but the untranslatable-page <warning>.
  ['- If you need to remark on anything — the source language differing from what was expected, OCR quality, uncertainty — put the remark INSIDE <meta>…</meta> or <warning>…</warning>. Any text outside tags is treated as part of the translation and corrupts the edition.\n',
   '- Do not remark on anything — the source language, OCR quality, your uncertainty. Any text you write is treated as part of the translation.\n'],
  ['Your response must begin either with a tag (e.g. <meta>) or with the first translated words of the page.',
   'Your response must begin with the first translated words of the page.'],
  // Inline annotations: no <note>, no <term>, <gloss> only for a gloss printed on the page.
  ['**Inline annotations (XML tags — toggleable by reader):**\n- <note>X</note> — interpretive notes, interpolated clarifications\n- <term>X</term> — technical/foreign terms kept in transliteration\n- <gloss>X</gloss> — definition immediately after a <term> tag; also translate interlinear annotations\n',
   '**Tags that mark what is on the page:**\n- <gloss>X</gloss> — ONLY an interlinear gloss printed in the source: translate it. Never a definition of your own.\n'],
  // Metadata tags section goes.
  ['**Metadata tags (hidden from readers):**\n- <meta>X</meta> for translator notes that should be hidden (e.g., continuity with previous page)\n\n', ''],
  // Do NOT use: the <meta>/<note> routes go; the bracket ban stays.
  ['  - Context from previous page → <meta>continues from previous page: ...</meta>\n  - Interpolated clarifications → <note>...</note>\n', '  - Context from previous page → leave it out; begin with this page\'s words\n'],
  ['- Bare (parenthetical glosses) after terms — use <term>word</term> <gloss>meaning</gloss> instead\n',
   '- Notes, definitions, glosses or explanations of your own, in any form: no tags, no (parentheses), no [brackets]\n'],
  // Embedded phrases: translate, no "original:" note.
  ['Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.',
   'The main text must be fully readable in English without knowing other languages.'],
  // Image descriptions: keep the OCR's own tag, translated literally (as #5919).
  ['If the OCR contains <image-desc>...</image-desc>, translate the description and wrap the ENTIRE paragraph in <note>...</note>. Image descriptions are editorial content, not original text — they must be toggleable. Do NOT leave image description prose untagged. Example:\n  OCR: <image-desc>A woodcut of a pelican feeding her young</image-desc>\n  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>\n',
   'If the OCR contains <image-desc>...</image-desc>, keep the tag and translate the description literally inside it. Add no interpretation. Example:\n  OCR: <image-desc>Ein Holzschnitt: ein Pelikan füttert seine Jungen</image-desc>\n  Translation: <image-desc>A woodcut: a pelican feeding her young</image-desc>\n'],
  // Instructions 1, 4, 5 lose their annotation half; the examples, 6, 7, 8 (museum label), the second 8 and 9 go.
  ['1. If the page continues a sentence from the previous page, start with <meta>continues from previous page</meta> then begin the translation mid-sentence naturally (no brackets, no ellipsis). Just write the continued text.\n',
   '1. If the page continues a sentence from the previous page, begin the translation mid-sentence naturally (no brackets, no ellipsis). Just write the continued text.\n'],
  ['4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.\n5. For foreign terms kept in transliteration: <term>Chesed</term> <gloss>Mercy/Loving-kindness</gloss>\n',
   '4. Translate embedded Latin/Greek/Hebrew phrases to English.\n5. A foreign term you keep in transliteration is written as plain text, undefined.\n'],
  ['\n**Examples of annotated translation:**\n- "He composed a very worthy book On the World and Religion <note>original: "De Seculo, & Religione"</note>; one On Fate and Fortune <note>original: "De Fato, & Fortuna"</note>; and another On Law and Medicine <note>original: "Della Legge, e della Medicina"</note>."\n- "The <term>prima materia</term> <gloss>first matter</gloss> must be purified through <term>calcination</term> <gloss>heating to powder</gloss> before the <term>opus</term> <gloss>the Great Work</gloss> can proceed."\n- "According to the <term>Sefer Yetzirah</term> <gloss>Book of Formation</gloss>, the ten <term>sefirot</term> <gloss>divine emanations</gloss> correspond to the paths of wisdom."\n6. For interpolated clarifications: <note>from the aspect of the secret</note>\n7. Add <note>...</note> inline to explain historical references or difficult phrases.\n8. Style: warm museum label - explain rather than assume knowledge.\n9. Preserve the voice and spirit of the original.\n8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n9. END with <summary>...</summary> and <keywords>...</keywords> for indexing.\n',
   '6. Do not write notes, definitions, glosses, summaries, keywords or explanations of any kind. Another step writes those; your output is the translation only.\n7. Preserve the voice and spirit of the original.\n'],
  // The style section is about summaries and notes only.
  ['\n**Writing style for summaries and notes:**\n- Never use em-dashes (—). Use commas, colons, semicolons, or separate sentences.\n- Avoid: "delves into", "rich tapestry", "fascinating exploration", "sheds light on", "comprehensive", "intricate", "nuanced", "multifaceted", "offers a window into".\n- Use short, direct sentences. Scholarly but accessible.\n', ''],
  // Final output format: the translation alone.
  ['Translated text here (no wrapper brackets).\n\n<summary>1-2 sentence summary of this page\'s main content and significance</summary>\n<keywords>key concepts, names, themes in English, for indexing</keywords>',
   'Translated text here (no wrapper brackets), and nothing else.'],
];

export function plainPrompt(current) {
  let t = current;
  for (const [find, rep] of PLAIN_EDITS) {
    if (t.split(find).length !== 2) throw new Error(`PLAIN anchor not found exactly once: ${find.slice(0, 70)}`);
    t = t.replace(find, () => rep);
  }
  for (const tag of ['note', 'term', 'summary', 'keywords', 'meta']) if (new RegExp(`<\\/?${tag}\\b`).test(t)) throw new Error(`PLAIN still names <${tag}>`);
  return t;
}

/** The previous page's stored English as a PLAIN pipeline would hold it: interpretive blocks out, <term> unwrapped. */
export function plainSeed(text) {
  if (!text) return text;
  return String(text)
    .replace(/<(note|summary|keywords|gloss|meta|vocab)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?term(?:\s[^>]*)?>/gi, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The BODY a judge scores, the same function for every arm: editorial blocks removed with their content (what the
// house prompt adds: notes, definitions, summary, keywords, metadata, image descriptions, warnings, OCR metadata tags);
// every other tag unwrapped so its words stay (term, gloss, margin, insert, unclear, header, heading, page-num …).
// <gloss> is KEPT: both prompts define it to carry interlinear text printed in the source (pilot, Sanguo yanyi p. 22) —
// EXCEPT a <gloss> straight after </term>, which is CURRENT's definition of a term (the prompt's own pattern): dropped.
const termGlossRe = /(<\/term>)\s*<gloss\b[^>]*>[\s\S]*?<\/gloss>/gi;
const DROP = ['note', 'summary', 'keywords', 'meta', 'vocab', 'warning', 'image-desc', 'scan-quality', 'language', 'page-type', 'sig', 'columns', 'script'];
const dropRe = new RegExp(`<(${DROP.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const loneRe = new RegExp(`</?(${DROP.join('|')})\\b[^>]*>`, 'gi');
export function bodyOf(text) {
  return String(text || '')
    .replace(termGlossRe, '$1')
    .replace(dropRe, '')
    .replace(loneRe, '')
    .replace(/<(column-break|leaf-break)\s*\/?>/gi, '\n')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Characters per interpretive tag kind (content included), for the output-composition table. */
export function tagChars(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/<(note|gloss|term|summary|keywords|meta|warning|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    const k = m[1].toLowerCase(); out[k] = (out[k] || 0) + m[0].length;
  }
  return out;
}
