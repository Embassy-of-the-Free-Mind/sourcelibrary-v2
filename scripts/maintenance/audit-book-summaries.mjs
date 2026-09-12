#!/usr/bin/env node
/**
 * Flag "About this book" summaries that are wrong in ways nothing else catches.
 *
 * Three failure modes seen in production:
 *
 *  1. Wikipedia disambiguation junk. GET /api/books/[id]/index falls back to a
 *     Wikipedia author bio, and for an ambiguous name it returns the "X may
 *     refer to: swimmer, politician…" page, which lands verbatim in the summary.
 *  2. Collection-framed summaries. A book described by its role in one
 *     collection rather than by what it is — a 1,363-plant herbal introduced as
 *     "the earliest published notice of a slime mould". About this book is on
 *     the book's page, where most readers arrive without the collection.
 *  3. Missing entirely, so the page shows nothing where a description belongs.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/audit-book-summaries.mjs [--days=14] [--collection=slug]
 */
import { MongoClient } from 'mongodb';

const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const DAYS = parseInt(arg('days', '14'), 10);
const COLLECTION = arg('collection', '');

const JUNK = [
  [/may refer to/i, 'wikipedia disambiguation'],
  [/\bdisambiguation\b/i, 'wikipedia disambiguation'],
  [/^\s*(this page|this is the title page|the following)/i, 'OCR page description, not a summary'],
  [/lorem ipsum|TODO|TBD|placeholder/i, 'placeholder text'],
  [/\bits interest here\b/i, 'written from a collection\'s point of view'],
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const since = new Date(Date.now() - DAYS * 86400000);
const filter = {
  visible: true,
  ...(COLLECTION ? { collections: COLLECTION } : { updated_at: { $gte: since } }),
};
const books = await db.collection('books').find(filter,
  { projection: { _id: 0, id: 1, slug: 1, title: 1, collections: 1, 'index.bookSummary.brief': 1, 'reading_summary.overview': 1 } })
  .sort({ updated_at: -1 }).limit(500).toArray();

const problems = [];
for (const b of books) {
  const s = b.index?.bookSummary?.brief || b.reading_summary?.overview || '';
  if (!s.trim()) { problems.push([b, 'no summary']); continue; }
  const hit = JUNK.find(([rx]) => rx.test(s));
  if (hit) { problems.push([b, hit[1]]); continue; }
  if (s.trim().length < 80) problems.push([b, `too short (${s.trim().length} chars)`]);
}

console.log(`Checked ${books.length} book${books.length === 1 ? '' : 's'}${COLLECTION ? ` in ${COLLECTION}` : ` updated in the last ${DAYS} days`}.\n`);
if (!problems.length) { console.log('No summary problems found.'); await client.close(); process.exit(0); }
problems.forEach(([b, why]) => console.log(`  ${why.padEnd(38)} ${String(b.title).slice(0, 44).padEnd(46)} /book/${b.slug}`));
console.log(`\n${problems.length} need attention.`);
process.exitCode = 1;
await client.close();
