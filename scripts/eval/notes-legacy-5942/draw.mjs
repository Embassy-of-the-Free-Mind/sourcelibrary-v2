#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer-5942/draw.mjs and scripts/maintenance/notes-layer-backfill-5942/backfill.mjs
// `drawPilot` draw ONE page per book, which undersamples the early prompt versions (few books, many pages each).
// This one draws PAGES uniformly (a book with probability ∝ its translated pages, then a page in it), and then tops
// up any prompt version, or any book list, with more pages from the books that hold it. A time-stratified draw on
// `translation.updated_at` was tried first and fails: bulk writers stamp thousands of pages with one timestamp.
/**
 * #5942 legacy syntaxes — read-only, $0.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-legacy-5942/draw.mjs \
 *     --n 60000 --out $JOB_SCRATCH/draw.jsonl.gz [--seed 5942]
 *   … --books-file books.txt --per-book 40 --out $JOB_SCRATCH/topup.jsonl.gz   (top-up: pages from these books)
 *
 * Each row: id, book_id, page_number, page_type, prompt_version, model, updated_at, data, w (the book's
 * pages_translated / pages drawn from it in a uniform draw; null in a top-up).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 60000));
const OUT = opt('out');
const BOOKS_FILE = opt('books-file');
const PER_BOOK = Number(opt('per-book', 40));
const CONC = Number(opt('concurrency', 6));
const rng = makeRng(Number(opt('seed', 5942)));

const c = new MongoClient(process.env.MONGODB_URI, { appName: 'notes-legacy-5942-draw', maxPoolSize: CONC + 2 });
await c.connect();
const db = c.db('bookstore');
const P = db.collection('pages');
const has = { 'translation.data': { $type: 'string', $gt: '' } };
const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.model': 1, 'translation.updated_at': 1 };

const q = BOOKS_FILE ? { id: { $in: fs.readFileSync(BOOKS_FILE, 'utf8').split(/\s+/).filter(Boolean) } } : { pages_translated: { $gt: 0 } };
const books = (await db.collection('books').find(q).project({ _id: 0, id: 1, pages_count: 1, pages_translated: 1 }).toArray())
  .filter((b) => b.id && b.pages_count > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
const total = books.reduce((s, b) => s + (b.pages_translated || 0), 0);
console.log(`${books.length} books, ${total} translated pages by the books' counters`);

// The draw list: [book, random page number]. Uniform: N picks ∝ pages_translated. Top-up: PER_BOOK per book.
const picks = [];
if (BOOKS_FILE) {
  for (const b of books) for (let k = 0; k < PER_BOOK; k++) picks.push([b, 1 + Math.floor(rng() * b.pages_count)]);
} else {
  const cum = [];
  let s = 0;
  for (const b of books) { s += b.pages_translated || 0; cum.push(s); }
  for (let k = 0; k < N; k++) {
    const x = rng() * s;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
    picks.push([books[lo], 1 + Math.floor(rng() * books[lo].pages_count)]);
  }
}
const drawnPerBook = new Map();
for (const [b] of picks) drawnPerBook.set(b.id, (drawnPerBook.get(b.id) || 0) + 1);

const out = zlib.createGzip();
out.pipe(fs.createWriteStream(OUT));
const seen = new Set();
let done = 0, written = 0;
async function one([b, r]) {
  let p = await P.findOne({ book_id: b.id, page_number: { $gte: r }, ...has }, { projection: proj, sort: { page_number: 1 } });
  if (!p) p = await P.findOne({ book_id: b.id, page_number: { $lt: r }, ...has }, { projection: proj, sort: { page_number: -1 } });
  done++;
  if (!p || seen.has(p.id)) return;
  seen.add(p.id);
  written++;
  const t = p.translation;
  out.write(JSON.stringify({ id: p.id, book_id: p.book_id, page_number: p.page_number, page_type: p.page_type ?? null, prompt_version: t.prompt_version ?? null, model: t.model ?? null, updated_at: t.updated_at ?? null, data: t.data, w: BOOKS_FILE ? null : (b.pages_translated || 0) / drawnPerBook.get(b.id) }) + '\n');
}
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < picks.length) {
    await one(picks[next++]);
    if (done % 5000 === 0) console.log(`${done}/${picks.length} · ${written} pages`);
  }
}));
await new Promise((res) => out.end(res));
console.log(`done: ${written} distinct pages from ${picks.length} picks`);
await c.close();
