import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1 } }
).toArray();

// Load episodes
const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epRegex = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*period:\s*"([^"]+)",\s*tags:\s*\[(.*?)\]\s*\}/g;
let m;
const episodes = [];
while ((m = epRegex.exec(ts)) !== null) {
  const tags = m[5].trim() ? m[5].split(',').map(t => t.trim().replace(/^'|'$/g, '')) : [];
  episodes.push({ number: parseInt(m[1]), title: m[2], period: m[4], tags });
}

// For each episode, count how many books match via tags
let withBooks = 0, withoutBooks = 0;
const poorEpisodes = [];
const richEpisodes = [];

for (const ep of episodes) {
  let bookCount = 0;
  const seenIds = new Set();
  for (const tag of ep.tags) {
    const pattern = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const b of books) {
      if (seenIds.has(b._id.toString())) continue;
      if (pattern.test(b.title || '') || pattern.test(b.display_title || '') || pattern.test(b.author || '')) {
        seenIds.add(b._id.toString());
        bookCount++;
      }
    }
  }
  
  if (bookCount > 0) {
    withBooks++;
    if (bookCount >= 15) richEpisodes.push({ ...ep, bookCount });
  } else {
    withoutBooks++;
    poorEpisodes.push(ep);
  }
}

console.log(`=== EPISODE COVERAGE ===`);
console.log(`Total episodes: ${episodes.length}`);
console.log(`With at least 1 book: ${withBooks} (${(withBooks/episodes.length*100).toFixed(0)}%)`);
console.log(`With 0 books: ${withoutBooks} (${(withoutBooks/episodes.length*100).toFixed(0)}%)`);

console.log(`\n=== EPISODES WITH 0 BOOKS (${poorEpisodes.length}) ===\n`);
for (const ep of poorEpisodes.sort((a,b) => a.number - b.number)) {
  const tagStr = ep.tags.length > 0 ? ` [tags: ${ep.tags.join(', ')}]` : ' [no tags]';
  console.log(`  #${ep.number} ${ep.title}${tagStr}`);
}

// Load crawled data to see what cited works these episodes have
const lines = readFileSync('src/data/shwep-crawled.jsonl', 'utf8').trim().split('\n');
const epCited = new Map();
for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (ep.citedWorks?.length > 0) epCited.set(ep.n, ep.citedWorks);
  } catch {}
}

console.log(`\n=== 0-BOOK EPISODES THAT HAVE CITED WORKS ===\n`);
for (const ep of poorEpisodes) {
  const cited = epCited.get(ep.number);
  if (cited && cited.length > 0) {
    console.log(`  #${ep.number} ${ep.title} → ${cited.length} cited works`);
  }
}

await client.close();
