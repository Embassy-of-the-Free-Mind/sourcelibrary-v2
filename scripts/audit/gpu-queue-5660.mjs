#!/usr/bin/env node
// gpu-queue-5660.mjs — what OCR is still owed to a GPU lane, for the standing GEX45 box (#5660). Read-only.
//
// PRIOR ART: the gpu-backlog-5660 recount (#5660 comment 2026-10-06, files under /root/gpu-backlog-5660/, never
// committed) and scripts/eval/results/yigdzin-rest-4523/ (#6717, Tibetan only). Neither is a reusable script;
// this one re-derives the per-lane queue from the book counters, then checks the held sets page by page.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/gpu-queue-5660.mjs [--json out.json]
//
// "Owed" = pages_count − pages_ocr on the book (the counter the lanes recount after a write), and, for the held
// cohorts below, a page with no `ocr.data` counted directly on `pages`. Heads and counts only.
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const LANGS = ['Tibetan', 'Japanese', 'Mongolian', 'Manchu', 'Chinese', 'Classical Chinese', 'Syriac', 'Persian', 'Sanskrit', 'Javanese'];
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const R = { at: new Date().toISOString(), by_language: {}, held: {}, checks: {} };

// 1. per language: owed pages by visibility, book class and hold reason (counters)
for (const language of LANGS) {
  const rows = await books.aggregate([
    { $match: { language, pages_count: { $gt: 0 } } },
    { $project: { visible: 1, cls: '$book_class.class', hold: '$pipeline_auto.hold.reason',
      owed: { $max: [0, { $subtract: ['$pages_count', { $ifNull: ['$pages_ocr', 0] }] }] } } },
    { $match: { owed: { $gt: 0 } } },
    { $group: { _id: { visible: { $eq: ['$visible', true] }, cls: '$cls', hold: '$hold' }, books: { $sum: 1 }, owed: { $sum: '$owed' } } },
    { $sort: { owed: -1 } },
  ]).toArray();
  const tot = rows.reduce((a, r) => ({ books: a.books + r.books, owed: a.owed + r.owed }), { books: 0, owed: 0 });
  R.by_language[language] = { ...tot, rows: rows.map(r => ({ visible: r._id.visible, class: r._id.cls ?? null, hold: r._id.hold ?? null, books: r.books, owed: r.owed })) };
  console.log(`\n== ${language}: ${tot.owed} owed pages in ${tot.books} books`);
  for (const r of rows.slice(0, 12)) console.log(`  ${String(r.owed).padStart(8)} pp ${String(r.books).padStart(5)} bk  ${r._id.visible ? 'live  ' : 'hidden'} ${r._id.cls ?? '-'} | ${r._id.hold ?? '-'}`);
}

// 2. the held Chinese cohort (#5660): unread pages counted on `pages`
const held = await books.find({ 'pipeline_auto.hold.reason': 'gpu-backlog-5660' }, { projection: { _id: 1, id: 1, title: 1 } }).toArray();
const ids = held.map(b => String(b.id ?? b._id));
let unread = 0;
for (let i = 0; i < ids.length; i += 200) unread += await pages.countDocuments({ book_id: { $in: ids.slice(i, i + 200) }, 'ocr.data': { $exists: false } });
R.held['gpu-backlog-5660'] = { books: held.length, pages_without_ocr: unread };
console.log(`\n== held gpu-backlog-5660: ${held.length} books, ${unread} pages with no ocr.data`);

// 3. the 372 Paddle pages reverted on 2026-10-10: still empty?
const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1 } }).toArray();
const pids = [...new Set(rev.map(r => String(r.page_id)))];
let stillEmpty = 0;
for (let i = 0; i < pids.length; i += 500) stillEmpty += await pages.countDocuments({ id: { $in: pids.slice(i, i + 500) }, 'ocr.data': { $exists: false } });
R.checks.reverted_paddle_5660 = { revisions: rev.length, pages: pids.length, still_without_ocr: stillEmpty };
console.log(`== reverted Paddle pages (revert-paddle-5660): ${pids.length} pages, ${stillEmpty} still without ocr.data`);

if (out) writeFileSync(out, JSON.stringify(R, null, 1));
await c.close();
