#!/usr/bin/env node
/**
 * Create the "Slime Moulds" collection and tag its books.
 *
 * A sub-collection of mycology, which is the point: these works sit inside the
 * mycological literature until de Bary takes them out of it in 1859. Phase 7.6
 * (the Gemini classifier that normally assigns collections) is paused, so the
 * membership is pinned by hand here.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/create-slime-moulds-collection.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const SLUG = 'slime-moulds';

// The three works of the group itself, then the four general mycological books
// already in the library that carry substantial myxomycete matter.
const BOOK_IDS = [
  '6a42724628e9db2e39c131da', // Panckow, Herbarium Portatile, 1656
  '6a8b60e7c53b44fe18da9437', // de Bary, Die Mycetozoen, 1864
  '6a8b60f1c53b44fe18da94e3', // Rostafiński, Śluzowce (Mycetozoa), 1875
  '69b1dddc537bff0aca8a9709', // Micheli, Nova Plantarum Genera, 1729
  '69d8ca4ea09828f83ddca72d', // Persoon, Synopsis Methodica Fungorum, 1801
  '69d8ca77a09828f83ddcb132', // Fries, Systema Mycologicum, Vol 3
  '6a601adc744548430e8ee345', // de Bary, Morphologie und Physiologie der Pilze, 1866
];

const COLLECTION = {
  slug: SLUG,
  name: 'Slime Moulds',
  subtitle: 'The Mycetozoa, from Panckow to Rostafiński',
  description:
    'Neither plant, animal, nor fungus. Two centuries of naturalists filed the slime moulds with the mushrooms because that is what they look like once they have stopped moving. This collection follows the argument from the first published notice of one in 1654, through de Bary taking the group out of the fungi in 1859, to the first monograph of them in 1875.',
  color: 'sage',
  type: 'category',
  parent: 'mycology',
  hidden: false,
  visible: true,
  show_all_books: true,
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const existing = await db.collection('collections').findOne({ slug: SLUG });
console.log(existing ? `Collection ${SLUG} exists, updating fields.` : `Creating collection ${SLUG}.`);

const books = await db.collection('books')
  .find({ id: { $in: BOOK_IDS } }, { projection: { _id: 0, id: 1, title: 1, collections: 1, visible: 1 } })
  .toArray();
const missing = BOOK_IDS.filter((id) => !books.some((b) => b.id === id));
if (missing.length) console.warn('WARNING: book ids not found:', missing.join(', '));
books.forEach((b) => console.log(`  ${b.id}  visible=${b.visible === true}  ${String(b.title).slice(0, 55)}`));

if (DRY) { console.log('\n(dry run — nothing written)'); await client.close(); process.exit(0); }

await db.collection('collections').updateOne(
  { slug: SLUG },
  { $set: { ...COLLECTION, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
  { upsert: true },
);

const tagged = await db.collection('books').updateMany(
  { id: { $in: BOOK_IDS } },
  { $addToSet: { collections: SLUG } },
);

// Panckow is a herbal that the paused classifier had filed under astrology.
// Two writes: Mongo rejects $pull and $addToSet on the same path in one update.
await db.collection('books').updateOne({ id: '6a42724628e9db2e39c131da' }, { $addToSet: { collections: 'mycology' } });
const untagged = await db.collection('books').updateOne({ id: '6a42724628e9db2e39c131da' }, { $pull: { collections: 'astrology' } });

const count = await db.collection('books').countDocuments({ collections: SLUG });
await db.collection('collections').updateOne({ slug: SLUG }, { $set: { book_count: count } });

console.log(`\nTagged ${tagged.modifiedCount} book(s) into ${SLUG}; collection book_count = ${count}.`);
console.log(`Panckow reclassified: ${untagged.modifiedCount} doc updated.`);
console.log('Next: POST /api/admin/revalidate-book/<id> for each, then purge /collections/slime-moulds.');
await client.close();
