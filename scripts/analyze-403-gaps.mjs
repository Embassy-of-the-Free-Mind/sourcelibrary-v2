import { MongoClient } from 'mongodb';
import fs from 'fs';

const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const client = new MongoClient(URI);
await client.connect();
const db = client.db('bookstore');

// Find unenriched books with failed archived_photo, post-1930
const results = await db.collection('pages').aggregate([
  { $match: { archived_photo: /^failed:/ } },
  { $group: { _id: '$book_id' } },
  { $lookup: { from: 'books', localField: '_id', foreignField: 'id', as: 'book' } },
  { $unwind: '$book' },
  { $match: { 'book.ai_metadata.enriched_at': { $exists: false } } },
  { $replaceRoot: { newRoot: '$book' } }
]).toArray();

const post1930 = results.filter(b => {
  const year = b.year || parseInt(b.published) || 0;
  return year > 1930;
});

// For each post-1930 book, check if we have a duplicate/alternate version
console.log(`Analyzing ${post1930.length} post-1930 books with 403'd images...\n`);

// Categories
const hasAlternate = [];
const uniqueAndValuable = [];
const modernSecondary = [];
const modernPopular = [];

for (const book of post1930) {
  const title = book.display_title || book.title || '';
  const author = book.author || '';
  const year = book.year || parseInt(book.published) || 0;

  // Check for alternate copies in our library (same work, different edition)
  // Search by similar title keywords
  const titleWords = title.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  const searchTerms = titleWords.slice(0, 3).join(' ');

  let alternates = [];
  if (searchTerms.length > 5) {
    alternates = await db.collection('books').find({
      id: { $ne: book.id },
      $text: { $search: searchTerms }
    }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1 } })
      .limit(5)
      .toArray();

    // Filter to relevant matches
    alternates = alternates.filter(a => {
      const aTitle = (a.display_title || a.title || '').toLowerCase();
      // Must share at least one significant word
      return titleWords.some(w => aTitle.includes(w.toLowerCase()));
    });
  }

  // Classify
  const isSecondary = /history of|introduction to|study of|studies in|companion to|encyclopedia|handbook|religion[s]? of|outline|manual of/i.test(title);
  const isModernWork = /wholeness|implicate|silence|what is life|search of the miraculous|cosmic music|new musical|northern indian music|dreamtime/i.test(title);

  const entry = {
    id: book.id,
    title: title.substring(0, 70),
    author: author.substring(0, 40),
    year,
    pages: book.pages_count || 0,
    language: book.language || '?',
    alternates: alternates.map(a => ({
      title: (a.display_title || a.title || '').substring(0, 50),
      year: a.year || a.published,
      pages: a.pages_count,
      ocr: a.pages_ocr || 0,
      url: `https://sourcelibrary.org/book/${a.id}`
    }))
  };

  if (alternates.length > 0) {
    hasAlternate.push(entry);
  } else if (isSecondary) {
    modernSecondary.push(entry);
  } else if (isModernWork) {
    modernPopular.push(entry);
  } else {
    uniqueAndValuable.push(entry);
  }
}

// Print results
console.log(`\n=== HAVE ALTERNATE VERSIONS (${hasAlternate.length}) ===`);
console.log('Safe to remove — we already have another copy\n');
for (const b of hasAlternate) {
  console.log(`  ${b.title} (${b.year}, ${b.pages}pp)`);
  for (const a of b.alternates) {
    console.log(`    ALT: ${a.title} (${a.year}, ${a.pages}pp, ${a.ocr} OCR'd)`);
    console.log(`         ${a.url}`);
  }
}

console.log(`\n=== MODERN SECONDARY/SCHOLARSHIP (${modernSecondary.length}) ===`);
console.log('Not primary sources — safe to remove\n');
for (const b of modernSecondary) {
  console.log(`  ${b.title} (${b.author}, ${b.year}, ${b.pages}pp)`);
}

console.log(`\n=== MODERN POPULAR WORKS (${modernPopular.length}) ===`);
console.log('Not historical primary sources — safe to remove\n');
for (const b of modernPopular) {
  console.log(`  ${b.title} (${b.author}, ${b.year}, ${b.pages}pp)`);
}

console.log(`\n=== UNIQUE TEXTS — WOULD CREATE GAPS (${uniqueAndValuable.length}) ===`);
console.log('These are our only copy — removal loses coverage of this text\n');
for (const b of uniqueAndValuable) {
  console.log(`  ${b.title} (${b.author}, ${b.year}, ${b.pages}pp, ${b.language})`);
  console.log(`    https://sourcelibrary.org/book/${b.id}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Safe to remove (have alternate):  ${hasAlternate.length}`);
console.log(`Safe to remove (secondary):       ${modernSecondary.length}`);
console.log(`Safe to remove (modern popular):   ${modernPopular.length}`);
console.log(`Would create gaps:                 ${uniqueAndValuable.length}`);

await client.close();
