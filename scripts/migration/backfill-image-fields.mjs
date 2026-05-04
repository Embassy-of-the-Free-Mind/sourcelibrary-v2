#!/usr/bin/env node
/**
 * Backfill canonical image_* fields from legacy thumbnail/thumbnail_blob fields.
 *
 * Books:
 *   thumbnail        → image_display
 *   thumbnail_blob   → image_thumb
 *   archived_full_url → image_full (artworks only)
 *   commons_full_url  → image_source_url (artworks only)
 *
 * Pages:
 *   thumbnail_blob   → image_thumb
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-image-fields.mjs [--dry-run] [--books-only] [--pages-only]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const BOOKS_ONLY = process.argv.includes('--books-only');
const PAGES_ONLY = process.argv.includes('--pages-only');

const client = new MongoClient(process.env.MONGODB_URI);

async function backfillBooks(db) {
  // Books that have thumbnail but no image_display
  const query = {
    thumbnail: { $exists: true, $ne: null },
    image_display: { $exists: false },
  };

  const count = await db.collection('books').countDocuments(query);
  console.log(`Books to backfill: ${count}`);

  if (DRY_RUN || count === 0) return count;

  // Batch update using bulkWrite for efficiency
  const BATCH = 500;
  let processed = 0;

  while (processed < count) {
    const docs = await db.collection('books')
      .find(query)
      .project({
        _id: 1, thumbnail: 1, thumbnail_blob: 1,
        archived_full_url: 1, commons_full_url: 1,
        resource_type: 1,
      })
      .limit(BATCH)
      .toArray();

    if (docs.length === 0) break;

    const ops = docs.map(doc => {
      const $set = {};

      if (doc.thumbnail) $set.image_display = doc.thumbnail;
      if (doc.thumbnail_blob) $set.image_thumb = doc.thumbnail_blob;

      // Artwork-specific fields
      if (doc.resource_type) {
        if (doc.archived_full_url) $set.image_full = doc.archived_full_url;
        if (doc.commons_full_url) $set.image_source_url = doc.commons_full_url;
      }

      return {
        updateOne: {
          filter: { _id: doc._id },
          update: { $set },
        },
      };
    });

    const result = await db.collection('books').bulkWrite(ops, { ordered: false });
    processed += docs.length;
    console.log(`  Books: ${processed}/${count} (modified: ${result.modifiedCount})`);
  }

  return processed;
}

async function backfillPages(db) {
  // Pages that have thumbnail_blob but no image_thumb
  const query = {
    thumbnail_blob: { $exists: true, $ne: null },
    image_thumb: { $exists: false },
  };

  const count = await db.collection('pages').countDocuments(query);
  console.log(`Pages to backfill: ${count}`);

  if (DRY_RUN || count === 0) return count;

  // Use updateMany with aggregation pipeline for single-pass efficiency
  const BATCH = 5000;
  let processed = 0;

  while (true) {
    const result = await db.collection('pages').updateMany(
      { ...query },
      [{ $set: { image_thumb: '$thumbnail_blob' } }],
      { limit: BATCH }
    );

    if (result.modifiedCount === 0) break;
    processed += result.modifiedCount;
    console.log(`  Pages: ${processed}/${count}`);
  }

  return processed;
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== BACKFILLING ===');

  if (!PAGES_ONLY) {
    await backfillBooks(db);
  }

  if (!BOOKS_ONLY) {
    await backfillPages(db);
  }

  console.log('\nDone.');
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
