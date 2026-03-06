import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const book = await db.collection('books').findOne({ slug: 'opus-mago-cabbalisticum-et-theosophicum-welling-2' });
if (!book) { console.log('Book not found'); process.exit(1); }
console.log('Book ID:', book.id || book._id);
console.log('Title:', book.title);
console.log('Pages count (cached):', book.pages_count);
console.log('IA identifier:', book.ia_identifier);
console.log('Provider:', book.image_source?.provider);
console.log('Needs splitting:', book.needs_splitting);
console.log('Split check:', JSON.stringify(book.split_check));

const bookId = book.id || book._id.toString();
const pages = await db.collection('pages').find({ book_id: bookId }).sort({ page_number: 1 }).toArray();
console.log('\nTotal pages in DB:', pages.length);

// Check page numbers
const pageNums = pages.map(p => p.page_number);
const dupes = pageNums.filter((n, i) => pageNums.indexOf(n) !== i);
if (dupes.length > 0) {
  console.log('\nDuplicate page numbers:', [...new Set(dupes)].sort((a, b) => a - b));
  // Show details of dupes
  for (const d of [...new Set(dupes)].sort((a, b) => a - b).slice(0, 10)) {
    const dupPages = pages.filter(p => p.page_number === d);
    for (const p of dupPages) {
      console.log(`  pg ${d}: id=${p.id || p._id} photo=${(p.photo || '').substring(0, 60)}`);
    }
  }
}

// Check first 30 pages for image issues
console.log('\nFirst 30 pages:');
for (const p of pages.slice(0, 30)) {
  const photo = p.cropped_photo || p.archived_photo || p.photo || p.photo_original;
  const hasOcr = !!p.ocr?.data;
  const isSplit = p.split_detection?.isTwoPageSpread || false;
  const hasCrop = !!p.cropped_photo;
  console.log(`  pg ${p.page_number}: photo=${photo ? photo.substring(0, 70) + '...' : 'NONE'} | crop=${hasCrop} | split=${isSplit} | ocr=${hasOcr}`);
}

await client.close();
