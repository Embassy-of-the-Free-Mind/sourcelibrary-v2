import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';

// Load crawled data — dedupe by episode number (keep last entry)
const lines = readFileSync('/tmp/shwep_crawled_all.jsonl', 'utf8').trim().split('\n');
const epMap = new Map();
for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (ep.n !== undefined) epMap.set(ep.n, ep);
  } catch {}
}

// Noise: abbreviations, Latin/Greek terms, journal refs
function isNoise(w) {
  if (w.length < 5) return true;
  if (/^[a-z]/.test(w)) return true; // lowercase start = technical term
  if (/^(Journal|Proceedings|Transactions|Bulletin|American|Harvard|Review|Zeitschrift|Revue)\b/.test(w)) return true;
  if (w.includes('&#')) return true;
  if (['Idem', 'Corrigendum', 'ANRW', 'Plot', 'Strom', 'Trans-', 'Repres-', 'entations',
       'should', 'were', 'born', 'Religion', 'Culture', 'Fragments', 'Anonymous',
       'Compendium', 'Letters', 'Histories', 'Interpretation', 'Second Century',
       'Visions'].includes(w)) return true;
  return false;
}

function cleanTitle(w) {
  return w.replace(/[.,;:]+$/, '').trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1 } }
).toArray();

// Cache: does a cited work match a pre-1930 book by exact title or author?
const matchCache = new Map();
function workMatchesOldBooks(work) {
  if (matchCache.has(work)) return matchCache.get(work);
  if (isNoise(work)) { matchCache.set(work, false); return false; }
  const lower = work.toLowerCase();
  const matches = books.some(b => {
    // Exact match on title, display_title, or author (case-insensitive)
    const titleMatch = (b.title || '').toLowerCase() === lower
      || (b.display_title || '').toLowerCase() === lower
      || (b.author || '').toLowerCase() === lower;
    // Also allow the cited work to appear as a substantial part of the title
    // (e.g. "Enneads" matching "The Enneads of Plotinus")
    // but only if the cited work is long enough to be specific (12+ chars)
    const substringMatch = work.length >= 12 && (
      (b.title || '').toLowerCase().includes(lower)
      || (b.display_title || '').toLowerCase().includes(lower)
      || (b.author || '').toLowerCase().includes(lower)
    );
    if (!titleMatch && !substringMatch) return false;
    const year = b.year || (b.published ? parseInt(b.published) : null);
    return !year || year <= 1929;
  });
  matchCache.set(work, matches);
  return matches;
}

// Read current shwep-episodes.ts
const tsContent = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epRegex = /\{ number: (\d+),.*?tags: \[(.*?)\]/gs;
let m;
const currentTags = new Map();
while ((m = epRegex.exec(tsContent)) !== null) {
  const num = parseInt(m[1]);
  const tags = m[2].trim()
    ? m[2].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, ''))
    : [];
  currentTags.set(num, tags);
}

// For each crawled episode, find cited works matching pre-1930 books
const updates = [];
for (const [n, ep] of [...epMap.entries()].sort((a, b) => a[0] - b[0])) {
  if (!ep.citedWorks?.length) continue;

  const matchingTags = ep.citedWorks
    .map(cleanTitle)
    .filter(w => workMatchesOldBooks(w));

  const current = currentTags.get(n) || [];
  const merged = [...new Set([...current, ...matchingTags])].sort();

  if (merged.length > current.length) {
    updates.push({
      n,
      oldTags: current,
      newTags: merged,
      added: merged.filter(t => !current.includes(t)),
    });
  }
}

console.log(`Episodes needing tag updates: ${updates.length}`);
console.log(`Total new tags to add: ${updates.reduce((s, u) => s + u.added.length, 0)}`);

for (const u of updates.slice(0, 15)) {
  console.log(`  Ep ${u.n}: ${u.oldTags.length} → ${u.newTags.length} (+${u.added.join(', ')})`);
}
if (updates.length > 15) console.log(`  ... and ${updates.length - 15} more`);

// Apply updates to the TS file
let updated = tsContent;
let changeCount = 0;
for (const u of updates) {
  const tagStr = u.newTags.map(t => `'${t.replace(/'/g, "\\'")}'`).join(', ');
  const lineRegex = new RegExp(
    `(\\{ number: ${u.n},.*?tags: \\[)[^\\]]*?(\\])`,
    's'
  );
  const newContent = updated.replace(lineRegex, `$1${tagStr}$2`);
  if (newContent !== updated) {
    updated = newContent;
    changeCount++;
  }
}

if (changeCount > 0) {
  writeFileSync('src/data/shwep-episodes.ts', updated);
  console.log(`\nUpdated ${changeCount} episodes in shwep-episodes.ts`);
} else {
  console.log('\nNo changes needed');
}

await client.close();
