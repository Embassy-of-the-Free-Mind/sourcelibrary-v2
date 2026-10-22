#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/backlog-manifest.mjs (the same Latin frame: language regex, duplicate_of
// excluded, century = first 1[4-7]xx in `published`; it lists unread pages for one century, it does not count engines).
// Read-only: one aggregate per batch of books, output to a file.
/**
 * reach-count.mjs — how many Latin pages would the long-s pass touch? (#5924, PREREGISTRATION "If it passes")
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local reach-count.mjs --out <reach.json>
 * Per century (1400s–1700s, plus "other" for no year in that range): Latin books, their pages by stored OCR engine
 * (lite = ocr.model gemini-3.1-flash-lite*, flash-preview, other engines, none = no ocr.data).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out'); if (!OUT) throw new Error('--out required');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
try {
  const books = await db.collection('books').find(
    { language: /latin|^lat$|^la$/i, pages_count: { $gt: 0 }, duplicate_of: { $in: [null, ''] } },
    { projection: { _id: 1, id: 1, published: 1 } }).toArray();
  const cen = (b) => { const y = (String(b.published || '').match(/1[4-7]\d\d/) || [''])[0]; return y ? `${y.slice(0, 2)}00s` : 'other'; };
  const byId = new Map(books.map((b) => [String(b.id ?? b._id), cen(b)]));
  const ids = [...byId.keys()];
  const res = {}; const add = (k, cls, n) => { res[k] ??= { books: 0, pages: 0, lite: 0, flash_preview: 0, other_engine: 0, none: 0 }; res[k][cls] += n; res[k].pages += n; };
  for (const b of books) { const k = cen(b); res[k] ??= { books: 0, pages: 0, lite: 0, flash_preview: 0, other_engine: 0, none: 0 }; res[k].books++; }
  const t0 = Date.now();
  for (let i = 0; i < ids.length; i += 200) {
    const agg = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids.slice(i, i + 200) } } },
      { $project: { book_id: 1, m: '$ocr.model', has: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] } } },
      { $group: { _id: { b: '$book_id', m: '$m', has: '$has' }, n: { $sum: 1 } } }]).toArray();
    for (const a of agg) {
      const m = String(a._id.m || '');
      const cls = !a._id.has ? 'none' : /flash-lite/.test(m) ? 'lite' : m === 'gemini-3-flash-preview' ? 'flash_preview' : 'other_engine';
      add(byId.get(a._id.b), cls, a.n);
    }
    if ((i / 200) % 25 === 0) console.log(`${i + 200}/${ids.length} books, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const total = { books: 0, pages: 0, lite: 0, flash_preview: 0, other_engine: 0, none: 0 };
  for (const v of Object.values(res)) for (const k of Object.keys(total)) total[k] += v[k];
  const doc = { at: new Date().toISOString(), frame: 'books.language ~ latin|lat|la, pages_count > 0, not duplicate_of; century from published', by_century: res, total };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(JSON.stringify(total));
} finally { await c.close(); }
