#!/usr/bin/env node
// PRIOR ART: none in the repo. ingest.mjs only counts and logs the search's metadata_issue; the old free-text
// field fired on 751 of 1,995 answers, mostly noise (#7598). This tallies the structured one.
//
// Count the record errors a batch's searches reported, and list the actionable ones for a by-hand fix.
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/metadata-issues.mjs <dir>
// Prints counts by kind. Writes <dir>/metadata-issues.csv for every kind except none and other:
// book url, kind, field, current value (read from the book), proposed value (the search's right_value).
// READ-ONLY: it never writes to books. Fixes go through setCatalogueFields() by hand, with a book_events row.
// Answers from before 2026-10-29 carry a free-text string: counted as legacy_text, not listed.
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: metadata-issues.mjs <dir>'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Which field of the book each kind is about.
const FIELD = {
  author_is_printer: 'author', author_is_editor: 'author', author_is_uploader: 'author', author_is_root_text_author: 'author',
  date_is_upload_date: 'published', wrong_volume: 'title', wrong_language: 'language',
};
const recs = readFileSync(`${DIR}/results.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const counts = {};
const rows = [];
for (const r of recs) {
  const mi = r.metadata_issue;
  const kind = typeof mi === 'string' ? (mi.trim() ? 'legacy_text' : 'none') : (mi && mi.kind) || 'none';
  counts[kind] = (counts[kind] || 0) + 1;
  if (FIELD[kind]) rows.push({ id: r._book, kind, right: (mi.right_value || '').trim() });
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const books = c.db('bookstore').collection('books');
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const out = ['book_url,kind,field,current_value,proposed_value'];
for (const x of rows) {
  const b = await books.findOne({ id: x.id }, { projection: { author: 1, published: 1, year: 1, title: 1, display_title: 1, language: 1 } });
  const field = FIELD[x.kind];
  const cur = b ? (field === 'published' ? b.published ?? b.year : field === 'title' ? b.display_title || b.title : b[field]) : '(book not found)';
  out.push([`https://sourcelibrary.org/book/${x.id}`, x.kind, field, cur, x.right].map(csv).join(','));
}
await c.close();
writeFileSync(`${DIR}/metadata-issues.csv`, out.join('\n') + '\n');
console.log(`answers ${recs.length}; by kind:`, Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])));
console.log(`${rows.length} actionable rows -> ${DIR}/metadata-issues.csv (none and other are not listed; nothing was written to books)`);
