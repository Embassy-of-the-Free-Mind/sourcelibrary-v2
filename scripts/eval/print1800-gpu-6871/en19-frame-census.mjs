#!/usr/bin/env node
// PRIOR ART: scripts/eval/print1800-gpu-6871/fr-refusal-frame.mjs (a read-only frame count for this lane family) and
// scripts/workers/gpu-print-lane.mjs `frame` (English 1800+, visible, held scans-only or --free) — neither applies the
// euro cell's book rule (armcEuroSkip: holds, manuscripts, the books gpu-print-en planned) nor counts by hold reason.
/**
 * en19-frame-census.mjs — #6871: the English 1800-1929 frame of `cli-ocr-lane.mjs armc --frame=euro --cell=en19`,
 * READ-ONLY. Every English book with a parsed year 1800-1929 and page records, the reason the cell leaves it out
 * (armcEuroSkip) or `in`, and its owed pages (UNREAD, no human edit: armcEuroPages without the spread check), by hold
 * reason and pipeline status. Also counts the English books the cell never sees: manifest-only, and no/other year.
 *   node --env-file=/root/sourcelibrary/.env.production.local en19-frame-census.mjs --out=FILE.json
 * Run on gex45 (the gpu-print-en plan dir the cell reads lives there).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { armcEuroSkip, UNREAD } from '../../batch/cli-ocr-lane.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const all = await db.collection('books').find({ language: { $regex: '^English' }, pages_count: { $gt: 0 } },
  { projection: { _id: 0, id: 1, title: 1, language: 1, year: 1, published: 1, visible: 1, pages_count: 1, pages_ocr: 1, image_source: 1, needs_splitting: 1, split_completed: 1, pages_state: 1, pipeline_auto: 1 } }).toArray();
const t = { english_books: all.length, outside: {}, skip: {}, in: { books: 0, owed: 0, by_hold: {}, by_status: {}, by_visible: {} }, skipped_owed: {} };
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const cand = [];
for (const b of all) {
  const y = b.year;
  if (typeof y !== 'number' || !Number.isFinite(y)) { bump(t.outside, 'no parsed year', b.pages_count); continue; }
  if (y < 1800) { bump(t.outside, 'before 1800', b.pages_count); continue; }
  if (y > 1929) { bump(t.outside, 'after 1929', b.pages_count); continue; }
  if ((b.pages_ocr ?? 0) >= b.pages_count) { bump(t.outside, '1800-1929, every page read', 0); continue; }
  cand.push(b);
}
// owed pages per candidate book (the cell's page rule less the spread check)
const owed = new Map();
for (let i = 0; i < cand.length; i += 300) {
  const ids = cand.slice(i, i + 300).map((b) => b.id);
  for (const r of await db.collection('pages').aggregate([{ $match: { book_id: { $in: ids }, ...UNREAD, 'ocr.edited_by': { $exists: false }, 'ocr.edited_at': { $exists: false }, 'ocr.source': { $ne: 'manual' } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }], { allowDiskUse: true }).toArray()) owed.set(r._id, r.n);
}
const inBooks = [];
for (const b of cand) {
  const n = owed.get(b.id) ?? 0;
  if (['manifest_only', 'materializing'].includes(b.pages_state?.state)) { bump(t.outside, 'manifest-only (pages_count)', b.pages_count); continue; }
  if (!n) { bump(t.skip, 'nothing owed'); continue; }
  const why = armcEuroSkip(b, 'en19');
  if (why) { bump(t.skip, why); bump(t.skipped_owed, why.replace(/\(.*\)/, (m) => m), n); continue; }
  t.in.books++; t.in.owed += n;
  bump(t.in.by_hold, b.pipeline_auto?.hold?.reason ?? 'none', n);
  bump(t.in.by_status, b.pipeline_auto?.status ?? 'none', n);
  bump(t.in.by_visible, b.visible ? 'visible' : 'hidden', n);
  inBooks.push({ bid: b.id, year: b.year, owed: n, hold: b.pipeline_auto?.hold?.reason ?? null, status: b.pipeline_auto?.status ?? null, visible: !!b.visible });
}
await c.close();
const res = { built_at: new Date().toISOString(), tally: t, books: inBooks };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(t, null, 1));
