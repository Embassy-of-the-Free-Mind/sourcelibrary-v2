#!/usr/bin/env node
// PRIOR ART: scripts/eval/correction-pass-7818/frame.mjs (seeded book order, one page per book, the lane's own frame
// rules re-done per page), scripts/batch/cli-ocr-lane.mjs (FIRST_READ_BOOKS / firstReadSkip / UNREAD / spreadReason: the
// first-read lane's frame; correctMain + correctablePages: the #7558 correction lane's frame, restated below because
// correctablePages is not exported), scripts/eval/typed-refs-6012/align.mjs (the DTA page matches, read from
// scripts/eval/output/typed-refs-6012-2026-10-06.dta.*). #7701 labelled faces by eye on 170 pages; here one agy call a
// page labels them (lib.mjs agyFace) and Opus checks 30 (T4).
/**
 * The four frames of #7835 (experiment file §Frames). Read-only on Mongo; the only model calls are the face tags.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fraktur-paired-7835/frame.mjs t4-draw
 *   ... frame.mjs t1-draw | t2-draw | t3-draw     candidates in seeded order (no model call)
 *   ... frame.mjs tag --set=t4|t1|t2|t3 [--concurrency=4]   face tags (agy), in draw order, until the set's strata are full
 *   ... frame.mjs select                          the strata from the tags -> OUT/<set>/selected.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, J, W, jsonl, SEED, makeRng, shuffle, arg, imageFor, agyFace } from './lib.mjs';
import { FIRST_READ_BOOKS, firstReadSkip, UNREAD, spreadReason, isInterior, lastPageNumber, LITE_MODELS, IDLE_STATUSES } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

export const T4_N = 300, T1_STRATA = { fraktur: 40, antiqua: 20 }, T2_STRATA = { fraktur: 40 }, T3_N = 40;
export const T1_CAP = 450, T2_CAP = 120;   // candidates drawn; tagging stops when the strata are full
export const GEX45 = 'root@65.108.136.89';
const DTA = (k) => path.join(ROOT, `scripts/eval/output/typed-refs-6012-2026-10-06.dta.${k}.jsonl.gz`);
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const PAGE_PROJ = { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, page_type: 1 };
const yearOf = (b) => { const y = Number(b.year) || Number(/\b(1[4-9]\d\d)\b/.exec(String(b.published || ''))?.[1]); return Number.isFinite(y) && y > 1400 ? y : null; };

async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }

/** T4: 300 visible German books, one interior page with an image each. */
async function t4Draw() {
  await withDb(async (db) => {
    const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: /^German/ } }, { projection: { id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1 } }).toArray();
    const rnd = makeRng(SEED.t4), order = shuffle(books.sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    const out = [], log = { frame_books: books.length, tried: 0, no_interior_image: 0 };
    for (const b of order) {
      if (out.length >= T4_N) break;
      log.tried++;
      const last = await lastPageNumber(db, b.id);
      const pages = (await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray()).filter((p) => isInterior(p.page_number, last) && getPageSource(p));
      if (!pages.length) { log.no_interior_image++; continue; }
      const p = pages[Math.floor(rnd() * pages.length)];
      out.push({ set: 't4', key: `T4-${p.id}`, page_id: p.id, book_id: b.id, page_number: p.page_number, title: String(b.title || '').slice(0, 80), language: b.language, year: yearOf(b), image: getPageSource(p) });
    }
    W('t4/candidates.json', { at: new Date().toISOString(), seed: SEED.t4, log, candidates: out });
    console.log(JSON.stringify(log));
  });
}

/** T1: the first-read lane's German frame; one interior unread page a book and its block of 4 unread pages. */
async function t1Draw() {
  await withDb(async (db) => {
    const books = (await db.collection('books').find({ ...FIRST_READ_BOOKS, language: { $regex: /^German/ } }, { projection: { id: 1, title: 1, language: 1, published: 1, year: 1, visible: 1, pages_count: 1, pages_ocr: 1, processing_priority: 1, image_source: 1, needs_splitting: 1, split_completed: 1, pipeline_auto: 1 } }).toArray())
      .filter((b) => !firstReadSkip(b, { languages: ['deu'] }));
    const rnd = makeRng(SEED.t1), order = shuffle(books.sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    const out = [], log = { frame_books: books.length, tried: 0, spread: 0, no_interior_unread: 0, short_block: 0 };
    for (const b of order) {
      if (out.length >= T1_CAP) break;
      log.tried++;
      const pages = await db.collection('pages').find({ book_id: b.id, ...UNREAD }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
      if (spreadReason(b, pages)) { log.spread++; continue; }
      const last = await lastPageNumber(db, b.id);
      const interior = pages.filter((p) => isInterior(p.page_number, last) && getPageSource(p));
      if (!interior.length) { log.no_interior_unread++; continue; }
      const p = interior[Math.floor(rnd() * interior.length)];
      if (pages.length < 4) { log.short_block++; continue; }
      const i = pages.findIndex((x) => x.id === p.id), s = Math.min(i, pages.length - 4);
      const block = pages.slice(s, s + 4).map((x) => x.id);
      out.push({ set: 't1', key: `T1-${p.id}`, page_id: p.id, book_id: b.id, page_number: p.page_number, title: String(b.title || '').slice(0, 80), language: b.language, year: yearOf(b), hold: b.pipeline_auto?.hold?.reason ?? null, image: getPageSource(p), block });
    }
    W('t1/candidates.json', { at: new Date().toISOString(), seed: SEED.t1, log, candidates: out });
    console.log(JSON.stringify(log));
  });
}

/**
 * T2: the #7558 correction lane's German frame (correctMain's book query, correctablePages restated), pages the lane has
 * not processed (its gex45 ledger) and the sampler has not judged; one page a book and the next 3 pages for the re-read.
 */
async function t2Draw() {
  const ledgerFile = path.join(OUT, 't2', 'correct-ledger.gex45.jsonl');
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  if (!fs.existsSync(ledgerFile)) { const r = spawnSync('scp', ['-q', `${GEX45}:/root/jobs/cli-ocr-correct/correct-ledger.jsonl`, ledgerFile]); if (r.status) throw new Error('scp ledger failed'); }
  const processed = new Set(jsonl(ledgerFile).map((r) => r.page_id));
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  await withDb(async (db) => {
    const judged = new Set((await db.collection('lane_judge_verdicts').find({}, { projection: { page_id: 1 } }).toArray()).map((r) => r.page_id));
    const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: /^German/ }, 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } }, { projection: { id: 1, title: 1, language: 1, year: 1, published: 1 } }).toArray();
    const rnd = makeRng(SEED.t2), order = shuffle(books.sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    const out = [], log = { frame_books: books.length, ledger_rows: processed.size, tried: 0, no_correctable: 0, short_block: 0 };
    for (const b of order) {
      if (out.length >= T2_CAP) break;
      log.tried++;
      const rows = await db.collection('pages').aggregate([
        { $match: { book_id: b.id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
        { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } } } },
        { $match: { n: { $gte: 300 }, hw: false } }, { $sort: { page_number: 1 } }]).toArray();
      const last = await lastPageNumber(db, b.id);
      const ok = rows.filter((p) => isInterior(p.page_number, last) && !processed.has(p.id) && !judged.has(p.id));
      if (!ok.length) { log.no_correctable++; continue; }
      const pick = ok[Math.floor(rnd() * ok.length)];
      const all = await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
      const i = all.findIndex((x) => x.id === pick.id);
      if (all.length < 4 || i < 0) { log.short_block++; continue; }
      const s = Math.min(i, all.length - 4);
      const p = all[i];
      out.push({ set: 't2', key: `T2-${p.id}`, page_id: p.id, book_id: b.id, page_number: p.page_number, title: String(b.title || '').slice(0, 80), language: b.language, year: yearOf(b), image: getPageSource(p), block: all.slice(s, s + 4).map((x) => x.id) });
    }
    W('t2/candidates.json', { at: new Date().toISOString(), seed: SEED.t2, log, candidates: out });
    console.log(JSON.stringify(log));
  });
}

/**
 * T3: DTA same-edition books (#6012, kgram-vote-v2) with a congruent page (our page = one typed page, both edges on the
 * typed page breaks) whose stored OCR is still a Flash-Lite read; one such page a book (>= 600 of our letters), seeded.
 * The reference is that typed page's body text (tei-pages-v1), fetched from the private R2 bucket.
 */
async function t3Draw() {
  const { getToFile } = await import('../typed-refs-6012/lib.mjs');
  const rows = gz(DTA('aligned-pages')).filter((r) => r.kind === 'same-edition' && r.congruent && r.our_letters >= 600);
  const man = new Map(gz(DTA('manifest')).map((m) => [m.source_id, m]));
  await withDb(async (db) => {
    const bookIds = [...new Set(rows.map((r) => r.book_id))].sort();
    const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, language: 1, year: 1, published: 1, visible: 1 } }).toArray()).map((b) => [b.id, b]));
    const rnd = makeRng(SEED.t3), order = shuffle(bookIds, rnd);
    const out = [], log = { books_same_edition_congruent: bookIds.length, tried: 0, no_lite_page: 0, missing_book: 0, ref_missing: 0 };
    const shardCache = new Map();
    const shard = async (key) => {
      if (!shardCache.has(key)) { const f = path.join(OUT, 't3', 'dta', path.basename(key)); fs.mkdirSync(path.dirname(f), { recursive: true }); if (!fs.existsSync(f)) await getToFile(key, f); shardCache.set(key, new Map(gz(f).map((r) => [r.source_id, r]))); }
      return shardCache.get(key);
    };
    for (const bid of order) {
      if (out.length >= T3_N) break;
      log.tried++;
      const b = books.get(bid); if (!b) { log.missing_book++; continue; }
      const mine = rows.filter((r) => r.book_id === bid).sort((x, y) => x.page_number - y.page_number);
      const pages = await db.collection('pages').find({ book_id: bid, page_number: { $in: mine.map((r) => r.page_number) }, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false } }, { projection: { ...PAGE_PROJ, 'ocr.data': 1, 'ocr.model': 1 } }).toArray();
      const lite = mine.filter((r) => pages.some((p) => p.page_number === r.page_number && getPageSource(p)));
      if (!lite.length) { log.no_lite_page++; continue; }
      const r = lite[Math.floor(rnd() * lite.length)];
      const p = pages.find((x) => x.page_number === r.page_number);
      const m = man.get(r.source_id);
      const typed = (await shard(m.derived_key)).get(r.source_id);
      const tp = typed?.pages?.[r.ref_page_idx[0]];
      if (!tp?.text) { log.ref_missing++; continue; }
      const all = await db.collection('pages').find({ book_id: bid, ...VISIBLE_PAGE_MATCH }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
      const i = all.findIndex((x) => x.id === p.id), s = Math.max(0, Math.min(i, all.length - 4));
      fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
      fs.writeFileSync(path.join(OUT, 'texts', `T3-${p.id}.lite.txt`), p.ocr.data);
      fs.writeFileSync(path.join(OUT, 'texts', `T3-${p.id}.ref.txt`), tp.text);
      out.push({ set: 't3', key: `T3-${p.id}`, page_id: p.id, book_id: bid, page_number: p.page_number, title: String(b.title || '').slice(0, 80), language: b.language, year: yearOf(b) ?? m.year ?? null, visible: !!b.visible, image: getPageSource(p),
        block: all.slice(s, s + 4).map((x) => x.id), lite_model: p.ocr.model, dta: { source_id: r.source_id, year: m.year, licence: m.licence_target ?? null, ref_page_idx: r.ref_page_idx, ref_facs: r.ref_facs, overlap: r.overlap, ref_notes: (tp.notes || []).length, ref_gaps: tp.gaps } });
    }
    // Word frequencies across the typed works of the frame's books (the name rule, lib.mjs nameErrors).
    const { wordKey } = await import('./lib.mjs');
    const freq = new Map();
    for (const sid of new Set(rows.map((r) => r.source_id))) {
      const typed = (await shard(man.get(sid).derived_key)).get(sid); if (!typed) continue;
      const keys = new Set(); for (const pg of typed.pages) for (const w of String(pg.text).split(/\s+/)) { const k = wordKey(w); if (k.length >= 3) keys.add(k); }
      for (const k of keys) freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    fs.writeFileSync(path.join(OUT, 't3', 'work-freq.json'), JSON.stringify(Object.fromEntries(freq)));
    W('t3/candidates.json', { at: new Date().toISOString(), seed: SEED.t3, log, works_in_freq: new Set(rows.map((r) => r.source_id)).size, candidates: out });
    console.log(JSON.stringify(log), `${out.length} pages`);
  });
}

/** Face tags in draw order, `--concurrency` at a time, until the set's strata are full (t4, t3: every candidate). */
async function tag() {
  const set = arg('set');
  const C = J(`${set}/candidates.json`).candidates;
  const file = path.join(OUT, set, 'tags.jsonl');
  const have = new Map(jsonl(file).filter((r) => r.tag).map((r) => [r.key, r]));
  const strata = set === 't1' ? T1_STRATA : set === 't2' ? T2_STRATA : null;
  const full = () => strata && Object.entries(strata).every(([f, n]) => C.filter((c) => have.get(c.key)?.tag.face === f).length >= n);
  const conc = Number(arg('concurrency') || 4);
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < C.length) {
      if (full()) { stop = 'strata full'; break; }
      const c = C[i++]; if (have.has(c.key)) continue;
      let img; try { img = await imageFor(c.key, c.image); } catch (e) { fs.appendFileSync(file, JSON.stringify({ key: c.key, tag: null, err: String(e.message).slice(0, 200), at: new Date().toISOString() }) + '\n'); continue; }
      const r = await agyFace(img);
      if (r.quota) { stop = `agy quota: ${r.err}`; break; }
      const row = { key: c.key, ...r, at: new Date().toISOString() };
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
      if (r.tag) have.set(c.key, row);
      console.log(`  ${c.key} ${r.tag?.face ?? 'unparsed'}`);
    }
  }));
  console.log(`tag ${set}: ${have.size} tagged; ${stop ?? 'queue done'}`);
}

/**
 * The strata, in draw order: T1 the first 40 Fraktur and the first 20 Antiqua candidates; T2 the first 40 Fraktur; T3
 * and T4 every candidate (T3 is reported by face). A candidate tagged in draw order after its stratum was full is not used.
 */
function select() {
  for (const set of ['t1', 't2', 't3', 't4']) {
    if (!fs.existsSync(path.join(OUT, set, 'candidates.json'))) continue;
    const C = J(`${set}/candidates.json`).candidates;
    const tags = new Map(jsonl(path.join(OUT, set, 'tags.jsonl')).filter((r) => r.tag).map((r) => [r.key, r.tag.face]));
    const strata = set === 't1' ? T1_STRATA : set === 't2' ? T2_STRATA : null;
    const got = {}, sel = [], seen = { fraktur: 0, antiqua: 0, mixed: 0, none: 0, untagged: 0 };
    for (const c of C) {
      const f = tags.get(c.key);
      if (!f) { seen.untagged++; continue; }
      seen[f]++;
      if (strata && !(strata[f] > (got[f] ?? 0))) continue;
      got[f] = (got[f] ?? 0) + 1;
      sel.push({ ...c, face: f });
      if (strata && Object.entries(strata).every(([k, n]) => (got[k] ?? 0) >= n)) break;
    }
    W(`${set}/selected.json`, { at: new Date().toISOString(), strata, seen_until_full: seen, selected: sel });
    console.log(`${set}: ${sel.length} selected ${JSON.stringify(got)}; tags seen ${JSON.stringify(seen)}`);
  }
}

const stages = { 't4-draw': t4Draw, 't1-draw': t1Draw, 't2-draw': t2Draw, 't3-draw': t3Draw, tag, select };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
