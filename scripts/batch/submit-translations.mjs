#!/usr/bin/env node
/**
 * Submit batch translation jobs for all books with >80% OCR and <50% translation.
 * Uses the batch-translate-async API (Gemini Batch API — 50% cheaper).
 *
 * Usage:
 *   node scripts/batch/submit-translations.mjs [--dry-run] [--limit=N] [--lang=Latin]
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
const langArg = args.find(a => a.startsWith('--lang='));
const LANG_FILTER = langArg ? langArg.split('=')[1] : null;

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// Find eligible books
const match = { hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } };
if (LANG_FILTER) match.language = LANG_FILTER;

const books = await db.collection('books').aggregate([
  { $match: match },
  { $addFields: {
    ocr_pct: { $divide: ['$pages_ocr', '$pages_count'] },
    trans_pct: { $cond: [
      { $gt: ['$pages_count', 0] },
      { $divide: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] },
      0
    ]}
  }},
  { $match: { ocr_pct: { $gte: 0.8 }, trans_pct: { $lt: 0.5 } } },
  // Skip books already in translate pipeline
  { $match: { 'pipeline_auto.status': { $nin: ['translate_submitted', 'translate_complete', 'enriching', 'enriched', 'chapters', 'chapters_complete', 'images_submitted', 'images_complete', 'complete'] } } },
  { $project: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.status': 1, _id: 0 } },
  { $sort: { pages_ocr: -1 } },
  { $limit: LIMIT === Infinity ? 10000 : LIMIT }
]).toArray();

console.log(`Found ${books.length} books eligible for translation${LANG_FILTER ? ` (${LANG_FILTER})` : ''}`);
if (DRY_RUN) console.log('DRY RUN — not submitting\n');

let submitted = 0;
let skipped = 0;
let failed = 0;

for (const book of books) {
  const needsTrans = book.pages_ocr - (book.pages_translated || 0);
  const status = book.pipeline_auto?.status || 'none';
  console.log(`${book.language || '?'} | ${needsTrans} pages | ${status} | ${(book.title || '').slice(0, 60)}`);

  if (DRY_RUN) {
    submitted++;
    continue;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/books/${book.id}/batch-translate-async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  -> Submitted: ${data.jobName || data.message || 'ok'}`);
      submitted++;
    } else {
      const text = await res.text();
      console.log(`  -> HTTP ${res.status}: ${text.slice(0, 100)}`);
      if (res.status === 429) {
        console.log('  Rate limited — waiting 60s');
        await new Promise(r => setTimeout(r, 60000));
        // Retry once
        const retry = await fetch(`${BASE_URL}/api/books/${book.id}/batch-translate-async`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (retry.ok) {
          submitted++;
          console.log('  -> Retry succeeded');
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    }

    // Brief pause between submissions
    await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    console.log(`  -> Error: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone: ${submitted} submitted, ${skipped} skipped, ${failed} failed`);
await c.close();
