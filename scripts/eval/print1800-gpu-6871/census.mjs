#!/usr/bin/env node
// PRIOR ART: scripts/audit/gpu-queue-5660.mjs (counts OCR owed per language for the whole backlog, no period split, no
// refusal split); scripts/eval/euro-gpu-correct-7567/e5-draw.mjs (the lite-draft page filter, copied: LITE_MODELS).
/**
 * census.mjs — #6871: 1800+ European print, by language. Per language (the edition's `language`, prefix match) and
 * period (1800–1849, 1850–1899, 1900+ by `books.year`), counts books and pages in four states:
 *   none     no OCR text (ocr.data missing/empty/whitespace) and no refusal stamp
 *   refused  no text with a refusal/failure stamp (recitation_count > 0, recitation_blocked, fail_blocked, fail_reason)
 *   lite     stored text whose ocr.model is Flash-Lite
 *   other    stored text by any other engine (Flash, IA, MinerU, human …)
 * Read-only. Visible and hidden books both count (a hidden book is still owed OCR); `visible` is split out.
 *   node --env-file=.env.production.local census.mjs --out=$JOB_SCRATCH/census.json
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { LITE_MODELS } from '../../batch/cli-ocr-lane.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const LANGS = { en: 'English', de: 'German', fr: 'French', it: 'Italian', la: 'Latin', nl: 'Dutch', es: 'Spanish' };
const period = (y) => (y < 1850 ? '1800-1849' : y < 1900 ? '1850-1899' : '1900+');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const out = { measured_at: new Date().toISOString(), cells: {} };
for (const [lang, L] of Object.entries(LANGS)) {
  const books = await db.collection('books').find({ language: { $regex: `^${L}` }, year: { $gte: 1800, $lte: 2030 } },
    { projection: { _id: 0, id: 1, year: 1, visible: 1, pages_count: 1 } }).toArray();
  const byId = new Map(books.map((b) => [b.id, b]));
  const ids = books.map((b) => b.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 400) {
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids.slice(i, i + 400) } } },
      { $project: { _id: 0, book_id: 1,
        txt: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $gt: [{ $strLenCP: { $trim: { input: '$ocr.data' } } }, 0] }, false] },
        lite: { $in: [{ $ifNull: ['$ocr.model', ''] }, LITE_MODELS] },
        ref: { $or: [{ $gt: [{ $ifNull: ['$ocr.recitation_count', 0] }, 0] }, { $eq: ['$ocr.recitation_blocked', true] }, { $eq: ['$ocr.fail_blocked', true] }, { $cond: [{ $eq: [{ $type: '$ocr.fail_reason' }, 'string'] }, { $gt: [{ $strLenCP: '$ocr.fail_reason' }, 0] }, false] }] } } },
      { $group: { _id: { b: '$book_id', s: { $cond: ['$txt', { $cond: ['$lite', 'lite', 'other'] }, { $cond: ['$ref', 'refused', 'none'] }] } }, n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    for (const r of rows) {
      const b = byId.get(r._id.b); const k = `${lang}|${period(b.year)}|${b.visible ? 'visible' : 'hidden'}`;
      const cell = (out.cells[k] ??= { books: new Set(), none: 0, refused: 0, lite: 0, other: 0, books_owed: new Set() });
      cell.books.add(r._id.b); cell[r._id.s] += r.n; if (r._id.s === 'none' || r._id.s === 'refused') cell.books_owed.add(r._id.b);
    }
  }
  console.error(`${lang}: ${books.length} books`);
}
for (const v of Object.values(out.cells)) { v.books = v.books.size; v.books_owed = v.books_owed.size; }
await c.close();
fs.writeFileSync(arg('out', '/dev/stdout'), JSON.stringify(out, null, 1));
const T = Object.entries(out.cells).sort();
console.log('cell\tbooks\tbooks_owed\tnone\trefused\tlite\tother');
for (const [k, v] of T) console.log([k, v.books, v.books_owed, v.none, v.refused, v.lite, v.other].join('\t'));
