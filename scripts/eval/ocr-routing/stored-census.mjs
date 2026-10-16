#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/model-usage-snapshot.mjs — which engine wrote the text on every page,
 * corpus-wide, for /about/models; it does not split by language, so it cannot fill a routing row.
 * The 2026-10-13 census on #6688 (150 books per language) was run by hand and never committed.
 *
 * stored-census — "What readers have now" for the routing table on /quality (#6688): for each
 * language, EVERY page of every live book (visible, pages_count > 0, books.language), counted by
 * the engine whose text the page carries now (ocr.model). A page with empty ocr.data counts as
 * "no text yet". A draw of 300 books per language was tried first and dropped: two draws of Latin
 * gave 22% and 29% of pages with no text, because a few long books carry most of the pages.
 *
 * Read-only, no model calls. Writes JSON to stdout, progress to stderr.
 *   node --env-file=.env.production.local scripts/eval/ocr-routing/stored-census.mjs \
 *     --langs=Latin,German,English > stored-census-<date>.json
 */
import { MongoClient } from 'mongodb';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const LANGS = arg('langs', 'Latin,German,English,French,Italian,Greek,Arabic,Persian,Sanskrit,Pali').split(',');
const CHUNK = 300; // books per aggregate

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db('bookstore');
const out = { date: new Date().toISOString().slice(0, 10), languages: {} };
for (const language of LANGS) {
  const live = { visible: true, pages_count: { $gt: 0 }, language };
  const ids = (await db.collection('books').find(live, { projection: { id: 1 } }).toArray()).map(b => b.id).filter(Boolean);
  const tally = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids.slice(i, i + CHUNK) } } },
      { $project: { model: '$ocr.model', hasText: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] } } },
      { $group: { _id: { $cond: ['$hasText', { $ifNull: ['$model', 'unrecorded'] }, 'no_text'] }, pages: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    for (const r of rows) tally[r._id] = (tally[r._id] || 0) + r.pages;
  }
  const byModel = Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]));
  const pages = Object.values(tally).reduce((s, n) => s + n, 0);
  out.languages[language] = { books: ids.length, pages, by_model: byModel };
  console.error(language, ids.length, pages, JSON.stringify(byModel));
}
console.log(JSON.stringify(out, null, 1));
await client.close();
