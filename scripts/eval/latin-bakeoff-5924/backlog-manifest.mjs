#!/usr/bin/env node
// PRIOR ART: scripts/audit/gpu-queue-5660.mjs (owed = pages_count − pages_ocr from the book counters; read-only),
// scripts/eval/latin-refs-5924.mjs `draw` (the Latin frame: language regex, century = first 1[4-7]xx in `published`,
// duplicate_of excluded) and scripts/gpu/paddle-zh-fleet.mjs (chunked manifests for a GPU lane; its planning HOLDS
// books and its apply writes pages — this does neither). Read-only: it writes manifest files, nothing to Mongo.
/**
 * backlog-manifest.mjs — the page manifest for a backlog read of one Latin century on the GEX45 (#5924, Derek's
 * inbox note 2026-10-18: "prepare (do not run) the backlog read … output to files, NOT to pages").
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local backlog-manifest.mjs --century 1500s --out <dir>
 *        [--limit-books N] [--chunk 2500]
 * Writes <dir>/chunk-00000.tsv … rows `page_id \t book_id \t page_number \t image_url` (getPageSource: the OCR
 * source the pipeline uses), pages with no `ocr.data` only, books in book-id order; and <dir>/manifest.json (counts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const century = arg('century', '1500s'), out = arg('out'), limit = Number(arg('limit-books', '0')), CHUNK = Number(arg('chunk', '2500'));
if (!out || !/^1[4-7]00s$/.test(century)) { console.error('usage: --century 1500s --out <dir>'); process.exit(2); }
const lead = century.slice(0, 2);
fs.mkdirSync(out, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { language: /latin|^lat$|^la$/i, pages_count: { $gt: 0 }, duplicate_of: { $in: [null, ''] } },
  { projection: { _id: 1, id: 1, published: 1, pages_count: 1, pages_ocr: 1 } }).toArray();
const sel = books.filter((b) => (String(b.published || '').match(/1[4-7]\d\d/) || [''])[0].slice(0, 2) === lead
  && (b.pages_count - (b.pages_ocr || 0)) > 0).map((b) => String(b.id ?? b._id)).sort();
const take = limit ? sel.slice(0, limit) : sel;
let rows = [], n = 0, chunk = 0, noSource = 0;
const flush = () => { if (!rows.length) return; fs.writeFileSync(path.join(out, `chunk-${String(chunk++).padStart(5, '0')}.tsv`), rows.join('\n') + '\n'); rows = []; };
for (const bid of take) {
  const ps = await db.collection('pages').find({ book_id: bid, 'ocr.data': { $exists: false } },
    { projection: { _id: 1, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1 } })
    .sort({ page_number: 1 }).toArray();
  for (const p of ps) {
    const url = getPageSource(p); if (!url) { noSource++; continue; }
    rows.push([String(p.id ?? p._id), bid, p.page_number, url].join('\t')); n++;
    if (rows.length >= CHUNK) flush();
  }
}
flush();
const m = { century, at: new Date().toISOString(), frame_books: sel.length, books: take.length, pages: n, pages_without_source: noSource, chunks: chunk, chunk_pages: CHUNK };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
console.log(JSON.stringify(m));
await c.close();
