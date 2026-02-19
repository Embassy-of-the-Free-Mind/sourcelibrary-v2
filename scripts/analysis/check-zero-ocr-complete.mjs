#!/usr/bin/env node
/**
 * Check "complete" books that actually have 0 OCR pages.
 * Uses sampling instead of full countDocuments for speed.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Timeout'); client.close(); process.exit(1); }, 90000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // Get all complete books with cached pages_ocr = 0
  const zeroOcrCached = await db.collection('books').find({
    'pipeline_auto.status': 'complete',
    $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }]
  }).project({
    id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    'pipeline_auto': 1,
  }).toArray();

  console.log(`"Complete" books with cached pages_ocr=0: ${zeroOcrCached.length}\n`);

  for (const book of zeroOcrCached) {
    // Verify with actual page check (just check if ANY page has OCR)
    const anyOcr = await db.collection('pages').findOne({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    }, { projection: { id: 1 } });

    const totalPages = book.pages_count || await db.collection('pages').countDocuments({ book_id: book.id });
    const hasAnyOcr = !!anyOcr;

    // Check a sample page for photo status
    const samplePage = await db.collection('pages').findOne(
      { book_id: book.id },
      { projection: { photo: 1, archived_photo: 1, photo_original: 1 } }
    );
    const photoType = samplePage?.archived_photo ? 'archived' :
      samplePage?.photo?.startsWith('http') ? 'http' :
      samplePage?.photo ? `local(${samplePage.photo.substring(0, 40)})` : 'none';

    console.log(`${book.id} | ${book.title?.substring(0, 55)}`);
    console.log(`  Lang: ${book.language} | Pages: ${totalPages} | Any OCR: ${hasAnyOcr} | Photo: ${photoType}`);
    console.log(`  Pipeline: completed ${book.pipeline_auto?.completed_at ? new Date(book.pipeline_auto.completed_at).toISOString().substring(0, 16) : '?'}`);
    console.log('');
  }

  // Also check: complete books where translation is very low
  console.log('=== "Complete" books with <30% translation (100+ pages) ===\n');
  const lowTrans = await db.collection('books').find({
    'pipeline_auto.status': 'complete',
    pages_count: { $gte: 100 },
    $expr: { $lt: [{ $ifNull: ['$pages_translated', 0] }, { $multiply: ['$pages_count', 0.3] }] }
  }).project({
    id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
  }).sort({ pages_count: -1 }).limit(15).toArray();

  for (const b of lowTrans) {
    const pct = b.pages_count > 0 ? ((b.pages_translated || 0) / b.pages_count * 100).toFixed(1) : '?';
    console.log(`  ${b.id} | ${b.title?.substring(0, 50)} | ${b.pages_translated || 0}/${b.pages_count} trans (${pct}%) | OCR: ${b.pages_ocr || 0}`);
  }

  // Summary gap
  console.log('\n=== Summary gap ===');
  const totalComplete = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'complete' });
  const withSummary = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'complete',
    'reading_summary.generated_at': { $exists: true }
  });
  const withIndex = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'complete',
    'index.generatedAt': { $exists: true }
  });
  console.log(`Complete: ${totalComplete}, Has summary: ${withSummary} (${(withSummary/totalComplete*100).toFixed(0)}%), Has index: ${withIndex} (${(withIndex/totalComplete*100).toFixed(0)}%)`);

  // Check enriching phase — what does it actually do?
  const recentEnrich = await db.collection('gemini_usage').find({
    type: { $in: ['summary', 'index'] },
    timestamp: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }
  }).sort({ timestamp: -1 }).limit(10).project({ type: 1, book_id: 1, status: 1, timestamp: 1 }).toArray();

  console.log(`\nRecent summary/index calls (last 3 days):`);
  for (const r of recentEnrich) {
    console.log(`  ${r.type} | ${r.status} | ${r.book_id} | ${new Date(r.timestamp).toISOString().substring(0, 16)}`);
  }

} finally {
  clearTimeout(timeout);
  await client.close();
}
