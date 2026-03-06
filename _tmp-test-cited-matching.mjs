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

// Load cited works module (parse it from generated TS)
const tsContent = readFileSync('src/data/shwep-cited-works.ts', 'utf8');
const worksMatch = tsContent.match(/\{([\s\S]*?)\n\};/);
const allWorks = new Set();
const epWorks = {};
for (const line of worksMatch[1].split('\n')) {
  const m = line.match(/^\s+(\d+): \[(.*)\],$/);
  if (!m) continue;
  const n = parseInt(m[1]);
  const works = m[2].match(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)?.map(w => w.slice(1, -1).replace(/\\'/g, "'")) || [];
  epWorks[n] = works;
  for (const w of works) allWorks.add(w);
}

// Also load current tags
const epTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const allTags = new Set();
const tagRe = /tags: \[(.*?)\]/g;
let tm;
while ((tm = tagRe.exec(epTs)) !== null) {
  if (!tm[1].trim()) continue;
  tm[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => allTags.add(t));
}

console.log(`Books in collection: ${books.length}`);
console.log(`Unique tags (old system): ${allTags.size}`);
console.log(`Unique cited works (new system): ${allWorks.size}`);
console.log(`Episodes with cited works: ${Object.keys(epWorks).length}`);

// Match cited works against books (same regex approach as page.tsx)
const workBooks = {};
let matchedBookIds = new Set();
for (const work of allWorks) {
  const pattern = new RegExp(work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const matches = books.filter(b => {
    return pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '');
  });
  if (matches.length > 0) {
    workBooks[work] = matches;
    for (const b of matches) matchedBookIds.add(b._id.toString());
  }
}

// Match tags against books for comparison
const tagBookIds = new Set();
for (const tag of allTags) {
  const pattern = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const matches = books.filter(b => {
    return pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '');
  });
  for (const b of matches) tagBookIds.add(b._id.toString());
}

console.log(`\nBooks matched by tags (old): ${tagBookIds.size}`);
console.log(`Books matched by cited works (new): ${matchedBookIds.size}`);
console.log(`New books found: ${[...matchedBookIds].filter(id => !tagBookIds.has(id)).length}`);

// Episode coverage comparison
const epTsContent = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epNumbers = [...epTsContent.matchAll(/number: (\d+)/g)].map(m => parseInt(m[1]));

let epsWithBooksOld = 0;
let epsWithBooksNew = 0;
let epsWithBooksOldCounts = [];
let epsWithBooksNewCounts = [];

// Extract tags per episode
const epTagMap = {};
const episodeBlocks = epTsContent.matchAll(/\{ number: (\d+),.*?tags: \[(.*?)\]/gs);
for (const eb of episodeBlocks) {
  const n = parseInt(eb[1]);
  const tags = eb[2].trim() ? eb[2].split(',').map(t => t.trim().replace(/^'|'$/g, '')) : [];
  epTagMap[n] = tags;
}

for (const n of epNumbers) {
  // Old: count books from tags
  const tags = epTagMap[n] || [];
  const oldBooks = new Set();
  for (const tag of tags) {
    const pattern = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    books.filter(b => pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || ''))
      .forEach(b => oldBooks.add(b._id.toString()));
  }
  if (oldBooks.size > 0) epsWithBooksOld++;
  epsWithBooksOldCounts.push({ n, count: oldBooks.size });

  // New: count books from cited works + tags
  const citedWorks = epWorks[n] || [];
  const combined = new Set([...tags, ...citedWorks]);
  const newBooks = new Set();
  for (const term of combined) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    books.filter(b => pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || ''))
      .forEach(b => newBooks.add(b._id.toString()));
  }
  if (newBooks.size > 0) epsWithBooksNew++;
  epsWithBooksNewCounts.push({ n, count: newBooks.size });
}

console.log(`\nEpisode coverage:`);
console.log(`  Episodes with books (old tags): ${epsWithBooksOld} / ${epNumbers.length} (${(100*epsWithBooksOld/epNumbers.length).toFixed(0)}%)`);
console.log(`  Episodes with books (new cited works): ${epsWithBooksNew} / ${epNumbers.length} (${(100*epsWithBooksNew/epNumbers.length).toFixed(0)}%)`);

// Show biggest improvements
const improvements = epsWithBooksNewCounts
  .map((nc, i) => ({ n: nc.n, oldCount: epsWithBooksOldCounts[i].count, newCount: nc.count, gain: nc.count - epsWithBooksOldCounts[i].count }))
  .filter(x => x.gain > 0)
  .sort((a, b) => b.gain - a.gain);
console.log(`\nBiggest improvements (top 10):`);
for (const x of improvements.slice(0, 10)) {
  console.log(`  Episode ${x.n}: ${x.oldCount} → ${x.newCount} books (+${x.gain})`);
}

// Show previously-zero episodes that now have books
const wasZero = improvements.filter(x => x.oldCount === 0);
console.log(`\nPreviously 0-book episodes now with books: ${wasZero.length}`);
for (const x of wasZero.slice(0, 10)) {
  console.log(`  Episode ${x.n}: 0 → ${x.newCount} books`);
}

// Check for any overly-broad matches (>20 books for a single work)
const broadMatches = Object.entries(workBooks)
  .filter(([_, matches]) => matches.length > 15)
  .sort((a, b) => b[1].length - a[1].length);
if (broadMatches.length > 0) {
  console.log(`\nPotentially too-broad matches (>15 books):`);
  for (const [work, matches] of broadMatches.slice(0, 10)) {
    console.log(`  "${work}" → ${matches.length} books`);
  }
}

await client.close();
