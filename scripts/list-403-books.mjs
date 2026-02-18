import { MongoClient } from 'mongodb';
import fs from 'fs';
const env = {};
try { const c = fs.readFileSync('.env.local','utf8'); for (const l of c.split('\n')) { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1].trim()]=v; } } } catch {}
const URI = process.env.MONGODB_URI || env.MONGODB_URI;
const c2 = new MongoClient(URI);
await c2.connect();
const db = c2.db('bookstore');

// Find books where ALL pages have failed:HTTP 403 archived_photo and photo also 403s
const books = await db.collection('books')
  .find({ 'ai_metadata.enriched_at': { $exists: false } })
  .sort({ pages_count: -1 })
  .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, pages_count: 1, language: 1, ia_identifier: 1, categories: 1 })
  .toArray();

let blocked = [];

for (const book of books) {
  // Check first page
  const page = await db.collection('pages')
    .findOne({ book_id: book.id }, { projection: { archived_photo: 1, photo: 1, photo_original: 1 } });

  if (!page) continue;

  const archived = page.archived_photo || '';
  const photo = page.photo || page.photo_original || '';

  // Book is blocked if archived_photo is a failure string AND photo is an IA URL
  if (archived.startsWith('failed:') && photo.includes('archive.org')) {
    blocked.push(book);
  }
}

console.log(`Found ${blocked.length} books with 403'd IA images\n`);

// Categorize
const modern = []; // Published after 1923 (likely copyrighted)
const historical = []; // Published before 1923 or unknown
const secondary = []; // Modern scholarly works ABOUT historical topics

for (const b of blocked) {
  const year = b.year || parseInt(b.published) || 0;
  const title = b.display_title || b.title || '';
  const isTranslation = /translat|transl\.|volume|vol\./i.test(title);
  const isSecondary = /history of|introduction to|study of|studies in|companion to|encyclopedia|handbook/i.test(title);

  if (isSecondary && year > 1900) {
    secondary.push({ ...b, _year: year });
  } else if (year > 1923) {
    modern.push({ ...b, _year: year });
  } else {
    historical.push({ ...b, _year: year });
  }
}

console.log(`=== MODERN SECONDARY WORKS (${secondary.length}) ===`);
console.log(`These are modern books ABOUT historical topics — candidates for removal\n`);
for (const b of secondary.sort((a,c) => c.pages_count - a.pages_count)) {
  console.log(`  ${b.display_title || b.title}`);
  console.log(`    ${b.author || '?'} | ${b._year || '?'} | ${b.pages_count}pp | ${b.language || '?'}`);
  console.log(`    https://sourcelibrary.org/book/${b.id}`);
}

console.log(`\n=== MODERN EDITIONS/TRANSLATIONS (${modern.length}) ===`);
console.log(`Post-1923 but may be translations of primary sources\n`);
for (const b of modern.sort((a,c) => c.pages_count - a.pages_count)) {
  console.log(`  ${b.display_title || b.title}`);
  console.log(`    ${b.author || '?'} | ${b._year || '?'} | ${b.pages_count}pp | ${b.language || '?'}`);
  console.log(`    https://sourcelibrary.org/book/${b.id}`);
}

console.log(`\n=== HISTORICAL / UNKNOWN DATE (${historical.length}) ===`);
console.log(`Pre-1923 or no date — likely primary sources, should keep\n`);
for (const b of historical.sort((a,c) => c.pages_count - a.pages_count)) {
  console.log(`  ${b.display_title || b.title}`);
  console.log(`    ${b.author || '?'} | ${b._year || '?'} | ${b.pages_count}pp | ${b.language || '?'}`);
  console.log(`    https://sourcelibrary.org/book/${b.id}`);
}

await c2.close();
