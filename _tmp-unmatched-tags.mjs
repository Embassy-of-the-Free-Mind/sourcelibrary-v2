import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const tags = new Set();
const re = /tags: \[(.*?)\]/g;
let m;
while ((m = re.exec(ts)) !== null) {
  if (!m[1].trim()) continue;
  m[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => tags.add(t));
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = await client.db('bookstore').collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1 } }
).toArray();

const matched = [];
const unmatched = [];

for (const tag of [...tags].sort()) {
  const pattern = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const hits = books.filter(b => 
    pattern.test(b.title || '') || pattern.test(b.display_title || '') || pattern.test(b.author || '')
  );
  if (hits.length > 0) {
    matched.push({ tag, count: hits.length });
  } else {
    unmatched.push(tag);
  }
}

console.log(`\n=== ${unmatched.length} TAGS WITH NO MATCHING BOOK ===\n`);
for (const tag of unmatched) {
  console.log(`  - ${tag}`);
}

console.log(`\n=== Summary ===`);
console.log(`Total tags: ${tags.size}`);
console.log(`Matched: ${matched.length}`);
console.log(`Unmatched: ${unmatched.length}`);

await client.close();
