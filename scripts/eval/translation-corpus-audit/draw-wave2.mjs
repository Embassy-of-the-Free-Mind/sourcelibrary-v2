#!/usr/bin/env node
// PRIOR ART: draw.mjs (the 09-30 / monthly draw: language quotas, optional 50/50 lite/flash quota, controls) — its page
// rule, exclusions and control construction are kept here unchanged; what it cannot do is stratify on an arm it has
// never heard of or on script type, because it reads models only for the pages it draws. census.mjs gives the whole
// frame up front, so this draw can allocate by language × model arm and stratify implicitly by script × period.
//
// Wave 2 of the translation corpus audit (#5274, for the #4916 paper):
//   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/draw-wave2.mjs \
//        --census $JOB_SCRATCH/census.jsonl --out scripts/eval/results/translation-corpus-audit-wave2-2026-10-30 --seed 20261030 [--target 300]
//
// Design (fixed before the draw; the write-up repeats it):
//   unit       one interior text page per book, live books only (census frame: visible && pages_count > 0 &&
//              pages_translated > 0); page rule as draw.mjs (15% front / 5% back skipped, OCR ≥ 200, translation
//              ≥ 100 chars, source ai|batch_api, no edited_by, text page types only).
//   languages  draw.mjs's 15, quota scaled to --target.
//   cells      language × model arm (arm.mjs). Within a language each arm gets its share of the language quota by
//              eligible translated pages, and at least 6 books where the cell has ≥ 6 live books (cells that cannot
//              be filled are listed in draw-log.cells). Rare cells are drawn first, so a book with pages in two arms
//              goes to the rarer one; a book enters the sample once.
//   strata     inside a cell, books are ordered by script type (print / manuscript / unknown, ocr-trust-gate
//              bookHand over pages.script_type) then period (pre-1500, 1500–1700, 1700–1900, 1900+) then a seeded
//              random key, and taken by systematic sampling from a random start: proportional allocation over
//              script × period without separate quotas, so the cell stays self-weighting.
//   weights    arm-shares.json = each arm's share of the language's eligible translated pages (census), so score.mjs
//              re-weights the floor-inflated arms back to their true share (sensitivity.language_x_arm).
//   prompt     prompt_version / prompt_hash recorded on every item; if versions other than the current one are
//              < 10% of the draw, a supplement of old-version pages is drawn (kind 'supplement', never in the
//              headline). draw-log.prompt counts items with neither field.
//   controls   15 swap + 15 drop + 15 repeat, built exactly as draw.mjs from 4 extra books per language.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { bookHand, editionYear } from '../../lib/ocr-trust-gate.mjs';
import { armOf, familyOf, MACHINE_ARMS, period4 } from './arm.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const CENSUS = args.census, OUT = args.out, SEED = Number(args.seed || 20261030), TARGET = Number(args.target || 300);
if (!CENSUS || !OUT) { console.error('--census and --out required'); process.exit(1); }

const QUOTA = { Latin: 60, English: 36, German: 36, Greek: 36, French: 24, Italian: 18, Dutch: 18, Chinese: 18, Sanskrit: 12, Hebrew: 12, Arabic: 12, Tibetan: 12, Korean: 6, Spanish: 6, Japanese: 6 };
const QSUM = Object.values(QUOTA).reduce((s, x) => s + x, 0);
const FLOOR = 6, EXTRA_PER_LANG = 4, N_SWAP = 15, N_DROP = 15, N_REPEAT = 15;
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
const MIN_OCR = 200, MIN_TR = 100, SOURCES = ['ai', 'batch_api'];
const CURRENT_PROMPT = /^13$/; // Standard Translation v13 (prompts collection; translate-batch-chained.mjs and the CLI lanes since 2026-10-01)
const MODERNIZATION_HASHES = ['d0e82fa7c2', '45790074ee'];
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newId = () => { let s = ''; for (let i = 0; i < 10; i++) s += Math.floor(seededRand() * 16).toString(16); return s; };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

resetSeed(SEED);
const log = { seed: SEED, at: new Date().toISOString(), census: CENSUS, target: TARGET, quota: {}, floor: FLOOR, weights: {}, arm_pages: {}, cells: {}, exclusions: {}, prompt: {} };

// 1. Frame from the census.
const bookInfo = {};
for (const line of fs.readFileSync(CENSUS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const b = (bookInfo[r.book_id] ||= { id: r.book_id, language: r.language, published: r.published, year: editionYear(r), pages_count: r.pages_count, pages_translated: r.pages_translated, hand: {}, arms: {}, prompts: {} });
  if (r.script_type) bump(b.hand, r.script_type, r.n);
  const arm = armOf(r.model);
  if (!SOURCES.includes(r.source) || !MACHINE_ARMS.includes(arm)) continue;
  bump(b.arms, arm, r.n);
  bump(b.prompts, `${arm}|${r.prompt_version ?? ''}`, r.n);
}
const frame = {};
for (const b of Object.values(bookInfo)) {
  if (!QUOTA[b.language] || b.pages_count < 2) continue;
  b.script = bookHand(b.hand); b.period = period4(b.year);
  (frame[b.language] ||= []).push(b);
}
for (const [lang, bs] of Object.entries(frame)) {
  log.weights[lang] = { books: bs.length, translated_pages: bs.reduce((s, b) => s + Object.values(b.arms).reduce((x, y) => x + y, 0), 0) };
  const ap = {}; for (const b of bs) for (const [a, n] of Object.entries(b.arms)) bump(ap, a, n);
  log.arm_pages[lang] = ap;
}
const armShares = Object.fromEntries(Object.entries(log.arm_pages).map(([lang, ap]) => { const t = Object.values(ap).reduce((s, x) => s + x, 0); return [lang, Object.fromEntries(Object.entries(ap).map(([a, n]) => [a, +(n / t).toFixed(4)]))]; }));

// 2. Allocation per language × arm.
const cells = [];
for (const lang of Object.keys(QUOTA)) {
  const T = Math.round(QUOTA[lang] * TARGET / QSUM);
  log.quota[lang] = T;
  // The floors come out of the language quota: cells raised to the floor take their books from the cells above it,
  // which are rescaled to the remainder (never below the floor). A language whose floors alone exceed its quota is
  // drawn at the floors (Spanish, Arabic, Korean …); the first draw without this rescale came to 430 books.
  const lc = Object.entries(armShares[lang] || {}).map(([arm, share]) => {
    const books = frame[lang].filter((b) => b.arms[arm]);
    const prop = Math.round(T * share);
    return { lang, arm, share, books, prop, floored: books.length >= FLOOR && prop <= FLOOR };
  });
  const floorSum = lc.filter((c) => c.floored).length * FLOOR;
  const above = lc.filter((c) => !c.floored && c.books.length >= FLOOR), aboveShare = above.reduce((s, c) => s + c.share, 0);
  for (const c of lc) {
    if (c.floored) c.want = FLOOR;
    else if (c.books.length < FLOOR) c.want = Math.min(c.prop, c.books.length);
    else c.want = Math.max(FLOOR, Math.round(Math.max(0, T - floorSum) * c.share / aboveShare));
    cells.push(c);
    log.cells[`${lang}|${c.arm}`] = { live_books: c.books.length, page_share: c.share, proportional: c.prop, target: c.want, floor_applies: c.books.length >= FLOOR };
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const booksC = db.collection('books'), pages = db.collection('pages');

async function drawPage(book, { arm = null, prompt = null } = {}) {
  const lo = Math.floor(book.pages_count * 0.15), hi = Math.ceil(book.pages_count * 0.95);
  const cands = await pages.aggregate([
    { $match: { book_id: book.id, page_number: { $gt: lo, $lt: hi }, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
    { $project: { page_number: 1, page_type: 1, ol: { $strLenCP: '$ocr.data' }, tl: { $strLenCP: '$translation.data' }, tm: '$translation.model', ts: '$translation.source', ted: '$translation.edited_by', tpv: '$translation.prompt_version' } },
  ], { maxTimeMS: 120000 }).toArray();
  const ok = cands.filter((p) => {
    if (EXCLUDED_TYPES.includes(p.page_type)) { bump(log.exclusions, 'page_type'); return false; }
    if (p.ol < MIN_OCR) { bump(log.exclusions, 'short_ocr'); return false; }
    if (p.tl < MIN_TR) { bump(log.exclusions, 'short_translation'); return false; }
    if (!SOURCES.includes(p.ts)) { bump(log.exclusions, 'source_' + p.ts); return false; }
    if (p.ted) { bump(log.exclusions, 'edited_by'); return false; }
    const a = armOf(p.tm);
    if (!MACHINE_ARMS.includes(a)) { bump(log.exclusions, 'arm_' + a); return false; }
    if (arm && a !== arm) return false;
    if (prompt && !prompt(p.tpv)) return false;
    return true;
  });
  if (!ok.length) return null;
  const pick = ok[Math.floor(seededRand() * ok.length)];
  const page = await pages.findOne({ book_id: book.id, page_number: pick.page_number }, { projection: { id: 1, page_number: 1, page_type: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.prompt_hash': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.engine': 1, display_photo: 1, photo: 1, cropped_photo: 1 } });
  return { page, n_candidates: ok.length };
}

const meta = {};
async function bookMeta(id) {
  if (!meta[id]) meta[id] = await booksC.findOne({ id }, { projection: { _id: 0, id: 1, title: 1, author: 1, provider: 1 } }) || {};
  return meta[id];
}
async function toItem(kind, b, r, extra = {}) {
  const { page } = r, t = page.translation, o = page.ocr, bm = await bookMeta(b.id), e = t.engine || {};
  const ph = (t.prompt_hash || '').slice(0, 10);
  const arm = armOf(t.model);
  return {
    id: newId(), kind, book_id: b.id, page_number: page.page_number, page_id: page.id, page_type: page.page_type || null,
    title: bm.title || null, author: bm.author || null, provider: bm.provider || null,
    language: b.language, published: b.published || null, year: b.year, period: period4(b.year),
    script: b.script, page_script: page.script_type || null,
    arm, family: familyOf(arm), model: t.model, engine: e.name || null, engine_api: e.api || null, call_site: e.call_site || null,
    prompt_version: t.prompt_version || e.prompt?.version || null, prompt_hash: t.prompt_hash || e.prompt?.hash || null,
    modernization: MODERNIZATION_HASHES.includes(ph),
    translation_source: t.source, translated_at: t.updated_at || null, ocr_model: o.model || null, ocr_source: o.source || null,
    ocr_at: o.updated_at || null, translation_older_than_ocr: !!(t.updated_at && o.updated_at && new Date(t.updated_at) < new Date(o.updated_at)),
    ocr_chars: o.data.length, translation_chars: t.data.length, ocr_hash: sha16(o.data), translation_hash: sha16(t.data),
    image: page.display_photo || page.cropped_photo || page.photo || null,
    url: `https://sourcelibrary.org/book/${b.id}?page=${page.page_number}`, n_candidates: r.n_candidates,
    ...extra,
  };
}

// 3. Main draw: rare cells first; systematic sample over (script, period, random key) inside each cell.
const used = new Set(), main = [], texts = {};
const order = (bs) => bs.map((b) => ({ b, k: seededRand() })).sort((x, y) => (x.b.script.localeCompare(y.b.script)) || (x.b.period.localeCompare(y.b.period)) || (x.k - y.k)).map((x) => x.b);
for (const c of [...cells].sort((x, y) => x.books.length - y.books.length)) {
  const list = order(c.books);
  const got = [];
  if (c.want > 0 && list.length) {
    const step = list.length / c.want, start = seededRand() * step;
    const picks = [];
    for (let i = 0; i < c.want; i++) picks.push(Math.floor(start + i * step));
    let tried = 0;
    for (const p0 of picks) {
      // walk forward from the systematic position to the next usable book (wraps), at most the whole list
      for (let k = 0; k < list.length && got.length < c.want; k++) {
        const b = list[(p0 + k) % list.length];
        if (used.has(b.id)) continue;
        used.add(b.id); tried++;
        const r = await drawPage(b, { arm: c.arm }).catch((e) => { bump(log.exclusions, 'error'); console.error('draw error', b.id, e.message); return null; });
        if (!r) { bump(log.exclusions, 'no_candidate_page'); continue; }
        const it = await toItem('main', b, r, { cell: `${c.lang}|${c.arm}` });
        main.push(it); got.push(it); texts[it.id] = { source: r.page.ocr.data, translation: r.page.translation.data };
        break;
      }
    }
    log.cells[`${c.lang}|${c.arm}`].books_tried = tried;
  }
  log.cells[`${c.lang}|${c.arm}`].drawn = got.length;
  if (got.length < c.want) log.cells[`${c.lang}|${c.arm}`].unfilled = c.want - got.length;
  console.error(`${c.lang} / ${c.arm}: ${got.length}/${c.want} (frame ${c.books.length} books, share ${(100 * c.share).toFixed(1)}%)`);
}

// 4. Prompt version: count; supplement old versions if they are < 10% of the draw.
const isOld = (v) => !!v && !CURRENT_PROMPT.test(String(v));
log.prompt.by_version = {}; for (const m of main) bump(log.prompt.by_version, `${m.arm}/${m.prompt_version ?? '(none)'}`);
log.prompt.neither_version_nor_hash = main.filter((m) => !m.prompt_version && !m.prompt_hash).length;
log.prompt.old_share = +(main.filter((m) => isOld(m.prompt_version)).length / main.length).toFixed(3);
const supplement = [];
if (log.prompt.old_share < 0.10) {
  const need = Math.ceil(0.10 * main.length) - main.filter((m) => isOld(m.prompt_version)).length;
  const pool = shuffle(Object.values(frame).flat().filter((b) => !used.has(b.id) && Object.keys(b.prompts).some((k) => isOld(k.split('|')[1]))));
  for (const b of pool) {
    if (supplement.length >= need) break;
    used.add(b.id);
    const r = await drawPage(b, { prompt: isOld }).catch(() => null);
    if (!r) continue;
    const it = await toItem('supplement', b, r, { cell: `${b.language}|${armOf(r.page.translation.model)}` });
    supplement.push(it); texts[it.id] = { source: r.page.ocr.data, translation: r.page.translation.data };
  }
  log.prompt.supplement = supplement.length;
}

// 5. Extras for controls (any arm), then controls exactly as draw.mjs.
const extras = [];
for (const lang of Object.keys(QUOTA)) {
  let n = 0;
  for (const b of shuffle([...frame[lang]])) {
    if (n >= EXTRA_PER_LANG) break;
    if (used.has(b.id)) continue;
    used.add(b.id);
    const r = await drawPage(b).catch(() => null);
    if (!r) continue;
    const it = await toItem('extra', b, r);
    extras.push(it); texts[it.id] = { source: r.page.ocr.data, translation: r.page.translation.data }; n++;
  }
}
const splitUnits = (s) => { let u = s.split(/(?<=[.!?。।])\s+/).filter((x) => x.trim()); if (u.length < 6) u = s.split(/\n+/).filter((x) => x.trim()); return u; };
const controls = [];
const byLang = {}; for (const e of shuffle([...extras])) (byLang[e.language] ||= []).push(e);
let swaps = 0;
for (const lang of shuffle(Object.keys(byLang))) {
  const arr = byLang[lang];
  if (arr.length < 2 || swaps >= N_SWAP) continue;
  const [a, b] = arr.splice(0, 2);
  const it = { ...a, id: newId(), kind: 'swap', control_of: a.id, swap_translation_from: b.id, expected: { fidelity: 1, wrong_page: true } };
  controls.push(it); texts[it.id] = { source: texts[a.id].source, translation: texts[b.id].translation }; swaps++;
}
let drops = 0;
for (const lang of shuffle(Object.keys(byLang))) {
  for (const e of byLang[lang]) {
    if (drops >= N_DROP) break;
    const units = splitUnits(texts[e.id].translation);
    if (units.length < 4) continue;
    const k = Math.max(1, Math.round(units.length * 0.35)), start = Math.floor((units.length - k) / 2);
    const kept = [...units.slice(0, start), ...units.slice(start + k)];
    const it = { ...e, id: newId(), kind: 'drop', control_of: e.id, dropped_units: k, total_units: units.length, dropped_chars: units.slice(start, start + k).join(' ').length, expected: { omission: true } };
    controls.push(it); texts[it.id] = { source: texts[e.id].source, translation: kept.join(units.length >= 6 && /[.!?。।]\s/.test(texts[e.id].translation) ? ' ' : '\n') }; drops++;
  }
}
const seenLang = {}; let repeats = 0;
for (const m of shuffle([...main])) {
  if (repeats >= N_REPEAT) break;
  if ((seenLang[m.language] || 0) >= 2) continue;
  bump(seenLang, m.language);
  const it = { ...m, id: newId(), kind: 'repeat', repeat_of: m.id };
  controls.push(it); texts[it.id] = texts[m.id]; repeats++;
}
log.controls = { swap: swaps, drop: drops, repeat: repeats };
if (swaps < N_SWAP) log.controls.swap_note = `only ${swaps} languages had 2 extras`;

// 6. Write.
fs.mkdirSync(OUT, { recursive: true });
const manifest = [...main, ...supplement, ...controls];
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'items.jsonl'), manifest.map((m) => JSON.stringify({ id: m.id, language: m.language, source: texts[m.id].source, translation: texts[m.id].translation })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'draw-log.json'), JSON.stringify(log, null, 2));
fs.writeFileSync(path.join(OUT, 'arm-shares.json'), JSON.stringify(armShares, null, 1));
const bookW = {}; for (const m of main) bookW[m.book_id] = { pages_translated: bookInfo[m.book_id].pages_translated || 0, pages_count: bookInfo[m.book_id].pages_count || 0 };
fs.writeFileSync(path.join(OUT, 'book-weights.json'), JSON.stringify(bookW, null, 1));
console.error(`wrote ${main.length} main + ${supplement.length} supplement + ${controls.length} controls → ${OUT}`);
await client.close();
