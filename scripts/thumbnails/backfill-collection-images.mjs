#!/usr/bin/env node
/**
 * Populate featured_images for collections that are missing them.
 * Uses the same scoring logic as assign-collections-ai.mjs but only
 * touches collections without existing featured_images.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/thumbnails/backfill-collection-images.mjs
 *   node scripts/thumbnails/backfill-collection-images.mjs --dry-run
 *   node scripts/thumbnails/backfill-collection-images.mjs --all    # Re-populate ALL collections
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 60000,
  });
  const db = client.db('bookstore');

  // Find collections that need images
  const filter = ALL ? {} : {
    $or: [
      { featured_images: { $exists: false } },
      { featured_images: { $size: 0 } },
      { featured_images: null },
    ],
  };
  const collections = await db.collection('collections').find(filter)
    .project({ slug: 1, name: 1, book_count: 1, featured_images: 1 })
    .sort({ book_count: -1 })
    .toArray();

  console.log(`Collections to process: ${collections.length}${ALL ? ' (all)' : ' (missing only)'}`);
  if (DRY_RUN) console.log('[DRY RUN]');

  let populated = 0;
  let noImages = 0;
  let noBooks = 0;

  // Phase 1: Collect candidate images for each collection
  const pending = []; // { slug, name, images: [] }

  for (const col of collections) {
    const bookIds = await db.collection('books').distinct('id', {
      collections: col.slug,
      deleted: { $ne: true },
    });

    if (bookIds.length === 0) {
      noBooks++;
      continue;
    }

    // Find best gallery images from these books
    const images = await db.collection('gallery_images').aggregate([
      { $match: {
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.7 },
        $or: [
          { extracted_url: { $exists: true, $ne: null, $ne: '' } },
          { image_url: { $exists: true, $ne: null, $ne: '' } },
          { thumbnail_url: { $exists: true, $ne: null, $ne: '' } },
        ],
      }},
      { $addFields: {
        _score: { $add: [
          { $multiply: ['$gallery_quality', 50] },
          { $cond: [{ $gt: [{ $size: { $ifNull: ['$metadata.subjects', []] } }, 0] }, 5, 0] },
          { $cond: [{ $and: [
            { $ne: ['$museum_description', null] },
            { $gt: [{ $strLenCP: { $ifNull: ['$museum_description', ''] } }, 50] },
          ]}, 10, 0] },
          { $cond: [{ $in: ['$type', ['emblem', 'engraving', 'frontispiece', 'diagram', 'portrait']] }, 10, 0] },
        ]},
      }},
      { $sort: { _score: -1 } },
      // Max 1 per book for diversity
      { $group: {
        _id: '$book_id',
        top: { $first: '$$ROOT' },
      }},
      { $replaceRoot: { newRoot: '$top' } },
      { $sort: { _score: -1 } },
      { $limit: 6 },
      { $project: {
        id: 1, page_id: 1, detection_index: 1,
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, type: 1, gallery_quality: 1,
        book_id: 1, book_title: 1, book_author: 1, book_year: 1,
        museum_description: 1,
      }},
    ]).toArray();

    if (images.length === 0) {
      // Fallback: use book thumbnails
      const booksWithThumbs = await db.collection('books').find({
        id: { $in: bookIds },
        thumbnail: { $exists: true, $ne: null, $ne: '' },
      }).project({ id: 1, title: 1, thumbnail: 1 })
        .sort({ pages_translated: -1 })
        .limit(6)
        .toArray();

      if (booksWithThumbs.length > 0) {
        pending.push({
          slug: col.slug,
          name: col.name,
          images: booksWithThumbs.map(b => ({
            image_url: b.thumbnail,
            book_id: b.id,
            book_title: b.title,
            type: 'thumbnail-fallback',
          })),
        });
        console.log(`  ${col.name}: ${booksWithThumbs.length} fallback thumbnails`);
        populated++;
      } else {
        console.log(`  ${col.name}: no images at all (${bookIds.length} books)`);
        noImages++;
      }
      continue;
    }

    pending.push({ slug: col.slug, name: col.name, images });
    console.log(`  ${col.name}: ${images.length} gallery images`);
    populated++;
  }

  // Phase 2: Deduplicate hero images across collections.
  // Each collection's first image is the thumbnail shown on /collections.
  // Reorder so every collection gets a unique hero where possible.
  console.log('\n--- Deduplicating hero images ---');
  const getUrl = (img) => img?.extracted_url || img?.image_url || img?.thumbnail_url || null;

  // Sort by fewest candidates first (most constrained pick first)
  pending.sort((a, b) => a.images.length - b.images.length);

  const usedHeroUrls = new Set();
  let reordered = 0;

  for (const col of pending) {
    const urls = col.images.map(getUrl).filter(Boolean);
    // Find first unused URL
    let chosenIdx = urls.findIndex(u => !usedHeroUrls.has(u));
    if (chosenIdx === -1) chosenIdx = 0; // all taken, keep first

    if (chosenIdx > 0) {
      // Move chosen image to front
      const [chosen] = col.images.splice(chosenIdx, 1);
      col.images.unshift(chosen);
      reordered++;
    }

    const heroUrl = getUrl(col.images[0]);
    if (heroUrl) usedHeroUrls.add(heroUrl);
  }

  console.log(`Reordered ${reordered} collections to avoid duplicate thumbnails`);

  // Phase 3: Write to DB
  if (!DRY_RUN) {
    for (const col of pending) {
      await db.collection('collections').updateOne(
        { slug: col.slug },
        { $set: { featured_images: col.images } }
      );
    }
  }

  console.log('\n--- Results ---');
  console.log(`Populated: ${populated}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`No images available: ${noImages}`);
  console.log(`No books assigned: ${noBooks}`);
  console.log(`Hero images reordered: ${reordered}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
