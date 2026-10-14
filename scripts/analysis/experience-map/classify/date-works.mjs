#!/usr/bin/env node
/**
 * Date the works and editions behind the aliveness atlas (#6652), with provenance on every date. Two dates per book:
 *   work    — when the text was first written (or the composition window), so a 1532 printing of the Asclepius plots in
 *             late antiquity, not in 1532
 *   edition — when THIS printing or manuscript was made
 * Each carries a `basis`: "title_page" (the opening leaves state it; the evidence must be a verbatim span of the OCR, else
 * the basis is downgraded), "catalogue" (the library's `published` field, edition only), or "model_knowledge" (the model's
 * scholarly estimate, with a from–to window and a precision). Writes <out>; nothing is written to Mongo.
 *
 * WHO RUNS IT: the Hetzner box (agy signed in), Gemini CLI on the subscription, $0. Resume by book_id; quota STOPS the run.
 * PRIOR ART: scripts/_archived/2026-09-unmetered/enrichment/enrich-source-work-dates.mjs — its layer schema and prompt rules
 * are kept (scholarly consensus for pseudepigrapha, translation layers). It does not fit as-is: it skips the work date for
 * "original works" (wrong for reprints), records no basis per date, and ran on the paid API.
 *   node date-works.mjs <atlas-books.jsonl> <out.jsonl> [--model gemini-3.8-flash-high] [--conc 12] [--max N]
 */
import fs from 'node:fs'; import path from 'node:path';
const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
const { gatedTextCall } = await import(path.join(SL, 'scripts', 'lib', 'agy-cli.mjs'));
const [IN, OUT] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'gemini-3.8-flash-high'); const CONC = +arg('--conc', 12); const MAX = +arg('--max', 0);
if (!IN || !OUT) { console.error('usage: date-works.mjs <in> <out>'); process.exit(2); }

const loose = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set(); if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) { if (l) try { done.add(JSON.parse(l).book_id); } catch {} }
let todo = rows.filter((r) => !done.has(r.book_id)); if (MAX) todo = todo.slice(0, MAX);
console.log(`${rows.length} books, ${done.size} dated, ${todo.length} to date with ${MODEL}`);

const prompt = (b) => `You are a historian of the book dating a volume in a digital library of historical sources.

CATALOGUE RECORD
- Title: ${b.original_title}${b.title && b.title !== b.original_title ? ` (English title: ${b.title})` : ''}
- Author: ${b.author || 'unknown'}
- Catalogue date ("published" field, may be wrong, a placeholder, or the work's date rather than the edition's): ${b.published ?? 'none'}
- Language: ${b.language || 'unknown'}

OPENING LEAVES (OCR, may be noisy):
"""
${b.lead}
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
 "layers":[{"type":"composition|translation|compilation|commentary|redaction|edition","date_display":"","author":"","language":""}],
 "catalogue_note":"","confidence":"high|medium|low","reasoning":"<one or two sentences>"}
Do not open, read or write any file and do not use any tool: everything you need is above.`;

const int = (v) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.round(+v) : null);
function clean(d, b) {
  if (!d || typeof d !== 'object') return null;
  const o = { year: int(d.year), from: int(d.from), to: int(d.to), display: String(d.display || '').slice(0, 60), precision: d.precision || null,
    basis: d.basis, evidence: String(d.evidence || '').slice(0, 200) };
  if (o.year === null && o.from !== null && o.to !== null) o.year = Math.round((o.from + o.to) / 2);
  if (o.from === null) o.from = o.year; if (o.to === null) o.to = o.year;
  // a title-page basis needs its words on the page; otherwise it is the model's estimate (or the catalogue's)
  if (o.basis === 'title_page' && !(o.evidence && loose(o.evidence).length >= 3 && loose(b.lead).includes(loose(o.evidence)))) { o.basis_claimed = 'title_page'; o.basis = 'model_knowledge'; }
  if (!['title_page', 'catalogue', 'model_knowledge'].includes(o.basis)) o.basis = 'model_knowledge';
  return o;
}

let i = 0, ok = 0, bad = 0, stop = false;
async function worker() {
  while (!stop && i < todo.length) {
    const b = todo[i++];
    const res = await gatedTextCall(prompt(b), { model: MODEL, task: 'translate', attempts: 2 });
    if (res.cls === 'quota') { stop = true; console.error('QUOTA — stopping; resume later'); break; }
    let j = null; try { j = JSON.parse((res.answer || '').match(/\{[\s\S]*\}/)[0]); } catch {}
    if (!j || !j.work) { bad++; continue; }
    fs.appendFileSync(OUT, JSON.stringify({ book_id: b.book_id, model: MODEL, dated_at: new Date().toISOString(), catalogue: b.published ?? null,
      work: clean(j.work, b), edition: clean(j.edition, b), layers: Array.isArray(j.layers) ? j.layers.slice(0, 6) : [],
      catalogue_note: String(j.catalogue_note || '').slice(0, 200), confidence: j.confidence || null, reasoning: String(j.reasoning || '').slice(0, 400) }) + '\n');
    ok++; if (ok % 50 === 0) console.log(`  ${ok}/${todo.length} dated, ${bad} unparsed`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`done dated=${ok} unparsed=${bad}${stop ? ' (stopped on quota)' : ''}`);
