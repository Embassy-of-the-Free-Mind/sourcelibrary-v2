/**
 * Script to sync pages_count, pages_ocr, and pages_translated fields on books
 * based on actual page data in the pages collection.
 *
 * Run with: npx tsx scripts/sync-page-counts.ts
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI!);

  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB;
    if (!dbName) {
      console.error('MONGODB_DB environment variable is required');
      process.exit(1);
    }
    const db = client.db(dbName);
    const books = db.collection('books');
    const pages = db.collection('pages');

    // Get all books
    const allBooks = await books.find({}).toArray();
    console.log(`Found ${allBooks.length} books to sync\n`);

    let updatedCount = 0;
    let mismatchCount = 0;

    for (const book of allBooks) {
      const bookId = book.id || book._id?.toString();
      if (!bookId) continue;

      // Count actual pages for this book
      const pageStats = await pages.aggregate([
        { $match: { book_id: bookId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            withOcr: {
              $sum: {
                $cond: [
                  { $and: [
                    { $ne: ['$ocr', null] },
                    { $ne: ['$ocr.data', null] },
                    { $ne: ['$ocr.data', ''] }
                  ]},
                  1,
                  0
                ]
              }
            },
            withTranslation: {
              $sum: {
                $cond: [
                  { $and: [
                    { $ne: ['$translation', null] },
                    { $ne: ['$translation.data', null] },
                    { $ne: ['$translation.data', ''] }
                  ]},
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).toArray();

      const stats = pageStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };

      // Check if update is needed
      const currentCount = book.pages_count || 0;
      const currentOcr = book.pages_ocr || 0;
      const currentTranslated = book.pages_translated || 0;

      if (
        currentCount !== stats.total ||
        currentOcr !== stats.withOcr ||
        currentTranslated !== stats.withTranslation
      ) {
        mismatchCount++;
        console.log(`${book.title || bookId}:`);
        console.log(`  pages_count: ${currentCount} → ${stats.total}`);
        console.log(`  pages_ocr: ${currentOcr} → ${stats.withOcr}`);
        console.log(`  pages_translated: ${currentTranslated} → ${stats.withTranslation}`);

        await books.updateOne(
          { _id: book._id },
          {
            $set: {
              pages_count: stats.total,
              pages_ocr: stats.withOcr,
              pages_translated: stats.withTranslation,
              updated_at: new Date()
            }
          }
        );
        updatedCount++;
      }
    }

    console.log(`\nDone! Updated ${updatedCount} of ${mismatchCount} mismatched books.`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
