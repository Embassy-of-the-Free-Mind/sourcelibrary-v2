// Creates the "An Account of the Plant: Cannabis in the Western Record" collection
// and tags its books. Curation by topic; books are existing public-domain library titles.
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!uri) { console.error('No MONGODB_URI in env'); process.exit(1); }

const SLUG = 'cannabis-western-record';

const COLLECTION = {
  slug: SLUG,
  name: 'An Account of the Plant',
  subtitle: "Cannabis in the Western record, from the Renaissance herbals to the Decadents",
  description:
    "In December 1689 Robert Hooke read to the Royal Society <em>An Account of the Plant, call'd Bangue</em> — the first detailed English scientific notice of cannabis, which he proposed calling \"Indian hemp.\" But the plant had been entering the European record for a century before him, through the herbals of Fuchs and the Indies pharmacologists Garcia de Orta, Monardes, and Cristóvão da Costa, who all wrote of \"bangue.\" This collection follows that thread across two centuries after Hooke: the Orientalist scholars who recovered the legend of the Assassins and the hashish-eaters of the <em>Thousand Nights</em>; the alienists — Moreau de Tours and his heirs — who used hashish to model madness and the unconscious; the Decadent literature of Baudelaire's <em>Paradis Artificiels</em>; and the fin-de-siècle occultists for whom Indian hemp was the sorcerer's key. A single plant, read in turn as medicine, as menace, as muse, and as mystery.",
  color: '#5a7d4f',
  order: 30,
  type: 'category',
  book_count: 0,
  languages: [],
  featured_images: [],
  visible: true,
  hidden: false,
  created_at: new Date(),
  updated_at: new Date(),
};

// Confirmed cannabis/hashish-discussing titles (book ids), chronological-ish by theme.
const BOOK_IDS = [
  // Ancient root + Renaissance / Indies herbals (prologue)
  '69c83f236c6f3cc53c850396', // Dioscorides, De medicinali materia (1552)
  '69b1deeaca46fa60ea1ee933', // Dioscorides, On Medical Matters (Greek, 1906)
  '69a5d8114d84314297c08924', // Fuchs, De historia stirpium (1542)
  '69dbca381040d1d5e20aa246', // Latin Herbal (1484)
  '69dbca3d1040d1d5e20aa644', // Latin Herbal w/ German synonyms (1486)
  '69dc558ecb6f7429748b8ec8', // Herbarius latinus w/ Dutch synonyms (1486)
  '69ef285385daccce30f2c71d', // Garcia de Orta / Clusius, Aromatum (1567)
  '6958e0a9d34d35c8156625ba', // Monardes, De simplicibus ex Occidentali India (1574)
  '69ef286185daccce30f2ca01', // Cristovao da Costa, Tractado de las Drogas (1578)
  // The hinge
  '695595e67bd6d2cd1d620227', // Hooke, Philosophical Experiments and Observations (1726)
  // Orientalism & the Assassins legend
  '69907936b621b177c1af59d3', // Lane, Manners and Customs of the Modern Egyptians
  '699079eadb8b55d19ec685b8', // Lane, Arabian Society in the Middle Ages (1883)
  '69e53443d48480a3869658be', // Burton, Supplemental Nights, Vol. 5 (1886)
  '69a557200904636c44e54662', // Burton, Thousand Nights and a Night, Vol. 6 (1888)
  '69ef2f7f72c1376fdf2af6e2', // Leclerc, Histoire de la medecine arabe, Vol. 2 (1876)
  '69e9618b2beefe2f6f72bcd1', // Odoric of Pordenone, Les Voyages en Asie (1891)
  '6991bd4f70254d38471e438c', // Colquhoun, History of Magic, Witchcraft & Animal Magnetism (1851)
  '6953c85b77f38f6761bdc00b', // Spence, Encyclopaedia of Occultism (1920) [Assassins]
  // Medicine & experimental psychology (the Moreau lineage)
  '69ef2191b3e2d3a0927f3a9d', // von Bibra, Die narkotischen Genussmittel und der Mensch (1855)
  '69905cd7aaa7f10ed4cfcfc5', // du Prel, Die Philosophie der Mystik (1884)
  '6990541c38e1fdee57b36c1a', // Janet, L'automatisme psychologique (1903)
  '6a15b94f070b5a08e3b8eb63', // N. C. Paul, A Treatise on the Yoga Philosophy (1851)
  // Literature
  '6a08a2b743d85a6ece189325', // Baudelaire, Les Paradis Artificiels (1860)
  // Fin-de-siecle occultism
  '69593291b91a6184ea943bbe', // Eliphas Levi, Histoire de la magie (1860)
  '69c89a626c6f3cc53c85d135', // Guaita, Le Temple de Satan (1891)
  '695932b8b91a6184ea943faf', // Papus, Traite elementaire de magie pratique
  '6953e3c677f38f6761bee1fb', // Crowley, Diary of a Drug Fiend (1925)
];

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const colls = db.collection('collections');

// upsert the collection doc (don't clobber if re-run)
const existing = await colls.findOne({ slug: SLUG });
if (existing) {
  await colls.updateOne({ slug: SLUG }, { $set: { ...COLLECTION, created_at: existing.created_at, updated_at: new Date() } });
  console.log('Updated existing collection', SLUG);
} else {
  await colls.insertOne(COLLECTION);
  console.log('Created collection', SLUG);
}

// tag each book; report match per id so we catch any id-space misses
let tagged = 0, missed = [];
for (const bid of BOOK_IDS) {
  const q = { $or: [{ id: bid }] };
  try { q.$or.push({ _id: new ObjectId(bid) }); } catch {}
  const r = await books.updateOne(q, { $addToSet: { collections: SLUG }, $set: { updated_at: new Date() } });
  if (r.matchedCount === 1) tagged++; else missed.push(bid);
}
console.log(`Tagged ${tagged}/${BOOK_IDS.length} books`);
if (missed.length) console.log('MISSED ids:', missed);

// compute book_count + language breakdown over visible, processed books
const taggedDocs = await books.find({ collections: SLUG }, { projection: { language: 1, visible: 1, pages_count: 1, title: 1, published: 1 } }).toArray();
const live = taggedDocs.filter(b => b.visible !== false && (b.pages_count || 0) > 0);
const langMap = {};
for (const b of live) { const l = b.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1; }
const languages = Object.entries(langMap).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count);
await colls.updateOne({ slug: SLUG }, { $set: { book_count: live.length, languages, updated_at: new Date() } });

console.log(`\nbook_count (visible, processed): ${live.length} of ${taggedDocs.length} tagged`);
console.log('languages:', JSON.stringify(languages));
console.log('\nTagged titles:');
for (const b of taggedDocs.sort((a,b)=>String(a.published).localeCompare(String(b.published)))) {
  console.log(`  ${b.published || '?'}  ${(b.visible===false?'[hidden] ':'')}${b.title}`);
}

await client.close();
