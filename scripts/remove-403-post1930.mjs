import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const client = new MongoClient(URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');

const dryRun = !process.argv.includes('--apply');

// 7 unique texts to keep
const keepIds = new Set([
  '699259873d2d40d1b0591298', // Blue Cliff Record
  '69924f31c8e06d213c5d3756', // Macrobius: Saturnalia
  '69906065ef12272ffdc8cfc2', // Robert Hooke's Diary
  '6992584f723cad8be263c18f', // Self-Knowledge (Atmabodha)
  '69924408bc722ec0ee80b69f', // Haran Gawaita
  '699259893d2d40d1b0591556', // Gateless Gate
  '699249b1a2d53df4853be919', // Engi-shiki
]);

// Find unenriched books with failed archived_photo, post-1930
const results = await db.collection('pages').aggregate([
  { $match: { archived_photo: /^failed:/ } },
  { $group: { _id: '$book_id' } },
  { $lookup: { from: 'books', localField: '_id', foreignField: 'id', as: 'book' } },
  { $unwind: '$book' },
  { $match: { 'book.ai_metadata.enriched_at': { $exists: false } } },
  { $replaceRoot: { newRoot: '$book' } }
]).toArray();

// Filter to post-1930, excluding the 7 unique texts
const post1930 = results.filter(b => {
  const year = b.year || parseInt(b.published) || 0;
  return year > 1930 && !keepIds.has(b.id);
});

console.log(`Found ${post1930.length} post-1930 books with 403'd images`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}\n`);

let removed = 0;
let totalPages = 0;

for (const book of post1930) {
  const title = (book.display_title || book.title || '?').substring(0, 70);
  const year = book.year || book.published || '?';

  // Get all pages for this book
  const pages = await db.collection('pages')
    .find({ book_id: book.id })
    .toArray();

  const pageCount = pages.length;
  totalPages += pageCount;

  console.log(`${dryRun ? '[DRY] ' : ''}Removing: ${title} (${year}, ${pageCount}pp)`);

  if (!dryRun) {
    // Move to deleted_books (soft delete)
    await db.collection('deleted_books').insertOne({
      ...book,
      pages,
      deleted_at: new Date(),
      deleted_reason: 'Post-1930 book with 403 IA images, cannot be processed',
      original_id: book._id
    });

    // Remove pages
    await db.collection('pages').deleteMany({ book_id: book.id });

    // Remove book
    await db.collection('books').deleteOne({ _id: book._id });

    // Audit log
    await db.collection('audit_log').insertOne({
      action: 'book_deleted',
      book_id: book.id,
      book_title: book.display_title || book.title,
      pages_affected: pageCount,
      metadata: {
        recoverable: true,
        reason: 'Post-1930 book with 403 IA images',
        year: year,
        batch: 'remove-403-post1930'
      },
      created_at: new Date()
    });

    removed++;
  }
}

console.log(`\n${dryRun ? 'Would remove' : 'Removed'}: ${post1930.length} books, ${totalPages} pages`);

await client.close();
