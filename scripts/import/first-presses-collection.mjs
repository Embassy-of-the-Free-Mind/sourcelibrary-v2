#!/usr/bin/env node
// PRIOR ART: scripts/import/create-slime-moulds-collection.mjs — same upsert-collection + $addToSet-tag + recount
// shape, but with a hardcoded id list; this one resolves its members from the import lists and from imprint data,
// so a re-run after a late import picks up the stragglers.
/**
 * The First Presses of the Americas (#6559), and the Nahuatl works into the existing Aztec & Nahua collection.
 *
 * WHO RUNS IT: the session that imported the Spanish waves, after each import finishes; idempotent.
 *   node --env-file=.env.production.local scripts/import/first-presses-collection.mjs [--commit]
 *
 * The new collection is created HIDDEN (visible:false): its description is public copy Derek has not seen.
 * Tagging hidden books changes nothing a reader sees; each book appears when it is flipped visible after QA.
 * Members:
 *   first-presses-americas: every book from new-world-press-candidates.json and lima-press-candidates.json, plus any
 *     held book whose place_published / publisher names Mexico or Lima (Los Reyes) and whose date is before 1641.
 *   aztec-nahua: every book from nahuatl-candidates.json, plus press books whose languages[] include Nahuatl.
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const COMMIT = process.argv.includes('--commit');
const listIds = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')).books;

const COLLECTION = {
  slug: 'first-presses-americas',
  name: 'The First Presses of the Americas',
  parent: 'americas',
  description: 'Books printed in Mexico City from 1539 and in Lima from 1584: the first century of printing in the Americas.',
  visible: false,
  hidden: true,
};

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const press = [...listIds('./new-world-press-candidates.json'), ...listIds('./lima-press-candidates.json')];
const nahuatlList = listIds('./nahuatl-candidates.json');

const byIa = async (ias) => (await books.find({ ia_identifier: { $in: ias } }, { projection: { id: 1, title: 1, collections: 1 } }).toArray());
const pressBooks = await byIa(press.map((b) => b.ia));
const imprintBooks = await books.find({
  $or: [{ place_published: /m[eé]xico|lima|los reyes/i }, { publisher: /m[eé]xico|lima|ciudad de los reyes/i }],
  published: { $regex: /^1[56]\d\d/ },
}, { projection: { id: 1, title: 1, published: 1, collections: 1, place_published: 1, publisher: 1 } }).toArray();
const early = imprintBooks.filter((b) => Number(String(b.published).slice(0, 4)) <= 1640
  && !/nueva york|new york|madrid|sevill|paris|london/i.test(`${b.place_published || ''} ${b.publisher || ''}`));
const pressSet = new Map([...pressBooks, ...early].map((b) => [b.id, b]));

const nahuatlIas = new Set([...nahuatlList.map((b) => b.ia), ...press.filter((b) => (b.languages || [b.language]).includes('Nahuatl')).map((b) => b.ia)]);
const nahuatlBooks = await byIa([...nahuatlIas]);

const toTag = (set, slug) => [...set].filter((b) => !(b.collections || []).includes(slug));
const newPress = toTag(pressSet.values(), COLLECTION.slug);
const newNah = toTag(nahuatlBooks, 'aztec-nahua');

console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
console.log(`first-presses-americas: ${pressSet.size} members (${pressBooks.length} from the lists, ${early.length} by imprint); ${newPress.length} to tag`);
console.log(`aztec-nahua: ${nahuatlBooks.length} Nahuatl works found of ${nahuatlIas.size} listed; ${newNah.length} to tag`);
for (const b of early.slice(0, 40)) console.log(`  imprint: ${String(b.published).slice(0, 4)} ${String(b.title).slice(0, 60)} | ${String(b.place_published || b.publisher).slice(0, 30)}`);

if (COMMIT) {
  await db.collection('collections').updateOne(
    { slug: COLLECTION.slug },
    { $set: { slug: COLLECTION.slug, name: COLLECTION.name, parent: COLLECTION.parent, updated_at: new Date() },
      $setOnInsert: { description: COLLECTION.description, visible: COLLECTION.visible, hidden: COLLECTION.hidden, created_at: new Date() } },
    { upsert: true },
  );
  for (const [slug, list] of [[COLLECTION.slug, newPress], ['aztec-nahua', newNah]]) {
    if (!list.length) continue;
    const r = await books.updateMany({ id: { $in: list.map((b) => b.id) } }, { $addToSet: { collections: slug }, $currentDate: { updated_at: true } });
    await recordSweepActions(db, list.map((b) => ({ sweep: 'first-presses-collection', book_id: b.id, action: 'collection_tagged', detail: { collection: slug, issue: 6559 } })));
    const count = await books.countDocuments({ collections: slug, visible: true, pages_count: { $gt: 0 } });
    const total = await books.countDocuments({ collections: slug });
    await db.collection('collections').updateOne({ slug }, { $set: { book_count: count, total_book_count: total } });
    console.log(`tagged ${r.modifiedCount} into ${slug}; live ${count}, total ${total}`);
  }
}
await client.close();
