import { readFileSync, writeFileSync } from 'fs';

// Map: new tag -> which episodes should get it (from the cited works data)
const NEW_TAGS = {
  'Oracula Chaldaica': [], // Chaldaean Oracles - need to find episodes
  'Macrobius': [],
  'Aratus': [],
  'Philostratus': [],
  'Stoicorum Veterum Fragmenta': [],
  'Hermetica': [],
};

// Load crawled data to find episode numbers for each work
const lines = readFileSync('src/data/shwep-crawled.jsonl', 'utf8').trim().split('\n');
const workToEps = new Map();

for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (!ep.citedWorks || !ep.n) continue;
    for (const work of ep.citedWorks) {
      const clean = work.replace(/[.,;:]+$/, '').trim();
      if (!workToEps.has(clean)) workToEps.set(clean, new Set());
      workToEps.get(clean).add(ep.n);
    }
  } catch {}
}

// Map cited work patterns to our tag names
const WORK_TO_TAG = {
  // Chaldaean Oracles
  'Chaldæan Oracles': 'Oracula Chaldaica',
  'Chaldaean Oracles': 'Oracula Chaldaica',
  'Chaldaean Oracles and Theurgy': 'Oracula Chaldaica',
  'Oracles chaldaïques': 'Oracula Chaldaica',
  'Oracles Chaldaïques': 'Oracula Chaldaica',
  // Macrobius
  'Commentary on the Dream of Scipio by Macrobius': 'Macrobius',
  // Timaeus - already have tag
  // Berthelot - already matching via existing tags
  // Justin Martyr  
  'Dialogue with Trypho': 'Justin Martyr',
  // Codex Theodosianus
  'Codex Theodosianus': 'Codex Theodosianus',
  // Hermetica / Kore Kosmou
  'Hermetica': 'Hermetica',
  'Hermetica II': 'Hermetica',
  'Korê Kosmou': 'Hermetica',
  // 1 Enoch
  'Book of Watchers': 'Das Buch Henoch',
  // SVF
  'Stoicorum Veterum Fragmenta': 'Stoicorum Veterum Fragmenta',
  // Philostratus
  'Life of Apollonius': 'Philostratus',
  'Life of Apollonius of Tyana': 'Philostratus',
  'Philostratus and Eunapius: The Lives of the Sophists': 'Philostratus',
  'Lives of the Sophists': 'Philostratus',
  // Aratus
  'Phænomena': 'Aratus',
  // Plutarch
  'On Isis and Osiris': 'Plutarchi De Iside',
  'De Iside et Osiride': 'Plutarchi De Iside',
  // CCAG
  'Catalogus Codicum Astrologorum Graecorum': 'Catalogus Codicum Astrologorum',
  // Irenaeus
  'Against Heresies': 'Irenaeus',
  'Adv. Hær': 'Irenaeus',
  'Adv. hær': 'Irenaeus',
  'Against the Heresies': 'Irenaeus',
  'Against All Heresies': 'Irenaeus',
  // Sefer ha-Razim
  'Sefer ha-Razim': 'Sepher ha-Razim',
  // Apocryphon of John (no book for this yet, skip)
  // Gospel of Thomas (no book for this yet, skip)
};

// Build tag -> episode numbers
const tagEpisodes = new Map();
for (const [work, tag] of Object.entries(WORK_TO_TAG)) {
  const eps = workToEps.get(work);
  if (!eps) continue;
  if (!tagEpisodes.has(tag)) tagEpisodes.set(tag, new Set());
  for (const ep of eps) tagEpisodes.get(tag).add(ep);
}

console.log('Tags to add:');
for (const [tag, eps] of [...tagEpisodes.entries()].sort()) {
  console.log(`  ${tag}: ${eps.size} episodes (${[...eps].sort((a,b)=>a-b).join(', ')})`);
}

// Now modify shwep-episodes.ts to add tags to matching episodes
let ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');

// Parse all episodes with their line positions
const epRegex = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*period:\s*"([^"]+)",\s*tags:\s*\[(.*?)\]\s*\}/g;
let match;
let changes = 0;

while ((match = epRegex.exec(ts)) !== null) {
  const epNum = parseInt(match[1]);
  const existingTags = match[5].trim() ? match[5].split(',').map(t => t.trim()) : [];
  
  // Find which new tags should be added to this episode
  const tagsToAdd = [];
  for (const [tag, eps] of tagEpisodes) {
    if (eps.has(epNum)) {
      const quotedTag = `'${tag.replace(/'/g, "\\'")}'`;
      if (!existingTags.includes(quotedTag)) {
        tagsToAdd.push(quotedTag);
      }
    }
  }
  
  if (tagsToAdd.length > 0) {
    const allTags = [...existingTags, ...tagsToAdd];
    const oldTagStr = `tags: [${match[5]}]`;
    const newTagStr = `tags: [${allTags.join(', ')}]`;
    ts = ts.replace(oldTagStr, newTagStr);
    changes++;
  }
}

writeFileSync('src/data/shwep-episodes.ts', ts);
console.log(`\nAdded tags to ${changes} episodes`);
