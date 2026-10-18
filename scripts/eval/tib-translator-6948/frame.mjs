#!/usr/bin/env node
// PRIOR ART: scripts/eval/experiments/2026-10-14-yigdzin-rest-withheld-and-unread-tibetan-4523.md (its scope-rest.mjs
// selects pages to READ, on the job box, not in the repo); #6948's table (counted by the mongol-kanjur-reader session,
// no script committed). Nothing in the repo enumerates the pages that have a good Tibetan transcription and no English.
/**
 * frame.mjs — read-only, $0. The #6948 translation frame: pages on public Tibetan books (`language` starts with
 * "Tibetan", `visible: true`, `pages_count > 0`) with no `translation.data` and EITHER a Yigdzin transcription
 * (`ocr.model: bdrc-yigdzin-v1`), split by `translation_withheld.reason` (unverified_script_ocr / stale_after_reocr /
 * none), OR the Derge Kangyur typed text (`ocr.pipeline: derge-kangyur-import-5665`).
 * Writes $JOB_SCRATCH/frame.jsonl (one row per frame page, no text) and prints the counts.
 *   node --env-file=<main>/.env.production.local scripts/eval/tib-translator-6948/frame.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const S = process.env.JOB_SCRATCH;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { language: /^\s*tibetan\b/i, visible: true, pages_count: { $gt: 0 } },
  { projection: { _id: 0, id: 1, title: 1, display_title: 1, language: 1, pages_count: 1, collections: 1, 'image_source.provider': 1 } },
).toArray();
const out = fs.createWriteStream(`${S}/frame.jsonl`);
const counts = {}; const allPages = { n: 0 };
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
let i = 0;
for (const b of books) {
  i++;
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: b.id } },
    { $project: {
      _id: 0, id: 1, page_number: 1, model: '$ocr.model', pipeline: '$ocr.pipeline', unreadable: '$ocr.unreadable',
      has_tr: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
      wr: '$translation_withheld.reason', wmodel: '$translation_withheld.model',
      olen: { $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } },
      tsheg: { $size: { $split: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, '་'] } },
    } },
  ]).toArray();
  allPages.n += rows.length;
  for (const p of rows) {
    if (p.has_tr) continue;
    let cell = null;
    if (p.model === 'bdrc-yigdzin-v1') cell = p.wr === 'unverified_script_ocr' ? 'Y_unverified' : p.wr === 'stale_after_reocr' ? 'Y_stale' : p.wr ? `Y_other:${p.wr}` : 'Y_none';
    else if (p.pipeline === 'derge-kangyur-import-5665') cell = p.wr ? `D_withheld:${p.wr}` : 'D_none';
    if (!cell) continue;
    bump(cell);
    out.write(JSON.stringify({ cell, book_id: b.id, title: b.display_title || b.title, page_id: p.id, page_number: p.page_number, wr: p.wr || null, wmodel: p.wmodel || null, olen: p.olen, tsheg: p.tsheg - 1, unreadable: !!p.unreadable }) + '\n');
  }
  if (i % 200 === 0) console.error(i, '/', books.length, JSON.stringify(counts));
}
out.end();
fs.writeFileSync(`${S}/frame-books.json`, JSON.stringify(books));
console.log(JSON.stringify({ books: books.length, pages: allPages.n, counts, at: new Date().toISOString() }));
await c.close();
