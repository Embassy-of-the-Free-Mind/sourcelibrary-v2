// PRIOR ART: scripts/eval/notes-layer-5942/s-format.mjs + arms.mjs (#5942 Part B, arm S: the model returns its notes
// as JSON annotations anchored by an `exact` phrase, resolved with annotation-layer's resolveAnchor) — that arm asked ONE
// call for text AND notes; here the translation is fixed (a PLAIN read) and a second call writes only the notes, so the
// prompt is new, the anchor rule is S's minus prefix/suffix (#5942 condition 2: compute them from `exact`).
// scripts/eval/plain-6728/prompts.mjs PLAIN_EDITS is the list of what PLAIN cut from v13; NOTES_STEP_V1 below is those
// notes / term / gloss / original instructions put back, as a prompt of their own, worded as v13 words them.
// scripts/maintenance/translation-prompt-v21-life-words.mjs buildV21 / LIFE_WORDS build v21, imported, not restated.
/**
 * #7965 step 2: the notes step as an eval harness. Pure: no I/O, no model, no database.
 *
 *   v21Request(v13Request)      the composed v13 request → the same request under v21 (production's v21 = buildV21(v13))
 *   notesRequest({...})         one notes-step call: transcription + clean PLAIN translation + previous page's notes
 *   parseNotes(raw, text)       the reply → page_annotations-shaped annotations, each anchor resolved in `text`
 *   inlineNotes(raw)            arm (a): a v21 read → its notes, through annotation-layer/3 (the backfill's parser)
 */
import crypto from 'node:crypto';
import { splitAnnotations, spanAnchor, resolveAnchor } from '../../lib/annotation-layer.mjs';
import { ANCHOR as V21_ANCHOR, LIFE_WORDS } from '../../maintenance/translation-prompt-v21-life-words.mjs';

export const SOURCE = 'notes-step/v1';
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

/** The composed v13 request with v21's one block stacked (the anchor occurs once in every panel request; else throw). */
export function v21Request(prompt) {
  if (prompt.split(V21_ANCHOR).length !== 2) throw new Error('v21 anchor not found exactly once in the request');
  return prompt.replace(V21_ANCHOR, () => LIFE_WORDS + V21_ANCHOR);
}

/** Sections of a composed translation request (translate-core buildTranslationPrompt's headings). */
export function requestParts(prompt) {
  const section = (h) => {
    const i = prompt.indexOf(`\n**${h}:**`);
    if (i < 0) return null;
    const rest = prompt.slice(i + h.length + 6);
    const j = rest.search(/\n\*\*(?:At the page break|Previous page translation for continuity|Text to translate|Page breaks|Source work|Note)[^*\n]*:\*\*/);
    return (j < 0 ? rest : rest.slice(0, j)).replace(/\n\nDo not open, read or write any file[\s\S]*$/, '').trim();
  };
  const sourceLanguage = (prompt.match(/\n\*\*Source language:\*\* ([^\n]*)/) || [])[1] || '';
  const sourceWork = (prompt.match(/\n\*\*Source work:\*\* ([^\n]*)/) || [])[1] || '';
  return { sourceLanguage, sourceWork, ocr: section('Text to translate'), previous: section('Previous page translation for continuity') };
}

/** The previous page's notes, as the step will see them: the commentary of its stored English (inline or a layer). */
export function previousNotes(previousEnglish) {
  if (!previousEnglish) return [];
  return splitAnnotations(previousEnglish).annotations
    .filter((a) => a.kind === 'commentary' && ['note', 'definition', 'original'].includes(a.type) && a.body && !a.malformed)
    .map((a) => ({ type: a.type, anchor: a.anchor?.exact || '', body: String(a.body).trim() }));
}

// v13's own words, kept: "interpretive notes, interpolated clarifications"; "technical/foreign terms kept in
// transliteration" + "definition immediately after a <term>"; "noting originals when significant" + "<note>original:
// "..."</note> to preserve important original phrases for scholars"; the three examples; instructions 6, 7, 8; the
// life-words block (v21); "Writing style for summaries and notes". What it does NOT carry: image descriptions (PLAIN
// keeps the OCR's <image-desc> in its own tag), summary, keywords and <meta> (out of scope, #7965).
export const NOTES_STEP_V1 = `You are writing the reader's notes for ONE page of a translated book. The English translation of the page is finished and will not change. Your notes are shown beside it, attached to its words; readers can toggle them off.

**Input:** the page's transcription (OCR) in the source language, the page's English translation, and the notes written for the previous page (for continuity: do not repeat a note the previous page already gives).

**Output contract (CRITICAL):**
- Your ENTIRE response is ONE JSON object: {"annotations": [{"type": "...", "anchor": "...", "body": "..."}, ...]}. Never address the reader or the requester; no introduction, no remark, no code fence.
- "anchor" is the words of the ENGLISH TRANSLATION the note attaches to, copied character for character from it (2 to 12 words, enough that they occur only once in the translation). Never quote the transcription as an anchor, and never change, add or drop a letter of the translation's words.
- "type" is one of:
  - "note": interpretive notes, interpolated clarifications;
  - "definition": the meaning of a technical/foreign term the translation keeps in transliteration (the anchor is the term itself, the body its meaning);
  - "original": an important original phrase preserved for scholars (the anchor is its English in the translation, the body is original: "..." with the source's words copied from the transcription).
- A page that needs no note gets {"annotations": []}.

**Notes:**
1. Note originals when significant: embedded Latin/Greek/Hebrew phrases, titles and key terms, as original: "...". The original words must be on the page.
2. For foreign terms kept in transliteration, give the definition: Chesed → Mercy/Loving-kindness.
3. For interpolated clarifications: a note such as "from the aspect of the secret".
4. Add notes to explain historical references or difficult phrases.
5. Style: warm museum label - explain rather than assume knowledge.

**Examples of annotations:**
- {"type": "original", "anchor": "On the World and Religion", "body": "original: \\"De Seculo, & Religione\\""}
- {"type": "definition", "anchor": "prima materia", "body": "first matter"}
- {"type": "definition", "anchor": "calcination", "body": "heating to powder"}
- {"type": "definition", "anchor": "sefirot", "body": "divine emanations"}

${LIFE_WORDS}**Writing style for notes:**
- Never use em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Avoid: "delves into", "rich tapestry", "fascinating exploration", "sheds light on", "comprehensive", "intricate", "nuanced", "multifaceted", "offers a window into".
- Use short, direct sentences. Scholarly but accessible.
`;

export const NOTES_STEP_V1_MD5 = md5(NOTES_STEP_V1);
/** The CLI lanes' wrapper line (agy-cli TRANSLATE_SUFFIX's form, for a JSON answer). */
export const CLI_SUFFIX = '\n\nDo not open, read or write any file and do not use any tool: the text is above. Write the JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n';

export function notesRequest({ ocr, translation, prevNotes = [], sourceLanguage, sourceWork, cli = false }) {
  const prev = prevNotes.length ? prevNotes.map((n) => `- [${n.type}] on "${n.anchor}": ${n.body}`).join('\n') : '(none)';
  return `${NOTES_STEP_V1}
**Source language:** ${sourceLanguage}
${sourceWork ? `**Source work:** ${sourceWork}\n` : ''}
**Transcription of this page:**
${ocr}

**English translation of this page (anchor your notes to these words):**
${translation}

**Notes on the previous page:**
${prev}
${cli ? CLI_SUFFIX : ''}`;
}

/** First JSON object of a reply (fences and stray prose tolerated). */
function jsonOf(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return { j: JSON.parse(t), problem: null }; } catch { /* below */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return { j: JSON.parse(t.slice(a, b + 1)), problem: 'text around the JSON' }; } catch { /* below */ } }
  return { j: null, problem: 'not JSON' };
}

const fold = (s) => String(s).normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

/**
 * Where `exact` stands in `text`: once exactly → 'exact'; not exactly but once after folding quotes and whitespace
 * (resolveAnchor's fuzzy pass, with the 32-character context built from that place) → 'fuzzy'; more than once →
 * 'repeated' (an orphan: the gate counts it as a miss); nowhere → null.
 */
export function placeAnchor(text, exact) {
  if (!exact || !text) return { how: null, occurrences: 0 };
  const occ = text.split(exact).length - 1;
  if (occ === 1) { const s = text.indexOf(exact); return { how: 'exact', occurrences: 1, anchor: spanAnchor(text, s, s + exact.length) }; }
  if (occ > 1) return { how: 'repeated', occurrences: occ };
  const ft = fold(text), fe = fold(exact).trim();
  const focc = fe ? ft.split(fe).length - 1 : 0;
  if (focc > 1) return { how: 'repeated', occurrences: focc };
  if (focc === 1) {
    const r = resolveAnchor(text, { exact });
    if (r) return { how: 'fuzzy', occurrences: 1, anchor: spanAnchor(text, r.start, r.end) };
    // resolveAnchor refuses a short phrase with no context; the folded place is unique, so map it back by length.
    const s = ft.indexOf(fe);
    if (ft === text) return { how: 'fuzzy', occurrences: 1, anchor: spanAnchor(text, s, s + fe.length) };
  }
  return { how: null, occurrences: 0 };
}

const TYPES = new Set(['note', 'definition', 'original']);
/** A notes-step reply → { ok, problem, annotations: [{type, anchor, body, source, how}] } (page_annotations shape). */
export function parseNotes(raw, text) {
  const { j, problem } = jsonOf(raw);
  if (!j || !Array.isArray(j.annotations)) return { ok: false, problem: problem || 'no "annotations" array', annotations: [] };
  const annotations = j.annotations.filter((a) => a && typeof a === 'object' && String(a.body ?? '').trim()).map((a) => {
    const type = TYPES.has(String(a.type).toLowerCase()) ? String(a.type).toLowerCase() : 'note';
    const exact = typeof a.anchor === 'string' ? a.anchor : typeof a.exact === 'string' ? a.exact : '';
    const p = placeAnchor(text, exact);
    return { type, anchor: p.anchor ?? { exact, prefix: '', suffix: '', start: null, end: null }, body: String(a.body).trim(), source: SOURCE, how: p.how, occurrences: p.occurrences, type_given: a.type ?? null };
  });
  return { ok: true, problem, annotations };
}

/** Arm (a): a v21 inline read → { text, notes } through annotation-layer/3; notes = commentary note/definition/original. */
export function inlineNotes(raw) {
  const s = splitAnnotations(raw, { source: 'inline-v21' });
  const notes = s.annotations.filter((a) => a.kind === 'commentary' && ['note', 'definition', 'original'].includes(a.type) && !a.malformed && String(a.body ?? '').trim());
  return { text: s.text, notes, images: s.annotations.filter((a) => a.type === 'image').length };
}
