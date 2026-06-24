#!/usr/bin/env node
/**
 * Create the "Aldine Press" curated collection and tag its books.
 *
 * Membership is imprint-driven, not a hand-curated slug list: any live book
 * (visible: true, pages_count > 0) whose printer/publisher/published field
 * names Aldus Manutius / Aldo Manuzio / the Aldine heirs is tagged. That
 * covers all generations of the press (Aldo I 1495-1515, the Torresani
 * partnership "in aedibus Aldi et Andreae soceri", the heirs, Paolo Manuzio,
 * and Aldo II) — USTC counts 993 Aldine editions across the family.
 *
 * Hidden books (the May 2026 bulk IA import still in pipeline QA) are NOT
 * flipped visible here — they pick up the tag automatically when re-run
 * after QA, or can be tagged by running with --include-hidden (tag only,
 * never flips visibility).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/create-aldine-press-collection.mjs
 *   node scripts/create-aldine-press-collection.mjs --dry-run
 *   node scripts/create-aldine-press-collection.mjs --include-hidden
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_HIDDEN = process.argv.includes('--include-hidden');
const SLUG = 'aldine-press';

// Word-boundary match for the press across naming conventions:
// "Aldus Manutius", "Manuzio, Aldo (I) (heirs of)", "apud Aldum",
// "in aedibus Aldi", "apud Aldi filios", "Aldine Press", etc.
const ALDINE_RX = /\b(aldus|aldine|aldo|aldi|aldum|manuti|manuzio|manutio)\b/i;

// Imprint-field matches that are NOT Aldine editions — verified by hand.
const EXCLUDE_SLUGS = [
  // 18th-c Hebrew sermon MS from John Rylands; publisher field is bad metadata
  'sermons-lattes',
  // Renouard's 1803 bibliography OF the press — about it, not printed by it.
  // Linked editorially via mentioned_books instead.
  'annales-de-l-imprimerie-des-alde-renouard',
];

const COLLECTION_DOC = {
  slug: SLUG,
  name: 'The Aldine Press',
  subtitle: 'The Venetian printing house that invented the modern book.',
  color: 'gold',
  order: 147, // beside printing-press-revolution (146)
  visible: true,
  parent: 'history-political-thought',
  description:
    'Founded in Venice by Aldus Manutius in 1494, the Aldine Press gave the world ' +
    'italic type, the semicolon, the pocket-sized octavo classic, and the first printed ' +
    'editions of Aristotle, Plato, Sophocles, and dozens of other Greek authors. Its ' +
    'dolphin-and-anchor device became the most famous trademark in the history of the book. ' +
    'This collection gathers editions from every generation of the press — Aldus the Elder ' +
    '(1495–1515), the partnership with Andrea Torresani, the heirs, Paolo Manuzio, and ' +
    'Aldo the Younger — from the 1499 Hypnerotomachia Poliphili, often called the most ' +
    'beautiful book ever printed, to the great Greek editiones principes that carried ' +
    'classical literature into the age of print.',
};

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const imprintMatch = {
    $or: [{ publisher: ALDINE_RX }, { printer: ALDINE_RX }, { published: ALDINE_RX }],
  };
  const baseQuery = INCLUDE_HIDDEN
    ? { ...imprintMatch, slug: { $nin: EXCLUDE_SLUGS } }
    : { ...imprintMatch, visible: true, pages_count: { $gt: 0 }, slug: { $nin: EXCLUDE_SLUGS } };

  const matched = await books
    .find(baseQuery)
    .project({ title: 1, slug: 1, year: 1, printer: 1, publisher: 1, visible: 1 })
    .toArray();
  console.log(`Matched ${matched.length} books (${INCLUDE_HIDDEN ? 'including hidden' : 'live only'})`);

  if (DRY_RUN) {
    for (const b of matched.slice(0, 30)) {
      console.log(`  ${b.year ?? '?'} | ${(b.printer || b.publisher || '').slice(0, 40)} | ${b.title?.slice(0, 60)}`);
    }
    if (matched.length > 30) console.log(`  ... and ${matched.length - 30} more`);
    console.log('\nDry run — no writes.');
    await client.close();
    return;
  }

  // Tag books. Bump updated_at explicitly: $addToSet alone does not, and the
  // Supabase books_catalog sync keys off updated_at (see CLAUDE.md).
  const tagRes = await books.updateMany(baseQuery, {
    $addToSet: { collections: SLUG },
    $currentDate: { updated_at: true },
  });
  console.log(`Tagged: matched ${tagRes.matchedCount}, modified ${tagRes.modifiedCount}`);

  // Renouard's Annales — the press's standard bibliography — goes in
  // mentioned_books so the collection page can link it without counting it
  // as an Aldine edition.
  const renouard = await books.findOne(
    { slug: 'annales-de-l-imprimerie-des-alde-renouard' },
    { projection: { _id: 1, title: 1 } }
  );

  const colRes = await db.collection('collections').updateOne(
    { slug: SLUG },
    {
      $set: {
        ...COLLECTION_DOC,
        ...(renouard
          ? { mentioned_books: { "Annales de l'imprimerie des Alde": String(renouard._id) } }
          : {}),
        updated_at: new Date(),
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true }
  );
  console.log(`Collection doc: ${colRes.upsertedCount ? 'created' : 'updated'}`);

  const liveCount = await books.countDocuments({
    collections: SLUG,
    visible: true,
    pages_count: { $gt: 0 },
  });
  await db.collection('collections').updateOne({ slug: SLUG }, { $set: { book_count: liveCount } });
  console.log(`book_count set to ${liveCount}`);
  console.log('\nNext: node scripts/workers/sync-books-catalog.mjs  (push tags to Supabase grid)');

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
