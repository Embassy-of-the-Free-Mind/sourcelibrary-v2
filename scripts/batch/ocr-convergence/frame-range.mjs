#!/usr/bin/env node
// PRIOR ART: ./driver.mjs frame (ranks books by readers itself; this only slices the saved queue) and the hand-built
// q300/frame.json of #6694 (ranks 201-300 minus lane_block, no file that made it). Neither drops held or Greek books.
// #6694 step 2: one run dir per 100 queue ranks. frame.json = non-Greek books in the range, minus lane_block and
// held books (pipeline_auto.hold); greek-lane-a.json = the Greek ones, left for lane A (Gemini read + Opus adjudication).
//   node --env-file=.env.production.local scripts/batch/ocr-convergence/frame-range.mjs <lo> <hi> <runDir>
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const [lo, hi, dir] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const q = JSON.parse(fs.readFileSync(new URL('./results/run/queue-next-1000.json', import.meta.url), 'utf8'));
const inRange = q.books.filter((b) => b.rank >= lo && b.rank <= hi);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const held = new Map((await c.db('bookstore').collection('books').find({ id: { $in: inRange.map((b) => b.book_id) }, 'pipeline_auto.hold': { $exists: true } }, { projection: { id: 1, 'pipeline_auto.hold.reason': 1 } }).toArray()).map((b) => [b.id, b.pipeline_auto.hold.reason]));
await c.close();
const skipped = [];
const keep = [], greek = [];
for (const b of inRange) {
  if (b.lane_block) { skipped.push({ ...b, skip: `lane_block: ${b.lane_block}` }); continue; }
  if (held.has(b.book_id)) { skipped.push({ ...b, skip: `held: ${held.get(b.book_id)}` }); continue; }
  (b.group === 'greek' ? greek : keep).push(b);
}
fs.mkdirSync(dir, { recursive: true });
const at = new Date().toISOString();
fs.writeFileSync(`${dir}/frame.json`, JSON.stringify({ built_at: at, source: `queue-next-1000.json ranks ${lo}-${hi} minus lane_block, held books and Greek (#6694 step 2, job opus-route-6694)`, books: keep }));
fs.writeFileSync(`${dir}/greek-lane-a.json`, JSON.stringify({ built_at: at, note: 'Greek books in this range: Derek 2026-10-14 (#6694) keeps Greek on lane A (Gemini 3.8 Flash read + Opus adjudication); not read by arm B. Hold state as of built_at.', books: greek }, null, 1));
fs.writeFileSync(`${dir}/skipped-books.json`, JSON.stringify(skipped, null, 1));
console.log(`ranks ${lo}-${hi}: ${inRange.length} books; arm B ${keep.length}; Greek ${greek.length}; skipped ${skipped.length} (${skipped.map((s) => s.skip.split(':')[0]).join(', ')})`);
