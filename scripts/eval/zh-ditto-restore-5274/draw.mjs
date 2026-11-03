#!/usr/bin/env node
// PRIOR ART: scripts/audit/headword-mark-drop.mjs (the page-level 丨 census: per-1k rule, flags pages, draws nothing;
// this frame is the brief's: zero 丨 and ≥ 300 Han, three families) and scripts/eval/paddle-correct-6561/draw.mjs
// (draws from a census file over a different frame, the withheld table pages).
/**
 * zh-ditto-restore-5274/draw.mjs — the frame and the seeded draw (READ-ONLY on Mongo).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-ditto-restore-5274/draw.mjs [--exclude=<page ids file>]
 *
 * Frame: live books titled 佩文韻府 | 韻府拾遺 | 駢字類編, pages with ocr.source paddle and ≥ 300 body Han characters.
 * 30 pages with no 丨 at all (one per book) + 5 control pages that keep ≥ 5 丨 (books not in the 30). Seed 5274.
 * Writes results/frame.json, results/draw.json; the per-page census goes to $JOB_SCRATCH/census.jsonl.gz.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { bodyHanCount } from '../../lib/paddle-zh-lane.mjs';
import { isHeld } from '../../lib/pipeline-hold.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '../results/zh-ditto-restore-5274'); fs.mkdirSync(RES, { recursive: true });
const SEED = 5274, N = 30, N_CTRL = 5, MIN_HAN = 300, MIN_CTRL_MARKS = 5;
const FAM = /佩文韻府|韻府拾遺|駢字類編/;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const exclude = new Set(arg('exclude') ? fs.readFileSync(arg('exclude'), 'utf8').split('\n').filter(Boolean) : []);
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const count = (s, re) => (s.match(re) || []).length;

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, title: { $regex: FAM.source } },
  { projection: { _id: 0, id: 1, title: 1, ia_identifier: 1, 'pipeline_auto.hold': 1 } }).sort({ id: 1 }).toArray();
const rows = [];
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < books.length) {
    const b = books[next++];
    const ps = await db.collection('pages').find({ book_id: b.id, 'ocr.source': 'paddle' },
      { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.pipeline': 1, 'ocr.qa_screen.status': 1, 'ocr.qa_screen.dice': 1, 'ocr.qa_screen.pb': 1, 'translation.data': 1, 'translation.source': 1, 'translation.model': 1, translation_withheld: 1, image_width: 1, image_height: 1, photo_original: 1, archived_photo: 1 } }).toArray();
    for (const p of ps) {
      const t = String(p.ocr?.data || '');
      const han = bodyHanCount(t);
      if (han < MIN_HAN) continue;
      rows.push({ pid: p.id, bid: b.id, pn: p.page_number, fam: b.title.match(FAM)[0], han, marks: count(t, /丨/g), alt: count(t, /[｜|│┃〡]/g),
        pipeline: p.ocr?.pipeline ?? null, qa: p.ocr?.qa_screen?.status ?? null, dice: p.ocr?.qa_screen?.dice ?? null, pb: p.ocr?.qa_screen?.pb ?? null,
        translated: Boolean(p.translation?.data), tr_model: p.translation?.model ?? null, w: p.image_width ?? null, h: p.image_height ?? null, ia: p.photo_original ?? null, r2: p.archived_photo ?? null, held: isHeld(b) });
    }
    if (next % 200 === 0) console.error(next, 'books', rows.length, 'pages');
  }
}));
const heldBooks = new Set(books.filter((b) => isHeld(b)).map((b) => b.id));
rows.sort((a, b) => (a.pid < b.pid ? -1 : 1));
await c.close();
const out = process.env.JOB_SCRATCH || '.';
fs.writeFileSync(path.join(out, 'census.jsonl.gz'), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));

const zero = rows.filter((r) => r.marks === 0);
const tally = (xs, f) => { const o = {}; for (const x of xs) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };
const wide = (r) => (!r.w ? 'unknown' : r.w < 1000 ? '<1000 px' : r.w < 1500 ? '1000-1499 px' : '≥1500 px');
const frame = {
  date: new Date().toISOString().slice(0, 10), books_live: books.length, books_with_paddle_body_pages: new Set(rows.map((r) => r.bid)).size, held_books: heldBooks.size,
  body_pages: rows.length, zero_pages: zero.length, zero_books: new Set(zero.map((r) => r.bid)).size,
  zero_with_alt_bar_forms: zero.filter((r) => r.alt > 0).length, zero_translated: zero.filter((r) => r.translated).length, zero_held: zero.filter((r) => r.held).length,
  zero_by_family: tally(zero, (r) => r.fam), body_by_family: tally(rows, (r) => r.fam), zero_by_pipeline: tally(zero, (r) => r.pipeline), body_by_pipeline: tally(rows, (r) => r.pipeline),
  zero_by_stored_width: tally(zero, wide), keep_by_stored_width: tally(rows.filter((r) => r.marks > 0), wide),
  zero_by_qa: tally(zero, (r) => r.qa), mean_marks_on_keep_pages: rows.filter((r) => r.marks > 0).reduce((a, r) => a + r.marks, 0) / Math.max(1, rows.filter((r) => r.marks > 0).length),
};
fs.writeFileSync(path.join(RES, 'frame.json'), JSON.stringify(frame, null, 1));
console.log(frame);

const pick = (pool, n, seed, used) => { const got = []; for (const r of shuffle(pool, seed)) { if (got.length >= n) break; if (used.has(r.bid) || exclude.has(r.pid)) continue; used.add(r.bid); got.push(r); } return got; };
const used = new Set();
const main = pick(zero, N, SEED, used);
const ctrl = pick(rows.filter((r) => r.marks >= MIN_CTRL_MARKS), N_CTRL, SEED + 1, used);
const draw = [...main.map((r) => ({ ...r, set: 'zero' })), ...ctrl.map((r) => ({ ...r, set: 'keep' }))].map((r) => ({ ...r, slug: `${r.set}-${r.bid.slice(-8)}-p${r.pn}` }));
fs.writeFileSync(path.join(RES, 'draw.json'), JSON.stringify({ seed: SEED, min_han: MIN_HAN, min_ctrl_marks: MIN_CTRL_MARKS, excluded_pages: exclude.size, pages: draw }, null, 1));
console.log(tally(draw, (r) => `${r.set}:${r.fam}`));
