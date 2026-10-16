#!/usr/bin/env node
/**
 * Export the WORKS whose stored work date is a model estimate, for one-line reasons (#6721, Derek 2026-10-15). Reads
 * `books` live (read-only; a projection, ~93K rows): every book whose `source_work_dates_meta.work.basis` is
 * `model_knowledge` and that no human has dated. Books inherit a representative's work (`work.from_book`), so rows are
 * deduped to works: one row per representative and stored date, with every member book listed.
 *
 * Row: { book_id (the representative), members[], title, original_title, author, published, language, author_window,
 *        work: { year, from, to, display }, confidence }. Nothing is written to Mongo.
 *
 * PRIOR ART: export-books.mjs in this directory exports catalogue fields from the nightly mirror plus page leaves, one row
 * per BOOK and without the stored date; reasons need the stored date as written (yesterday's run, which the mirror may
 * not carry) and one row per WORK, so this reads Mongo directly and groups.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/export-why.mjs <out.jsonl>
 * (The check sample before the bulk was drawn from the output with `shuf -n 300 --random-source`.)
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: export-why.mjs <out.jsonl>'); process.exit(2); }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const docs = await books.find({ 'source_work_dates_meta.work.basis': 'model_knowledge', 'source_work_dates_meta.edited_by': { $exists: false } },
  { projection: { id: 1, title: 1, display_title: 1, english_title: 1, author: 1, published: 1, language: 1,
    'source_work_dates_meta.work': 1, 'source_work_dates_meta.confidence': 1, 'source_work_dates_meta.author_window': 1 } }).toArray();
await c.close();

const key = (w) => `${w.year}|${w.from}|${w.to}`;
const works = new Map();
for (const d of docs) {
  const id = String(d.id || d._id); const w = d.source_work_dates_meta.work;
  const rep = w.from_book || id;
  // a member whose stored date is not its representative's is its own work
  let k = `${rep}#${key(w)}`;
  if (works.has(`${rep}#`) && works.get(`${rep}#`) !== k) k = `${id}#${key(w)}`;
  else works.set(`${rep}#`, k);
  const row = works.get(k) || { book_id: k.split('#')[0], members: [], work: { year: w.year, from: w.from, to: w.to, display: w.display } };
  row.members.push(id);
  // the catalogue fields: the representative's own record where it is in scope, else the first member's
  if (!row.title_from || id === row.book_id) {
    Object.assign(row, { title_from: id, original_title: d.title || null, title: d.display_title || d.english_title || null, author: d.author || null,
      published: d.published ?? null, language: d.language || null, author_window: d.source_work_dates_meta.author_window || null,
      confidence: d.source_work_dates_meta.confidence || null });
  }
  works.set(k, row);
}
const rows = [...works.entries()].filter(([k]) => !k.endsWith('#')).map(([, r]) => r);
console.log(`${docs.length} books with a model-estimated work date → ${rows.length} works`);
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${rows.length} rows → ${OUT}`);
