// Merge crawled SHWEP descriptions (primary) with Apple Podcasts data (gap-fill)
import { readFileSync, writeFileSync } from 'fs';

// Load crawled data (primary — more detailed, authoritative)
const crawled = JSON.parse(readFileSync('src/data/shwep-descriptions.json', 'utf8'));
const crawledEntries = Object.entries(crawled).filter(([_, v]) => v && v.length > 10);
console.log(`Crawled: ${crawledEntries.length} entries`);

// Load Apple Podcasts data (gap-fill)
const apple = JSON.parse(readFileSync('_tmp-episode-descriptions.json', 'utf8'));
console.log(`Apple: ${Object.keys(apple).length} entries`);

// Merge: crawled first, Apple for gaps
const merged = {};
let fromCrawl = 0;
let fromApple = 0;

// Add all crawled entries (truncated to ~300 chars at sentence boundary)
for (const [num, desc] of crawledEntries) {
  let clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length > 300) {
    const sentEnd = clean.indexOf('. ', 100);
    if (sentEnd > 0 && sentEnd < 350) {
      clean = clean.substring(0, sentEnd + 1);
    } else {
      clean = clean.substring(0, 297) + '...';
    }
  }
  merged[num] = clean;
  fromCrawl++;
}

// Fill gaps with Apple data
for (const [num, desc] of Object.entries(apple)) {
  if (!merged[num] && desc && desc.length > 10) {
    let clean = desc.replace(/\s+/g, ' ').trim();
    if (clean.length > 300) {
      const sentEnd = clean.indexOf('. ', 100);
      if (sentEnd > 0 && sentEnd < 350) {
        clean = clean.substring(0, sentEnd + 1);
      } else {
        clean = clean.substring(0, 297) + '...';
      }
    }
    merged[num] = clean;
    fromApple++;
  }
}

console.log(`\nMerged: ${Object.keys(merged).length} total`);
console.log(`  From crawl: ${fromCrawl}`);
console.log(`  From Apple: ${fromApple}`);

// Generate TypeScript
const lines = [
  '// Episode descriptions from SHWEP website + Apple Podcasts (gap-fill)',
  '// Auto-generated — do not edit manually',
  '',
  'export const EPISODE_DESCRIPTIONS: Record<number, string> = {',
];

const sortedNums = Object.keys(merged).map(Number).sort((a, b) => a - b);
for (const num of sortedNums) {
  // Escape for single-quoted TS string
  const escaped = merged[num].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  lines.push(`  ${num}: '${escaped}',`);
}
lines.push('};');
lines.push('');

writeFileSync('src/data/shwep-descriptions.ts', lines.join('\n'));
console.log(`\nWrote src/data/shwep-descriptions.ts with ${sortedNums.length} descriptions`);

// Check gaps against our episode list
const episodesTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epNums = [];
const epRe = /\{ number: (\d+),/g;
let m;
while ((m = epRe.exec(episodesTs)) !== null) {
  epNums.push(parseInt(m[1]));
}
const mergedSet = new Set(sortedNums);
const stillMissing = epNums.filter(n => !mergedSet.has(n));
console.log(`\nEpisodes in data: ${epNums.length}`);
console.log(`Still missing descriptions: ${stillMissing.length}`);
if (stillMissing.length > 0 && stillMissing.length <= 30) {
  console.log(`Missing: ${stillMissing.join(', ')}`);
}
