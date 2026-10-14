/**
 * date-works.mjs — date a book's WORK and its EDITION, with a basis and evidence on each date (#6721).
 *
 *   work    — when the text was first composed (or the composition window): a 1532 Asclepius is a late-antique work
 *   edition — when THIS printing, manuscript copy or reprint was made
 *
 * Each date carries `basis`: "title_page" (the opening leaves state it, and `evidence` is a verbatim span of the OCR —
 * otherwise the basis is DOWNGRADED to model_knowledge and the claim kept in `basis_claimed`), "catalogue" (edition
 * only: the library's `published` value, repeated because nothing contradicts it), or "model_knowledge" (the model's
 * scholarly estimate, with a from–to window).
 *
 * PRIOR ART: scripts/analysis/experience-map/classify/date-works.mjs (origin/aliveness-animism, #6652/#6708) — this is
 * its prompt and clean() moved into a lib, so the eval, the library-wide dater and the writer share one copy. Changes:
 * each layer carries a `year` (the reader's /research/translation-lag and BookBiblioPanel read `date` per layer), the
 * opening leaves are stripped of editorial wrappers before the model sees them (else a `<meta>` sentence the OCR model
 * wrote could be quoted back as "title-page evidence"), and toStoredLayers() maps the reply onto the existing
 * SourceWorkDateLayer shape (src/lib/types/book.ts). scripts/_archived/2026-09-unmetered/enrichment/
 * enrich-source-work-dates.mjs is the older paid-API writer; its layer schema is kept.
 */
import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';
import { stripMarkupTags } from './strip-markup-tags.mjs';

export const PROMPT_VERSION = 'date-works-2';
export const BASES = ['title_page', 'catalogue', 'model_knowledge'];

export const loose = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The opening leaves the dater reads: pages in page order, editorial wrappers stripped, the first ones that carry
 * text, up to ~2,600 characters. `pages` = [{ page_number, text }].
 */
export function buildLead(pages, { perPage = 900, max = 2600 } = {}) {
  let lead = '';
  for (const pg of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    const t = stripMarkupTags(stripEditorialWrappers(pg.text || '') || '', ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 40) lead += `[page ${pg.page_number}] ${t.slice(0, perPage)}\n`;
    if (lead.length > max) break;
  }
  return lead.slice(0, max);
}

export const buildPrompt = (b) => `You are a historian of the book dating a volume in a digital library of historical sources.

CATALOGUE RECORD
- Title: ${b.original_title || b.title}${b.title && b.original_title && b.title !== b.original_title ? ` (English title: ${b.title})` : ''}
- Author: ${b.author || 'unknown'}
- Catalogue date ("published" field, may be wrong, a placeholder, or the work's date rather than the edition's): ${b.published ?? 'none'}
- Language: ${b.language || 'unknown'}

OPENING LEAVES (OCR, may be noisy):
"""
${b.lead || '[no text available]'}
"""

Give two dates.
1. WORK: when the text itself was first composed (or compiled), as scholars date it. For a translation or a later printing, this is the ORIGINAL composition, not this volume. For pseudepigrapha (Hermes, Solomon, Orpheus) give the scholarly date, not the legendary one. For a canon or anthology, the main composition window of its contents. For a modern original book, its first publication year.
2. EDITION: when THIS volume (printing, manuscript copy, xylograph, reprint) was made.

For each, say what the date rests on:
- "title_page": the opening leaves state it. Then copy the exact words that state it into "evidence", character for character from the OCR above (e.g. an imprint line "M.D.LXI." or "Anno 1612").
- "catalogue": (edition only) you can only repeat the catalogue date and nothing contradicts it.
- "model_knowledge": your own scholarly estimate. Give an honest from–to window.
If the catalogue date looks like a placeholder or is contradicted by the leaves, say so in "catalogue_note".
Years are integers; negative for BCE.

Reply with ONLY this JSON, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"work":{"year":0,"from":0,"to":0,"display":"","precision":"exact|decade|century|range","basis":"title_page|model_knowledge","evidence":""},
 "edition":{"year":0,"from":0,"to":0,"display":"","basis":"title_page|catalogue|model_knowledge","evidence":""},
 "layers":[{"type":"composition|translation|compilation|commentary|redaction|edition","year":0,"date_display":"","precision":"exact|decade|century|millennium","author":"","language":""}],
 "catalogue_note":"","confidence":"high|medium|low","reasoning":"<one or two sentences>"}
Do not open, read or write any file and do not use any tool: everything you need is above.`;

// 0 is the reply template's placeholder, and there is no year 0 (1 BCE is followed by 1 CE): read it as "not given"
// ── Edition dates by rule (#6721 amendment: no model where a rule does) ──────────────────────────────────────────

const CLEAN_YEAR = /^\s*\[?\s*(?:c\.?\s*|ca\.?\s*|circa\s*)?(\d{3,4})\s*\]?\s*\.?\s*$/i;
/** A single clean year from a catalogue value ("1612", "[1612]", "c. 1612", 1612), else null. */
export function cleanYear(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v <= 2030 ? v : null;
  const m = String(v ?? '').match(CLEAN_YEAR) || String(v ?? '').match(/^(\d{4})-\d{2}-\d{2}/);
  const y = m ? +m[1] : null;
  return y && y <= 2030 ? y : null;
}

/** Years the SOURCE library's record gives (catalog_metadata, a JSON string or object; #4572). Scrape/scan dates are not. */
export function catalogueYears(cm) {
  let o = cm; if (typeof cm === 'string') try { o = JSON.parse(cm); } catch { return []; }
  if (!o || typeof o !== 'object') return [];
  const ys = new Set();
  for (const k of ['date_iso', 'publication_date', 'year', 'nav_date', 'date_raw', 'date']) { const y = cleanYear(o[k]); if (y) ys.add(y); }
  for (const p of Array.isArray(o.metadata_pairs) ? o.metadata_pairs : []) { const y = cleanYear(p?.value); if (y) ys.add(y); }
  return [...ys];
}

export function roman(n) {
  let s = '';
  for (const [v, c] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { s += c; n -= v; }
  return s;
}
/**
 * Where the first two text leaves print `year` (Arabic digits, or Roman numerals with any dots/spaces, J for I, and the
 * printers' IIII), as a verbatim span of the lead with a little context, else null.
 */
export function findImprint(lead, year) {
  const tp = (lead || '').split('\n').slice(0, 2).join('\n');
  // the span stays on the match's own line (a leaf), widened to whole words, ~30 characters each side
  const span = (i, j) => {
    const ls = tp.lastIndexOf('\n', i) + 1; const le = tp.indexOf('\n', j) < 0 ? tp.length : tp.indexOf('\n', j);
    const a = Math.max(ls, tp.lastIndexOf(' ', Math.max(ls, i - 30)) + 1); const e = tp.indexOf(' ', Math.min(le, j + 20));
    return tp.slice(a, e < 0 || e > le ? le : e).replace(/^\[page \d+\]\s*/, '').trim();
  };
  const a = tp.match(new RegExp(`(?<!\\d)${year}(?!\\d)`));
  if (a) return { form: 'arabic', evidence: span(a.index, a.index + a[0].length) };
  const want = new Set([roman(year), roman(year).replace('CD', 'CCCC').replace('XC', 'LXXXX').replace('IV', 'IIII').replace('IX', 'VIIII')]);
  for (const m of tp.matchAll(/(?<![A-Za-z])[MDCLXVIJmdclxvij][MDCLXVIJmdclxvij.\s]{3,30}/g)) {
    const compact = m[0].toUpperCase().replace(/[^MDCLXVIJ]/g, '').replace(/J/g, 'I');
    if (want.has(compact)) return { form: 'roman', evidence: span(m.index, m.index + m[0].trimEnd().length) };
  }
  return null;
}

const DESCRIBING = /\b(edition|layout|image|scan|photograph|this page|the page|appears|transcri|original|reproduc|facsimile|copyright|digiti[sz]ed|indicated)\b/i;
// a library's label, stamp or shelfmark slip carries the CATALOGUE's year, not the printer's (716 of 20,197 hits, #6721)
const LABEL = /\b(library|libraries|bibliot\w*|biblioteca|incunab\w*|signatur|shelf\s?mark|call\s?n(o|umber)|catalog\w*|vellum|pages|museum|collection|purchased|bequeathed|presented|stamp)\b|#\s*\d|\b[A-Z]{1,3}\d{2,4}\.[A-Z]\d/i;
// #3307: undated Bhutanese/Tibetan manuscripts carry a fabricated 1700
const isPlaceholder = (b, y) => y === 1700 && /tibetan|dzongkha|bhutan/i.test(`${b.language} ${b.original_title}`);

/**
 * The edition date WITHOUT a model, or null when one is needed. title_page: the catalogue year is printed on the
 * opening leaves (two sources agree). catalogue: a clean printed-era catalogue year, no conflicting source year, not a
 * known placeholder. Everything else (no year, a range, a pre-1450 year that may be the WORK's date — #4884 —, a
 * placeholder, catalogue sources that disagree) goes to the model.
 */
export function ruleEdition(b) {
  const pub = cleanYear(b.published);
  const cands = [...new Set([pub, ...(b.catalogue_years || [])].filter(Boolean))];
  for (const y of cands) {
    if (isPlaceholder(b, y)) continue;
    const hit = findImprint(b.lead, y);
    // a year inside describing prose ("the original 1771 edition", "the image shows") is not an imprint (#4149 class)
    if (hit && !DESCRIBING.test(hit.evidence) && !LABEL.test(hit.evidence) && loose(b.lead).includes(loose(hit.evidence))) {
      return { year: y, from: y, to: y, display: String(y), precision: 'exact', basis: 'title_page', evidence: hit.evidence.slice(0, 200), rule: `imprint_${hit.form}` };
    }
  }
  if (cands.length === 1 && cands[0] >= 1450 && !isPlaceholder(b, cands[0])) {
    const y = cands[0];
    return { year: y, from: y, to: y, display: String(y), precision: 'exact', basis: 'catalogue', evidence: '', rule: pub ? 'published' : 'catalog_metadata' };
  }
  return null;
}

/**
 * The batched prompt (#6721 amendment: 10–20 books per CLI call). Same instructions as buildPrompt(), one numbered
 * record per book, the reply a JSON array with `n` echoing each record's number. Shorter leaves per book (the title
 * page comes first, and the work date rarely needs more).
 */
export const buildBatchPrompt = (books, { leadChars = 1200 } = {}) => `You are a historian of the book dating volumes in a digital library of historical sources. Below are ${books.length} catalogue records, each with the OCR of its opening leaves (may be noisy). Date each one independently.

${books.map((b, i) => `=== RECORD ${i + 1} ===
- Title: ${b.original_title || b.title}${b.title && b.original_title && b.title !== b.original_title ? ` (English title: ${b.title})` : ''}
- Author: ${b.author || 'unknown'}
- Catalogue date ("published" field, may be wrong, a placeholder, or the work's date rather than the edition's): ${b.published ?? 'none'}
- Language: ${b.language || 'unknown'}
- Opening leaves:
"""
${(b.lead || '[no text available]').slice(0, leadChars)}
"""`).join('\n\n')}

For EACH record give two dates.
1. WORK: when the text itself was first composed (or compiled), as scholars date it. For a translation or a later printing, this is the ORIGINAL composition, not this volume. For pseudepigrapha (Hermes, Solomon, Orpheus) give the scholarly date, not the legendary one. For a canon or anthology, the main composition window of its contents. For a modern original book, its first publication year.
2. EDITION: when THIS volume (printing, manuscript copy, xylograph, reprint) was made.

For each date, say what it rests on:
- "title_page": that record's opening leaves state it. Then copy the exact words that state it into "evidence", character for character from that record's OCR (e.g. an imprint line "M.D.LXI." or "Anno 1612").
- "catalogue": (edition only) you can only repeat the catalogue date and nothing contradicts it.
- "model_knowledge": your own scholarly estimate. Give an honest from–to window.
If a catalogue date looks like a placeholder or is contradicted by the leaves, say so in "catalogue_note".
Years are integers; negative for BCE.

Reply with ONLY a JSON array of ${books.length} objects, in record order, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them. Each object:
{"n":<record number>,"work":{"year":0,"from":0,"to":0,"display":"","precision":"exact|decade|century|range","basis":"title_page|model_knowledge","evidence":""},
 "edition":{"year":0,"from":0,"to":0,"display":"","basis":"title_page|catalogue|model_knowledge","evidence":""},
 "layers":[{"type":"composition|translation|compilation|commentary|redaction|edition","year":0,"date_display":"","precision":"exact|decade|century|millennium","author":"","language":""}],
 "catalogue_note":"","confidence":"high|medium|low","reasoning":"<one sentence>"}
Do not open, read or write any file and do not use any tool: everything you need is above.`;

/** Parse a batched answer: Map(index → parsed row) for the records it answered. */
export function parseBatchReply(answer, books, { leadChars = 1200 } = {}) {
  const out = new Map();
  let arr = null;
  try { arr = JSON.parse((answer || '').match(/\[[\s\S]*\]/)[0]); } catch { return out; }
  if (!Array.isArray(arr)) return out;
  arr.forEach((o, k) => {
    const i = Number.isInteger(o?.n) ? o.n - 1 : k;
    if (i < 0 || i >= books.length || out.has(i)) return;
    // evidence must be a span of what this record SHOWED the model, not of leaves it never saw
    const r = parseReply(JSON.stringify(o), { ...books[i], lead: (books[i].lead || '').slice(0, leadChars) });
    if (r) out.set(i, r);
  });
  return out;
}

const int = (v) => (v !== '' && v !== null && v !== undefined && Number.isFinite(+v) && Math.round(+v) !== 0 ? Math.round(+v) : null);

/** The window must hold the year: from ≤ to, and a year outside the model's own window widens it (in place). */
export function fitWindow(o) {
  if (!o) return o;
  if (o.from !== null && o.to !== null && o.from > o.to) [o.from, o.to] = [o.to, o.from];
  if (o.year !== null && o.from !== null && o.year < o.from) o.from = o.year;
  if (o.year !== null && o.to !== null && o.year > o.to) o.to = o.year;
  return o;
}

/** One date from the reply, checked: a title_page basis needs its words in the lead, or it is downgraded. */
export function cleanDate(d, lead) {
  if (!d || typeof d !== 'object') return null;
  const o = { year: int(d.year), from: int(d.from), to: int(d.to), display: String(d.display || '').slice(0, 60), precision: d.precision || null,
    basis: d.basis, evidence: String(d.evidence || '').slice(0, 200) };
  if (o.year === null && o.from !== null && o.to !== null) o.year = Math.round((o.from + o.to) / 2);
  if (o.from === null) o.from = o.year;
  if (o.to === null) o.to = o.year;
  fitWindow(o);
  if (o.basis === 'title_page' && !(o.evidence && loose(o.evidence).length >= 3 && loose(lead).includes(loose(o.evidence)))) {
    o.basis_claimed = 'title_page'; o.basis = 'model_knowledge';
  }
  if (!BASES.includes(o.basis)) o.basis = 'model_knowledge';
  if (o.basis === 'model_knowledge') o.evidence = '';
  return o;
}

/** Parse an agy answer into a dated row (null if it is not one). */
export function parseReply(answer, b) {
  let j = null;
  try { j = JSON.parse((answer || '').match(/\{[\s\S]*\}/)[0]); } catch { return null; }
  if (!j || !j.work || typeof j.work !== 'object') return null;
  const work = cleanDate(j.work, b.lead);
  if (!work || work.year === null) return null;
  if (work.basis === 'catalogue') work.basis = 'model_knowledge'; // the catalogue holds the edition, never the work
  return {
    work, edition: cleanDate(j.edition, b.lead),
    layers: Array.isArray(j.layers) ? j.layers.filter((l) => l && typeof l === 'object').slice(0, 6) : [],
    catalogue_note: String(j.catalogue_note || '').slice(0, 300),
    confidence: ['high', 'medium', 'low'].includes(j.confidence) ? j.confidence : 'low',
    reasoning: String(j.reasoning || '').slice(0, 500),
  };
}

const LAYER_TYPES = new Set(['composition', 'translation', 'compilation', 'commentary', 'redaction', 'edition', 'abridgement', 'adaptation']);
const PRECISIONS = new Set(['exact', 'decade', 'century', 'millennium']);

/**
 * The reply's layers in the stored SourceWorkDateLayer shape, each with `basis` + `evidence`. The first composition/
 * compilation layer takes the WORK date's basis, the edition layer the EDITION date's; every other layer is the
 * model's estimate. A layer the model gave no year gets the work's (composition) or edition's year, else is dropped.
 */
export function toStoredLayers(r) {
  const out = []; let workTaken = false;
  for (const l of r.layers) {
    const type = LAYER_TYPES.has(l.type) ? l.type : null;
    if (!type) continue;
    const isWork = !workTaken && (type === 'composition' || type === 'compilation');
    const src = isWork ? r.work : type === 'edition' ? r.edition : null;
    let year = int(l.year);
    if (year === null && src) year = src.year;
    if (year === null) continue;
    if (isWork) workTaken = true;
    const layer = { type, date: String(year), date_display: String(l.date_display || src?.display || year).slice(0, 60),
      date_precision: PRECISIONS.has(l.precision) ? l.precision : 'century' };
    if (l.author) layer.author = String(l.author).slice(0, 120);
    if (l.language) layer.language = String(l.language).slice(0, 40);
    layer.basis = src ? src.basis : 'model_knowledge';
    layer.evidence = src ? (src.evidence || '') : '';
    out.push(layer);
  }
  return out;
}

/** The `source_work_dates_meta` value (schema 2). */
export function toMeta(r, { model, run_id, dated_at }) {
  return { work: r.work, edition: r.edition, catalogue_note: r.catalogue_note, confidence: r.confidence, reasoning: r.reasoning,
    model, prompt_version: PROMPT_VERSION, run_id, dated_at: new Date(dated_at), schema: 2 };
}
