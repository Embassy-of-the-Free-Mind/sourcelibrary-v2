import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const files = [
  '/tmp/shwep_cited_works.json',
  '/tmp/shwep_cited_works_45_89.json',
  '/tmp/shwep_cited_works_90_132.json',
  '/tmp/shwep_cited_works_133_175.json',
  '/tmp/shwep_cited_works_176_214.json',
];

const allEpisodes = [];
for (const f of files) {
  try {
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    for (const line of lines) {
      try { const ep = JSON.parse(line); if (ep.citedWorks?.length) allEpisodes.push(ep); } catch {}
    }
  } catch {}
}

const SKIP = new Set([
  'Plato','Aristotle','Homer','Pythagoras','Socrates','Heraclitus','Parmenides',
  'Empedocles','Democritus','Hesiod','Euripides','Sophocles','Aeschylus',
  'Thucydides','Xenophon','Cicero','Seneca','Virgil','Ovid','Horace','Tacitus','Livy',
  'Paul','Jerome','Moses','Jesus','Bible','Torah','Genesis','Exodus','Isaiah','Psalms',
  'Matthew','Luke','John','Gnosticism','Neoplatonic Theurgy','Neoplatonism','Stoicism',
  'Christianity','Judaism','Islam','Sufism','Kabbalah','Alchemy','Astrology','Magic',
  'Mysticism','Hermeticism','Thomas Aquinas','Boethius','Dante','Petrarch',
  'Marsilio Ficino','Giovanni Pico della Mirandola','Jacob Böhme','Emanuel Swedenborg',
  'Descartes','Spinoza','Leibniz','Kant','Hegel','Rg Veda','Upanishads','Brahmanas',
  'Homeric poems','Greek Tragedy','Greek Comedy','Presocratic Philosophy',
  'Egyptian religion','Roman religion','Persian religion',
  'Anonymous','Compendium','Letters','Histories',
]);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1 } }
).toArray();

const allCited = new Set();
for (const ep of allEpisodes) for (const w of ep.citedWorks) allCited.add(w);

// Works not matching any book
const noMatch = [];
for (const work of allCited) {
  if (SKIP.has(work)) continue;
  const pattern = new RegExp('\\b' + work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const has = books.some(b => pattern.test(b.author||'') || pattern.test(b.title||'') || pattern.test(b.display_title||''));
  if (!has) noMatch.push(work);
}
noMatch.sort();

// Episodes with 0 tags in our static data
const epText = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epRegex = /\{ number: (\d+),.*?tags: \[(.*?)\]/gs;
let m;
const emptyEps = [];
while ((m = epRegex.exec(epText)) !== null) {
  const num = parseInt(m[1]);
  const tags = m[2].trim();
  if (!tags) emptyEps.push(num);
}

// Episodes in crawl gap (45-132)
const crawledNums = new Set(allEpisodes.map(e => e.n));
const gapEps = [];
for (let i = 45; i <= 132; i++) {
  if (!crawledNums.has(i)) gapEps.push(i);
}

console.log(`Crawled episodes: ${allEpisodes.length}`);
console.log(`Total unique cited works: ${allCited.size}`);
console.log(`No match in library (excl broad terms): ${noMatch.length}`);
console.log(`Episodes with 0 book tags: ${emptyEps.length} — [${emptyEps.join(', ')}]`);
console.log(`Uncrawled episodes (45-132 gap): ${gapEps.length}`);
console.log(`\n=== CITED WORKS NOT IN LIBRARY (${noMatch.length}) ===`);
console.log(noMatch.join('\n'));

await client.close();
