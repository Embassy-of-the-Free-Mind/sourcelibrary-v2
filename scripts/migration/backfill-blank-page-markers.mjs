#!/usr/bin/env node
/**
 * Backfill translation markers on blank/skipped pages.
 *
 * These pages have OCR data but no translation because the translation worker
 * used to skip them silently. Without a marker in translation.data, they don't
 * count toward pages_translated, requiring pages_blank subtraction everywhere.
 *
 * This script:
 * 1. Finds pages with page_type in SKIP_TRANSLATION_PAGE_TYPES, OCR data, but no translation
 * 2. Writes a system marker to translation.data
 * 3. Recalculates pages_translated on affected books
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/backfill-blank-page-markers.mjs
 */

import { MongoClient } from 'mongodb';

const SKIP_TRANSLATION_PAGE_TYPES = ['blank'];

const MARKER_BY_TYPE = {
  blank: '[Blank page — no translatable content]',
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const books = db.collection('books');

  // Find pages that need markers
  const query = {
    page_type: { $in: SKIP_TRANSLATION_PAGE_TYPES },
    'ocr.data': { $exists: true, $ne: '' },
    $or: [
      { 'translation.data': { $exists: false } },
      { 'translation.data': null },
      { 'translation.data': '' },
    ],
  };

  const count = await pages.countDocuments(query);
  console.log(`Found ${count} blank pages without translation markers`);

  if (count === 0) {
    console.log('Nothing to do');
    await client.close();
    return;
  }

  // Process in batches
  const BATCH_SIZE = 500;
  let processed = 0;
  const affectedBookIds = new Set();

  const cursor = pages.find(query, {
    projection: { _id: 1, id: 1, book_id: 1, page_type: 1 },
    batchSize: BATCH_SIZE,
  });

  let ops = [];
  for await (const page of cursor) {
    const pageType = page.page_type || 'blank';
    const marker = MARKER_BY_TYPE[pageType] || `[${pageType.charAt(0).toUpperCase() + pageType.slice(1)} page — no translatable content]`;

    ops.push({
      updateOne: {
        filter: { _id: page._id },
        update: {
          $set: {
            translation: {
              data: marker,
              language: 'English',
              source: 'system',
              updated_at: new Date(),
            },
            updated_at: new Date(),
          },
        },
      },
    });
    affectedBookIds.add(page.book_id);

    if (ops.length >= BATCH_SIZE) {
      await pages.bulkWrite(ops, { ordered: false });
      processed += ops.length;
      console.log(`  ${processed}/${count} pages updated`);
      ops = [];
    }
  }

  if (ops.length > 0) {
    await pages.bulkWrite(ops, { ordered: false });
    processed += ops.length;
    console.log(`  ${processed}/${count} pages updated`);
  }

  console.log(`\nUpdated ${processed} pages across ${affectedBookIds.size} books`);

  // Recalculate pages_translated for affected books
  console.log(`\nRecalculating pages_translated for ${affectedBookIds.size} books...`);
  let booksDone = 0;
  for (const bookId of affectedBookIds) {
    const [agg] = await pages.aggregate([
      { $match: { book_id: bookId } },
      {
        $group: {
          _id: null,
          translated: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: [{ $type: '$translation.data' }, 'string'] },
                    { $gt: [{ $strLenCP: '$translation.data' }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          blank: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: [{ $ifNull: ['$page_type', ''] }, SKIP_TRANSLATION_PAGE_TYPES] },
                    { $eq: [{ $type: '$ocr.data' }, 'string'] },
                    { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).toArray();

    if (agg) {
      await books.updateOne(
        { id: bookId },
        {
          $set: {
            pages_translated: agg.translated,
            pages_blank: agg.blank,
            updated_at: new Date(),
          },
        }
      );
    }

    booksDone++;
    if (booksDone % 100 === 0) {
      console.log(`  ${booksDone}/${affectedBookIds.size} books recalculated`);
    }
  }
  console.log(`  ${booksDone}/${affectedBookIds.size} books recalculated`);

  // Final check
  const newReadable = await books.countDocuments({
    pages_count: { $gt: 0 },
    pages_ocr: { $gte: 1 },
    $expr: {
      $gte: [
        '$pages_translated',
        { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] },
      ],
    },
  });
  console.log(`\nReadable books after backfill: ${newReadable}`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
