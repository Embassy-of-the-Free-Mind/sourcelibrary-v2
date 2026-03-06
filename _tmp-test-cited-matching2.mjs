import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const env = readFileSync('.env.production.local', 'utf8');
const uri = env.match(/MONGODB_URI="?([^"\n]+)"?/)?.[1]?.trim();
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1 } }
).toArray();

// Parse cited works from generated TS
const tsContent = readFileSync('src/data/shwep-cited-works.ts', 'utf8');
const allWorks = new Set();
const epWorks = {};
for (const line of tsContent.split('\n')) {
  const m = line.match(/^\s+(\d+): \[(.*)\],$/);
  if (!m) continue;
  const n = parseInt(m[1]);
  const works = m[2].match(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)?.map(w => w.slice(1, -1).replace(/\\'/g, "'")) || [];
  epWorks[n] = works;
  for (const w of works) allWorks.add(w);
}

// Load current tags
const epTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epTagMap = {};
for (const m of epTs.matchAll(/\{ number: (\d+),.*?tags: \[(.*?)\]/gs)) {
  const n = parseInt(m[1]);
  epTagMap[n] = m[2].trim() ? m[2].split(',').map(t => t.trim().replace(/^'|'$/g, '')) : [];
}

// Use word-boundary matching + max 30 match cap
const MAX_MATCHES = 30;

function makePattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped + '\\b', 'i');
}

// Build term → books mapping
const termBooks = {};
const skippedTerms = [];
for (const term of allWorks) {
  const pattern = makePattern(term);
  const matches = books.filter(b =>
    pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
  );
  if (matches.length > MAX_MATCHES) {
    skippedTerms.push({ term, count: matches.length });
    continue;
  }
  if (matches.length > 0) {
    termBooks[term] = matches;
  }
}

// Also match tags with original substring approach (keep curated tags working)
const allTags = new Set();
for (const tags of Object.values(epTagMap)) {
  for (const t of tags) allTags.add(t);
}
const tagBooks = {};
for (const tag of allTags) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');
  const matches = books.filter(b =>
    pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
  );
  if (matches.length > 0) {
    tagBooks[tag] = matches;
  }
}

// Episode coverage
const epNumbers = Object.keys(epTagMap).map(Number).sort((a, b) => a - b);

let epsWithBooksOld = 0, epsWithBooksNew = 0;
let totalMatchesOld = 0, totalMatchesNew = 0;
const improvements = [];

for (const n of epNumbers) {
  // Old: tag-based matching
  const tags = epTagMap[n] || [];
  const oldIds = new Set();
  for (const tag of tags) {
    for (const b of (tagBooks[tag] || [])) oldIds.add(b._id.toString());
  }
  if (oldIds.size > 0) epsWithBooksOld++;
  totalMatchesOld += oldIds.size;

  // New: cited works + tags combined
  const citedWorks = epWorks[n] || [];
  const newIds = new Set();
  // Tags first (curated, keep)
  for (const tag of tags) {
    for (const b of (tagBooks[tag] || [])) newIds.add(b._id.toString());
  }
  // Then cited works
  for (const work of citedWorks) {
    for (const b of (termBooks[work] || [])) newIds.add(b._id.toString());
  }
  if (newIds.size > 0) epsWithBooksNew++;
  totalMatchesNew += newIds.size;

  improvements.push({ n, old: oldIds.size, new: newIds.size, gain: newIds.size - oldIds.size });
}

// Unique books matched
const allOldIds = new Set();
const allNewIds = new Set();
for (const n of epNumbers) {
  const tags = epTagMap[n] || [];
  for (const tag of tags) {
    for (const b of (tagBooks[tag] || [])) allOldIds.add(b._id.toString());
  }
  const citedWorks = epWorks[n] || [];
  for (const tag of tags) {
    for (const b of (tagBooks[tag] || [])) allNewIds.add(b._id.toString());
  }
  for (const work of citedWorks) {
    for (const b of (termBooks[work] || [])) allNewIds.add(b._id.toString());
  }
}

console.log('=== COMPARISON ===');
console.log(`Books in collection: ${books.length}`);
console.log();
console.log('Old (tags only):');
console.log(`  Unique books matched: ${allOldIds.size}`);
console.log(`  Episodes with books: ${epsWithBooksOld} / ${epNumbers.length} (${(100*epsWithBooksOld/epNumbers.length).toFixed(0)}%)`);
console.log(`  Total book-episode links: ${totalMatchesOld}`);
console.log();
console.log('New (cited works + tags, word-boundary, max 30 cap):');
console.log(`  Unique books matched: ${allNewIds.size}`);
console.log(`  Episodes with books: ${epsWithBooksNew} / ${epNumbers.length} (${(100*epsWithBooksNew/epNumbers.length).toFixed(0)}%)`);
console.log(`  Total book-episode links: ${totalMatchesNew}`);
console.log();

console.log(`Skipped ${skippedTerms.length} too-broad terms (>${MAX_MATCHES} matches):`);
for (const { term, count } of skippedTerms.sort((a, b) => b.count - a.count).slice(0, 15)) {
  console.log(`  "${term}" → ${count} books`);
}

console.log();
console.log('Biggest improvements:');
for (const x of improvements.filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 10)) {
  console.log(`  Episode ${x.n}: ${x.old} → ${x.new} books (+${x.gain})`);
}

console.log();
const wasZero = improvements.filter(x => x.old === 0 && x.new > 0);
console.log(`Previously 0-book episodes now with books: ${wasZero.length}`);
for (const x of wasZero.slice(0, 15)) {
  console.log(`  Episode ${x.n}: 0 → ${x.new} books`);
}

// Check for any episodes with very high book counts (>50) that seem suspicious
const high = improvements.filter(x => x.new > 50).sort((a, b) => b.new - a.new);
if (high.length > 0) {
  console.log();
  console.log('High book count episodes (>50 — check for false positives):');
  for (const x of high.slice(0, 5)) {
    console.log(`  Episode ${x.n}: ${x.new} books`);
  }
}

await client.close();
