import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// What do we actually have that's pre-1800?
const oldBooks = await db.collection('books').find(
  { deleted: { $ne: true }, year: { $lte: 1800 } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1 } }
).sort({ year: 1 }).toArray();

console.log(`Pre-1800 books in collection: ${oldBooks.length}\n`);

// Sample of what we have
const subjects = {};
for (const b of oldBooks) {
  const t = (b.display_title || b.title || '').toLowerCase();
  const a = (b.author || '').toLowerCase();
  
  // Categorize by likely SHWEP relevance
  let cat = 'other';
  if (t.includes('hermet') || t.includes('hermes') || a.includes('hermes')) cat = 'hermetic';
  else if (t.includes('plato') || t.includes('platon') || a.includes('plato')) cat = 'platonic';
  else if (t.includes('aristotel') || a.includes('aristotel')) cat = 'aristotelian';
  else if (t.includes('plotin') || a.includes('plotin')) cat = 'neoplatonic';
  else if (t.includes('proclus') || a.includes('proclus') || t.includes('iamblich') || a.includes('iamblich')) cat = 'neoplatonic';
  else if (t.includes('porphyr') || a.includes('porphyr')) cat = 'neoplatonic';
  else if (t.includes('alch') || t.includes('chymi') || t.includes('chemi')) cat = 'alchemy';
  else if (t.includes('magic') || t.includes('magi') || t.includes('occult')) cat = 'magic';
  else if (t.includes('cabbal') || t.includes('kabbal') || t.includes('zohar')) cat = 'kabbalah';
  else if (t.includes('gnostic') || t.includes('gnosis')) cat = 'gnostic';
  else if (t.includes('astrol') || t.includes('ptolem')) cat = 'astrology';
  else if (t.includes('rosicru') || t.includes('fama')) cat = 'rosicrucian';
  else if (a.includes('cicero') || a.includes('plutarch') || a.includes('seneca') || a.includes('stoic')) cat = 'classical';
  else if (a.includes('origen') || a.includes('clement') || a.includes('augustin') || a.includes('basil') || a.includes('gregor')) cat = 'church_fathers';
  else if (t.includes('oracle') || t.includes('chald') || t.includes('sibyll')) cat = 'oracles';
  else if (t.includes('orphe') || t.includes('orphic') || t.includes('pythagor')) cat = 'pythagorean';
  
  if (!subjects[cat]) subjects[cat] = [];
  subjects[cat].push(b);
}

// Show SHWEP-relevant categories
const shwepCats = ['hermetic', 'neoplatonic', 'platonic', 'alchemy', 'magic', 'gnostic', 'kabbalah', 'astrology', 'oracles', 'pythagorean', 'church_fathers', 'classical', 'rosicrucian'];
for (const cat of shwepCats) {
  const books = subjects[cat] || [];
  if (books.length === 0) continue;
  console.log(`\n=== ${cat.toUpperCase()} (${books.length} books) ===`);
  for (const b of books.slice(0, 8)) {
    console.log(`  ${b.year || '?'}  ${(b.display_title || b.title || '').slice(0, 70)}  [${b.author || '?'}]`);
  }
  if (books.length > 8) console.log(`  ... and ${books.length - 8} more`);
}

// Now check: how many of these pre-1800 books are NOT matched by any SHWEP tag?
const { readFileSync } = await import('fs');
const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const tags = new Set();
const re = /tags: \[(.*?)\]/g;
let m;
while ((m = re.exec(ts)) !== null) {
  if (!m[1].trim()) continue;
  m[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => tags.add(t));
}

let matchedOld = 0, unmatchedOld = 0;
const unmatchedShwepRelevant = [];

for (const b of oldBooks) {
  let matched = false;
  for (const tag of tags) {
    const pattern = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (pattern.test(b.title || '') || pattern.test(b.display_title || '') || pattern.test(b.author || '')) {
      matched = true;
      break;
    }
  }
  if (matched) {
    matchedOld++;
  } else {
    unmatchedOld++;
    const t = (b.display_title || b.title || '').toLowerCase();
    const a = (b.author || '').toLowerCase();
    const relevant = shwepCats.some(cat => {
      if (cat === 'other') return false;
      return (subjects[cat] || []).some(sb => sb._id.toString() === b._id.toString());
    });
    if (relevant) {
      unmatchedShwepRelevant.push(b);
    }
  }
}

console.log(`\n\n=== COVERAGE ===`);
console.log(`Pre-1800 books matched by SHWEP tags: ${matchedOld}`);
console.log(`Pre-1800 books NOT matched: ${unmatchedOld}`);
console.log(`SHWEP-relevant but unmatched: ${unmatchedShwepRelevant.length}\n`);

console.log('=== SHWEP-RELEVANT BOOKS WE HAVE BUT AREN\'T LINKING ===\n');
for (const b of unmatchedShwepRelevant.sort((a,b) => (a.year||9999) - (b.year||9999)).slice(0, 50)) {
  console.log(`  ${b.year || '?'}  ${(b.display_title || b.title || '').slice(0, 80)}  [${b.author || '?'}]`);
}

await client.close();
