import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookId = '6984e84db96022f6fa69b4c8';
const book = await db.collection('books').findOne({ id: bookId });

console.log('=== Book thumbnail ===');
console.log('thumbnail:', book.thumbnail);
console.log('thumbnail_blob:', book.thumbnail_blob);

// Check if thumbnail is a cropped or unsplit URL
if (book.thumbnail?.includes('/uploads/')) {
  console.log('WARNING: thumbnail points to uploads/ (unsplit original)');
} else if (book.thumbnail?.includes('/cropped/')) {
  console.log('OK: thumbnail points to cropped/ (split page)');
}

// Test a few image URLs
const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [1, 2, 3, 12, 14] } }).sort({ page_number: 1 }).toArray();

console.log('\n=== Testing image URLs ===');
for (const p of pages) {
  const url = p.cropped_photo || p.archived_photo || p.photo;
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    console.log(`pg ${p.page_number}: ${resp.status} ${resp.headers.get('content-type')} size=${resp.headers.get('content-length')} url=${url.substring(0, 80)}...`);
  } catch (e) {
    console.log(`pg ${p.page_number}: FETCH ERROR ${e.message} url=${url.substring(0, 80)}...`);
  }
}

// Check pages 1-2 specifically — they are NOT split
console.log('\n=== Pages 1-2 (unsplit) detail ===');
for (const p of pages.filter(pg => pg.page_number <= 2)) {
  console.log(`pg ${p.page_number}:`);
  console.log(`  photo: ${p.photo}`);
  console.log(`  photo_original: ${p.photo_original}`);
  console.log(`  archived_photo: ${p.archived_photo || 'none'}`);
  console.log(`  cropped_photo: ${p.cropped_photo || 'none'}`);
  console.log(`  thumbnail_blob: ${p.thumbnail_blob || 'none'}`);
  console.log(`  split: ${p.split_detection?.isTwoPageSpread || false}`);
  console.log(`  crop: ${JSON.stringify(p.crop)}`);
}

// OCR content comparison for pages 12 and 14
console.log('\n=== OCR comparison: pages 12 vs 14 ===');
const p12 = pages.find(p => p.page_number === 12);
const p14 = pages.find(p => p.page_number === 14);
console.log('pg 12 OCR (first 200):', p12?.ocr?.data?.substring(0, 200));
console.log('pg 14 OCR (first 200):', p14?.ocr?.data?.substring(0, 200));

// Check the provider — EFM books have specific URL patterns
console.log('\n=== Image source ===');
console.log(JSON.stringify(book.image_source, null, 2));

await client.close();
