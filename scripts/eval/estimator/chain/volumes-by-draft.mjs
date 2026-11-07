#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/planner/volumes.mjs (live pages per LANGUAGE from `books` counters, read-weighted;
// no page scan, so it cannot say which engine drafted the pages a corrector would start from) and the #6688 routing
// census (a one-off 150-books-per-language page count by ocr.model). Estimator v2 (#6740) keys correction cells by the
// DRAFT engine, so it needs pages per book x stored ocr.model; this counts them, read-only.
/**
 * Pages per live book x draft engine, for the chained-route allocation (#6740). Read-only; secondary reads.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/chain/volumes-by-draft.mjs \
 *     --langs=Latin,Chinese,Tibetan --out=$JOB_SCRATCH/volumes-by-draft.jsonl
 * One output line per (book, draft bucket): book id, language, book read_count, pages, page read_count sum, and for
 * Chinese the Kanripo screen bucket and whether the page came from the guarded Paddle apply (#6871).
 * Live = visible && pages_count > 0 (the canonical filter). A page with no OCR is bucket `none`.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (n) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out');
const langs = (arg('langs') || 'Latin,Chinese,Tibetan').split(',');
if (!out) { console.error('--out=FILE required'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const fd = fs.openSync(out, 'a');
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).book_id) : []);

const bucket = {
  $switch: {
    branches: [
      { case: { $not: ['$ocr.model'] }, then: 'none' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /flash-lite/ } }, then: 'lite' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /paddle/i } }, then: 'paddle' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /yigdzin/i } }, then: 'yigdzin' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /^gemini-3-flash/ } }, then: 'flash3' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /^claude/ } }, then: 'claude' },
      { case: { $regexMatch: { input: '$ocr.model', regex: /antigravity|gemini-3\.[678]|gemini-4/ } }, then: 'agy' },
    ],
    default: 'other',
  },
};
const dice = {
  $switch: {
    branches: [
      { case: { $not: [{ $isNumber: '$ocr.qa_screen.dice' }] }, then: 'none' },
      { case: { $lt: ['$ocr.qa_screen.dice', 0.9] }, then: 'lt0.90' },
      { case: { $lt: ['$ocr.qa_screen.dice', 0.95] }, then: '0.90-0.95' },
    ],
    default: 'ge0.95',
  },
};

for (const language of langs) {
  const books = await db.collection('books').find({ language, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } },
    { projection: { id: 1, read_count: 1 } }).toArray();
  const rc = new Map(books.map(b => [b.id, b.read_count || 0]));
  const todo = books.map(b => b.id).filter(id => !done.has(id));
  console.error(`${language}: ${books.length} books with OCR, ${todo.length} to count`);
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i += 200) {
    const ids = todo.slice(i, i + 200);
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids } } },
      { $group: { _id: { b: '$book_id', d: bucket, k: language === 'Chinese' ? dice : 'na',
        g: { $eq: ['$ocr.pipeline', 'paddle-zh-guarded-2026-10'] }, w: { $gt: ['$translation_withheld', null] } },
        pages: { $sum: 1 }, page_reads: { $sum: { $ifNull: ['$read_count', 0] } } } }],
      { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
    fs.writeSync(fd, rows.map(r => JSON.stringify({ book_id: r._id.b, language, book_reads: rc.get(r._id.b), draft: r._id.d,
      dice: r._id.k, zh_guarded: r._id.g, withheld: r._id.w, pages: r.pages, page_reads: r.page_reads })).join('\n') + (rows.length ? '\n' : ''));
    if ((i / 200) % 10 === 0) console.error(`  ${language} ${i + ids.length}/${todo.length} books, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
fs.closeSync(fd);
await client.close();
console.error('done');
