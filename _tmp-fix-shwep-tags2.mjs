import { readFileSync, writeFileSync } from 'fs';

const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');

const REPLACEMENTS = {
  // Fix spelling to match our collection
  'Empedocles': 'Empedoclis',       // matches "Empedoclis et Parmenidis Fragmenta"
  'Philolaus': 'Philolaos',          // matches "Philolaos des Pythagoreers"
  
  // Remove tags that genuinely have no matching book and aren't importable
  'Alcestis': '',       // Euripides play — not in collection
  'De mensibus': '',    // John Lydus — obscure, not in collection
  'Heraclitus': '',     // fragments only — no standalone book
  'Hymn of the Pearl': '',  // part of Acts of Thomas — not standalone
};

let changes = 0;

const updated = ts.replace(/tags: \[(.*?)\]/g, (match, inner) => {
  if (!inner.trim()) return match;
  const tags = inner.split(',').map(t => t.trim());
  const cleaned = [];
  
  for (const t of tags) {
    const val = t.replace(/^'|'$/g, '');
    if (val in REPLACEMENTS) {
      const newVal = REPLACEMENTS[val];
      if (newVal === '') { changes++; continue; }
      const existingVals = tags.map(x => x.replace(/^'|'$/g, ''));
      if (existingVals.includes(newVal)) { changes++; continue; }
      cleaned.push(`'${newVal}'`);
      changes++;
    } else {
      cleaned.push(t);
    }
  }
  
  return `tags: [${cleaned.join(', ')}]`;
});

writeFileSync('src/data/shwep-episodes.ts', updated);
console.log(`Made ${changes} tag changes`);

// Count remaining
const remaining = new Set();
const re = /tags: \[(.*?)\]/g;
let m;
while ((m = re.exec(updated)) !== null) {
  if (!m[1].trim()) continue;
  m[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => remaining.add(t));
}
console.log(`Total unique tags: ${remaining.size}`);
