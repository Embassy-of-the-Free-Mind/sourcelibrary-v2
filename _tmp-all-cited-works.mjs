import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Load ALL cited works from crawled data
const lines = readFileSync('/tmp/shwep_crawled_all.jsonl', 'utf8').trim().split('\n');
const allWorks = new Map(); // work -> [episode numbers]

for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (!ep.citedWorks || !ep.n) continue;
    for (const work of ep.citedWorks) {
      const clean = work.replace(/[.,;:]+$/, '').trim();
      if (clean.length < 4) continue;
      if (!allWorks.has(clean)) allWorks.set(clean, []);
      allWorks.get(clean).push(ep.n);
    }
  } catch {}
}

// Check which cited works have books in our collection
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = await client.db('bookstore').collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1 } }
).toArray();

// Filter: only works that look like actual primary source titles (not journal articles, not generic words)
function isLikelyPrimarySource(work) {
  if (work.length < 6) return false;
  if (/^[a-z]/.test(work)) return false; // starts lowercase
  // Skip journal/modern references
  if (/^(Journal|Proceedings|Transactions|Bulletin|American|Harvard|Review|Zeitschrift|Revue|Oxford|Cambridge|University|Press|Edition|Studies|History of|Introduction to|Survey of)\b/.test(work)) return false;
  if (work.includes('&#')) return false;
  // Skip very common English words that aren't titles
  if (['The','This','That','These','Those','There','Their','Where','Which','While','After','Before','About','Against','Through','Between','Without','Within','During'].includes(work)) return false;
  return true;
}

function hasMatch(work) {
  const pattern = new RegExp(work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return books.some(b => 
    pattern.test(b.title || '') || pattern.test(b.display_title || '') || pattern.test(b.author || '')
  );
}

// Find cited works that DON'T match any book and look like primary sources
const unmatched = [];
for (const [work, eps] of allWorks) {
  if (!isLikelyPrimarySource(work)) continue;
  if (hasMatch(work)) continue;
  unmatched.push({ work, eps, count: eps.length });
}

// Sort by frequency (most cited first)
unmatched.sort((a, b) => b.count - a.count);

console.log(`Total unique cited works: ${allWorks.size}`);
console.log(`Likely primary sources without matches: ${unmatched.length}\n`);

console.log('=== TOP UNMATCHED (cited in 2+ episodes) ===\n');
for (const { work, eps, count } of unmatched.filter(u => u.count >= 2)) {
  console.log(`  ${count}x  ${work}  (eps: ${eps.join(', ')})`);
}

console.log('\n=== SINGLE-EPISODE UNMATCHED ===\n');
for (const { work, eps } of unmatched.filter(u => u.count === 1).slice(0, 80)) {
  console.log(`  ${work}  (ep ${eps[0]})`);
}

await client.close();
