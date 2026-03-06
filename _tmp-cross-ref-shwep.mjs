import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Load all crawled data
const files = [
  '/tmp/shwep_cited_works.json',        // eps 0-44
  '/tmp/shwep_cited_works_133_175.json', // eps 133-175
  '/tmp/shwep_cited_works_176_214.json', // eps 176-214
];

// Parse JSONL files
const allEpisodes = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  for (const line of lines) {
    try {
      const ep = JSON.parse(line);
      if (ep.citedWorks && ep.citedWorks.length > 0) {
        allEpisodes.push(ep);
      }
    } catch {}
  }
}

// Collect all unique cited works
const allCitedWorks = new Set();
for (const ep of allEpisodes) {
  for (const w of ep.citedWorks) {
    allCitedWorks.add(w);
  }
}

console.log(`Loaded ${allEpisodes.length} episodes with cited works`);
console.log(`Total unique cited works: ${allCitedWorks.size}`);

// Broad names to skip (match too many books)
const SKIP_BROAD = new Set([
  'Plato', 'Aristotle', 'Homer', 'Pythagoras', 'Socrates', 'Heraclitus',
  'Parmenides', 'Empedocles', 'Democritus', 'Hesiod', 'Euripides',
  'Sophocles', 'Aeschylus', 'Thucydides', 'Xenophon', 'Cicero',
  'Seneca', 'Virgil', 'Ovid', 'Horace', 'Tacitus', 'Livy',
  'Paul', 'Jerome', 'Moses', 'Jesus', 'Bible', 'Torah', 'Genesis',
  'Exodus', 'Isaiah', 'Psalms', 'Matthew', 'Luke', 'John',
  'Gnosticism', 'Neoplatonic Theurgy', 'Neoplatonism', 'Stoicism',
  'Christianity', 'Judaism', 'Islam', 'Sufism', 'Kabbalah',
  'Alchemy', 'Astrology', 'Magic', 'Mysticism', 'Hermeticism',
  'Thomas Aquinas', 'Boethius', 'Dante', 'Petrarch',
  'Marsilio Ficino', 'Giovanni Pico della Mirandola',
  'Jacob Böhme', 'Emanuel Swedenborg',
  'Descartes', 'Spinoza', 'Leibniz', 'Kant', 'Hegel',
  'Rg Veda', 'Upanishads', 'Brahmanas', 'Homeric poems',
  // Genre/category labels
  'Greek Tragedy', 'Greek Comedy', 'Presocratic Philosophy',
  'Egyptian religion', 'Roman religion', 'Persian religion',
]);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, language: 1 } }
).toArray();

console.log(`\nTotal books in DB: ${books.length}`);

// Test each cited work against books
const results = [];
for (const work of allCitedWorks) {
  if (SKIP_BROAD.has(work)) continue;

  const pattern = new RegExp('\\b' + work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const matches = books.filter(b =>
    pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
  );

  if (matches.length > 0) {
    results.push({
      work,
      count: matches.length,
      samples: matches.slice(0, 3).map(b => ({
        title: (b.display_title || b.title || '').slice(0, 80),
        author: (b.author || '').slice(0, 40),
        lang: b.language,
      })),
    });
  }
}

results.sort((a, b) => b.count - a.count);

console.log(`\n=== CITED WORKS MATCHING BOOKS (${results.length} matches) ===\n`);

// Also get existing tags from the tagging script for comparison
const existingTags = new Set([
  'Hermes Trismegistus', 'Corpus Hermeticum', 'Asclepius', 'Poimandres',
  'Plotinus', 'Enneads', 'Porphyry', 'Iamblichus', 'De Mysteriis',
  'Proclus', 'Elements of Theology', 'Damascius', 'Simplicius', 'Olympiodorus',
  'Plutarch', 'Apuleius', 'Golden Ass', 'Numenius',
  'Ptolemy', 'Tetrabiblos', 'Vettius Valens', 'Firmicus Maternus',
  'Aelius Aristides', 'Artemidorus', 'Oneirocritica',
  'Apollonius', 'Philostratus', 'Nicomachus',
  'Clement of Alexandria', 'Stromateis', 'Origen', 'Contra Celsum',
  'Augustine', 'Marius Victorinus', 'Evagrius',
  'Gregory of Nyssa', 'Gregory of Nazianzus',
  'Pseudo-Dionysius', 'Dionysius the Areopagite',
  'Maximus the Confessor', 'Calcidius',
  'Macrobius', 'Martianus Capella', 'Synesius', 'Hierocles',
  'Stephanos of Alexandria', 'Zosimus',
  'Philo', 'Sefer Yetzirah', 'Nag Hammadi', 'Dead Sea Scrolls',
  'Valentinus', 'Basilides', 'Mani',
  'Chaldean Oracles', 'Sibylline Oracles',
  'Greek Magical Papyri', 'PGM',
  'Turba Philosophorum', 'Emerald Tablet',
  'Timaeus', 'Republic', 'Symposium', 'Phaedo',
]);

for (const r of results) {
  const isNew = !existingTags.has(r.work);
  const marker = isNew ? ' [NEW]' : '';
  console.log(`${r.work}: ${r.count} books${marker}`);
  for (const s of r.samples) {
    console.log(`    "${s.title}" by ${s.author} (${s.lang})`);
  }
}

// Show cited works that DON'T match any books (for reference)
const noMatch = [];
for (const work of allCitedWorks) {
  if (SKIP_BROAD.has(work)) continue;
  const pattern = new RegExp('\\b' + work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const hasMatch = books.some(b =>
    pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
  );
  if (!hasMatch) noMatch.push(work);
}
noMatch.sort();
console.log(`\n=== NO MATCH IN LIBRARY (${noMatch.length} works) ===`);
console.log(noMatch.join(', '));

// Per-episode breakdown: which episodes from crawled data map to which tags that match books
console.log(`\n=== PER-EPISODE NEW MATCHABLE TAGS ===`);
const matchableWorks = new Set(results.map(r => r.work));
for (const ep of allEpisodes) {
  const newTags = ep.citedWorks.filter(w => matchableWorks.has(w) && !existingTags.has(w) && !SKIP_BROAD.has(w));
  if (newTags.length > 0) {
    console.log(`  Ep ${ep.n}: +${newTags.join(', ')}`);
  }
}

await client.close();
