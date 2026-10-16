#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-census.mjs-style per-book counters and the #6688 routing-table census (a
// one-off 150-books-per-language page count by ocr.model, posted on #6688). Neither gives the planner (#6740) one
// read-only table of live pages per language: how many still need a read or a translation, and how much they are read.
/**
 * Live pages per language for the planner (#6740): read-only aggregate over `books`, no page scan.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/planner/volumes.mjs --out F
 * Live = visible && pages_count > 0 (the canonical filter). Per language (books.language as stored):
 *   books, pages, pages_ocr, pages_translated, reads (sum of read_count), and read-weighted untranslated / unread pages
 *   (each book's pages weighted by (read_count + 1) / (corpus mean of read_count + 1)).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (!out) { console.error('--out=FILE required'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const live = { visible: true, pages_count: { $gt: 0 } };
const [{ mean } = { mean: 0 }] = await db.collection('books').aggregate([
  { $match: live }, { $group: { _id: null, mean: { $avg: { $ifNull: ['$read_count', 0] } } } }]).toArray();
const rows = await db.collection('books').aggregate([
  { $match: live },
  { $project: { language: { $ifNull: ['$language', 'unknown'] }, pc: '$pages_count',
    po: { $min: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] },
    pt: { $min: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] },
    w: { $divide: [{ $add: [{ $ifNull: ['$read_count', 0] }, 1] }, mean + 1] }, rc: { $ifNull: ['$read_count', 0] } } },
  { $group: { _id: '$language', books: { $sum: 1 }, pages: { $sum: '$pc' }, pages_ocr: { $sum: '$po' },
    pages_translated: { $sum: '$pt' }, reads: { $sum: '$rc' },
    rw_untranslated: { $sum: { $multiply: ['$w', { $subtract: ['$pc', '$pt'] }] } },
    rw_unread: { $sum: { $multiply: ['$w', { $subtract: ['$pc', '$po'] }] } },
    rw_pages: { $sum: { $multiply: ['$w', '$pc'] } } } },
  { $sort: { pages: -1 } }], { allowDiskUse: true, maxTimeMS: 300000 }).toArray();
fs.writeFileSync(out, JSON.stringify({ generated_by: 'scripts/eval/estimator/planner/volumes.mjs', date: new Date().toISOString(),
  filter: 'visible && pages_count > 0', mean_read_count: mean, languages: rows.map(r => ({ language: r._id, ...r, _id: undefined })) }, null, 1) + '\n');
console.log(`wrote ${out}: ${rows.length} languages, mean read_count ${mean.toFixed(2)}`);
await client.close();
