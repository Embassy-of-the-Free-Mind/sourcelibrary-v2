#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/backlog-manifest.mjs (selects Latin books for reading, not text for a
// lexicon); scripts/eval/latin-r4-report-5924.mjs (folds, no corpus). Nothing in scripts/ builds a Latin word list from
// our own pages. Read-only.
/**
 * fetch-corpus.mjs — the long-s pass's training text (PREREGISTRATION.md step 3). READ-ONLY on Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local fetch-corpus.mjs --out <corpus.jsonl.gz> [--books 4000]
 *
 * Latin books (books.language Latin) with pages, minus the 99 reference books of latin-refs-5924 and every book that
 * shares a work_id with one of them; a random sample of them; every page whose stored OCR is gemini-3-flash-preview
 * (lite's ſ-as-f habit is not in that engine). Rows: {book_id, page_id, text}, OCR metadata tags stripped.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out'); const NBOOKS = +opt('books', 4000);
if (!OUT) throw new Error('--out required');

const META = /^<(scan-quality|language|script|page-type|page-num|meta|vocab|columns|catchword|signature)>.*$/gm;
export const stripTags = (t) => String(t || '').replace(META, '').replace(/<\/?[a-z-]+\/?>/g, ' ');

const refs = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'benchmark', 'latin-refs-5924.json'), 'utf8')).pages;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
try {
  const refIds = refs.map((p) => p.book_id);
  const refBooks = await db.collection('books').find({ $or: [{ id: { $in: refIds } }, { _id: { $in: refIds } }] }, { projection: { id: 1, work_id: 1 } }).toArray();
  const works = [...new Set(refBooks.map((b) => b.work_id).filter(Boolean))];
  const workBooks = works.length ? await db.collection('books').find({ work_id: { $in: works } }, { projection: { id: 1 } }).toArray() : [];
  const exclude = new Set([...refIds, ...workBooks.map((b) => b.id)]);
  console.log(`exclude: ${refIds.length} ref books (${refBooks.length} found), ${works.length} works, ${exclude.size} books in all`);
  const sample = await db.collection('books').aggregate([
    { $match: { language: /^(latin|la)$/i, pages_count: { $gt: 0 } } },
    { $sample: { size: NBOOKS } }, { $project: { id: 1 } }]).toArray();
  const ids = sample.map((b) => b.id).filter((id) => id && !exclude.has(id));
  const gz = zlib.createGzip(); const ws = fs.createWriteStream(OUT); gz.pipe(ws);
  let pages = 0, books = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const cur = db.collection('pages').find({ book_id: { $in: ids.slice(i, i + 50) }, 'ocr.model': 'gemini-3-flash-preview' }, { projection: { _id: 0, id: 1, book_id: 1, 'ocr.data': 1 } }).batchSize(1000);
    const seen = new Set();
    for await (const p of cur) {
      const text = stripTags(p.ocr?.data); if (text.trim().length < 200) continue;
      gz.write(JSON.stringify({ book_id: p.book_id, page_id: p.id, text }) + '\n'); pages++; seen.add(p.book_id);
    }
    books += seen.size;
    if ((i / 50) % 10 === 0) console.log(`${i + 50}/${ids.length} books scanned, ${books} with flash-preview pages, ${pages} pages`);
  }
  gz.end(); await new Promise((r) => ws.on('finish', r));
  console.log(`done: ${books} books, ${pages} pages -> ${OUT}`);
} finally { await c.close(); }
