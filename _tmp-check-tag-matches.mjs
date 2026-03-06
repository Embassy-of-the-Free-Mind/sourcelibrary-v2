import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const regex = /tags: \[(.*?)\]/gs;
const allTags = new Set();
let m;
while ((m = regex.exec(ts)) !== null) {
  if (m[1].trim()) {
    m[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).forEach(t => allTags.add(t));
  }
}
console.log('Unique tags:', allTags.size);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = await client.db('bookstore').collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1 } }
).toArray();

let matched = 0, unmatched = 0;
const unmatchedList = [];
const matchedList = [];
for (const tag of allTags) {
  const p = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const has = books.some(b => p.test(b.author || '') || p.test(b.title || '') || p.test(b.display_title || ''));
  if (has) { matched++; matchedList.push(tag); }
  else { unmatched++; unmatchedList.push(tag); }
}

console.log('Match a book:', matched);
console.log('No match:', unmatched);
console.log('\nSample matched:', matchedList.slice(0, 20).join(', '));
console.log('\nSample unmatched:', unmatchedList.slice(0, 40).join('\n'));
await client.close();
