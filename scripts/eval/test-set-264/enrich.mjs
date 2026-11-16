#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/page-descriptor.mjs (describes a page with a paid flash-lite call; its prompt has no
// period, and #264 allows agy flash-low only) and scripts/eval/book-class-5768.mjs (book-level print/manuscript from a
// contact sheet; read here as the recorded class, never re-run). Neither joins existing references and judged pages to
// the frame or hashes the served image.
/**
 * Stage 1 step 2 of #264, part 2: the existing-truth rows, the image hash and the observed class of every frame row.
 * Read-only on production; agy gemini-3.8-flash-low (subscription) for pages with no recorded class. Resumable: every
 * image hash and agy answer is cached in --cache (jsonl) and a re-run makes no repeat call.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/test-set-264/enrich.mjs \
 *     [--draw=$JOB_SCRATCH/draw.json] [--out=$JOB_SCRATCH/enriched.json] [--cache=$JOB_SCRATCH/cache.jsonl] [--conc=4]
 *
 * Existing rows (#264 "existing references and judged pages that passed step 1 join as rows in their cell"): from
 * inventory.json, the passing references and passing judged pages, ONE page per book per cell (a book already drawn in
 * the cell is left out: one page per book per stratum, eval-design 3.1), non-canonical references first, then canonical
 * references, then judged pages, each in sha256(SEED|page id) order, up to the cell's target.
 *
 * Observed class, first source that has it (named per row in observed.by):
 *   1. scripts/eval/benchmark/script-class/<slug>.json   by-eye class of a benchmark page
 *   2. books.book_class (#5768)                          a book-level contact-sheet class (16 pages), not this leaf
 *   3. a by-eye reading of this page's image (--eye: Claude Opus subagents, list.json + out-*.jsonl), used when agy's
 *      Gemini pools are spent (2026-11-13: default 0.06%, james 2.7%, milo 0.5% of the week left)
 *   4. agy gemini-3.8-flash-low on this page's image      script, kind and century (skipped with --no-agy)
 * Period comes only from sources 3 and 4; elsewhere it is `unknown` and the catalogue year stays in catalogue.year.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MongoClient, ObjectId } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { gatedImageCall, firstJson } from '../../lib/agy-cli.mjs';
import { licenseFor } from '../lib/ocr-eval-licences.mjs';
import { SEED } from './seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..', 'benchmark');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SCR = process.env.JOB_SCRATCH || '/tmp';
const DRAW = arg('draw', `${SCR}/draw.json`), OUT = arg('out', `${SCR}/enriched.json`), CACHE = arg('cache', `${SCR}/cache.jsonl`);
const INV = arg('inventory', path.join(HERE, '..', 'dataset', 'test-set-264', 'inventory.json'));
const CONC = Number(arg('conc', 4));
let NO_AGY = process.argv.includes('--no-agy');
const EYE = arg('eye', null);
const eye = new Map();
if (EYE) {
  const list = JSON.parse(fs.readFileSync(path.join(EYE, 'list.json'), 'utf8'));
  const byN = new Map();
  for (const f of fs.readdirSync(EYE).filter((x) => /^out-\d+\.jsonl$/.test(x))) for (const l of fs.readFileSync(path.join(EYE, f), 'utf8').split('\n').filter(Boolean)) { const x = JSON.parse(l); byN.set(x.n, x); }
  for (const x of list) if (byN.has(x.n)) eye.set(x.url, byN.get(x.n));
}
export const EYE_BY = 'claude-opus-5-5 by eye (4 subagents, 1200 px, 2026-11-13)';
export const AGY_MODEL = 'gemini-3.8-flash-low';
export const CLASS_PROMPT_VERSION = 'test-set-264-class-v1';
const hk = (s) => crypto.createHash('sha256').update(`${SEED}|${s}`).digest('hex');

const { log, rows: drawn } = JSON.parse(fs.readFileSync(DRAW, 'utf8'));
const inv = JSON.parse(fs.readFileSync(INV, 'utf8'));
const target = new Map(log.frame_cells.map((f) => [f.id, f.target]));

// ── existing rows ────────────────────────────────────────────────────────────
const drawnIn = new Set(drawn.map((r) => `${r.frame_cell}|${r.book_id}`));
const cand = new Map();
for (const r of inv.refs) if (!r.rules.length && r.frame_cell && r.page_id) (cand.get(r.frame_cell) || cand.set(r.frame_cell, []).get(r.frame_cell)).push({ kind: r.canonical ? 1 : 0, page_id: r.page_id, book_id: r.book_id, work_id: r.work_id, router_cell: r.router_cell, frame_cell: r.frame_cell, prior_text: r.prior_text, ref: r });
for (const j of inv.judged) if (!j.rules.length && j.frame_cell) (cand.get(j.frame_cell) || cand.set(j.frame_cell, []).get(j.frame_cell)).push({ kind: 2, page_id: j.page_id, book_id: j.book_id, work_id: j.work_id, router_cell: j.router_cell, frame_cell: j.frame_cell, prior_text: j.prior_text, judged: j });
const judgedByPage = new Map(inv.judged.filter((j) => !j.rules.length).map((j) => [j.page_id, j]));
const refsByPage = new Map();
for (const r of inv.refs) if (!r.rules.length && r.page_id) (refsByPage.get(r.page_id) || refsByPage.set(r.page_id, []).get(r.page_id)).push(r);
const existing = [];
for (const [cell, list] of cand) {
  const seen = new Set();
  for (const c of list.sort((a, b) => a.kind - b.kind || hk(a.page_id).localeCompare(hk(b.page_id)))) {
    if (existing.filter((e) => e.frame_cell === cell).length >= (target.get(cell) || 0)) break;
    if (seen.has(c.book_id) || drawnIn.has(`${cell}|${c.book_id}`)) continue;
    seen.add(c.book_id);
    existing.push({ origin: c.kind === 2 ? 'judged' : 'reference', frame_cell: cell, router_cell: c.router_cell, book_id: c.book_id, work_id: c.work_id, page_id: c.page_id, prior_text: c.prior_text });
  }
}

// ── Mongo: books and pages for the existing rows; pages for drawn rows already carry what is needed ─────────────
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const pages = new Map();
const pids = existing.map((e) => e.page_id);
for (let i = 0; i < pids.length; i += 500) for (const p of await db.collection('pages').find({ id: { $in: pids.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.model': 1, photo: 1, archived_photo: 1, photo_original: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1 } }).toArray()) pages.set(p.id, p);
const bids = [...new Set(existing.map((e) => e.book_id))];
const books = new Map();
for (let i = 0; i < bids.length; i += 500) {
  const ids = bids.slice(i, i + 500), oids = ids.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
  for (const b of await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] }, { projection: { id: 1, language: 1, languages: 1, year: 1, published: 1, work_id: 1, visible: 1, hidden_reason: 1, pages_count: 1, text_role: 1, book_class: 1, contributing_library: 1, image_source: 1, title: 1 } }).toArray()) { books.set(b.id, b); books.set(String(b._id), b); }
}
await client.close();
const bookClass = (b) => (b?.book_class ? { class: b.book_class.class, script_family: b.book_class.script_family || null, source: b.book_class.evidence?.source || null, version: b.book_class.version || null, model: b.book_class.model || null, at: b.book_class.at || null } : null);
for (const e of existing) {
  const p = pages.get(e.page_id), b = books.get(e.book_id);
  const year = Number(b?.year) || Number(String(b?.published || '').match(/\d{4}/)?.[0]) || null;
  Object.assign(e, { book_oid: b ? String(b._id) : null, work_id: e.work_id || b?.work_id || null, page_number: p?.page_number ?? null, pages_count: b?.pages_count ?? null, image_url: p ? getPageSource(p) : null,
    stored_text: { model: p?.ocr?.model || null }, catalogue: { language: b?.language ?? null, languages: b?.languages || null, published: b?.published ?? null, year, text_role: b?.text_role || null, visible: !!b?.visible, hidden_reason: b?.hidden_reason || null, title: b?.title || null },
    book_class: bookClass(b), image_holder: b?.contributing_library || b?.image_source?.provider || b?.image_source?.name || null, image_source: b?.image_source || null });
}

// ── truth available, per row ─────────────────────────────────────────────────
const all = [...drawn, ...existing];
for (const r of all) {
  const refs = refsByPage.get(r.page_id) || [], j = judgedByPage.get(r.page_id);
  r.truth = [
    ...refs.map((x) => ({ kind: 'reference', slug: x.slug, source: x.source, canonical: !!x.canonical, licence: x.licence || licenseFor(x.source).license, licence_include: x.licence ? null : licenseFor(x.source).include, holder: x.source })),
    ...(j ? [{ kind: 'judged', rows: j.rows, lanes: j.lanes, routes: j.routes, cells_at_judging: j.cells_at_judging }] : []),
  ];
  r.canonical = refs.some((x) => x.canonical);
}

// ── image hash and observed class (cached) ───────────────────────────────────
const cache = new Map();
if (fs.existsSync(CACHE)) for (const l of fs.readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) { const x = JSON.parse(l); cache.set(`${x.k}|${x.url}`, x); }
const put = (x) => { cache.set(`${x.k}|${x.url}`, x); fs.appendFileSync(CACHE, JSON.stringify(x) + '\n'); };
const scriptClass = (slug) => { const f = path.join(BENCH, 'script-class', `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

const PROMPT = (name) => `@./${name}
This is one scanned page of a historical book or manuscript. Look at the image only; do not transcribe it and do not open any other file.
Reply with ONE line of JSON and nothing else:
{"script": "latin"|"blackletter"|"greek"|"hebrew-square"|"hebrew-rashi"|"arabic"|"syriac"|"cjk"|"tibetan"|"devanagari"|"other-indic"|"cyrillic"|"armenian"|"other"|"none",
 "kind": "print"|"manuscript"|"mixed"|"none",
 "century": the century the page was most likely written or printed, as an integer (16 for the 1500s), or null if you cannot tell}
"print" = set in type, woodblock, engraved or lithographed; "manuscript" = written by hand; "mixed" = a printed page carrying substantial handwriting; "none" = no text on the page.`;

async function fetchBuf(url) {
  let res;
  for (let a = 0; a < 3; a++) {
    res = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-eval/test-set-264' }, signal: AbortSignal.timeout(90_000) }).catch((e) => ({ ok: false, status: String(e.message) }));
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    await new Promise((r) => setTimeout(r, 8000 * (a + 1)));
  }
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let done = 0, agyCalls = 0;
async function work(r) {
  if (!r.image_url) { r.image = { url: null, error: 'no usable image' }; return; }
  let img = cache.get(`img|${r.image_url}`);
  let buf = null;
  if (!img) {
    try { buf = await fetchBuf(r.image_url); img = { k: 'img', url: r.image_url, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, at: new Date().toISOString() }; }
    catch (e) { img = { k: 'img', url: r.image_url, error: e.message, at: new Date().toISOString() }; }
    put(img);
  }
  r.image = { url: r.image_url, sha256: img.sha256 || null, bytes: img.bytes || null, fetched_at: img.at, error: img.error || null };
  const sc = r.truth.map((t) => t.slug && scriptClass(t.slug)).find(Boolean);
  if (sc) { r.observed = { script: sc.script_class, kind: /manuscript|hand/i.test(sc.script_class) ? 'manuscript' : 'print', period: 'unknown', by: `script-class/${sc.slug}.json (${sc.classified_by}, ${sc.classified_at})`, level: 'page' }; return; }
  if (r.book_class?.class) { r.observed = { script: r.book_class.script_family || 'unknown', kind: { printed: 'print', handwritten: 'manuscript', mixed: 'mixed' }[r.book_class.class] || r.book_class.class, period: 'unknown', by: `books.book_class ${r.book_class.version || ''} (${r.book_class.source || 'contact-sheet'}, ${r.book_class.model || '?'}, ${String(r.book_class.at || '').slice(0, 10)})`.replace(/\s+/g, ' '), level: 'book' }; return; }
  const e = eye.get(r.image_url);
  if (e) { r.observed = { script: e.script, kind: e.kind, period: Number.isInteger(e.century) ? `${e.century}th c.` : 'unknown', century: Number.isInteger(e.century) ? e.century : null, by: EYE_BY, note: e.note || null, level: 'page' }; return; }
  if (img.error || NO_AGY) { r.observed = { script: 'unknown', kind: 'unknown', period: 'unknown', by: `not classified: ${img.error || 'no recorded class, agy not run'}`, level: null }; return; }
  let a = cache.get(`agy|${r.image_url}`);
  if (!a) {
    buf ||= await fetchBuf(r.image_url);
    const jpeg = await sharp(buf).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const res = await gatedImageCall(PROMPT, jpeg, { model: AGY_MODEL, tmp: SCR }); agyCalls += res.calls || 1;
    const j = firstJson(res.text);
    a = { k: 'agy', url: r.image_url, answer: j, raw: j ? null : String(res.text || '').slice(0, 300), cls: res.cls || null, at: new Date().toISOString() };
    if (j || res.cls !== 'quota') put(a);
    if (res.cls === 'quota') throw new Error('agy quota');
  }
  const j = a.answer;
  r.observed = j ? { script: j.script || 'unknown', kind: j.kind || 'unknown', period: Number.isInteger(j.century) ? `${j.century}th c.` : 'unknown', century: Number.isInteger(j.century) ? j.century : null, by: `agy ${AGY_MODEL} ${CLASS_PROMPT_VERSION} (${String(a.at).slice(0, 10)})`, level: 'page' }
    : { script: 'unknown', kind: 'unknown', period: 'unknown', by: `agy ${AGY_MODEL}: no JSON answer`, level: null };
}
const queue = [...all];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const r = queue.shift();
    try { await work(r); } catch (e) { if (/quota/.test(e.message)) { console.error('agy quota reached: no more agy calls this run'); NO_AGY = true; } r.observed ||= { script: 'unknown', kind: 'unknown', period: 'unknown', by: `error: ${e.message}`, level: null }; }
    if (++done % 50 === 0) process.stderr.write(`\r${done}/${all.length} (agy calls ${agyCalls})   `);
  }
}));
fs.writeFileSync(OUT, JSON.stringify({ log, existing_rule: 'one page per book per cell; non-canonical refs, canonical refs, judged; sha256(SEED|page id) order; capped at target', rows: all }, null, 1));
const by = {}; for (const r of all) { const k = (r.observed?.by || '?').split(' ')[0]; by[k] = (by[k] || 0) + 1; }
console.log(`\n${all.length} rows (${drawn.length} drawn, ${existing.length} existing); agy calls ${agyCalls}; class sources`, by);
console.log(`image errors: ${all.filter((r) => r.image?.error).length}; wrote ${OUT}`);
