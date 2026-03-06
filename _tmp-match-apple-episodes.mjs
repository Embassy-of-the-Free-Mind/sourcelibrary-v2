// Match Apple Podcasts episode descriptions to our SHWEP episode data
import { readFileSync } from 'fs';

const raw = JSON.parse(readFileSync('_tmp-apple-episodes-raw.json', 'utf8'));
const appleEps = raw.results.filter(r => r.trackId !== 1295957854);
console.log(`Apple episodes: ${appleEps.length}`);

// Read our episode data to get titles
const episodesTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');

// Extract episode numbers and titles from our data
const ourEpisodes = [];
const epRe = /\{ number: (\d+), title: ["'](.*?)["'],/g;
let m;
while ((m = epRe.exec(episodesTs)) !== null) {
  ourEpisodes.push({ number: parseInt(m[1]), title: m[2] });
}
console.log(`Our episodes: ${ourEpisodes.length}`);

// Normalize titles for matching
function normalize(t) {
  return t.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build Apple lookup by normalized title fragments
const matched = {};
let matchCount = 0;
let noMatch = [];

for (const our of ourEpisodes) {
  const ourNorm = normalize(our.title);

  // Try exact title match first
  let found = appleEps.find(a => normalize(a.trackName) === ourNorm);

  // Try partial match — our title contained in Apple title
  if (!found) {
    found = appleEps.find(a => normalize(a.trackName).includes(ourNorm));
  }

  // Try partial match — Apple title contained in our title
  if (!found) {
    found = appleEps.find(a => ourNorm.includes(normalize(a.trackName)));
  }

  // Try matching key words (at least 3 matching words of 4+ chars)
  if (!found) {
    const ourWords = ourNorm.split(/\s+/).filter(w => w.length >= 4);
    found = appleEps.find(a => {
      const aWords = normalize(a.trackName).split(/\s+/).filter(w => w.length >= 4);
      const common = ourWords.filter(w => aWords.includes(w));
      return common.length >= 3;
    });
  }

  if (found) {
    const desc = found.shortDescription || found.description || '';
    if (desc.length > 10) {
      matched[our.number] = desc.substring(0, 300);
      matchCount++;
    }
  } else {
    noMatch.push(our.number);
  }
}

console.log(`\nMatched: ${matchCount}`);
console.log(`No match: ${noMatch.length} — ${noMatch.slice(0, 30).join(', ')}${noMatch.length > 30 ? '...' : ''}`);

// Show some samples
console.log('\n--- Samples ---');
for (const num of [1, 50, 100, 150, 200]) {
  if (matched[num]) {
    console.log(`\nEp ${num}: ${matched[num].substring(0, 150)}`);
  }
}

// Write matched descriptions
import { writeFileSync } from 'fs';
writeFileSync('_tmp-episode-descriptions.json', JSON.stringify(matched, null, 2));
console.log(`\nWrote ${Object.keys(matched).length} descriptions to _tmp-episode-descriptions.json`);
