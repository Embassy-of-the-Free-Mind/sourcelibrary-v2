import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const allBooks = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1 } }
).toArray();

// Read cited works
const cwTs = readFileSync('src/data/shwep-cited-works.ts', 'utf8');
const episodeCitedWorks = {};
const cwRe = /^\s+(\d+): \[(.*?)\],?$/gm;
let m;
while ((m = cwRe.exec(cwTs)) !== null) {
  if (m[2].trim()) {
    episodeCitedWorks[parseInt(m[1])] = m[2].split("', '").map(w => w.replace(/^'|'$/g, ''));
  }
}

// Read episodes with tags
const episodesTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epTags = {};
const tags = new Set();
const epBlocks = episodesTs.split(/\{ number:/g).slice(1);
epBlocks.forEach(block => {
  const numMatch = block.match(/^\s*(\d+)/);
  const tagsMatch = block.match(/tags: \[(.*?)\]/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    const t = [];
    if (tagsMatch && tagsMatch[1].trim()) {
      tagsMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).forEach(s => { t.push(s); tags.add(s); });
    }
    epTags[num] = t;
  }
});

// Build allTerms
const allCitedWorks = new Set();
Object.values(episodeCitedWorks).forEach(ws => ws.forEach(w => allCitedWorks.add(w)));
const allTerms = new Set([...tags, ...allCitedWorks]);

// Match terms to books
const MAX = 30;
const matchedTerms = new Set();
for (const term of allTerms) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isTag = tags.has(term);
  const pattern = isTag
    ? new RegExp(escaped, 'i')
    : new RegExp('\\b' + escaped + '\\b', 'i');
  const matches = allBooks.filter(b =>
    pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
  );
  if (!isTag && matches.length > MAX) continue;
  if (matches.length > 0) matchedTerms.add(term);
}

// Count zero-match episodes
const episodeNumbers = Object.keys(epTags).map(Number);
let zeroCount = 0;
const zeroEps = [];
for (const epNum of episodeNumbers.sort((a,b) => a-b)) {
  const epTermsArr = [...(epTags[epNum] || []), ...(episodeCitedWorks[epNum] || [])];
  const epTerms = new Set(epTermsArr);
  let hasMatch = false;
  for (const t of epTerms) {
    if (matchedTerms.has(t)) { hasMatch = true; break; }
  }
  if (!hasMatch) {
    zeroCount++;
    zeroEps.push(epNum);
  }
}

const totalEps = episodeNumbers.length;
const withBooks = totalEps - zeroEps.length;
console.log(`Total episodes: ${totalEps}`);
console.log(`With books: ${withBooks} (${(withBooks/totalEps*100).toFixed(0)}%)`);
console.log(`Zero-match: ${zeroEps.length}`);
console.log(`Zero-match eps: ${zeroEps.join(', ')}`);

await client.close();
