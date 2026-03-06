import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// --- Part 1: Syriac & Armenian status ---
const langBooks = await db.collection('books').find(
  { deleted: { $ne: true }, language: { $in: ['Syriac', 'Armenian'] } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pipeline_auto: 1 } }
).toArray();

for (const lang of ['Syriac', 'Armenian']) {
  const lb = langBooks.filter(b => b.language === lang);
  console.log(`\n--- ${lang} (${lb.length} books) ---`);
  const statuses = {};
  lb.forEach(b => {
    const s = b.pipeline_auto?.status || 'not_enrolled';
    statuses[s] = (statuses[s] || 0) + 1;
  });
  Object.entries(statuses).sort((a,b) => b[1]-a[1]).forEach(([s,c]) => console.log(`  ${s}: ${c}`));

  const totalPages = lb.reduce((s,b) => s + (b.pages_count||0), 0);
  const totalOcr = lb.reduce((s,b) => s + (b.pages_ocr||0), 0);
  const totalTranslated = lb.reduce((s,b) => s + (b.pages_translated||0), 0);
  console.log(`  Pages: ${totalPages} | OCR: ${totalOcr} (${totalPages ? (totalOcr/totalPages*100).toFixed(0) : 0}%) | Translated: ${totalTranslated} (${totalPages ? (totalTranslated/totalPages*100).toFixed(0) : 0}%)`);

  const notEnrolled = lb.filter(b => !b.pipeline_auto?.status);
  if (notEnrolled.length > 0) {
    console.log(`  Not enrolled (${notEnrolled.length}):`);
    notEnrolled.forEach(b => {
      console.log(`    ${b._id} - ${(b.display_title || b.title).substring(0, 80)} (${b.pages_count||0}pp, OCR:${b.pages_ocr||0})`);
    });
  }
}

// --- Part 2: Missing cited works ---
const allBooks = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1 } }
).toArray();

const crawled = readFileSync('src/data/shwep-crawled.jsonl', 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

const citedWorksTs = readFileSync('src/data/shwep-cited-works.ts', 'utf8');
const episodeCitedWorks = {};
const cwRe = /^\s+(\d+): \[(.*?)\],?$/gm;
let m;
while ((m = cwRe.exec(citedWorksTs)) !== null) {
  if (m[2].trim()) {
    episodeCitedWorks[parseInt(m[1])] = m[2].split("', '").map(w => w.replace(/^'|'$/g, ''));
  }
}

const episodesTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const tags = new Set();
const tagRe = /tags: \[(.*?)\]/g;
while ((m = tagRe.exec(episodesTs)) !== null) {
  if (m[1].trim()) m[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => tags.add(t));
}

const allCitedWorks = new Set();
Object.values(episodeCitedWorks).forEach(ws => ws.forEach(w => allCitedWorks.add(w)));
const allTerms = new Set([...tags, ...allCitedWorks]);

const MAX = 30;
const matchedTerms = new Set();
for (const term of allTerms) {
  const escaped = term.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
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

// Get tags per episode
const epBlocks = episodesTs.split(/\{ number:/g).slice(1);
const epTags = {};
epBlocks.forEach(block => {
  const numMatch = block.match(/^\s*(\d+)/);
  const tagsMatch = block.match(/tags: \[(.*?)\]/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    const t = [];
    if (tagsMatch && tagsMatch[1].trim()) {
      tagsMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).forEach(s => t.push(s));
    }
    epTags[num] = t;
  }
});

const episodeNumbers = Object.keys(epTags).map(Number);

console.log('\n\n=== Zero-match episodes: what are we missing? ===\n');

let zeroCount = 0;
const allMissing = [];

for (const epNum of episodeNumbers.sort((a,b) => a-b)) {
  const epTermsArr = [...(epTags[epNum] || []), ...(episodeCitedWorks[epNum] || [])];
  const epTerms = new Set(epTermsArr);

  let hasMatch = false;
  for (const term of epTerms) {
    if (matchedTerms.has(term)) { hasMatch = true; break; }
  }

  if (!hasMatch) {
    zeroCount++;
    const ep = crawled.find(c => c.number === epNum);
    const title = ep ? ep.title : '(unknown)';
    const unmatchedCited = (episodeCitedWorks[epNum] || []).filter(w => !matchedTerms.has(w));
    console.log(`Ep ${epNum}: ${title}`);
    if (unmatchedCited.length > 0) {
      unmatchedCited.forEach(w => {
        console.log(`  - ${w}`);
        allMissing.push(w);
      });
    } else if (epTerms.size === 0) {
      console.log('  (no cited works or tags)');
    } else {
      console.log('  (terms exist but all filtered/capped)');
    }
    console.log();
  }
}
console.log(`Total zero-match episodes: ${zeroCount}`);
console.log(`Total missing cited works: ${allMissing.length}`);
console.log(`Unique missing: ${new Set(allMissing).size}`);

await client.close();
