/**
 * Fix Atalanta fugiens - delete excess pages (233-407) that contain calibration targets
 *
 * This book was imported with 407 pages due to a bug in the jp2.zip size estimation.
 * The actual book has 232 pages (per IA imagecount metadata).
 *
 * Run: npx tsx scripts/fix-atalanta-excess-pages.ts
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

const BOOK_ID = '6952d0c377f38f6761bc585e';
const CORRECT_PAGE_COUNT = 232;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const dbName = process.env.MONGODB_DB;
  if (!dbName) {
    console.error('MONGODB_DB not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    // Get current state
    const book = await db.collection('books').findOne({ id: BOOK_ID });
    if (!book) {
      console.error('Book not found:', BOOK_ID);
      process.exit(1);
    }

    console.log('Book:', book.title);
    console.log('Current pages_count:', book.pages_count);
    console.log('Correct pages_count:', CORRECT_PAGE_COUNT);

    // Count pages to delete
    const excessPages = await db.collection('pages').countDocuments({
      book_id: BOOK_ID,
      page_number: { $gt: CORRECT_PAGE_COUNT }
    });

    console.log(`\nPages to delete: ${excessPages} (pages ${CORRECT_PAGE_COUNT + 1}-${book.pages_count})`);

    if (excessPages === 0) {
      console.log('No excess pages to delete. Book already fixed?');
      return;
    }

    // Delete excess pages
    const deleteResult = await db.collection('pages').deleteMany({
      book_id: BOOK_ID,
      page_number: { $gt: CORRECT_PAGE_COUNT }
    });

    console.log(`Deleted ${deleteResult.deletedCount} excess pages`);

    // Count remaining OCR'd and translated pages
    const ocrCount = await db.collection('pages').countDocuments({
      book_id: BOOK_ID,
      'ocr.data': { $ne: '' }
    });

    const translatedCount = await db.collection('pages').countDocuments({
      book_id: BOOK_ID,
      'translation.data': { $ne: '' }
    });

    // Update book metadata
    const updateResult = await db.collection('books').updateOne(
      { id: BOOK_ID },
      {
        $set: {
          pages_count: CORRECT_PAGE_COUNT,
          pages_ocr: ocrCount,
          pages_translated: translatedCount,
          updated_at: new Date()
        }
      }
    );

    console.log(`\nUpdated book metadata:`);
    console.log(`  pages_count: ${CORRECT_PAGE_COUNT}`);
    console.log(`  pages_ocr: ${ocrCount}`);
    console.log(`  pages_translated: ${translatedCount}`);
    console.log(`\nBook fix complete!`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
