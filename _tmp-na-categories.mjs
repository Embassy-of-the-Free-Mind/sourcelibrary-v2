#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const na = await db.collection('books').find({ 'pipeline_auto.status': 'needs_attention' })
  .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.error': 1, language: 1 })
  .toArray();

// Categorize by error pattern
const categories = {
  lowOcrCoverage: [],      // "Very low OCR coverage"
  ocrLooped: [],           // "OCR looped 4 times"
  translateLooped: [],     // "Translation looped 4 times"
  imageDownloadFailed: [], // "All N image downloads failed"
  finalizeBlocked: [],     // "Finalize blocked"
  other: [],
};

for (const b of na) {
  const err = b.pipeline_auto?.error || '';
  if (err.includes('Very low OCR coverage')) categories.lowOcrCoverage.push(b);
  else if (err.includes('OCR looped')) categories.ocrLooped.push(b);
  else if (err.includes('Translation looped')) categories.translateLooped.push(b);
  else if (err.includes('image downloads failed')) categories.imageDownloadFailed.push(b);
  else if (err.includes('Finalize blocked')) categories.finalizeBlocked.push(b);
  else categories.other.push(b);
}

console.log('=== Needs Attention Categories ===');
for (const [cat, books] of Object.entries(categories)) {
  console.log(`\n${cat}: ${books.length} books`);
}

// Deep dive: lowOcrCoverage — are these actually fully OCR'd?
console.log('\n=== LOW OCR COVERAGE: Stale cache check ===');
const sampleLow = categories.lowOcrCoverage.slice(0, 20);
for (const b of sampleLow) {
  const actualOcr = await db.collection('pages').countDocuments({
    book_id: b.id,
    'ocr.data': { $exists: true, $ne: null, $ne: '' }
  });
  const stale = b.pages_ocr !== actualOcr;
  console.log(`  ${stale ? 'STALE' : 'ok'} | cached:${b.pages_ocr} actual:${actualOcr}/${b.pages_count} | ${(b.title||'').substring(0,40)}`);
}

// Deep dive: ocrLooped — how many pages are actually missing?
console.log('\n=== OCR LOOPED: Actual missing pages ===');
let ocrLoopedTotal = 0;
let ocrLoopedMissing = 0;
const sampleOcr = categories.ocrLooped.slice(0, 10);
for (const b of sampleOcr) {
  const actualOcr = await db.collection('pages').countDocuments({
    book_id: b.id,
    'ocr.data': { $exists: true, $ne: null, $ne: '' }
  });
  const missing = b.pages_count - actualOcr;
  ocrLoopedTotal += b.pages_count;
  ocrLoopedMissing += missing;
  console.log(`  ${actualOcr}/${b.pages_count} (${missing} missing) | ${(b.title||'').substring(0,40)}`);
}

// Deep dive: imageDownloadFailed — do these have archived_photo?
console.log('\n=== IMAGE DOWNLOAD FAILED: Archive status ===');
const sampleImg = categories.imageDownloadFailed.slice(0, 10);
for (const b of sampleImg) {
  const withArchive = await db.collection('pages').countDocuments({
    book_id: b.id,
    archived_photo: { $exists: true, $regex: /^https/ }
  });
  const withPhoto = await db.collection('pages').countDocuments({
    book_id: b.id,
    photo: { $exists: true, $regex: /^https/ }
  });
  console.log(`  archived:${withArchive} photo:${withPhoto}/${b.pages_count} | ${(b.title||'').substring(0,40)}`);
}

// Deep dive: translateLooped — how many actually missing?
console.log('\n=== TRANSLATE LOOPED: Actual gap ===');
const sampleTr = categories.translateLooped.slice(0, 10);
for (const b of sampleTr) {
  const actualTr = await db.collection('pages').countDocuments({
    book_id: b.id,
    'translation.data': { $exists: true, $ne: null, $ne: '' }
  });
  console.log(`  tr:${actualTr}/${b.pages_count} (${b.pages_count - actualTr} missing) | ${(b.title||'').substring(0,40)}`);
}

// "Other" errors
console.log('\n=== OTHER errors ===');
categories.other.forEach(b => {
  console.log(`  ${(b.pipeline_auto?.error||'').substring(0,80)} | ${(b.title||'').substring(0,30)}`);
});

await client.close();
