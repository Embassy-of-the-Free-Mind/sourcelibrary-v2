#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/backlog-manifest.mjs (a page manifest for the GEX45 over Latin print, but
// of UNREAD backlog pages with no target text) and scripts/eval/mongol-realpilot-5664 (a LoRA training set with a
// leakage check, Mongolian columns). Neither draws read pages with a teacher's text as the label.
/**
 * build-train — the training set for the #6871 Latin print distillation test (PREREGISTRATION.md, this directory).
 *
 * Teacher = the STORED production read by gemini-3-flash-preview (round 4, #5924: level with 3.8-flash on Latin print).
 * Books: Latin, printed, year 1500–1699, seeded shuffle (6871). Excluded: the 99 #5924 reference books and every
 * book sharing a work_id with one of them. Pages: page_number ≥ 5, ocr.model gemini-3-flash-preview, not human
 * edited, cleaned text 300–5,000 chars and ≥ 5 ſ (the teacher kept long s on that page: "keep long s", Derek
 * 2026-10-20). At most 3 pages per book. First VAL_N books' pages go to val.jsonl, the rest to train.jsonl.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local build-train.mjs --out DIR [--n 2000] [--val 100]
 * Writes {id, book_id, page_number, year, src, text} rows. Read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { isHumanEdited } from '../../lib/paddle-zh-lane.mjs';
import { cleanTeacher } from './clean-teacher.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('out'); const N = Number(arg('n', 2000)); const VAL = Number(arg('val', 100));
if (!OUT) throw new Error('--out DIR');
const HERE = path.dirname(fileURLToPath(import.meta.url));

let s = 6871; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const refBooks = JSON.parse(fs.readFileSync(path.join(HERE, '../latin-bakeoff-5924/inputs.json'))).pages.map((p) => p.slug.match(/^lr-([0-9a-f]+)-p/)[1]);
const refWorks = (await db.collection('books').find({ id: { $in: refBooks } }, { projection: { work_id: 1 } }).toArray()).map((b) => b.work_id).filter(Boolean);
const books = (await db.collection('books').find({ language: 'Latin', 'book_class.class': 'printed', year: { $gte: 1500, $lte: 1699 }, pages_ocr: { $gte: 20 } },
  { projection: { id: 1, year: 1, work_id: 1 } }).sort({ id: 1 }).toArray())
  .filter((b) => !refBooks.includes(b.id) && !(b.work_id && refWorks.includes(b.work_id)));
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
console.log(`frame: ${books.length} books (ref books ${refBooks.length}, ref works ${refWorks.length} excluded)`);

const rows = []; let scanned = 0; const perBook = new Map();
for (let i = 0; i < books.length && rows.length < N + VAL; i += 8) {
  const batch = books.slice(i, i + 8);
  const got = await Promise.all(batch.map((b) => db.collection('pages').find({ book_id: b.id, page_number: { $gte: 5 }, 'ocr.model': 'gemini-3-flash-preview' },
    { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, enhanced_photo: 1, split_from_spread: 1 } }).limit(40).toArray()));
  for (const [k, ps] of got.entries()) {
    const b = batch[k]; scanned += ps.length;
    const ok = ps.filter((p) => !isHumanEdited(p.ocr) && getPageSource(p)).map((p) => ({ p, t: cleanTeacher(p.ocr.data) }))
      .filter(({ t }) => t.length >= 300 && t.length <= 5000 && (t.match(/ſ/g) || []).length >= 5);
    for (let j = ok.length - 1; j > 0; j--) { const r = Math.floor(rnd() * (j + 1)); [ok[j], ok[r]] = [ok[r], ok[j]]; }
    for (const { p, t } of ok.slice(0, 3)) {
      if (rows.length >= N + VAL) break;
      rows.push({ id: p.id, book_id: b.id, page_number: p.page_number, year: b.year, src: getPageSource(p), text: t });
      perBook.set(b.id, (perBook.get(b.id) || 0) + 1);
    }
  }
}
// val = whole books, never shared with train
const valBooks = new Set(); const val = [], train = [];
// rows arrive grouped by book, so the first books up to VAL pages go to val whole
for (const r of rows) { if (val.length < VAL || valBooks.has(r.book_id)) { valBooks.add(r.book_id); val.push(r); } else train.push(r); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'train.jsonl'), train.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'val.jsonl'), val.map((r) => JSON.stringify(r)).join('\n') + '\n');
const cent = (rs) => ({ '1500s': rs.filter((r) => r.year < 1600).length, '1600s': rs.filter((r) => r.year >= 1600).length });
console.log(JSON.stringify({ scanned_pages: scanned, train: train.length, train_books: new Set(train.map((r) => r.book_id)).size, val: val.length, val_books: valBooks.size, train_by_century: cent(train), leak_ref_books: train.concat(val).filter((r) => refBooks.includes(r.book_id)).length }));
await c.close();
