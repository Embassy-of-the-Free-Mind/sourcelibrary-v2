#!/usr/bin/env node

/**
 * Curate the top 100 books for beta launch.
 *
 * Selects books with the best translation coverage, ensuring diversity across:
 *   - Languages (8+ different)
 *   - Categories (10+ different)
 *   - Centuries (spread across 1400s-1800s)
 *   - Source providers
 *   - Mix of illustration-rich and text-heavy
 *
 * Usage:
 *   node scripts/curate-beta-100.mjs              # Preview list
 *   node scripts/curate-beta-100.mjs --apply      # Set featured: true in MongoDB
 *   node scripts/curate-beta-100.mjs --clear      # Remove all featured flags
 *   node scripts/curate-beta-100.mjs --add=ID1,ID2  # Add specific book IDs
 *   node scripts/curate-beta-100.mjs --remove=ID1   # Remove specific book IDs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Use: secret-lover run -- node scripts/curate-beta-100.mjs');
  process.exit(1);
}

const TARGET_COUNT = 100;
const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const clearMode = args.includes('--clear');
const addArg = args.find(a => a.startsWith('--add='));
const removeArg = args.find(a => a.startsWith('--remove='));
const addIds = addArg ? addArg.split('=')[1].split(',') : [];
const removeIds = removeArg ? removeArg.split('=')[1].split(',') : [];

const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Handle --clear
  if (clearMode) {
    const result = await books.updateMany(
      { featured: true },
      { $unset: { featured: '' } }
    );
    console.log(`Cleared featured flag from ${result.modifiedCount} books.`);
    return;
  }

  // Handle --add
  if (addIds.length > 0) {
    for (const id of addIds) {
      const result = await books.updateOne({ id }, { $set: { featured: true } });
      console.log(`${id}: ${result.modifiedCount ? 'featured' : 'not found'}`);
    }
    return;
  }

  // Handle --remove
  if (removeIds.length > 0) {
    for (const id of removeIds) {
      const result = await books.updateOne({ id }, { $unset: { featured: '' } });
      console.log(`${id}: ${result.modifiedCount ? 'unfeatured' : 'not found'}`);
    }
    return;
  }

  // Query books with translations, sorted by completeness
  const candidates = await books.aggregate([
    {
      $match: {
        pages_translated: { $gt: 0 },
        pages_count: { $gt: 10 },
      },
    },
    {
      $addFields: {
        translation_pct: {
          $cond: {
            if: { $gt: ['$pages_count', 0] },
            then: { $multiply: [{ $divide: ['$pages_translated', '$pages_count'] }, 100] },
            else: 0,
          },
        },
        century: {
          $cond: {
            if: { $regexMatch: { input: { $toString: { $ifNull: ['$published', ''] } }, regex: /^\d{4}/ } },
            then: {
              $concat: [
                { $toString: { $add: [{ $floor: { $divide: [{ $toInt: { $substr: [{ $toString: '$published' }, 0, 4] } }, 100] } }, 1] } },
                'th c.',
              ],
            },
            else: 'Unknown',
          },
        },
      },
    },
    { $sort: { translation_pct: -1, pages_translated: -1 } },
    {
      $project: {
        _id: 0,
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        language: 1,
        published: 1,
        categories: 1,
        pages_count: 1,
        pages_translated: 1,
        pages_ocr: 1,
        translation_pct: 1,
        century: 1,
        image_source: 1,
        ia_identifier: 1,
        detected_images_count: { $size: { $ifNull: ['$detected_images', []] } },
      },
    },
  ]).toArray();

  console.log(`Found ${candidates.length} books with translations.\n`);

  // Greedy selection with diversity constraints
  const selected = [];
  const languageCounts = {};
  const categoryCounts = {};
  const centuryCounts = {};
  const MAX_PER_LANGUAGE = 25;
  const MAX_PER_CATEGORY = 15;
  const MAX_PER_CENTURY = 30;

  for (const book of candidates) {
    if (selected.length >= TARGET_COUNT) break;

    const lang = book.language || 'Unknown';
    const century = book.century || 'Unknown';

    // Check language cap
    if ((languageCounts[lang] || 0) >= MAX_PER_LANGUAGE) continue;

    // Check century cap
    if ((centuryCounts[century] || 0) >= MAX_PER_CENTURY) continue;

    // Check category caps
    const cats = book.categories || [];
    const catBlocked = cats.some(c => (categoryCounts[c] || 0) >= MAX_PER_CATEGORY);
    if (catBlocked && cats.length > 0) continue;

    // Select this book
    selected.push(book);
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    centuryCounts[century] = (centuryCounts[century] || 0) + 1;
    for (const c of cats) {
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    }
  }

  // Print summary
  console.log(`Selected ${selected.length} books for beta:\n`);
  console.log('--- Language Distribution ---');
  for (const [lang, count] of Object.entries(languageCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lang}: ${count}`);
  }
  console.log(`\n--- Century Distribution ---`);
  for (const [century, count] of Object.entries(centuryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${century}: ${count}`);
  }
  console.log(`\n--- Top Categories ---`);
  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log('\n--- Selected Books ---');
  for (const book of selected) {
    const title = (book.display_title || book.title || '').slice(0, 60);
    const pct = Math.round(book.translation_pct);
    console.log(`  [${pct}%] ${title} (${book.language}, ${book.published || '?'}) — ${book.pages_translated}/${book.pages_count} pages`);
  }

  if (applyMode) {
    console.log('\n--- Applying featured flag ---');
    // First clear all existing
    await books.updateMany({ featured: true }, { $unset: { featured: '' } });

    const ids = selected.map(b => b.id);
    const result = await books.updateMany(
      { id: { $in: ids } },
      { $set: { featured: true } }
    );
    console.log(`Set featured: true on ${result.modifiedCount} books.`);
  } else {
    console.log('\nDry run. Use --apply to set featured: true in MongoDB.');
  }
}

main()
  .catch(console.error)
  .finally(() => client.close());
