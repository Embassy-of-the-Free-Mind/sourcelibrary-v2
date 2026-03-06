import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';

// Load crawled data — dedupe by number
const lines = readFileSync('/tmp/shwep_crawled_all.jsonl', 'utf8').trim().split('\n');
const epMap = new Map();
for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (ep.n !== undefined) epMap.set(ep.n, ep);
  } catch {}
}

// Read current TS file
const tsContent = readFileSync('src/data/shwep-episodes.ts', 'utf8');

// Extract existing URLs from TS
const urlRegex = /url: "(.*?)"/g;
const existingUrls = new Set();
let m;
while ((m = urlRegex.exec(tsContent)) !== null) existingUrls.add(m[1]);

// Find genuinely new episodes (URL not in TS)
const newEps = [];
for (const [n, ep] of [...epMap.entries()].sort((a, b) => a[0] - b[0])) {
  if (n <= 214) continue;
  if (!existingUrls.has(ep.url)) {
    newEps.push(ep);
  }
}

console.log(`Existing URLs in TS: ${existingUrls.size}`);
console.log(`Genuinely new episodes: ${newEps.length}`);
if (newEps.length === 0) process.exit(0);

// Clean HTML entities
function cleanHtml(s) {
  return s
    .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(parseInt(code)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

// Noise filter for cited works matching
function isNoise(w) {
  if (w.length < 5) return true;
  if (/^[a-z]/.test(w)) return true;
  if (/^(Journal|Proceedings|Transactions|Bulletin|American|Harvard|Review|Zeitschrift|Revue)\b/.test(w)) return true;
  if (w.includes('&#')) return true;
  if (['Idem','Corrigendum','ANRW','Plot','Strom','Trans-','Repres-','entations',
       'should','were','born','Religion','Culture','Fragments','Anonymous',
       'Compendium','Letters','Histories','Interpretation','Second Century','Visions'].includes(w)) return true;
  return false;
}
function cleanTag(w) { return w.replace(/[.,;:]+$/, '').trim(); }

// Connect to DB for tag matching
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = await client.db('bookstore').collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1 } }
).toArray();

function workMatchesOldBooks(work) {
  if (isNoise(work)) return false;
  const lower = work.toLowerCase();
  return books.some(b => {
    const exact = (b.title || '').toLowerCase() === lower
      || (b.display_title || '').toLowerCase() === lower
      || (b.author || '').toLowerCase() === lower;
    const sub = work.length >= 12 && (
      (b.title || '').toLowerCase().includes(lower)
      || (b.display_title || '').toLowerCase().includes(lower)
      || (b.author || '').toLowerCase().includes(lower)
    );
    if (!exact && !sub) return false;
    const y = b.year || (b.published ? parseInt(b.published) : null);
    return !y || y <= 1929;
  });
}

// Determine which period array each episode belongs to based on content/context
// These new episodes are supplementary content (oddcasts, storytimes, extended interviews)
// that accompanies existing numbered episodes. Assign to same period as their parent episode.
function assignPeriod(n, title) {
  const t = title.toLowerCase();

  // Storytimes and oddcasts about Zosimus → late-magic
  if (t.includes('zosimus')) return 'late-magic';
  // Coptic magic, Syriac, Mandaeans → late-magic
  if (t.includes('coptic') || t.includes('syriac') || t.includes('mandæ') || t.includes('christian magic')) return 'late-magic';
  // New Testament episodes → late-magic (early Christianity)
  if (t.includes('new testament') || t.includes('gospel') || t.includes('jesus')) return 'late-magic';
  // Early Christian esotericism → late-magic
  if (t.includes('early christian') || t.includes('christian esotericism')) return 'late-magic';

  // Gregory of Nyssa, Cappadocians → christian-fathers
  if (t.includes('gregory') || t.includes('cappadoc') || t.includes('darkness with')) return 'christian-fathers';
  // Evagrius → christian-fathers
  if (t.includes('evagrius')) return 'christian-fathers';
  // Julian, Sallustius, Eunapius, Sosipatra → christian-fathers
  if (t.includes('julian') || t.includes('sallustius') || t.includes('eunapius') || t.includes('sosipatra')) return 'christian-fathers';
  // Fall of Rome → christian-fathers
  if (t.includes('fall of rome')) return 'christian-fathers';
  // Hypatia, Synesius → christian-fathers
  if (t.includes('hypatia') || t.includes('synesius')) return 'christian-fathers';
  // Calcidius → christian-fathers
  if (t.includes('calcidius')) return 'christian-fathers';

  // Augustine, Macrobius, Marius Victorinus → christian-fathers (late Latin)
  if (t.includes('augustin') || t.includes('macrobius') || t.includes('victorinus')) return 'christian-fathers';
  // Nonnus → christian-fathers
  if (t.includes('nonnus')) return 'christian-fathers';
  // Martianus Capella → athenian-academy
  if (t.includes('martian')) return 'athenian-academy';
  // Cicero's Dream of Scipio → athenian-academy (paired with Macrobius commentary)
  if (t.includes('dream of scipio') || t.includes('cicero')) return 'athenian-academy';
  // Poseidonius → christian-fathers (misc late antiquity)
  if (t.includes('poseidon')) return 'christian-fathers';

  // Hierocles, Golden Verses → athenian-academy
  if (t.includes('hierocles') || t.includes('golden verses')) return 'athenian-academy';
  // Proclus → athenian-academy
  if (t.includes('proclus') || t.includes('henadology') || t.includes('noetic fire')) return 'athenian-academy';
  // Damascius → athenian-academy
  if (t.includes('damascius')) return 'athenian-academy';
  // Pseudo-Dionysius → post-antiquity
  if (t.includes('dionys') || t.includes('apophasis')) return 'post-antiquity';
  // Anonymous Prolegomena → athenian-academy
  if (t.includes('prolegomena') || t.includes('apollonian')) return 'athenian-academy';
  // Higher Virtues in Late Platonism → athenian-academy
  if (t.includes('higher virtues') || t.includes('late platonism')) return 'athenian-academy';
  // Joseph Sanzo, confessional boundaries → late-magic
  if (t.includes('sanzo') || t.includes('confessional')) return 'late-magic';
  // Last Platonists → athenian-academy
  if (t.includes('last platonist')) return 'athenian-academy';

  // Islam-related → post-antiquity
  if (t.includes('islam') || t.includes('islām') || t.includes('qur') || t.includes('melvin-koushki')) return 'post-antiquity';
  if (t.includes('donner')) return 'post-antiquity';
  // Maximus the Confessor → post-antiquity
  if (t.includes('maximus') || t.includes('salvation')) return 'post-antiquity';

  return 'late-magic'; // default
}

// Build new entries
const byPeriod = {};
for (const ep of newEps) {
  const title = cleanHtml(ep.title || '');
  const period = assignPeriod(ep.n, title);
  if (!byPeriod[period]) byPeriod[period] = [];

  const tags = (ep.citedWorks || [])
    .map(cleanTag)
    .filter(w => workMatchesOldBooks(w))
    .sort();

  byPeriod[period].push({
    number: ep.n,
    title: title.replace(/'/g, "\\'"),
    url: ep.url || `https://shwep.net/podcast/episode-${ep.n}/`,
    period,
    tags,
  });
}

// Output grouped by period
for (const [period, eps] of Object.entries(byPeriod).sort()) {
  console.log(`\n=== ${period} (${eps.length} new episodes) ===`);
  for (const ep of eps.sort((a, b) => a.number - b.number)) {
    const tagStr = ep.tags.map(t => `'${t.replace(/'/g, "\\'")}'`).join(', ');
    console.log(`  { number: ${ep.number}, title: "${ep.title}", url: "${ep.url}", period: "${ep.period}", tags: [${tagStr}] },`);
  }
}

await client.close();
