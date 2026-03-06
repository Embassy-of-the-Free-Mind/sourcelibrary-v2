#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!DRY_RUN && !EXECUTE) {
  console.log('Usage: node _tmp-recover-na.mjs --dry-run   (analyze only)');
  console.log('       node _tmp-recover-na.mjs --execute   (actually recover)');
  process.exit(0);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const na = await db.collection('books').find({ 'pipeline_auto.status': 'needs_attention' })
  .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    'pipeline_auto.error': 1, 'pipeline_auto.retry_count': 1, language: 1 })
  .toArray();

console.log(`Total needs_attention: ${na.length}`);

// For each book, check actual page state to determine correct pipeline re-entry point
const recovery = {
  toArchiveComplete: [],   // Has pages, needs OCR from scratch
  toOcrComplete: [],       // Has OCR, needs translation
  toTranslateComplete: [], // Has translation, needs enrichment
  toEnriching: [],         // Fully translated, needs summary/index
  skip_empty: [],          // 0 pages — empty shells
  skip_no_urls: [],        // No valid image URLs
  skip_investigate: [],    // Needs manual investigation
};

for (const b of na) {
  if (!b.pages_count || b.pages_count === 0) {
    recovery.skip_empty.push(b);
    continue;
  }

  // Check actual page counts
  const [actualOcr, actualTranslated, hasImages] = await Promise.all([
    db.collection('pages').countDocuments({
      book_id: b.id,
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    }),
    db.collection('pages').countDocuments({
      book_id: b.id,
      'translation.data': { $exists: true, $ne: null, $ne: '' }
    }),
    db.collection('pages').countDocuments({
      book_id: b.id,
      $or: [
        { archived_photo: { $exists: true, $regex: /^https/ } },
        { photo: { $exists: true, $regex: /^https/ } }
      ]
    }),
  ]);

  const ocrPct = b.pages_count > 0 ? actualOcr / b.pages_count : 0;
  const trPct = b.pages_count > 0 ? actualTranslated / b.pages_count : 0;
  const err = b.pipeline_auto?.error || '';

  // No valid image URLs at all
  if (hasImages === 0 && err.includes('image')) {
    recovery.skip_no_urls.push({ ...b, actualOcr, actualTranslated, hasImages });
    continue;
  }

  // Determine re-entry point based on actual progress
  if (trPct >= 0.90) {
    // 90%+ translated — go to translate_complete, will advance to enrichment
    recovery.toTranslateComplete.push({ ...b, actualOcr, actualTranslated });
  } else if (ocrPct >= 0.90) {
    // 90%+ OCR'd — go to ocr_complete, will advance to translation
    recovery.toOcrComplete.push({ ...b, actualOcr, actualTranslated });
  } else if (hasImages > 0) {
    // Has images but low OCR — restart from archive_complete
    recovery.toArchiveComplete.push({ ...b, actualOcr, actualTranslated, hasImages });
  } else {
    recovery.skip_investigate.push({ ...b, actualOcr, actualTranslated, hasImages });
  }
}

console.log('\n=== Recovery Plan ===');
console.log(`  → archive_complete (restart OCR): ${recovery.toArchiveComplete.length}`);
console.log(`  → ocr_complete (needs translation): ${recovery.toOcrComplete.length}`);
console.log(`  → translate_complete (needs enrichment): ${recovery.toTranslateComplete.length}`);
console.log(`  Skip: empty shells: ${recovery.skip_empty.length}`);
console.log(`  Skip: no valid URLs: ${recovery.skip_no_urls.length}`);
console.log(`  Skip: investigate: ${recovery.skip_investigate.length}`);

const totalRecover = recovery.toArchiveComplete.length + recovery.toOcrComplete.length + recovery.toTranslateComplete.length;
console.log(`\n  TOTAL to recover: ${totalRecover}`);
console.log(`  TOTAL to skip: ${recovery.skip_empty.length + recovery.skip_no_urls.length + recovery.skip_investigate.length}`);

// Show samples
if (recovery.toTranslateComplete.length > 0) {
  console.log('\nSample → translate_complete:');
  recovery.toTranslateComplete.slice(0, 5).forEach(b => {
    console.log(`  ${(b.title || '').substring(0, 45)} | OCR:${b.actualOcr}/${b.pages_count} | tr:${b.actualTranslated}/${b.pages_count}`);
  });
}
if (recovery.toOcrComplete.length > 0) {
  console.log('\nSample → ocr_complete:');
  recovery.toOcrComplete.slice(0, 5).forEach(b => {
    console.log(`  ${(b.title || '').substring(0, 45)} | OCR:${b.actualOcr}/${b.pages_count} | tr:${b.actualTranslated}/${b.pages_count}`);
  });
}
if (recovery.toArchiveComplete.length > 0) {
  console.log('\nSample → archive_complete:');
  recovery.toArchiveComplete.slice(0, 5).forEach(b => {
    console.log(`  ${(b.title || '').substring(0, 45)} | OCR:${b.actualOcr}/${b.pages_count} | imgs:${b.hasImages}`);
  });
}
if (recovery.skip_no_urls.length > 0) {
  console.log('\nSkip (no URLs):');
  recovery.skip_no_urls.forEach(b => {
    console.log(`  ${(b.title || '').substring(0, 45)} | pg:${b.pages_count} | imgs:${b.hasImages} | err:${(b.pipeline_auto?.error||'').substring(0,50)}`);
  });
}
if (recovery.skip_investigate.length > 0) {
  console.log('\nSkip (investigate):');
  recovery.skip_investigate.forEach(b => {
    console.log(`  ${(b.title || '').substring(0, 45)} | pg:${b.pages_count} | OCR:${b.actualOcr} | imgs:${b.hasImages} | err:${(b.pipeline_auto?.error||'').substring(0,50)}`);
  });
}

if (EXECUTE) {
  console.log('\n=== EXECUTING RECOVERY ===');
  const now = new Date();
  
  async function recoverBatch(books, targetStatus) {
    if (books.length === 0) return 0;
    const ids = books.map(b => b.id);
    const result = await db.collection('books').updateMany(
      { id: { $in: ids } },
      {
        $set: {
          'pipeline_auto.status': targetStatus,
          'pipeline_auto.error': null,
          'pipeline_auto.retry_count': 0,
          'pipeline_auto.last_updated': now,
        }
      }
    );
    console.log(`  ${targetStatus}: ${result.modifiedCount}/${ids.length} updated`);
    return result.modifiedCount;
  }

  // Also sync page counts for recovered books
  async function syncPageCounts(books) {
    let synced = 0;
    for (const b of books) {
      if (b.actualOcr !== undefined) {
        await db.collection('books').updateOne(
          { id: b.id },
          { $set: { pages_ocr: b.actualOcr, pages_translated: b.actualTranslated || 0, updated_at: now } }
        );
        synced++;
      }
    }
    return synced;
  }

  let total = 0;
  total += await recoverBatch(recovery.toArchiveComplete, 'archive_complete');
  total += await recoverBatch(recovery.toOcrComplete, 'ocr_complete');
  total += await recoverBatch(recovery.toTranslateComplete, 'translate_complete');

  // Mark empty shells distinctly
  if (recovery.skip_empty.length > 0) {
    const emptyIds = recovery.skip_empty.map(b => b.id);
    const r = await db.collection('books').updateMany(
      { id: { $in: emptyIds } },
      { $set: { 'pipeline_auto.status': 'empty_shell', 'pipeline_auto.last_updated': now } }
    );
    console.log(`  empty_shell: ${r.modifiedCount} marked`);
  }

  // Sync page count caches for all recovered books
  const allRecovered = [...recovery.toArchiveComplete, ...recovery.toOcrComplete, ...recovery.toTranslateComplete];
  const synced = await syncPageCounts(allRecovered);
  console.log(`  Page count caches synced: ${synced}`);

  console.log(`\n  Total recovered: ${total}`);
}

await client.close();
