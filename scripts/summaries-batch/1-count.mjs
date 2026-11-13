#!/usr/bin/env node
/**
 * READ-ONLY. How many live books have no summary at all, how much text they have, and what the
 * trial would cost. Writes nothing, calls no model.
 *
 *   node --env-file=.env.production.local scripts/summaries-batch/1-count.mjs [--sample=40]
 *
 * "No summary" = none of index.bookSummary.brief, reading_summary.overview, summary (string or
 * .data), summary_candidate.brief, nor book_indexes.bookSummary (merged over books.index on read).
 */
import { MongoClient } from 'mongodb';
import { NO_SUMMARY, eligibleFilter, hasIndexSummary, bookText, recordText, RECORD_FIELDS, MODEL, tokensOf, OUT_TOKENS_PER_BOOK, arg } from './lib.mjs';
import { calculateUsageCost } from '../workers/lib/supabase-usage-logger.mjs';

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set (see README: credentials)'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const bands = await books.aggregate([
  { $match: NO_SUMMARY },
  { $lookup: { from: 'book_indexes', localField: 'id', foreignField: 'book_id', as: 'ix', pipeline: [{ $project: { 'bookSummary.brief': 1 } }] } },
  { $match: { $nor: [{ 'ix.bookSummary.brief': { $type: 'string', $ne: '' } }] } },
  { $project: { ocr: { $ifNull: ['$pages_ocr', 0] }, tr: { $ifNull: ['$pages_translated', 0] }, pages: '$pages_count', rung: '$translation_state.rung', eo: '$translation_state.english_original' } },
  { $group: {
    _id: { $switch: { branches: [
      { case: { $eq: ['$ocr', 0] }, then: '1 no transcribed text' },
      { case: { $lt: ['$ocr', 5] }, then: '2 1-4 pages' },
      { case: { $lt: ['$ocr', 20] }, then: '3 5-19 pages' },
      { case: { $lt: [{ $divide: ['$ocr', { $max: ['$pages', 1] }] }, 0.5] }, then: '4 20+ pages, under half the book' },
    ], default: '5 half the book or more' } },
    books: { $sum: 1 },
    translated5: { $sum: { $cond: [{ $gte: ['$tr', 5] }, 1, 0] } },
    readable: { $sum: { $cond: [{ $or: [{ $in: ['$rung', ['readable', 'complete']] }, { $and: [{ $eq: ['$eo', true] }, { $in: ['$rung', ['transcribed', 'translating', 'readable', 'complete']] }] }] }, 1, 0] } },
  } },
  { $sort: { _id: 1 } },
]).toArray();

let total = 0;
console.log('Live books with no summary anywhere, by transcribed text:');
console.log('  band                               books   5+ translated pages   readable (production gate)');
for (const b of bands) { total += b.books; console.log(`  ${b._id.slice(2).padEnd(34)} ${String(b.books).padStart(7)}   ${String(b.translated5).padStart(19)}   ${String(b.readable).padStart(10)}`); }
console.log(`  ${'total'.padEnd(34)} ${String(total).padStart(7)}`);

// Cost from a sample of real inputs, not a guess per book.
for (const [name, f] of [['production gate (readable English)', eligibleFilter()], ['trial gate (>=20 OCR pages or half the book)', eligibleFilter({ partial: true })]]) {
  const n = await books.countDocuments(f);
  const sample = await books.aggregate([{ $match: f }, { $sample: { size: Number(arg('sample', 40)) } }, { $project: RECORD_FIELDS }]).toArray();
  let inTok = 0, k = 0;
  for (const b of sample) {
    if (await hasIndexSummary(db, b.id)) continue;
    const t = await bookText(db, b);
    inTok += tokensOf(t.text) + tokensOf(recordText(b)) + 700; k++;
  }
  const per = k ? inTok / k : 0;
  const cost = calculateUsageCost(MODEL, per * n, OUT_TOKENS_PER_BOOK * n, true);
  console.log(`\n${name}: ${n} books · ~${Math.round(per)} input tokens a book (sample ${k}) · batch estimate $${cost.toFixed(2)} on ${MODEL}`);
}
console.log('\nPrices come from supabase-usage-logger calculateUsageCost; check them against Google\'s current price list before approving spend.');
await client.close();
