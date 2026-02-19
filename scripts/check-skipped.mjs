import { MongoClient } from 'mongodb';
import fs from 'fs';
const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const c2 = new MongoClient(URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await c2.connect();
const db = c2.db('bookstore');

// Get unenriched books sorted by pages_count desc (same as enrichment script)
const books = await db.collection('books')
  .find({ 'ai_metadata.enriched_at': { $exists: false } })
  .sort({ pages_count: -1 })
  .limit(30)
  .project({ id: 1, title: 1, display_title: 1, pages_count: 1, image_source: 1, ia_identifier: 1 })
  .toArray();

for (const book of books) {
  const page = await db.collection('pages')
    .findOne({ book_id: book.id }, { projection: { photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1 } });

  const provider = book.image_source?.provider || 'unknown';
  const hasArchived = !!page?.archived_photo;
  const photoUrl = page?.cropped_photo || page?.archived_photo || page?.photo || page?.photo_original || 'none';
  const shortUrl = photoUrl.length > 80 ? photoUrl.substring(0, 80) + '...' : photoUrl;

  console.log(`${book.display_title || book.title}`);
  console.log(`  https://sourcelibrary.org/book/${book.id}`);
  console.log(`  pages: ${book.pages_count} | provider: ${provider} | archived: ${hasArchived}`);
  console.log(`  image: ${shortUrl}`);
  console.log();
}

await c2.close();
