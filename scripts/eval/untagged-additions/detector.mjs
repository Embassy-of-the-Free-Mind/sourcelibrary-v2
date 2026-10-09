// PRIOR ART: scripts/audit/translation-bridging.mjs (#5305) flags a page on length ratio, shared runs with a
// neighbour and an open ending — mechanical signals, a work list, no sentence and no reason.
// scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md (#5274) and translation-vs-reference/JUDGE-PROMPT.md (#5695)
// are whole-page fidelity judges for Opus subagents: they name ≤ 15-word examples of invention, not every sentence,
// and the second needs a human reference. scripts/lib/note-claims.mjs (#5647) checks facts INSIDE <note> tags.
// scripts/eval/lib/quality-census-detectors.mjs sees brackets and tag shapes only. None lists the untagged sentences
// of a translation that render nothing in the source; this does, and reuses stripMarkupTags, callGemini and the
// #5919 envelope pattern.
/** #5982 source-grounded additions detector: numbered sentences of a translation's running text, checked against the page's source text by Lite/Flash. */
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

/** Tags whose CONTENT is ours or the transcriber's, not the author's: dropped content and all (they are tagged, so not this study's subject). */
export const APPARATUS = ['note', 'gloss', 'meta', 'summary', 'keywords', 'image-desc', 'warning', 'vocab', 'language', 'lang', 'page-type', 'scan-quality', 'script', 'columns', 'lacuna', 'condition'];
/** The OCR's own machine-written prose about the page (not the page's words): shown to the detector apart from the source text. */
const OCR_DESCRIPTIVE = ['image-desc', 'meta', 'summary', 'warning', 'lacuna', 'condition'];
/** In a SOURCE transcription <note> and <gloss> hold the page's printed footnotes and interlinear glosses: the page's words, kept. */
const SOURCE_APPARATUS = APPARATUS.filter((t) => t !== 'note' && t !== 'gloss').concat('detected-images');
const TAG_RE = /<\/?([a-zA-Z][\w-]*)\b[^<>]*>/g;

/**
 * Split marked-up page text into the running text (apparatus removed with its content, every other tag unwrapped)
 * and the removed apparatus blocks.
 */
export function splitApparatus(text, apparatus = APPARATUS) {
  const s = String(text || '').replace(/->|<-/g, ' ');
  let out = ''; const blocks = []; const stack = []; let last = 0; let cur = '';
  const push = (chunk) => { if (stack.length) cur += chunk; else out += chunk; };
  for (const m of s.matchAll(TAG_RE)) {
    push(s.slice(last, m.index)); last = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    if (!apparatus.includes(tag)) { push(' '); continue; }
    if (m[0].startsWith('</')) {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) { stack.splice(i); if (!stack.length) { blocks.push({ tag, text: stripMarkupTags(cur).replace(/\s+/g, ' ').trim() }); cur = ''; out += ' '; } }
    } else if (!m[0].endsWith('/>')) stack.push(tag);
  }
  // an unclosed apparatus tag swallows to the end of its paragraph only, as the reader does
  const rest = s.slice(last);
  if (stack.length) { const cut = rest.search(/\n\s*\n/); const i = cut < 0 ? rest.length : cut; blocks.push({ tag: stack[0], text: (cur + rest.slice(0, i)).replace(/\s+/g, ' ').trim() }); out += rest.slice(i); } else out += rest;
  return { text: stripMarkupTags(out), blocks: blocks.filter((b) => b.text) };
}

const unMarkdown = (t) => t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '').replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '').replace(/\*{1,3}/g, '').replace(/^[ \t]*\|?[ \t:|-]{5,}$/gm, '');

/** The sentences of a translation's running text (apparatus dropped), in page order. A short fragment joins the unit before it on the same line. */
export function sentenceUnits(translation) {
  const { text } = splitApparatus(translation);
  const units = [];
  for (const raw of unMarkdown(text).split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue;
    const parts = line.split(/(?<=[.!?…]["'”’)\]]?)\s+(?=["'“‘([]?[A-Z0-9])/u);
    let first = true;
    for (const p of parts) {
      const words = p.split(/\s+/).length;
      if (!first && (words < 4 || units[units.length - 1].split(/\s+/).length < 3)) units[units.length - 1] += ` ${p}`;
      else units.push(p);
      first = false;
    }
  }
  return units;
}

/** The source as the detector reads it: running text, plus the transcriber's own descriptive blocks apart. */
export function sourceParts(source) {
  const { text, blocks } = splitApparatus(source, SOURCE_APPARATUS);
  return { text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), described: blocks.filter((b) => OCR_DESCRIPTIVE.includes(b.tag)).map((b) => b.text) };
}

export const KINDS = ['explanation', 'definition', 'image_description', 'summary', 'page_note', 'transcriber_block', 'continuation', 'unsupported'];
/** Kinds that are commentary or invention inside the running text. `continuation` (a neighbouring page's text) is counted apart. */
export const ADDITION_KINDS = KINDS.filter((k) => k !== 'continuation');
export const PROMPT_VERSION = 'additions-5982-v2';
export const MAX_SOURCE_CHARS = 14000;
export const MAX_UNITS = 160;

export function buildPrompt({ source, units, prevTail = '', nextHead = '', sourceKind = 'ocr' }) {
  const sp = sourceParts(source);
  const src = sp.text.slice(0, MAX_SOURCE_CHARS);
  const numbered = units.slice(0, MAX_UNITS).map((u, i) => `[${i + 1}] ${u}`).join('\n');
  return `You check an English translation of ONE page of a historical book against the page's source text. Your one question: did the translator write COMMENTARY into the running text, that is, a sentence, clause, bracket or parenthesis of the translator's own, which translates nothing on the page?

SOURCE (${sourceKind === 'typed' ? 'a typed transcription of the page; it may leave out running heads, page numbers and marginal notes, and may start or end a few words off the page' : 'a transcription of the page; it can carry small reading errors'}). Everything in it is the page's own text, including headings, running heads, marginal notes, footnotes and editors' notes printed on the page, wherever they stand:
"""
${src}
"""
${sp.described.length ? `\nTRANSCRIBER'S OWN DESCRIPTIONS (written by the transcriber about pictures, layout or the state of the page; NOT printed on the page):\n"""\n${sp.described.join('\n').slice(0, 3000)}\n"""\n` : ''}${prevTail ? `\nEND OF THE PREVIOUS PAGE (source):\n"""\n${sourceParts(prevTail).text.slice(-500)}\n"""\n` : ''}${nextHead ? `\nSTART OF THE NEXT PAGE (source):\n"""\n${sourceParts(nextHead).text.slice(0, 500)}\n"""\n` : ''}
TRANSLATION, one numbered sentence per line (it may give the page's parts in another order than the source):
"""
${numbered}
"""

For each sentence find the source words it renders, anywhere in the SOURCE. Flag it only when a whole sentence, or a clause, bracket or parenthesis of five words or more inside it, renders NOTHING in the SOURCE. Kinds:
- "explanation": explains, interprets or identifies ("This refers to …", "that is, …", who a person was, what an allusion means) where the source says no such thing.
- "definition": defines or glosses a word (in brackets, in parentheses, after a colon, dash or "i.e.") where the source gives only the word.
- "image_description": describes a picture, diagram, ornament, stamp, handwriting, layout or the state of the page, and the SOURCE has no such words.
- "summary": summarises, introduces or bridges in the translator's voice ("In summary …", "The author now turns to …", "This page continues …", "The text breaks off here").
- "page_note": a remark about the page, the scan or the translation itself ("[Blank page]", "[illegible]", "Translation:", "No text on this page").
- "transcriber_block": the sentence renders the TRANSCRIBER'S OWN DESCRIPTIONS above and nothing in the SOURCE.
- "continuation": the sentence, or its ending, renders the previous or next page's text, or completes a sentence that the source page breaks off.
- "unsupported": a sentence or clause of other content that the source does not have at all.

NEVER flag:
- translation choices: a free, loose, reordered, modernised or expanded rendering; a word or short phrase that makes explicit what the source implies (a subject, a pronoun's referent, a connective, "namely", an adjective, a verb the English needs); an expanded abbreviation or citation; a unit converted;
- a mistranslation or a doubtful reading: wrong is not added;
- words supplied in brackets so that the English sentence works ("I shaved [my head]", "[he said]");
- anything that IS in the source, wherever it stands and whoever wrote it: headings, running heads, page numbers, signatures, captions, marginal notes, footnotes, variant readings, the author's own "that is" and parentheses;
- a word kept in the original language beside its translation.
Before you flag, look once more for the source words; if you find them, do not flag. If the source is too garbled, short or mismatched to check against, do not flag, and set "checkable" to false when that is true of most of the page.

Return ONLY JSON: {"checkable": true, "flags": [{"n": <sentence number>, "words": "<the added words, copied exactly from that sentence, at most 25 words>", "whole": <true if the whole sentence is added>, "kind": "<kind>", "source_has": "<the source words nearest to that spot, at most 12 words, or NONE>", "reason": "<at most 20 words>"}]}
Most pages have no commentary: an empty list is the usual answer.`;
}

/** Parse the model's JSON; null when unusable. Flags with an unknown number or kind are dropped and counted. */
export function parseFlags(out, nUnits) {
  let j;
  try { j = JSON.parse(String(out || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { const m = /\{[\s\S]*\}/.exec(String(out || '')); if (!m) return null; try { j = JSON.parse(m[0]); } catch { return null; } }
  if (!j || !Array.isArray(j.flags)) return null;
  const flags = []; let dropped = 0;
  for (const f of j.flags) {
    const n = Number(f?.n);
    if (!Number.isInteger(n) || n < 1 || n > nUnits || !KINDS.includes(f.kind)) { dropped++; continue; }
    flags.push({ n, words: String(f.words || '').slice(0, 300), whole: !!f.whole, kind: f.kind, source_has: String(f.source_has || '').slice(0, 200), reason: String(f.reason || '').slice(0, 200) });
  }
  return { checkable: j.checkable !== false, flags, dropped };
}

export const generationConfig = (nUnits) => ({ temperature: 0, maxOutputTokens: Math.min(8000, 600 + nUnits * 60), responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });

/** Wilson 95% interval for k of n. */
export function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

const foldText = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
/**
 * The detector's mechanical half, applied to every model flag before it counts. A flag is dropped when
 *  - the "added words" stand in the source as they are (a term kept in the original beside its translation), or
 *  - it is under five words, not in brackets or parentheses, and not a whole sentence of five words or more:
 *    that size is a translation choice (a supplied subject, a connective), which the prompt already excludes.
 */
export function keepFlag(flag, unit, source) {
  const w = String(flag.words || '').trim(); if (!w) return false;
  const fw = foldText(w);
  if (fw.length >= 4 && foldText(source).includes(fw)) return false;
  const nWords = w.split(/\s+/).length;
  const u = String(unit || '');
  const at = u.indexOf(w.slice(0, 16));
  const bracketed = /^[[(]/.test(w) || /[\])]$/.test(w) || (at > 0 && /[[(]\s*$/.test(u.slice(0, at)));
  if (bracketed) return nWords >= 2 || /blank|illegible|unclear|page|text/i.test(w);
  if (flag.whole && u.split(/\s+/).length >= 5) return true;
  return nWords >= 5;
}
/** A row's flags after the mechanical filter: {additions, continuation}. */
export function countedFlags(row, source) {
  const kept = (row.flags || []).filter((f) => keepFlag(f, row.units[f.n - 1], source));
  return { additions: kept.filter((f) => ADDITION_KINDS.includes(f.kind)), continuation: kept.filter((f) => f.kind === 'continuation') };
}
