import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookId = '6984e84db96022f6fa69b4c8';
const pages = await db.collection('pages').find({ book_id: bookId }).sort({ page_number: 1 }).toArray();

// Check if consecutive pages share the same original image (split spreads)
console.log('=== Pages 10-20 detail ===');
for (const p of pages.filter(pg => pg.page_number >= 10 && pg.page_number <= 20)) {
  console.log(`\npg ${p.page_number}:`);
  console.log(`  id: ${p.id || p._id}`);
  console.log(`  photo_original: ${p.photo_original}`);
  console.log(`  photo: ${p.photo}`);
  console.log(`  cropped_photo: ${p.cropped_photo || 'none'}`);
  console.log(`  archived_photo: ${p.archived_photo || 'none'}`);
  console.log(`  split: ${p.split_detection?.isTwoPageSpread} pos=${p.split_detection?.splitPosition}`);
  console.log(`  crop: ${JSON.stringify(p.crop)}`);
  console.log(`  ocr first 80: ${(p.ocr?.data || '').substring(0, 80)}`);
}

// Check if ANY original photos repeat (same spread → two pages)
console.log('\n=== Checking for shared original photos (split spreads) ===');
const origMap = new Map();
for (const p of pages) {
  const orig = p.photo_original || p.photo;
  if (!origMap.has(orig)) origMap.set(orig, []);
  origMap.get(orig).push(p.page_number);
}
const shared = [...origMap.entries()].filter(([, nums]) => nums.length > 1);
console.log(`${shared.length} original images shared between split pages`);
for (const [url, nums] of shared.slice(0, 10)) {
  console.log(`  pages ${nums.join(',')} share: ${url.substring(0, 70)}...`);
}

// Check if pages 1-2 have valid accessible images
console.log('\n=== First 5 pages image URLs ===');
for (const p of pages.slice(0, 5)) {
  console.log(`pg ${p.page_number}: ${p.cropped_photo || p.archived_photo || p.photo || 'NONE'}`);
}

await client.close();
