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
// colophon (#6721, 2026-10-15): the closing leaves state the date (evidence is their verbatim words, a cycle year converted)
export const BASES = ['title_page', 'colophon', 'catalogue', 'model_knowledge'];

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
  // the catalogue states a window, not a year ("C.18th Century CE", "1804–1821", "2. Hälfte 18. Jh.", "17uu", "um 1600"):
  // stored as that window, basis catalogue, when no other source year contradicts it (#6721 lean route)
  const w = !cands.length || cands.every((y) => y === pub) ? catalogueWindow(b.published) : null;
  if (w && w.to >= 1450 && !(w.from <= 1700 && w.to >= 1700 && isPlaceholder(b, 1700))) {
    return { year: w.year, from: w.from, to: w.to, display: String(b.published).trim().slice(0, 60), precision: w.to - w.from >= 99 ? 'century' : w.to === w.from ? 'exact' : 'range',
      basis: 'catalogue', evidence: String(b.published).trim().slice(0, 200), rule: 'catalogue_window' };
  }
  return null;
}

const ORD = (n) => +n;
const PART = { early: [0, 33], mid: [33, 66], middle: [33, 66], late: [66, 99], first: [0, 49], second: [50, 99] };
/**
 * A window the catalogue's own words state, or null: a century ("C.18th Century CE", "17th - 18th Century", "Late 18th
 * century", "18. Jh.", "2. Hälfte 18. Jh.", "1. Viertel 18. Jh.", "17uu"), a year range ("1804-1821", "1804–21"), a
 * circa year ("um 1600", "C.1600 CE": ±10), a dated day ("1604 März 12", "1600 CE"). Years CE only; BCE, regnal,
 * Hijri and Samvat dates are left to the model (an AH year in a catalogue can be the composition's, #6057).
 */
export function catalogueWindow(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s || /\b(BCE?|AH|A\.H\.|Samvat|Hijri|Shaka|era)\b/i.test(s)) return null;
  let m;
  const cent = (c) => [(c - 1) * 100 + 1, c * 100];
  if ((m = s.match(/^(?:c\.?\s*|ca\.?\s*|circa\s*)?(early|mid|middle|late|first half of the|second half of the)?\s*-?\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)\s+century(?:\s*CE|\s*AD)?\.?$/i))) {
    const [a] = cent(ORD(m[2])); const [, b] = cent(ORD(m[3])); return b > a ? { from: a, to: b, year: Math.round((a + b) / 2) } : null;
  }
  if ((m = s.match(/^(?:c\.?\s*|ca\.?\s*|circa\s*)?(?:(early|mid|middle|late)[\s-]+|(first|second) half of the\s+)?(\d{1,2})\s?(?:st|nd|rd|th)\s+century(?:\s*CE|\s*AD)?\.?$/i))) {
    const [a, b] = cent(ORD(m[3])); const part = PART[(m[1] || m[2] || '').toLowerCase()];
    const from = part ? a + part[0] : a; const to = part ? Math.min(b, a + part[1]) : b;
    return { from, to, year: Math.round((from + to) / 2) };
  }
  if ((m = s.match(/^(?:(\d)\.\s*(Hälfte|Viertel|Drittel)\s+)?(\d{1,2})\.\s*Jh(?:dt)?\.?$/i))) {
    const [a] = cent(ORD(m[3])); const k = m[1] ? +m[1] : 0; const size = { hälfte: 50, viertel: 25, drittel: 33 }[(m[2] || '').toLowerCase()];
    const from = size ? a + (k - 1) * size : a; const to = size ? Math.min(a + 99, a + k * size - 1) : a + 99;
    return k && size && from > a + 99 ? null : { from, to, year: Math.round((from + to) / 2) };
  }
  if ((m = s.match(/^\[?(1\d)uu\]?\.?$/i))) { const a = +m[1] * 100; return { from: a, to: a + 99, year: a + 50 }; }
  if ((m = s.match(/^\[?(1\d{2})-\]?\.?$/))) { const a = +m[1] * 10; return { from: a, to: a + 9, year: a + 5 }; }
  if ((m = s.match(/^\[?(1\d{3})\s?(?:-|–|—|to)\s?(1?\d{1,3})\]?\.?$/))) {
    const a = +m[1]; let b = +m[2]; if (m[2].length < 4) b = +String(a).slice(0, 4 - m[2].length) * 10 ** m[2].length + b;
    return b >= a && b - a <= 150 ? { from: a, to: b, year: Math.round((a + b) / 2) } : null;
  }
  if ((m = s.match(/^(?:um|ca\.?|c\.?|circa)\s*(1\d{3})(?:\s*CE)?\??\.?$/i))) { const y = +m[1]; return { from: y - 10, to: y + 10, year: y }; }
  if ((m = s.match(/^(1\d{3})(?:\s*CE|\s*AD|\s+\d{1,2}\.?\s+\p{L}+|\s+\p{L}+\.?\s+\d{1,2})\.?$/u))) { const y = +m[1]; return { from: y, to: y, year: y }; }
  return null;
}

/**
 * The batched prompt (#6721 amendment: 10–20 books per CLI call). Same instructions as buildPrompt(), one numbered
 * record per book, the reply a JSON array with `n` echoing each record's number. Shorter leaves per book (the title
 * page comes first, and the work date rarely needs more).
 */
// The one alternative wording tested (#6721 amendment 3d): the point year is the date scholars conventionally cite
// (else the window's midpoint), and the window is the narrowest one defensible.
const P2_YEAR = `\nFor each date, "year" is the date scholars conventionally cite (if there is none, the midpoint of the window), and "from"–"to" is the narrowest window you can defend: a known year is a window of zero, a decade's uncertainty is ten years, not a century.`;
export const buildBatchPrompt = (books, { leadChars = 1200, variant = null } = {}) => `You are a historian of the book dating volumes in a digital library of historical sources. Below are ${books.length} catalogue records, each with the OCR of its opening leaves (may be noisy). Date each one independently.

${books.map((b, i) => `=== RECORD ${i + 1} ===
- Title: ${b.original_title || b.title}${b.title && b.original_title && b.title !== b.original_title ? ` (English title: ${b.title})` : ''}
- Author: ${b.author || 'unknown'}
- Catalogue date ("published" field, may be wrong, a placeholder, or the work's date rather than the edition's): ${b.published ?? 'none'}
- Language: ${b.language || 'unknown'}
- Opening leaves:
"""
${(b.lead || '[no text available]').slice(0, leadChars)}
"""${b.context ? `
- ${b.context_label || 'More of the book'}:
"""
${String(b.context).slice(0, 1500)}
"""` : ''}`).join('\n\n')}

For EACH record give two dates.
1. WORK: when the text itself was first composed (or compiled), as scholars date it. For a translation or a later printing, this is the ORIGINAL composition, not this volume. For pseudepigrapha (Hermes, Solomon, Orpheus) give the scholarly date, not the legendary one. For a canon or anthology, the main composition window of its contents. For a modern original book, its first publication year.
2. EDITION: when THIS volume (printing, manuscript copy, xylograph, reprint) was made.

For each date, say what it rests on:
- "title_page": that record's opening leaves state it. Then copy the exact words that state it into "evidence", character for character from that record's OCR (e.g. an imprint line "M.D.LXI." or "Anno 1612").
- "catalogue": (edition only) you can only repeat the catalogue date and nothing contradicts it.
- "model_knowledge": your own scholarly estimate. Give an honest from–to window.
If a catalogue date looks like a placeholder or is contradicted by the leaves, say so in "catalogue_note".
Years are integers; negative for BCE.${variant === 'p2' ? P2_YEAR : ''}

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
  if ((o.basis === 'title_page' || o.basis === 'colophon') && !(o.evidence && loose(o.evidence).length >= 3 && loose(lead).includes(loose(o.evidence)))) {
    o.basis_claimed = o.basis; o.basis = 'model_knowledge';
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

// ── The lean route (#6721, 2026-10-15: "why does it take so much just to get an estimated date?") ─────────────────
// Cheapest first: the edition by rule (ruleEdition), the work by a model on catalogue fields alone (the reference check
// showed C1 85.9% vs C2 85.4%: leaves do not move the work date), 100 books a call, one short JSON object per book and
// nothing else. Wikidata is a SOURCE and a CHECK, never the date on its own: on the library, `books.work_id` QIDs often
// name an edition item (the Loeb Iliad, P577 1973) and `author_id` often names the translator or editor (R. H. Charles
// for 1 Enoch, James Legge for the Li Ki), so an unchecked Wikidata date was wrong on 19% of work items and on most of
// the 661 lifespans that contradicted a model date (#6721 lean reference check).

export const LEAN_PROMPT_VERSION = 'date-works-lean-1';
// wikidata = the work item's date where a model's window meets it; author_lifespan = the author's dated window
// (Wikidata, else BDRC), used where nothing narrower is sourced and the model's estimate does not contradict it
export const SOURCED_BASES = ['wikidata', 'author_lifespan'];
const fmtYear = (y) => (y < 0 ? `${-y} BCE` : String(y));
const fmtSpan = (a, b) => (a === b ? fmtYear(a) : a < 0 && b < 0 ? `${-a}–${-b} BCE` : `${fmtYear(a)}–${fmtYear(b)}`);

/**
 * The author's dated window from the Wikidata cache (wikidata-dates.mjs), or null: [birth + 15, death]; else the work
 * period (P2031–P2032); else floruit ± 15; else 60 years before death or 85 after birth.
 */
export function authorWindow(a) {
  if (!a) return null;
  const b = a.P569, d = a.P570, ws = a.P2031, we = a.P2032, fl = a.P1317;
  if (b && d) return { from: b[0] + 15, to: d[1], how: 'lifespan' };
  if (ws || we) return { from: (ws || we)[0], to: (we || ws)[1], how: 'work_period' };
  if (fl) return { from: fl[0] - 15, to: fl[1] + 15, how: 'floruit' };
  if (d) return { from: d[1] - 60, to: d[1], how: 'death_only' };
  if (b) return { from: b[0] + 15, to: b[1] + 85, how: 'birth_only' };
  return null;
}
/**
 * The book's author's window and its source, or null: books.author_id → authors.wikidata_id (Wikidata P569/P570/…),
 * else → authors.bdrc_ids (a BDRC person's PersonBirth/PersonDeath/PersonFlourished; `bd` = bdrc-dates.mjs cache).
 */
export function authorWindowOf(b, wd, bd = null) {
  const qid = b.author_id ? wd.author_qid?.[b.author_id] : null;
  const w = qid ? authorWindow(wd.authors?.[qid]) : null;
  if (w) return { qid, src: qid, ...w };
  const pid = b.author_id ? bd?.author_person?.[b.author_id] : null; const p = pid ? bd.persons?.[pid] : null;
  const bw = p ? authorWindow({ P569: p.birth, P570: p.death, P1317: p.floruit }) : null;
  return bw ? { src: `bdr:${pid}`, ...bw } : null;
}
const WINDOW_WHAT = { lifespan: "the author's adult life", work_period: "the author's working years", floruit: "around the author's floruit",
  death_only: "before the author's death", birth_only: "the author's likely working life" };
/** The work date an author's window gives, capped at the edition's year (a work cannot postdate a copy), or null. */
export function lifespanWork(aw, editionYear = null) {
  if (!aw) return null;
  const to = editionYear != null ? Math.min(aw.to, editionYear) : aw.to;
  if (to < aw.from) return null;
  return { year: Math.round((aw.from + to) / 2), from: aw.from, to, display: `${fmtSpan(aw.from, to)}, ${WINDOW_WHAT[aw.how]}`, precision: 'range',
    basis: 'author_lifespan', evidence: `${aw.src} ${aw.how}` };
}

/**
 * The date of the Wikidata WORK item a book's `work_id` names — P571 inception, else P577 publication, else P1191 —
 * or null; an item dated after `editionYear` is a later edition's or translation's and is ignored. A CANDIDATE only:
 * the writer stores it (basis wikidata) only where it agrees with the model's window (agreesWith()).
 */
export function wikidataWork(b, wd, editionYear = null) {
  const w = /^Q\d+$/.test(b.work_id || '') ? wd.works?.[b.work_id] : null;
  for (const p of ['P571', 'P577', 'P1191']) {
    const iv = w?.[p];
    if (!iv || (editionYear != null && iv[0] > editionYear)) continue;
    const year = iv[0] === iv[1] ? iv[0] : Math.round((iv[0] + iv[1]) / 2);
    return { year, from: iv[0], to: iv[1], display: fmtSpan(iv[0], iv[1]), precision: iv[0] === iv[1] ? 'exact' : 'range',
      basis: 'wikidata', evidence: `${b.work_id} ${p}` };
  }
  return null;
}
/**
 * Two dated windows agree when they meet. No tolerance beyond that: a work_id naming a neighbouring work (Kepler's
 * Apologia → Harmonices Mundi, 1622 vs 1619) must not replace a model's exact year.
 */
export const agreesWith = (a, b) => !!a && !!b && a.from <= b.to && a.to >= b.from;

/** The author's Wikidata dates as the lean prompt shows them ("b. 1433, d. 1499", "fl. 1520–1540"), else null. */
export function authorDates(b, wd) {
  const a = b.author_id ? wd.authors?.[wd.author_qid?.[b.author_id]] : null;
  if (!a) return null;
  const s = (iv) => fmtSpan(iv[0], iv[1]);
  const parts = [a.P569 && `b. ${s(a.P569)}`, a.P570 && `d. ${s(a.P570)}`, !a.P569 && !a.P570 && a.P1317 && `fl. ${s(a.P1317)}`].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** The lean work prompt: catalogue fields (+ the author's Wikidata dates when known), one line of JSON per book. */
export const buildLeanPrompt = (books) => `Date the WORK in each catalogue record below: when the text itself was first composed or compiled, as scholars date it. For a translation, commentary or later printing, the ORIGINAL composition, not this volume. Pseudepigrapha (Hermes, Solomon, Orpheus): the scholarly date, not the legendary one. A canon or anthology: the main composition window of its contents. A modern original book: its first publication year. The catalogue date is the date of this copy, may be wrong, and may be a placeholder.

${books.map((b, i) => `${i + 1}. ${[b.original_title || b.title, b.title && b.original_title && b.title !== b.original_title ? `[${b.title}]` : null,
  b.author ? `by ${b.author}${b.author_dates ? ` (${b.author_dates})` : ''}` : null, b.published != null && String(b.published).trim() !== '' ? `cat. ${b.published}` : null, b.language || null]
  .filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}

Reply with exactly ${books.length} lines, one per record, in order, and nothing else. Each line is one JSON object:
{"i":<record number>,"w":[<from>,<to>],"y":<the year scholars conventionally cite>,"c":"h|m|l"}
w is the narrowest window you can defend (a known year is [y,y]). c is your confidence. Years are integers, negative for BCE. No prose, no code fences, no tools.`;

/** Parse a lean reply: Map(index → { work, confidence }) for the records it answered. */
export function parseLeanReply(answer, n) {
  const out = new Map();
  for (const m of String(answer || '').matchAll(/\{[^{}\n]*\}/g)) {
    let o; try { o = JSON.parse(m[0]); } catch { continue; }
    const i = Number.isInteger(o?.i) ? o.i - 1 : -1;
    // a reply that gives "w" as one year instead of [from, to] (1 call in 20 on the first run): the window is that year and "y"
    const w = Array.isArray(o.w) ? o.w : Number.isFinite(+o.w) && o.w !== null && o.w !== '' ? [Math.min(+o.w, +o.y || +o.w), Math.max(+o.w, +o.y || +o.w)] : null;
    if (i < 0 || i >= n || out.has(i) || !w) continue;
    const work = cleanDate({ year: o.y, from: w[0], to: w[1], basis: 'model_knowledge' }, '');
    if (!work || work.year === null) continue;
    work.display = work.from === work.to ? fmtYear(work.year) : `c. ${fmtSpan(work.from, work.to)}`;
    work.precision = work.from === work.to ? 'exact' : 'range';
    out.set(i, { work, confidence: { h: 'high', m: 'medium', l: 'low' }[o.c] || 'low' });
  }
  return out;
}

/**
 * The lean edition prompt, only for books no rule could date: catalogue fields plus the opening leaves, one line of
 * JSON per book. b = "t" (the leaves print it: x is their exact words), "c" (only the catalogue date, nothing
 * contradicts it), "m" (your estimate).
 */
/** What one volume shows the edition model: opening leaves, then closing leaves (where a colophon dates the copy). */
export const editionText = (b, { leadChars = 700, tailChars = 700 } = {}) =>
  `${(b.lead || '').slice(0, leadChars).replace(/\s+/g, ' ')}${b.tail ? ` ... CLOSING LEAVES: ${String(b.tail).slice(-tailChars).replace(/\s+/g, ' ')}` : ''}`;
export const buildLeanEditionPrompt = (books, opts = {}) => `For each volume below give the date THIS copy (printing, manuscript copy, xylograph, reprint) was made, from its catalogue record and the OCR (may be noisy) of its opening leaves and, where shown, its closing leaves. Tibetan, Chinese, Arabic, Persian and Hebrew books often date themselves in a colophon on the closing leaves, in a cycle year (rab byung, ganzhi/reign year, AH, anno mundi): convert it to CE. The catalogue date may be wrong, a range, or a placeholder. A range is fine; do not invent a precise year.

${books.map((b, i) => `=== ${i + 1}. ${[b.original_title || b.title, b.author ? `by ${b.author}` : null, `cat. ${b.published ?? 'none'}`, b.language || null].filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 300)}
${editionText(b, opts) || '[no text]'}`).join('\n')}

Reply with exactly ${books.length} lines, one per volume, in order, and nothing else. Each line is one JSON object:
{"i":<number>,"e":[<from>,<to>],"y":<year>,"b":"t|k|c|m","x":"<if b is t or k: the exact words of the leaves that state the date, copied character for character, else empty>","c":"h|m|l"}
b: t = the opening leaves (title page, imprint) print the date, k = a colophon on the closing leaves states it, c = only the catalogue date and nothing contradicts it, m = your estimate. Years are integers. No prose, no code fences, no tools.`;

/** Parse a lean edition reply against what each volume SHOWED the model. Map(index → { edition, confidence }). */
export function parseLeanEditionReply(answer, books, opts = {}) {
  const out = new Map();
  for (const m of String(answer || '').matchAll(/\{[^\n]*\}/g)) {
    let o; try { o = JSON.parse(m[0]); } catch { continue; }
    const i = Number.isInteger(o?.i) ? o.i - 1 : -1;
    if (i < 0 || i >= books.length || out.has(i) || !Array.isArray(o.e)) continue;
    // a title-page quote must be on the opening leaves, a colophon quote on the closing ones
    const shown = o.b === 'k' ? editionText({ tail: books[i].tail }, opts) : editionText({ lead: books[i].lead }, opts);
    const edition = cleanDate({ year: o.y, from: o.e[0], to: o.e[1], basis: { t: 'title_page', k: 'colophon', c: 'catalogue', m: 'model_knowledge' }[o.b] || 'model_knowledge', evidence: o.x || '' }, shown);
    if (!edition || edition.year === null) continue;
    edition.display = edition.from === edition.to ? fmtYear(edition.year) : fmtSpan(edition.from, edition.to);
    out.set(i, { edition, confidence: { h: 'high', m: 'medium', l: 'low' }[o.c] || 'low' });
  }
  return out;
}
