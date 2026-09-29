#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook — samples from an in-memory list; this is the
// Mongo query that builds that list for the #5250 "unreadable slice" (Tibetan cohort pages with ocr.unreadable).
// Read-only. Run on Hetzner from the repo root: node --env-file=.env.production.local <this> <cohort-ids.txt> <out.jsonl>
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const [cohortFile, outFile] = process.argv.slice(2);
const N = Number(process.env.N_WANT || 50);
const cohort = readFileSync(cohortFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

// mulberry32, seed 5250: the same draw every time.
let s = 5250;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const rows = await db.collection('pages')
  .find({ book_id: { $in: cohort }, 'ocr.unreadable': true }, { projection: { _id: 0, book_id: 1, page_number: 1, 'ocr.unreadable_reason': 1, 'ocr.model': 1 } })
  .toArray();
const counts = await db.collection('books')
  .find({ id: { $in: cohort } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).toArray();
const pagesCount = Object.fromEntries(counts.map((b) => [b.id, b.pages_count]));
const byBook = new Map();
for (const r of rows) {
  const n = pagesCount[r.book_id] || 0;
  if (!n || r.page_number < n * 0.15 || r.page_number > n * 0.95) continue; // interior only
  if (!byBook.has(r.book_id)) byBook.set(r.book_id, []);
  byBook.get(r.book_id).push(r);
}
const books = [...byBook.keys()].sort();
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
const out = books.slice(0, N).map((b) => {
  const ps = byBook.get(b).sort((x, y) => x.page_number - y.page_number);
  const p = ps[Math.floor(rand() * ps.length)];
  return { book: b, page: p.page_number, reason: p.ocr?.unreadable_reason ?? null, model: p.ocr?.model ?? null, book_pages: pagesCount[b] };
});
writeFileSync(outFile, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ mark_pages: rows.length, mark_books_interior: books.length, drawn: out.length }));
await client.close();
