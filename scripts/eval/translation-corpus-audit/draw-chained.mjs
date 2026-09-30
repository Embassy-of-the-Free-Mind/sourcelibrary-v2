#!/usr/bin/env node
// PRIOR ART: ./draw.mjs — the corpus-wide draw (frame = every live translated book, 15-language quotas, interior
// rule). It cannot frame "pages one LANE wrote": the lane's pages are marked on the page
// (translation.engine.call_site) and the frame is the lane's run records, not books.language quotas. This is the
// same draw restricted to that frame, writing the same manifest/items/draw-log shape so build-packets.mjs, the
// judge rubric and score.mjs run unchanged. Design: .claude/docs/eval-design.md §3, §6; brief in the ops repo
// handoffs/2026-09-30-chained-quality-sample.md (#4681).
//
//   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/draw-chained.mjs \
//        --out scripts/eval/results/translation-corpus-audit-chained-2026-10-01 --seed 20261001 [--books 60] [--seams 15]
//
// Frame: books with a `translate_batch_runs` record in mode 'chained'; within a book, pages whose
// translation.engine.call_site is scripts/lib/translate-batch-chained.mjs (the lane wrote them).
// Unit: one random SEEDED page per book (engine.input.context.previous_translation true — the lane's normal
// case), up to --books books; plus --seams pages that were the FIRST page of a block (block.first_page ==
// page_number), one per book, from other books — the seam case the brief asks for. Both are kind 'main' and
// carry stratum: 'seeded' | 'seam' so the split can be read from the manifest. The same length / page_type /
// edited_by exclusions as draw.mjs apply; the interior rule does not (the lane chose the pages).
// Controls (blinded, from a second seeded page of the sampled books): 15 swap, 15 drop, 15 repeat — the gate
// in score.mjs needs ≥ 10 of each. Weights in draw-log.json = the lane's page count per language, so the
// post-stratified estimate is "a page the lane wrote", not "a page in the corpus".
//
// Window mode (the speed-test-A quality gate, ops handoffs/2026-09-30-chained-quality-sample.md "Amended"):
//   --since <ISO> --until <ISO>   only pages whose translation.updated_at falls in [since, until)
//   --book-ids <file>             frame = these book ids (one per line or a JSON array) instead of every chained run
//   --swap/--drop/--repeat <n>    control counts (default 15 each; score.mjs --gate needs >= 10 of each)
// and draw-log.json gains `eligibility`: frame books the lane should not have written in the window
// (held before the write, English, processing_priority >= 90) — a gate ABORT condition that needs no judge.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = args.out || 'scripts/eval/results/translation-corpus-audit-chained-2026-10-01';
const SEED = Number(args.seed || 20261001);
const N_BOOKS = Number(args.books || 60);
const N_SEAMS = Number(args.seams || 15);
const CALL_SITE = 'scripts/lib/translate-batch-chained.mjs';
const N_SWAP = Number(args.swap || 15), N_DROP = Number(args.drop || 15), N_REPEAT = Number(args.repeat || 15);
const SINCE = args.since ? new Date(args.since) : null, UNTIL = args.until ? new Date(args.until) : null;
const WINDOW = SINCE || UNTIL ? { 'translation.updated_at': { ...(SINCE ? { $gte: SINCE } : {}), ...(UNTIL ? { $lt: UNTIL } : {}) } } : {};
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
const MIN_OCR = 200, MIN_TR = 100;

const armOf = (m) => !m ? 'none' : /^gemini-3\.1-flash-lite/.test(m) ? 'lite' : /^gemini-3-flash-preview/.test(m) ? 'flash' : 'other';
const periodOf = (published) => {
  const m = String(published || '').match(/\b(1[0-9]\d\d|20[0-2]\d|[5-9]\d\d)\b/);
  if (!m) return 'unknown';
  const y = Number(m[1]);
  return y < 1500 ? 'pre-1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : y < 1900 ? '1800s' : '1900+';
};
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newId = () => { let s = ''; for (let i = 0; i < 10; i++) s += Math.floor(seededRand() * 16).toString(16); return s; };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

resetSeed(SEED);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books'), pages = db.collection('pages'), runs = db.collection('translate_batch_runs');

const log = { seed: SEED, at: new Date().toISOString(), frame: { call_site: CALL_SITE, runs_mode: 'chained', since: SINCE, until: UNTIL, book_ids_file: args['book-ids'] || null }, n_books: N_BOOKS, n_seams: N_SEAMS, weights: {}, visits: {}, exclusions: {}, arms: {} };

// 1. Frame: books the lane has run on, and the lane's page count per language (the weights).
let bookIds;
if (args['book-ids']) {
  const raw = fs.readFileSync(args['book-ids'], 'utf8').trim();
  bookIds = raw.startsWith('[') ? JSON.parse(raw) : raw.split(/\s+/).filter(Boolean);
} else bookIds = await runs.distinct('book_id', { mode: 'chained' });
const bookRows = await books.find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, provider: 1, language: 1, visible: 1, hidden: 1, processing_priority: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1 } }).toArray();
log.eligibility = [];
const byBook = Object.fromEntries(bookRows.map((b) => [b.id, b]));
const PROJ = { page_number: 1, page_type: 1, ol: { $strLenCP: '$ocr.data' }, tl: { $strLenCP: '$translation.data' }, tm: '$translation.model', ted: '$translation.edited_by', seeded: '$translation.engine.input.context.previous_translation', first: '$translation.engine.input.context.block.first_page' };
const lanePages = {}; // book_id → candidate rows the lane wrote (filtered)
for (const b of bookRows) {
  const rows = await pages.aggregate([
    { $match: { book_id: b.id, 'translation.engine.call_site': CALL_SITE, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' }, ...WINDOW } },
    { $project: { ...PROJ, tu: '$translation.updated_at' } },
  ], { maxTimeMS: 60000 }).toArray();
  if (rows.length) {
    const lastWrite = rows.reduce((m, r) => (r.tu && (!m || r.tu > m) ? r.tu : m), null);
    const hold = b.pipeline_auto?.hold;
    const why = [];
    if (hold?.held_at && lastWrite && new Date(hold.held_at) < new Date(lastWrite)) why.push(`held (${hold.reason}) since ${new Date(hold.held_at).toISOString()}`);
    if (/^(english|eng|en)$/i.test(b.language || '')) why.push('English');
    if (b.processing_priority >= 90) why.push(`processing_priority ${b.processing_priority}`);
    if (why.length) log.eligibility.push({ book_id: b.id, title: b.title, pages: rows.length, last_write: lastWrite, why });
  }
  const lang = b.language || 'unknown';
  log.weights[lang] ||= { books: 0, translated_pages: 0 };
  log.weights[lang].books++; log.weights[lang].translated_pages += rows.length;
  const ok = rows.filter((p) => {
    if (EXCLUDED_TYPES.includes(p.page_type)) { bump(log.exclusions, 'page_type'); return false; }
    if (p.ol < MIN_OCR) { bump(log.exclusions, 'short_ocr'); return false; }
    if (p.tl < MIN_TR) { bump(log.exclusions, 'short_translation'); return false; }
    if (p.ted) { bump(log.exclusions, 'edited_by'); return false; }
    if (['other', 'none'].includes(armOf(p.tm))) { bump(log.exclusions, 'arm_' + armOf(p.tm)); return false; }
    return true;
  });
  if (ok.length) lanePages[b.id] = ok;
}
if (log.eligibility.length) console.error(`ELIGIBILITY: ${log.eligibility.length} books the lane should not have written:`, JSON.stringify(log.eligibility));
console.error(`frame: ${bookIds.length} books with chained runs, ${Object.keys(lanePages).length} with judgeable lane pages; lane pages by language:`, Object.fromEntries(Object.entries(log.weights).map(([k, w]) => [k, w.translated_pages])));

async function fullPage(bookId, n) {
  return pages.findOne({ book_id: bookId, page_number: n }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.prompt_hash': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.engine': 1, display_photo: 1, photo: 1, cropped_photo: 1 } });
}
function toItem(kind, book, page, extra = {}) {
  const t = page.translation, o = page.ocr, ctx = t.engine?.input?.context || {};
  return {
    id: newId(), kind, book_id: book.id, page_number: page.page_number, page_id: page.id, page_type: page.page_type || null,
    title: book.title, author: book.author || null, provider: book.provider || null,
    language: book.language || 'unknown', period: periodOf(book.published), published: book.published || null,
    arm: armOf(t.model), model: t.model, prompt_version: t.prompt_version || null, prompt_hash: t.prompt_hash || null, modernization: false,
    translation_source: t.source, translated_at: t.updated_at || null, ocr_model: o.model || null, ocr_source: o.source || null,
    ocr_at: o.updated_at || null, translation_older_than_ocr: !!(t.updated_at && o.updated_at && new Date(t.updated_at) < new Date(o.updated_at)),
    lane: { call_site: t.engine?.call_site || null, api: t.engine?.api || null, seeded: !!ctx.previous_translation, block_first_page: ctx.block?.first_page ?? null, block_pages: ctx.block?.pages ?? null },
    ocr_chars: o.data.length, translation_chars: t.data.length, ocr_hash: sha16(o.data), translation_hash: sha16(t.data),
    image: page.display_photo || page.cropped_photo || page.photo || null,
    url: `https://sourcelibrary.org/book/${book.id}?page=${page.page_number}`,
    ...extra,
  };
}

// 2. One seeded page per book (main, stratum seeded) + one more seeded page per book (extra, control pool).
const main = [], extras = [], texts = {};
const order = shuffle(Object.keys(lanePages));
let visits = 0;
for (const bookId of order) {
  if (main.filter((m) => m.stratum === 'seeded').length >= N_BOOKS) break;
  visits++;
  const seeded = shuffle(lanePages[bookId].filter((p) => p.seeded === true));
  if (!seeded.length) { bump(log.exclusions, 'no_seeded_page'); continue; }
  const p1 = await fullPage(bookId, seeded[0].page_number);
  const it = toItem('main', byBook[bookId], p1, { stratum: 'seeded', n_candidates: seeded.length });
  main.push(it); texts[it.id] = { source: p1.ocr.data, translation: p1.translation.data };
  bump(log.arms, it.arm);
  if (seeded.length > 1) {
    const p2 = await fullPage(bookId, seeded[1].page_number);
    const ex = toItem('extra', byBook[bookId], p2);
    extras.push(ex); texts[ex.id] = { source: p2.ocr.data, translation: p2.translation.data };
  }
}
// 3. Seam pages: first page of a block, one per book, preferring books not yet in the main sample.
const used = new Set(main.map((m) => m.book_id));
const seamOrder = [...order.filter((b) => !used.has(b)), ...order.filter((b) => used.has(b))];
for (const bookId of seamOrder) {
  if (main.filter((m) => m.stratum === 'seam').length >= N_SEAMS) break;
  const seams = shuffle(lanePages[bookId].filter((p) => p.first != null && p.first === p.page_number && !main.some((m) => m.book_id === bookId && m.page_number === p.page_number)));
  if (!seams.length) continue;
  const p = await fullPage(bookId, seams[0].page_number);
  const it = toItem('main', byBook[bookId], p, { stratum: 'seam', n_candidates: seams.length });
  main.push(it); texts[it.id] = { source: p.ocr.data, translation: p.translation.data };
}
log.visits = { books_visited: visits, seeded_main: main.filter((m) => m.stratum === 'seeded').length, seam_main: main.filter((m) => m.stratum === 'seam').length, extras: extras.length };
console.error(`main: ${log.visits.seeded_main} seeded + ${log.visits.seam_main} seam pages; ${extras.length} extras for controls`);

// 4. Controls — same construction as draw.mjs; swaps pair within a language first, then across.
const splitUnits = (s) => {
  let u = s.split(/(?<=[.!?。।])\s+/).filter((x) => x.trim());
  if (u.length < 6) u = s.split(/\n+/).filter((x) => x.trim());
  return u;
};
const controls = [];
const pool = shuffle([...extras]);
const byLang = {};
for (const e of pool) (byLang[e.language] ||= []).push(e);
let swaps = 0;
const pairAndSwap = (a, b) => {
  const it = { ...a, id: newId(), kind: 'swap', control_of: a.id, swap_translation_from: b.id, expected: { fidelity: 1, wrong_page: true } };
  controls.push(it); texts[it.id] = { source: texts[a.id].source, translation: texts[b.id].translation };
  swaps++;
};
for (const lang of shuffle(Object.keys(byLang))) {
  while (byLang[lang].length >= 2 && swaps < N_SWAP) pairAndSwap(...byLang[lang].splice(0, 2));
}
const leftovers = shuffle(Object.values(byLang).flat());
while (leftovers.length >= 2 && swaps < N_SWAP) { const [a, b] = leftovers.splice(0, 2); pairAndSwap(a, b); byLang[a.language] = byLang[a.language].filter((x) => x !== a); byLang[b.language] = byLang[b.language].filter((x) => x !== b); }
let drops = 0;
for (const e of leftovers) {
  if (drops >= N_DROP) break;
  const units = splitUnits(texts[e.id].translation);
  if (units.length < 4) continue;
  const k = Math.max(1, Math.round(units.length * 0.35)), start = Math.floor((units.length - k) / 2);
  const kept = [...units.slice(0, start), ...units.slice(start + k)];
  const removed = units.slice(start, start + k).join(' ');
  const it = { ...e, id: newId(), kind: 'drop', control_of: e.id, dropped_units: k, total_units: units.length, dropped_chars: removed.length, expected: { omission: true } };
  controls.push(it); texts[it.id] = { source: texts[e.id].source, translation: kept.join(units.length >= 6 && /[.!?。।]\s/.test(texts[e.id].translation) ? ' ' : '\n') };
  drops++;
}
let repeats = 0;
for (const m of shuffle([...main])) {
  if (repeats >= N_REPEAT) break;
  const it = { ...m, id: newId(), kind: 'repeat', repeat_of: m.id };
  controls.push(it); texts[it.id] = texts[m.id];
  repeats++;
}
log.controls = { swap: swaps, drop: drops, repeat: repeats };
console.error(`controls: ${swaps} swap, ${drops} drop, ${repeats} repeat`);

// 5. Write.
fs.mkdirSync(OUT, { recursive: true });
const all = [...main, ...controls];
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), all.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'items.jsonl'), all.map((x) => JSON.stringify({ id: x.id, language: x.language, source: texts[x.id].source, translation: texts[x.id].translation })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'draw-log.json'), JSON.stringify(log, null, 2));
console.error(`wrote ${all.length} items (${main.length} main) → ${OUT}`);
await client.close();
