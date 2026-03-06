import { readFileSync, writeFileSync } from 'fs';

const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');

// Tag replacements: old → new (or empty string to remove)
const REPLACEMENTS = {
  // False positives — make more specific to match correct book
  'Augustine': 'St. Augustine',       // matches De Civitate Dei author
  'Basil': '',                         // Basil of Caesarea — no book, Basil Valentine is wrong
  'Julian': 'Julianus Apostata',       // matches Misopogon author, not Julian of Norwich
  'Mani': '',                          // matches "Humani", "demonomanie" — false positives
  'Valentinus': '',                    // matches Basilius Valentinus (wrong Valentinus)
  'Confessions': 'De Civitate Dei',   // We have Augustine's City of God, not Confessions
  'Republic': '',                      // matches Republic of Christianopolis — no Plato Republic
  'Philo': 'Philo of Alexandria',     // avoid matching "Philosophy", "Poliphilo"
  
  // Too vague — remove  
  'Kings': '',
  'Knights': '',
  'Peace': '',
  'Proverbs': '',
  'Annales': '',
  'Anthology': '',
  'Epistles': '',
  'Oracles': '',
  'Ascension': '',           // too short, matches wrong things
  'Circe': '',               // Madeline Miller novel? Not a historical text
  'Traditio': '',            // journal name, not a primary source
  
  // Abbreviations → full form
  'PGM': 'Greek Magical Papyri',
  
  // Duplicates or near-duplicates → consolidate
  'Orpheus': 'Orphica',
  'Orphic': 'Orphica',
  'Hermeticum': 'Corpus Hermeticum',
  'Hermetica': 'Corpus Hermeticum',
  'Enneads': 'Plotinus',     // already matched as Plotinus
  'Diogenes': 'Diogenes Laertius',
  'Josephus': 'Jewish Antiquities',
  'Evagrius': 'Evagrius Ponticus',
  'Synesius': 'Synesius of Cyrene',
  
  // People that aren't book titles — remove
  'Basilides': '',
  'Hypatia': '',
  'Mandaean': '',
  'Manichaeism': '',
  'Qumran': '',
  'Pseudo-Methodios': '',
  'Philoxenus': '',
  'Berthelot': '',     // editor name, not a book
  
  // Modern collections — no pre-1930 edition available
  'Dead Sea Scrolls': '',
  'Nag Hammadi': '',
  'Hekhalot': '',
};

let changeCount = 0;
let removeCount = 0;
let renameCount = 0;

const updated = ts.replace(/tags: \[(.*?)\]/g, (match, inner) => {
  if (!inner.trim()) return match;
  const tags = inner.split(',').map(t => t.trim());
  const cleaned = [];
  
  for (const t of tags) {
    const val = t.replace(/^'|'$/g, '');
    
    if (val in REPLACEMENTS) {
      const newVal = REPLACEMENTS[val];
      if (newVal === '') {
        removeCount++;
        continue;  // remove tag
      }
      // Check if the new tag already exists in this episode
      const existingVals = tags.map(x => x.replace(/^'|'$/g, ''));
      if (existingVals.includes(newVal)) {
        removeCount++;  // would be duplicate after rename
        continue;
      }
      cleaned.push(`'${newVal}'`);
      renameCount++;
    } else {
      cleaned.push(t);
    }
  }
  
  if (cleaned.length !== tags.length || cleaned.some((c, i) => c !== tags[i])) {
    changeCount++;
  }
  
  return `tags: [${cleaned.join(', ')}]`;
});

writeFileSync('src/data/shwep-episodes.ts', updated);
console.log(`Changed ${changeCount} episodes`);
console.log(`Removed ${removeCount} tags, renamed ${renameCount} tags`);

// List remaining unmatched tags
console.log('\n--- Remaining tags that may still not match books ---');
const remaining = new Set();
const re2 = /tags: \[(.*?)\]/g;
let m2;
while ((m2 = re2.exec(updated)) !== null) {
  if (!m2[1].trim()) continue;
  m2[1].split(',').map(t => t.trim().replace(/^'|'$/g, '')).forEach(t => remaining.add(t));
}
const stillMissing = [
  'Alcestis', 'Alcinous', 'Apologia', 'Damascius', 'De mensibus',
  'Empedocles', 'Heraclitus', 'Hymn of the Pearl', 'Numenius',
  'Philolaus', 'Procopius', 'Satyricon', 'Somnium', 'Stromateis', 'Symposium',
];
for (const t of stillMissing) {
  if (remaining.has(t)) console.log(`  "${t}" — still in tags, may not match`);
}

console.log(`\nTotal unique tags remaining: ${remaining.size}`);
