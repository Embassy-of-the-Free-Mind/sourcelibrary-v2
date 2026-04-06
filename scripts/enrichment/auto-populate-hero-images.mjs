#!/usr/bin/env node
/**
 * Auto-populate hero_image for collections that have gallery images but no curated hero.
 *
 * For each collection missing a hero_image, finds the highest-quality gallery image
 * from that collection's books and sets it as the hero.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/auto-populate-hero-images.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/auto-populate-hero-images.mjs --apply
 *
 * Default is dry-run. Pass --apply to actually write to the database.
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const EXCLUDED_TYPES = [
  'decorative', 'symbol', 'musical_score',
  'printer_device', 'printer_mark', 'ornament', 'border',
];
const MIN_QUALITY = 0.7;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Source .env.production.local first.');
    process.exit(1);
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('bookstore');

  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (pass --apply to write) ===');
  console.log();

  // Find collections without a hero_image
  const collections = await db.collection('collections').find({
    $or: [
      { hero_image: { $exists: false } },
      { hero_image: null },
      { hero_image: '' },
    ],
  }).toArray();

  console.log(`Found ${collections.length} collections without hero_image.\n`);

  let populated = 0;
  let skipped = 0;

  for (const col of collections) {
    const slug = col.slug;

    // Find books in this collection
    let bookDocs;
    try {
      bookDocs = await db.collection('books').find(
        { collections: slug, pages_count: { $gt: 0 } },
        { projection: { id: 1 }, maxTimeMS: 10000 },
      ).toArray();
    } catch (err) {
      console.log(`[${slug}] Books query timeout — skipping`);
      skipped++;
      continue;
    }

    const bookIds = bookDocs.map(b => b.id);

    if (bookIds.length === 0) {
      console.log(`[${slug}] No books found — skipping`);
      skipped++;
      continue;
    }

    // Find the best gallery image from these books
    let topImages;
    try {
      topImages = await db.collection('gallery_images').find(
        {
          book_id: { $in: bookIds },
          gallery_quality: { $gte: MIN_QUALITY },
          extracted_url: { $exists: true, $ne: null },
          type: { $nin: EXCLUDED_TYPES },
        },
        { maxTimeMS: 15000 },
      )
        .sort({ gallery_quality: -1 })
        .limit(1)
        .toArray();
    } catch (err) {
      console.log(`[${slug}] Query timeout (${bookIds.length} books) — skipping`);
      skipped++;
      continue;
    }

    if (topImages.length === 0) {
      console.log(`[${slug}] No qualifying gallery images (${bookIds.length} books) — skipping`);
      skipped++;
      continue;
    }

    const best = topImages[0];
    const url = best.extracted_url;
    console.log(`[${slug}] -> ${url}`);
    console.log(`   quality: ${best.gallery_quality?.toFixed(2)}, type: ${best.type || 'unknown'}, book: ${best.book_title || best.book_id}`);

    if (APPLY) {
      await db.collection('collections').updateOne(
        { _id: col._id },
        {
          $set: {
            hero_image: url,
            hero_image_source: 'auto-gallery',
            updated_at: new Date(),
          },
        },
      );
      console.log(`   WRITTEN`);
    }

    populated++;
  }

  console.log();
  console.log(`=== Summary ===`);
  console.log(`Collections without hero: ${collections.length}`);
  console.log(`Would populate: ${populated}`);
  console.log(`Skipped (no books/images): ${skipped}`);
  if (!APPLY && populated > 0) {
    console.log(`\nRe-run with --apply to write changes.`);
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
