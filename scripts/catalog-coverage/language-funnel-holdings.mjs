#!/usr/bin/env node
// Writes what Source Library itself holds, per language, into the per-language funnel
// data (#6256): books with page images, their pages, and how many are public.
//
// Who runs it: anyone refreshing the figure on /research/canon-gap, from a machine with
// the production env. Read-only on Mongo; rewrites only the `holdings` block of each
// language in results/language-funnel-2026-10.json.
//
//   node --env-file=.env.production.local scripts/catalog-coverage/language-funnel-holdings.mjs
//
// A "book" here is one record in `books` (often one volume), counted by the edition's
// `language`, so it is not the same unit as the bars above it. Public means
// visible && pages_count > 0, the site's own "live" filter.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results/language-funnel-2026-10.json');
// Funnel panel id → values of books.language it covers.
const LANGUAGES = {
  latin: ['Latin'],
  greek: ['Greek'],
  chinese: ['Chinese'],
  japanese: ['Japanese'],
  sanskrit: ['Sanskrit'],
  tibetan: ['Tibetan'],
  pali: ['Pali'],
  arabic: ['Arabic', 'Persian'],
  hebrew: ['Hebrew'],
  syriac: ['Syriac'],
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const rows = await client
  .db('bookstore')
  .collection('books')
  .aggregate(
    [
      { $match: { language: { $in: Object.values(LANGUAGES).flat() }, pages_count: { $gt: 0 } } },
      { $group: { _id: '$language', books: { $sum: 1 }, pages: { $sum: '$pages_count' }, public_books: { $sum: { $cond: ['$visible', 1, 0] } } } },
    ],
    { maxTimeMS: 120000 },
  )
  .toArray();
await client.close();

const data = JSON.parse(readFileSync(file, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
for (const lang of data.languages) {
  const names = LANGUAGES[lang.id];
  if (!names) continue;
  const mine = rows.filter((r) => names.includes(r._id));
  lang.holdings = {
    books: mine.reduce((a, r) => a + r.books, 0),
    pages: mine.reduce((a, r) => a + r.pages, 0),
    public_books: mine.reduce((a, r) => a + r.public_books, 0),
    languages: names,
    counted: today,
  };
  console.log(lang.id.padEnd(9), JSON.stringify(lang.holdings));
}
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
