#!/usr/bin/env node
/**
 * Investigate books marked "complete" that have suspicious gaps.
 * 1. Books with 0 OCR pages
 * 2. Books with low translation %
 * 3. Summary gap (complete but no reading_summary)
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (120s)'); client.close(); process.exit(1); }, 120000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // === Issue 2: Complete books with 0 or very low OCR ===
  console.log('=== ISSUE 2: "Complete" books with missing OCR ===\n');

  const completeBooks = await db.collection('books').find({
    'pipeline_auto.status': 'complete'
  }).project({
    id: 1, title: 1, author: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    'pipeline_auto': 1, 'reading_summary.generated_at': 1, 'index.generatedAt': 1, chapters: 1,
  }).toArray();

  console.log(`Total "complete" books: ${completeBooks.length}\n`);

  // Check actual page counts for each (batch — get real OCR counts)
  const zeroOcrBooks = [];
  const lowTransBooks = [];

  for (const book of completeBooks) {
    const realOcr = await db.collection('pages').countDocuments({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    });
    const realTotal = await db.collection('pages').countDocuments({ book_id: book.id });
    const realTrans = await db.collection('pages').countDocuments({
      book_id: book.id,
      'translation.data': { $exists: true, $ne: null, $ne: '' }
    });

    if (realOcr === 0 && realTotal > 0) {
      zeroOcrBooks.push({ ...book, realOcr, realTotal, realTrans });
    }
    if (realTotal > 50 && realTrans / realTotal < 0.5) {
      lowTransBooks.push({ ...book, realOcr, realTotal, realTrans, pct: (realTrans / realTotal * 100).toFixed(1) });
    }
  }

  console.log(`Books with 0 actual OCR pages: ${zeroOcrBooks.length}`);
  for (const b of zeroOcrBooks) {
    console.log(`  ${b.id} | ${b.title?.substring(0, 60)} | ${b.realTotal} pages, 0 OCR`);
    console.log(`    Lang: ${b.language} | Queued: ${b.pipeline_auto?.queued_at ? new Date(b.pipeline_auto.queued_at).toISOString().substring(0, 10) : '?'}`);
    // Check if pages exist at all
    const samplePage = await db.collection('pages').findOne({ book_id: b.id }, { projection: { id: 1, photo: 1, archived_photo: 1, 'ocr.data': 1 } });
    if (samplePage) {
      const hasPhoto = !!(samplePage.photo || samplePage.archived_photo);
      console.log(`    Sample page: photo=${hasPhoto}, ocr=${samplePage.ocr?.data ? samplePage.ocr.data.substring(0, 50) : 'null'}`);
    }
  }

  console.log(`\n--- Books with <50% translation (50+ pages): ${lowTransBooks.length} ---`);
  lowTransBooks.sort((a, b) => a.pct - b.pct);
  for (const b of lowTransBooks.slice(0, 15)) {
    console.log(`  ${b.id} | ${b.title?.substring(0, 50)} | ${b.realTrans}/${b.realTotal} trans (${b.pct}%) | OCR: ${b.realOcr}/${b.realTotal}`);
  }

  // === Issue 3: What's the 108 Upanishads situation? ===
  console.log('\n=== ISSUE 3: 108 Upanishads deep dive ===');
  const upanishadsId = '6953c87677f38f6761bdcad4';
  const upTotal = await db.collection('pages').countDocuments({ book_id: upanishadsId });
  const upOcr = await db.collection('pages').countDocuments({ book_id: upanishadsId, 'ocr.data': { $exists: true, $ne: null, $ne: '' } });
  const upTrans = await db.collection('pages').countDocuments({ book_id: upanishadsId, 'translation.data': { $exists: true, $ne: null, $ne: '' } });
  console.log(`  Pages: ${upTotal}, OCR: ${upOcr}, Translated: ${upTrans} (${(upTrans/upTotal*100).toFixed(1)}%)`);

  // Check pipeline_auto history
  const upBook = await db.collection('books').findOne({ id: upanishadsId }, { projection: { pipeline_auto: 1, language: 1 } });
  console.log(`  Language: ${upBook?.language}`);
  console.log(`  Pipeline auto:`, JSON.stringify(upBook?.pipeline_auto, null, 2));

  // === How is the pipeline deciding "complete"? ===
  console.log('\n=== Pipeline completion logic ===');
  // Check Phase 9 (finalize) — what conditions mark a book complete?
  // Let's look at what the cron checks

  // === Issue 1: Summary gap ===
  console.log('\n=== ISSUE 1: Summary gap ===');
  const withSummary = completeBooks.filter(b => b.reading_summary?.generated_at).length;
  const withIndex = completeBooks.filter(b => b.index?.generatedAt).length;
  const withChapters = completeBooks.filter(b => b.chapters && b.chapters.length > 0).length;

  console.log(`Of ${completeBooks.length} "complete" books:`);
  console.log(`  Has reading_summary: ${withSummary} (${(withSummary/completeBooks.length*100).toFixed(0)}%)`);
  console.log(`  Has index: ${withIndex} (${(withIndex/completeBooks.length*100).toFixed(0)}%)`);
  console.log(`  Has chapters: ${withChapters} (${(withChapters/completeBooks.length*100).toFixed(0)}%)`);

  // Check enriching phase — does it generate summary?
  // Look at recent gemini_usage for summary type
  const recentSummaries = await db.collection('gemini_usage').countDocuments({
    type: 'summary',
    timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });
  const recentIndexes = await db.collection('gemini_usage').countDocuments({
    type: 'index',
    timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });
  console.log(`\nLast 7 days gemini_usage:`);
  console.log(`  summary calls: ${recentSummaries}`);
  console.log(`  index calls: ${recentIndexes}`);

} finally {
  clearTimeout(timeout);
  await client.close();
}
