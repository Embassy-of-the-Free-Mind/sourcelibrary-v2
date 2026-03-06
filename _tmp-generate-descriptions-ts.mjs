// Generate a TypeScript file with episode descriptions from Apple Podcasts data
import { readFileSync, writeFileSync } from 'fs';

const descriptions = JSON.parse(readFileSync('_tmp-episode-descriptions.json', 'utf8'));

// Clean descriptions: trim, remove trailing "..." artifacts, cap at 200 chars
const cleaned = {};
for (const [num, desc] of Object.entries(descriptions)) {
  let clean = desc
    .replace(/\s+/g, ' ')
    .trim();
  // Cap at first sentence if under 200 chars, else cap at 200
  if (clean.length > 200) {
    // Try to break at sentence boundary
    const sentEnd = clean.indexOf('. ', 100);
    if (sentEnd > 0 && sentEnd < 250) {
      clean = clean.substring(0, sentEnd + 1);
    } else {
      clean = clean.substring(0, 197) + '...';
    }
  }
  cleaned[num] = clean;
}

// Generate TypeScript
const lines = [`// Episode descriptions sourced from Apple Podcasts API`,
  `// Auto-generated — do not edit manually`,
  ``,
  `export const EPISODE_DESCRIPTIONS: Record<number, string> = {`];

const sortedNums = Object.keys(cleaned).map(Number).sort((a, b) => a - b);
for (const num of sortedNums) {
  const escaped = cleaned[num].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  lines.push(`  ${num}: '${escaped}',`);
}

lines.push(`};`);
lines.push(``);

writeFileSync('src/data/shwep-descriptions.ts', lines.join('\n'));
console.log(`Generated src/data/shwep-descriptions.ts with ${sortedNums.length} descriptions`);
console.log(`\nSamples:`);
for (const num of [1, 50, 100, 200]) {
  if (cleaned[num]) {
    console.log(`  Ep ${num}: ${cleaned[num].substring(0, 120)}...`);
  }
}
