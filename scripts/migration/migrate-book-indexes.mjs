#!/usr/bin/env node
/**
 * Migrate book.index data to dedicated book_indexes collection.
 *
 * Copies the full index to book_indexes, then $unsets the heavy arrays from
 * the book doc (entries, pageSummaries, sectionSummaries, people, places, concepts).
 * Keeps lightweight fields on the book doc: generatedAt, pagesCovered, totalPages, bookSummary.
 *
 * Safe to run multiple times — uses replaceOne with upsert.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/migrate-book-indexes.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const BATCH_SIZE = 100;

// These are the heavy fields that bloat book docs (100KB-2.6MB)
const HEAVY_FIELDS = [
  'index.entries',
  'index.pageSummaries',
  'index.sectionSummaries',
  'index.people',
  'index.places',
  'index.concepts',
];

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Ensure index on book_indexes
  await db.collection('book_indexes').createIndex({ book_id: 1 }, { unique: true });

  // Find all books with index data
  const cursor = db.collection('books').find(
    { 'index.generatedAt': { $exists: true } },
    { projection: { id: 1, index: 1 } }
  ).batchSize(BATCH_SIZE);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const book of cursor) {
    const bookId = book.id;
    const index = book.index;

    if (!bookId || !index) {
      skipped++;
      continue;
    }

    try {
      // Write full index to dedicated collection
      await db.collection('book_indexes').replaceOne(
        { book_id: bookId },
        { book_id: bookId, ...index },
        { upsert: true }
      );

      // $unset heavy fields from book doc, keep lightweight marker
      const unsetFields = {};
      for (const field of HEAVY_FIELDS) {
        unsetFields[field] = '';
      }
      await db.collection('books').updateOne(
        { id: bookId },
        { $unset: unsetFields }
      );

      migrated++;
      if (migrated % 500 === 0) {
        console.log(`  migrated ${migrated} books...`);
      }
    } catch (err) {
      errors++;
      console.error(`  Error migrating ${bookId}: ${err.message}`);
    }
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);

  // Stats
  const bookIndexCount = await db.collection('book_indexes').countDocuments();
  console.log(`book_indexes collection: ${bookIndexCount} documents`);

  const stats = await db.command({ collStats: 'books' });
  console.log(`books collection: ${(stats.size / 1024 / 1024).toFixed(0)} MB (was ~2062 MB)`);

  await client.close();
}

run().catch(e => { console.error(e.message); process.exit(1); });
