#!/usr/bin/env node
/**
 * Migrate the hardcoded contemplative-traditions page to DB-backed subcollections.
 *
 * Creates:
 *   1. A parent collection document `contemplative-traditions`
 *   2. Five subcollection documents with `parent: 'contemplative-traditions'`
 *   3. Tags books with subcollection slugs AND `contemplative-traditions`
 *   4. Computes `book_count` and `languages` for each subcollection + parent
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/migrate-contemplative-traditions.mjs [--dry-run]
 */

import { MongoClient, ObjectId } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const PARENT_SLUG = 'contemplative-traditions';

const TRADITIONS = [
  {
    slug: 'taoism',
    name: 'Taoism',
    subtitle: 'The Way and Its Power',
    description:
      'Chinese woodblock prints from the Ming and Qing dynasties alongside the Victorian translations that introduced the Tao Te Ching and Chuang Tzu to the West.',
    order: 1,
    color: 'emerald',
    bookIds: [
      '69935b6f2c63944063134103',
      '6993575f8ed86e583b7b8703',
      '69935b6c2c6394406313403a',
      '69935b692c63944063133f67',
      '6993569a83378b7aed7ce5b7',
      '6993569383378b7aed7ce400',
      '69592bc6b89ab99ff513c08b',
    ],
  },
  {
    slug: 'sufism',
    name: 'Sufism',
    subtitle: 'The Path of the Heart',
    description:
      "Original Persian and Arabic texts paired with their English translations. Includes Nicholson's critical edition of Rumi's Mathnawi in Persian, Zhukovsky's scholarly edition of Hujwiri, and a Ghazali manuscript copied just four years after the philosopher's death in 1111 CE.",
    order: 2,
    color: 'cyan',
    bookIds: [
      '69935b348e28d8f4c5d3cb86',
      '69935b318e28d8f4c5d3c9da',
      '69935b2b8e28d8f4c5d3c6f6',
      '69935b198e28d8f4c5d3c249',
      '69935b208e28d8f4c5d3c445',
      '699356ad83378b7aed7ce878',
      '699356a38e28d8f4c5d3b69f',
      '699356a983378b7aed7ce7b9',
      '6993575c8e28d8f4c5d3bdd3',
      '699357738e28d8f4c5d3c1a2',
    ],
  },
  {
    slug: 'buddhism-zen',
    name: 'Buddhism & Zen',
    subtitle: "Seeing Into One's Nature",
    description:
      'Song dynasty woodblock sutras from the Library of Congress — including a 975 AD Dharani Sutra, one of the earliest surviving printed Buddhist texts — alongside English translations of key Mahayana works and the first Zen teachings published in English.',
    order: 3,
    color: 'amber',
    bookIds: [
      '699356c28ed86e583b7b8320',
      '699356c58ed86e583b7b8334',
      '699356cb8ed86e583b7b86cc',
      '699258c38812793469fdd7e0',
      '699356bc8e28d8f4c5d3b879',
      '6993576f8e28d8f4c5d3c0a0',
    ],
  },
  {
    slug: 'advaita-vedanta',
    name: 'Advaita Vedanta',
    subtitle: 'Non-Dual Reality',
    description:
      "Sanskrit originals in Devanagari script — the Bhagavad Gita with eight classical commentaries, fifteen principal Upanishads, Patanjali's Yoga Sutras with three commentaries, and Shankara's Vivekachudamani — alongside the landmark English translations that shaped Western understanding of Hindu philosophy.",
    order: 4,
    color: 'orange',
    bookIds: [
      '69935b458e28d8f4c5d3cbd3',
      '69935b4a8e28d8f4c5d3cf8c',
      '69935b4d8e28d8f4c5d3cfaa',
      '69935b538e28d8f4c5d3d0cc',
      '6993571783378b7aed7ce8f6',
      '699356d28e28d8f4c5d3ba61',
      '6993571d83378b7aed7ce92b',
      '6993572283378b7aed7ceb65',
      '699357648e28d8f4c5d3bf8e',
    ],
  },
  {
    slug: 'depth-psychology',
    name: 'Depth Psychology',
    subtitle: 'The Unconscious and the Sacred',
    description:
      "The bridge between contemplative traditions and modern psychology. Jung's foundational works in their original German alongside English translations, plus William James on religious experience, Silberer on mystical symbolism, and G.R.S. Mead's recovery of Gnostic texts.",
    order: 5,
    color: 'violet',
    bookIds: [
      '6990541238e1fdee57b36a6e',
      '69935b5f2afc33235052333b',
      '6955957b7bd6d2cd1d61f2c4',
      '6993572983378b7aed7ced01',
      '6993573783378b7aed7ceee1',
      '6993574783378b7aed7cf169',
      '6993574e83378b7aed7cf419',
      '6993575683378b7aed7cf5b1',
    ],
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Source .env.production.local first.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const collections = db.collection('collections');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // 1. Create or update parent collection
  const parentDoc = {
    slug: PARENT_SLUG,
    name: 'The Contemplative Traditions',
    subtitle:
      'Primary sources from five wisdom traditions — in their original languages alongside English translations.',
    description:
      'Primary sources from five contemplative traditions — Taoism, Sufism, Zen Buddhism, Advaita Vedanta, and depth psychology — in their original languages alongside English translations. From a 975 AD Chinese woodblock sutra to Jung in the original German.',
    type: 'portal',
    is_portal: true,
  };

  if (!DRY_RUN) {
    await collections.updateOne(
      { slug: PARENT_SLUG },
      { $set: parentDoc, $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    );
  }
  console.log(`[parent] Upserted '${PARENT_SLUG}'`);

  let totalParentBooks = 0;
  const allBookObjectIds = [];

  // 2. Process each tradition
  for (const tradition of TRADITIONS) {
    const objectIds = tradition.bookIds.map((id) => new ObjectId(id));
    allBookObjectIds.push(...objectIds);

    // Find books to compute stats
    const traditionBooks = await books
      .find(
        { _id: { $in: objectIds } },
        { projection: { _id: 1, language: 1, original_language: 1, title: 1, display_title: 1, author: 1, year: 1, thumbnail: 1, thumbnail_blob: 1, slug: 1 } }
      )
      .toArray();

    const bookCount = traditionBooks.length;
    totalParentBooks += bookCount;

    // Compute language stats
    const langCounts = {};
    for (const book of traditionBooks) {
      const lang = book.original_language || book.language || 'Unknown';
      if (lang !== 'Unknown') {
        langCounts[lang] = (langCounts[lang] || 0) + 1;
      }
    }
    const languages = Object.entries(langCounts)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    // Build sample_books (first 6 for card display)
    const sampleBooks = traditionBooks.slice(0, 6).map((b) => ({
      id: b._id.toString(),
      title: b.display_title || b.title,
      author: b.author || '',
      year: b.year || null,
      thumbnail: b.thumbnail || b.thumbnail_blob || null,
    }));

    // Upsert subcollection
    const subDoc = {
      slug: tradition.slug,
      name: tradition.name,
      subtitle: tradition.subtitle,
      description: tradition.description,
      parent: PARENT_SLUG,
      order: tradition.order,
      color: tradition.color,
      book_count: bookCount,
      languages,
      sample_books: sampleBooks,
      updated_at: new Date(),
    };

    if (!DRY_RUN) {
      await collections.updateOne(
        { slug: tradition.slug },
        { $set: subDoc, $setOnInsert: { created_at: new Date() } },
        { upsert: true }
      );
    }
    console.log(
      `[sub] Upserted '${tradition.slug}': ${bookCount} books, languages: ${languages.map((l) => l.lang).join(', ')}`
    );

    // 3. Tag books with subcollection slug AND parent slug
    if (!DRY_RUN) {
      const result = await books.updateMany(
        { _id: { $in: objectIds } },
        { $addToSet: { collections: { $each: [tradition.slug, PARENT_SLUG] } } }
      );
      console.log(
        `  Tagged ${result.modifiedCount}/${objectIds.length} books with ['${tradition.slug}', '${PARENT_SLUG}']`
      );
    } else {
      console.log(
        `  Would tag ${objectIds.length} books with ['${tradition.slug}', '${PARENT_SLUG}']`
      );
    }
  }

  // 4. Update parent book_count
  // Count unique books tagged with the parent slug
  const uniqueParentCount = await books.countDocuments({
    collections: PARENT_SLUG,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
  });

  if (!DRY_RUN) {
    await collections.updateOne(
      { slug: PARENT_SLUG },
      { $set: { book_count: uniqueParentCount, updated_at: new Date() } }
    );
  }
  console.log(`\n[parent] Total unique books: ${uniqueParentCount}`);
  console.log(`[parent] Subcollections: ${TRADITIONS.length}`);

  console.log('\nDone.');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
