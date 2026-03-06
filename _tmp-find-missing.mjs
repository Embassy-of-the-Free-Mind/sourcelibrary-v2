import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Extract all unique tags from TS file
const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const tags = new Set();
const re = /tags: \[(.*?)\]/g;
let m;
while ((m = re.exec(ts)) !== null) {
  if (!m[1].trim()) continue;
  m[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => tags.add(t));
}

console.log(`Total unique SHWEP tags: ${tags.size}\n`);

// Connect to MongoDB and check each tag
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const found = [];
const missing = [];

for (const tag of [...tags].sort()) {
  const lower = tag.toLowerCase();
  
  // Try exact match on title, display_title, author
  const exact = await books.findOne({
    deleted: { $ne: true },
    $or: [
      { title: { $regex: new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { display_title: { $regex: new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { author: { $regex: new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
    ]
  });
  
  if (exact) {
    found.push({ tag, match: 'exact', title: exact.display_title || exact.title, id: exact._id });
    continue;
  }
  
  // Try substring match (12+ chars)
  if (tag.length >= 12) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sub = await books.findOne({
      deleted: { $ne: true },
      $or: [
        { title: { $regex: new RegExp(escaped, 'i') } },
        { display_title: { $regex: new RegExp(escaped, 'i') } },
        { author: { $regex: new RegExp(escaped, 'i') } },
      ]
    });
    if (sub) {
      found.push({ tag, match: 'substring', title: sub.display_title || sub.title, id: sub._id });
      continue;
    }
  }
  
  missing.push(tag);
}

console.log(`=== FOUND (${found.length} tags match existing books) ===`);
for (const f of found) {
  console.log(`  [${f.match}] "${f.tag}" → ${f.title}`);
}

console.log(`\n=== MISSING (${missing.length} tags have no matching book) ===`);
for (const m of missing) {
  console.log(`  "${m}"`);
}

await client.close();
