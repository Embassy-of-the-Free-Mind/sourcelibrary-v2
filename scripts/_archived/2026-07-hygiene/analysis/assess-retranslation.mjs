#!/usr/bin/env node
/**
 * Assess which books need re-translation.
 * Two cases:
 *   1. OCR was re-done but translation is stale (translation.updated_at < ocr.updated_at)
 *   2. OCR was done with an old model (not gemini-3-flash-preview)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Case 1: Stale translations (OCR updated after translation)
  const stalePages = await db.collection('pages').aggregate([
    { $match: {
        'ocr.data': { $exists: true, $ne: '' },
        'translation.data': { $exists: true, $ne: '' },
        'ocr.updated_at': { $exists: true },
        'translation.updated_at': { $exists: true },
    }},
    { $addFields: { is_stale: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } } },
    { $match: { is_stale: true } },
    { $group: { _id: '$book_id', stale_count: { $sum: 1 } } },
  ]).toArray();
  const staleBookIds = new Set(stalePages.map(b => b._id));
  const staleTotalPages = stalePages.reduce((s, b) => s + b.stale_count, 0);

  // Case 2: Old OCR model (translated pages using non-current OCR)
  const oldOcrPages = await db.collection('pages').aggregate([
    { $match: {
        'translation.data': { $exists: true, $ne: '' },
        'ocr.data': { $exists: true, $ne: '' },
        'ocr.model': { $nin: ['gemini-3-flash-preview', 'manual', 'manual-correction'] },
    }},
    { $group: { _id: '$book_id', old_ocr_count: { $sum: 1 }, ocr_model: { $first: '$ocr.model' } } },
  ]).toArray();
  const oldOcrBookIds = new Set(oldOcrPages.map(b => b._id));
  const oldOcrTotalPages = oldOcrPages.reduce((s, b) => s + b.old_ocr_count, 0);

  const overlap = [...staleBookIds].filter(id => oldOcrBookIds.has(id));
  const allBookIds = new Set([...staleBookIds, ...oldOcrBookIds]);

  console.log('=== TRANSLATION RE-DO ASSESSMENT ===\n');
  console.log('Case 1 — Stale translations (new OCR, old translation):');
  console.log(`  Books: ${staleBookIds.size}`);
  console.log(`  Pages: ${staleTotalPages}`);
  console.log('  Action: Re-translate (OCR is already good)\n');
  console.log('Case 2 — Old OCR model still in use:');
  console.log(`  Books: ${oldOcrBookIds.size}`);
  console.log(`  Pages: ${oldOcrTotalPages}`);
  console.log('  Action: Re-OCR first, THEN re-translate\n');
  console.log(`Overlap (books in both): ${overlap.length}`);
  console.log(`Total unique books needing work: ${allBookIds.size}\n`);

  // Model breakdown for case 2
  const modelBreakdown = {};
  for (const b of oldOcrPages) {
    const m = b.ocr_model || '(null)';
    if (modelBreakdown[m] === undefined) modelBreakdown[m] = { books: 0, pages: 0 };
    modelBreakdown[m].books++;
    modelBreakdown[m].pages += b.old_ocr_count;
  }
  console.log('Case 2 breakdown by OCR model:');
  for (const [model, stats] of Object.entries(modelBreakdown).sort((a, b) => b[1].pages - a[1].pages)) {
    console.log(`  ${model}: ${stats.pages} pages across ${stats.books} books`);
  }

  // Of stale set, how many already have good OCR (just need re-translate)?
  const staleWithNewOcr = await db.collection('pages').aggregate([
    { $match: {
        'ocr.data': { $exists: true, $ne: '' },
        'translation.data': { $exists: true, $ne: '' },
        'ocr.updated_at': { $exists: true },
        'translation.updated_at': { $exists: true },
        'ocr.model': 'gemini-3-flash-preview',
    }},
    { $addFields: { is_stale: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } } },
    { $match: { is_stale: true } },
    { $count: 'total' },
  ]).toArray();
  console.log(`\nOf stale translations, pages with gemini-3-flash-preview OCR: ${staleWithNewOcr[0]?.total || 0}`);
  console.log('(these just need re-translation, no re-OCR)\n');

  // Also count: translated pages on OLD OCR that are NOT stale
  // (i.e. OCR was never re-done — these need BOTH re-OCR and re-translate)
  const needBothCount = [...oldOcrBookIds].filter(id => !staleBookIds.has(id));
  console.log(`Books needing BOTH re-OCR + re-translate (never re-OCR'd): ${needBothCount.length}`);
  console.log(`Books needing ONLY re-translate (already re-OCR'd): ${staleBookIds.size - overlap.length}`);
  console.log(`Books in overlap (old OCR on some pages, stale on others): ${overlap.length}`);

  // Get book titles for case 2 (old OCR, need re-OCR first)
  if (oldOcrPages.length > 0) {
    const bookIds = oldOcrPages.map(b => b._id);
    const books = await db.collection('books').find({ id: { $in: bookIds } })
      .project({ id: 1, title: 1, pages_count: 1 })
      .toArray();
    const bookMap = Object.fromEntries(books.map(b => [b.id, b]));

    console.log('\n=== CASE 2 BOOKS (need re-OCR) ===');
    for (const b of oldOcrPages.sort((a, b) => b.old_ocr_count - a.old_ocr_count).slice(0, 30)) {
      const book = bookMap[b._id];
      console.log(`  ${b._id}: ${b.old_ocr_count} pages on ${b.ocr_model} — ${book?.title?.slice(0, 60) || '?'}`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
