import { MongoClient } from 'mongodb';
import fs from 'fs';
const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const c2 = new MongoClient(URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await c2.connect();
const db = c2.db('bookstore');

// Use aggregation to find books with failed archived_photo on their first page
const results = await db.collection('pages').aggregate([
  { $match: { archived_photo: /^failed:/ } },
  { $group: { _id: '$book_id' } },
  { $lookup: { from: 'books', localField: '_id', foreignField: 'id', as: 'book' } },
  { $unwind: '$book' },
  { $match: { 'book.ai_metadata.enriched_at': { $exists: false } } },
  { $project: {
    id: '$book.id', title: '$book.display_title', fallback_title: '$book.title',
    author: '$book.author', year: '$book.year', published: '$book.published',
    pages_count: '$book.pages_count', language: '$book.language',
    ia_identifier: '$book.ia_identifier'
  }},
  { $sort: { pages_count: -1 } }
]).toArray();

console.log(`Found ${results.length} unenriched books with failed archive images\n`);

for (const b of results) {
  const t = b.title || b.fallback_title || '?';
  const yr = b.year || b.published || '?';
  console.log(`${t.substring(0, 70)}`);
  console.log(`  ${b.author || '?'} | ${yr} | ${b.pages_count || '?'}pp | ${b.language || '?'}`);
  console.log(`  https://sourcelibrary.org/book/${b.id}`);
  console.log();
}

await c2.close();
