import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookId = '6984e84db96022f6fa69b4c8';

// Get pages around the suspected duplicates (10-16)
const pages = await db.collection('pages').find({
  book_id: bookId,
  page_number: { $gte: 10, $lte: 16 }
}).sort({ page_number: 1 }).toArray();

console.log('=== Pages 10-16: checking for identical source images ===\n');
for (const p of pages) {
  console.log(`pg ${p.page_number}:`);
  console.log(`  original spread: ${p.photo_original}`);
  console.log(`  crop: ${JSON.stringify(p.crop)}`);
  console.log(`  page_type: ${p.ocr?.data?.match(/<page-type>(.*?)<\/page-type>/)?.[1] || 'unknown'}`);
  console.log(`  OCR first line: ${(p.ocr?.data || '').split('\n').find(l => l.trim() && !l.startsWith('<')) || 'none'}`);
  console.log();
}

// Check if pages 11-12's spread is the same image as 13-14's spread
const p11 = pages.find(p => p.page_number === 11);
const p13 = pages.find(p => p.page_number === 13);
console.log('Same spread image for 11-12 vs 13-14?', p11?.photo_original === p13?.photo_original);
console.log('11-12 spread:', p11?.photo_original);
console.log('13-14 spread:', p13?.photo_original);

// Check all pages with thumbnail_blob issues
console.log('\n=== Checking thumbnail_blob values for first 10 pages ===');
const first10 = await db.collection('pages').find({
  book_id: bookId,
  page_number: { $lte: 10 }
}).sort({ page_number: 1 }).toArray();

for (const p of first10) {
  console.log(`pg ${p.page_number}: thumbnail_blob=${p.thumbnail_blob || 'NONE'}`);
}

await client.close();
