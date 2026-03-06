import { readFileSync, writeFileSync } from 'fs';

const d = JSON.parse(readFileSync('_tmp-apple-episodes-raw.json', 'utf8'));
const eps = d.results.filter(r => r.trackId !== 1295957854);
console.log(`Apple episodes: ${eps.length}`);

// Read our episode data
const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epRe = /\{ number: (\d+), title: ["'](.*?)["'],/g;
let m;
const ourEps = [];
while ((m = epRe.exec(ts)) !== null) {
  ourEps.push({ number: parseInt(m[1]), title: m[2] });
}
console.log(`Our episodes: ${ourEps.length}`);

// Normalize for matching
function normalize(t) {
  return t.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match and extract dates
const dateMap = {};
let matched = 0;
let noMatch = [];

for (const our of ourEps) {
  const ourNorm = normalize(our.title);

  let found = eps.find(a => normalize(a.trackName) === ourNorm);
  if (!found) found = eps.find(a => normalize(a.trackName).includes(ourNorm));
  if (!found) found = eps.find(a => ourNorm.includes(normalize(a.trackName)));
  if (!found) {
    const ourWords = ourNorm.split(/\s+/).filter(w => w.length >= 4);
    found = eps.find(a => {
      const aWords = normalize(a.trackName).split(/\s+/).filter(w => w.length >= 4);
      const common = ourWords.filter(w => aWords.includes(w));
      return common.length >= 3;
    });
  }

  if (found && found.releaseDate) {
    dateMap[our.number] = found.releaseDate;
    matched++;
  } else {
    noMatch.push(our.number);
  }
}

console.log(`\nMatched with dates: ${matched}`);
console.log(`No match: ${noMatch.length}`);
if (noMatch.length <= 40) console.log(`Missing: ${noMatch.join(', ')}`);

// Show ordering to verify — last 20 by date
const sorted = Object.entries(dateMap)
  .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());

console.log('\n--- Most recent 20 by publication date ---');
sorted.slice(0, 20).forEach(([num, date]) => {
  const ep = ourEps.find(e => e.number === parseInt(num));
  console.log(`  ${date.slice(0, 10)}  Ep ${num}: ${ep?.title.slice(0, 60)}`);
});

console.log('\n--- Oldest 10 by publication date ---');
sorted.slice(-10).forEach(([num, date]) => {
  const ep = ourEps.find(e => e.number === parseInt(num));
  console.log(`  ${date.slice(0, 10)}  Ep ${num}: ${ep?.title.slice(0, 60)}`);
});

// Generate TS file
const lines = [
  '// Episode publication dates from Apple Podcasts API',
  '// Auto-generated — do not edit manually',
  '',
  'export const EPISODE_DATES: Record<number, string> = {',
];

const sortedNums = Object.keys(dateMap).map(Number).sort((a, b) => a - b);
for (const num of sortedNums) {
  lines.push(`  ${num}: '${dateMap[num].slice(0, 10)}',`);
}
lines.push('};');
lines.push('');

writeFileSync('src/data/shwep-dates.ts', lines.join('\n'));
console.log(`\nWrote src/data/shwep-dates.ts with ${sortedNums.length} dates`);
