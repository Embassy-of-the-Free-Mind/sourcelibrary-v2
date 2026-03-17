#!/usr/bin/env node
/**
 * Populate featured_images for collections.
 *
 * Picks images that are both high-quality AND thematically iconic for
 * each collection. Uses keyword matching between image metadata
 * (subjects, figures, symbols, description) and the collection's name
 * and description to boost relevance. Then deduplicates hero images
 * across all collections so every thumbnail is unique.
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

/**
 * Build a set of meaningful keywords from text.
 * Strips stop words and short tokens.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'are', 'was', 'has',
  'its', 'into', 'their', 'also', 'all', 'can', 'not', 'but', 'more', 'most',
  'than', 'been', 'other', 'which', 'about', 'such', 'through', 'between',
  'texts', 'books', 'works', 'including', 'tradition', 'traditions',
]);

function extractKeywords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score how well an image's metadata matches a collection's theme.
 * Returns 0-30 relevance bonus.
 */
function thematicRelevance(image, collectionKeywords) {
  if (collectionKeywords.length === 0) return 0;

  // Gather all text from the image
  const imageText = [
    ...(image.metadata?.subjects || []),
    ...(image.metadata?.figures || []),
    ...(image.metadata?.symbols || []),
    image.description || '',
    image.museum_description || '',
    image.book_title || '',
    image.type || '',
  ].join(' ');

  const imageWords = new Set(extractKeywords(imageText));

  // Count how many collection keywords appear in the image
  let hits = 0;
  for (const kw of collectionKeywords) {
    if (imageWords.has(kw)) hits++;
    // Also check partial matches (e.g., "alchemical" matches "alchemy")
    else if ([...imageWords].some(w => w.startsWith(kw) || kw.startsWith(w))) hits += 0.5;
  }

  // Normalize: more hits = higher score, max 30
  const ratio = hits / collectionKeywords.length;
  return Math.min(30, Math.round(ratio * 30));
}

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
    .project({ slug: 1, name: 1, description: 1, book_count: 1, featured_images: 1 })
    .sort({ book_count: -1 })
    .toArray();

  console.log(`Collections to process: ${collections.length}${ALL ? ' (all)' : ' (missing only)'}`);
  if (DRY_RUN) console.log('[DRY RUN]');

  let populated = 0;
  let noImages = 0;
  let noBooks = 0;

  // Phase 1: Collect candidate images with thematic relevance scoring
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

    // Build collection keywords from name + description + slug
    const colKeywords = extractKeywords(
      `${col.name} ${col.slug.replace(/-/g, ' ')} ${col.description || ''}`
    );

    // Fetch MORE candidates (20 per-book top images) for better thematic selection
    const candidates = await db.collection('gallery_images').aggregate([
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
        _quality_score: { $add: [
          { $multiply: ['$gallery_quality', 50] },
          { $cond: [{ $gt: [{ $size: { $ifNull: ['$metadata.subjects', []] } }, 0] }, 5, 0] },
          { $cond: [{ $and: [
            { $ne: ['$museum_description', null] },
            { $gt: [{ $strLenCP: { $ifNull: ['$museum_description', ''] } }, 50] },
          ]}, 10, 0] },
          { $cond: [{ $in: ['$type', ['emblem', 'engraving', 'frontispiece', 'diagram', 'portrait']] }, 10, 0] },
        ]},
      }},
      { $sort: { _quality_score: -1 } },
      // Max 1 per book for diversity
      { $group: {
        _id: '$book_id',
        top: { $first: '$$ROOT' },
      }},
      { $replaceRoot: { newRoot: '$top' } },
      { $sort: { _quality_score: -1 } },
      { $limit: 20 },
      { $project: {
        id: 1, page_id: 1, detection_index: 1,
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, type: 1, gallery_quality: 1,
        book_id: 1, book_title: 1, book_author: 1, book_year: 1,
        museum_description: 1,
        metadata: 1,
        _quality_score: 1,
      }},
    ]).toArray();

    if (candidates.length === 0) {
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

    // Re-rank by combined quality + thematic relevance
    for (const img of candidates) {
      img._relevance = thematicRelevance(img, colKeywords);
      img._total_score = (img._quality_score || 0) + img._relevance;
    }
    candidates.sort((a, b) => b._total_score - a._total_score);

    // Take top 6 after re-ranking
    const images = candidates.slice(0, 6).map(img => {
      // Strip internal scoring fields before storing
      const { _quality_score, _relevance, _total_score, metadata, ...clean } = img;
      return clean;
    });

    const topImg = candidates[0];
    const relevanceTag = topImg._relevance > 0 ? ` (relevance +${topImg._relevance})` : '';
    pending.push({ slug: col.slug, name: col.name, images });
    console.log(`  ${col.name}: ${images.length} images, hero="${topImg.book_title}"${relevanceTag}`);
    populated++;
  }

  // Phase 2: Deduplicate hero images across collections.
  console.log('\n--- Deduplicating hero images ---');
  const getUrl = (img) => img?.extracted_url || img?.image_url || img?.thumbnail_url || null;

  // Sort by fewest candidates first (most constrained pick first)
  pending.sort((a, b) => a.images.length - b.images.length);

  const usedHeroUrls = new Set();
  let reordered = 0;

  for (const col of pending) {
    const urls = col.images.map(getUrl).filter(Boolean);
    let chosenIdx = urls.findIndex(u => !usedHeroUrls.has(u));
    if (chosenIdx === -1) chosenIdx = 0;

    if (chosenIdx > 0) {
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
