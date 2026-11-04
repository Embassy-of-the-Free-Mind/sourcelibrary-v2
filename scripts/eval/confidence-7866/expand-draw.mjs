#!/usr/bin/env node
// PRIOR ART: ./frame.mjs draw() (the live frame FRAME, eligiblePage, imageUrl, seeded shuffles) — it draws by confidence
// stratum, five pages a book; this draws uniform within language × script, one page a book, and tops up to a target.
// scripts/eval/severity-cal-7263/draw.mjs (#8136, not on main: its rules are restated) — one page a book from live
// Sanskrit, book_class 'handwritten' as the manuscript test; its 30 Sanskrit stored reads are reused here, not redrawn.
/**
 * #7263 judged-expand (scripts/eval/experiments/2026-11-04-judged-expand-prereg-7263.md): the frame and the draw.
 * Read-only on Mongo, no model calls.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/confidence-7866/expand-draw.mjs frame
 *        live books by language × script, the books already judged in each cell, the allocation → OUT/frame.json
 *   ... expand-draw.mjs draw     the seeded draw, one body page a book, stored text frozen → OUT/sample.json
 *                                (refuses to draw over an existing sample)
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { FRAME, eligiblePage, imageUrl, SKIP_TYPES } from './lib.mjs';
import { isVisiblePage, hasOcr } from '../../lib/page-counts.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { EX_OUT as OUT, EX_SEED, TARGET, MIN_LIVE, NO_TOPUP, SEV_CAL_DIR, LANG_ALIAS, bookScripts, shuffle, sha } from './expand-lib.mjs';

const c = new MongoClient(process.env.MONGODB_URI);
const db = () => c.db('bookstore');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };

/** Books already judged: #7866's 160 (lane_judge_verdicts, live rows) and severity-cal-7263's 60 (its sample file). */
async function judgedBefore() {
  const rows = await db().collection('lane_judge_verdicts').find(verdictQuery({ lane: 'confidence-7866', kind: 'item' }), { projection: { book_id: 1 } }).toArray();
  const c7866 = new Set(rows.map((r) => String(r.book_id)));
  const sev = JSON.parse(fs.readFileSync(path.join(SEV_CAL_DIR, 'sample.json'), 'utf8'));
  return { c7866, sev: new Map(sev.map((s) => [s.book_id, s.lang])) };
}

async function frame() {
  const live = await db().collection('books').aggregate([{ $match: { visible: true, pages_count: { $gt: 0 } } }, { $group: { _id: '$language', n: { $sum: 1 } } }]).toArray();
  // An ISO code stored as the language (fr, it, ar ...) is the same language as its name: counted and drawn under it.
  const liveBy = {}, labels = {};
  for (const r of live) { const L = LANG_ALIAS[r._id] ?? r._id ?? '(none)'; liveBy[L] = (liveBy[L] ?? 0) + r.n; (labels[L] ??= []).push(r._id); }
  const langs = Object.keys(liveBy).filter((L) => liveBy[L] >= MIN_LIVE).sort((a, b) => liveBy[b] - liveBy[a]);
  const books = (await db().collection('books').find({ ...FRAME, language: { $in: langs.flatMap((L) => labels[L]) } }, { projection: { id: 1, _id: 1, language: 1, 'book_class.class': 1 } }).toArray())
    .map((b) => ({ ...b, label: b.language, language: LANG_ALIAS[b.language] ?? b.language }));
  const scripts = await bookScripts(db(), books);
  const { c7866, sev } = await judgedBefore();
  // 7866 rows carry the book's _id string; a book is "already judged" if either id matches.
  const was7866 = (b) => c7866.has(b.id) || c7866.has(String(b._id));
  const cells = {};
  for (const b of books) {
    const s = scripts.get(b.id).script, k = `${b.language}|${s}`;
    const e = (cells[k] ??= { language: b.language, script: s, frame_books: 0, judged_7866: 0, judged_sevcal: 0, basis: {}, pool: [] });
    e.frame_books++; e.basis[scripts.get(b.id).basis] = (e.basis[scripts.get(b.id).basis] ?? 0) + 1;
    if (was7866(b)) e.judged_7866++;
    else if (sev.has(b.id)) { if (sev.get(b.id) === 'sa' && s === 'print') e.judged_sevcal++; }
    else e.pool.push(b.id);
  }
  for (const e of Object.values(cells)) {
    const have = e.judged_7866 + e.judged_sevcal;
    e.target = e.script === 'unclassified' ? 0 : TARGET;
    e.no_topup = NO_TOPUP.includes(`${e.language}|${e.script}`) || null;
    e.need = e.script === 'unclassified' || e.no_topup ? 0 : Math.max(0, Math.min(TARGET - have, e.pool.length));
    e.pool_books = e.pool.length;
  }
  const out = {
    at: new Date().toISOString(), seed: EX_SEED, min_live: MIN_LIVE, target: TARGET,
    live_books_by_language: liveBy,
    languages: langs, labels_merged: Object.fromEntries(Object.entries(labels).filter(([, v]) => v.length > 1)),
    too_few: Object.entries(liveBy).filter(([, n]) => n < MIN_LIVE && n >= 10).sort((a, b) => b[1] - a[1]).map(([language, live_books]) => ({ language, live_books })),
    cells: Object.values(cells).sort((a, b) => b.frame_books - a.frame_books).map(({ pool, ...e }) => e),
    pages_to_draw: Object.values(cells).reduce((a, e) => a + e.need, 0),
  };
  W('frame.json', { ...out, pools: Object.fromEntries(Object.entries(cells).map(([k, e]) => [k, e.pool])) });
  for (const e of out.cells) console.log(`${`${e.language} / ${e.script}`.padEnd(32)} frame ${String(e.frame_books).padStart(6)}  7866 ${String(e.judged_7866).padStart(3)}  sevcal ${String(e.judged_sevcal).padStart(2)}  draw ${e.need}${e.no_topup ? ' (no top-up)' : ''}`);
  console.log(`pages to draw: ${out.pages_to_draw}`);
}

const PROJ = { id: 1, book_id: 1, page_number: 1, repeat_of: 1, page_type: 1, hidden: 1, split_into: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.unreadable': 1, 'ocr.edited_by': 1, 'ocr.updated_at': 1,
  display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };
const TAG_TYPE = /<page-type>\s*([a-z-]+)\s*<\/page-type>/i;
/** A body page a reader can open: served (page_number > 0, not a repeat capture), not a plate / blank / front matter by
 *  its page_type or its own OCR tag, not hidden or split, with an image. Its text may be missing: that page counts. */
const bodyPage = (p) => isVisiblePage(p) && !SKIP_TYPES.includes(p.page_type) && !SKIP_TYPES.includes(String(p.ocr?.data ?? '').match(TAG_TYPE)?.[1]?.toLowerCase()) && !p.hidden && !p.split_into && Boolean(imageUrl(p));

async function draw() {
  if (fs.existsSync(path.join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);
  const F = J('frame.json');
  const sample = [], log = [];
  for (const cell of F.cells.filter((e) => e.need > 0)) {
    const key = `${cell.language}|${cell.script}`, rng = makeRng(EX_SEED + [...key].reduce((a, ch) => (Math.imul(a, 31) + ch.codePointAt(0)) | 0, 0));
    const books = await db().collection('books').find({ id: { $in: F.pools[key] } }, { projection: { id: 1, _id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1 } }).toArray();
    let got = 0;
    for (const b of shuffle(books.sort((x, y) => (x.id < y.id ? -1 : 1)), rng)) {
      if (got >= cell.need) break;
      const pages = await db().collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
      const body = pages.filter(bodyPage);
      if (!body.length) { log.push({ cell: key, book_id: b.id, skipped: 'no body page with an image' }); continue; }
      const p = body[Math.floor(rng() * body.length)];
      const served = hasOcr(p) ? p.ocr.data : '';
      got++;
      sample.push({ cell: key, language: cell.language, script: cell.script, book_id: b.id, book_oid: String(b._id), title: String(b.title ?? '').slice(0, 160), year: b.year ?? null, published: b.published ?? null,
        body_pages: body.length, page_id: p.id, page_number: p.page_number, page_script_type: p.script_type ?? null, image: imageUrl(p), eligible_7866: eligiblePage(p),
        stored: served, stored_sha: sha(served), words: words(served), served_state: hasOcr(p) ? 'text' : p.ocr?.unreadable ? 'unreadable: not served' : typeof p.ocr?.data === 'string' ? 'empty' : 'no OCR',
        model: p.ocr?.model ?? null, pipeline: p.ocr?.pipeline ?? null, source: p.ocr?.source ?? null, human_edited: Boolean(p.ocr?.edited_by || p.ocr?.source === 'manual') });
    }
    log.push({ cell: key, drawn: got, need: cell.need });
    console.log(`${key}: ${got}/${cell.need}`);
  }
  W('sample.json', sample);
  W('draw-log.json', log);
  const st = {}; for (const s of sample) st[s.served_state] = (st[s.served_state] ?? 0) + 1;
  console.log(`sample: ${sample.length} pages ${JSON.stringify(st)} → ${OUT}`);
}

const stages = { frame, draw };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await c.connect();
try { await stages[process.argv[2]](); } finally { await c.close(); }
