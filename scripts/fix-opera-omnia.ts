/**
 * Fix Opera Omnia page mapping error.
 * Batch import error: OCR from folios 526+ was incorrectly mapped to pages 1-39
 *
 * Run: source .env.local && npx tsx scripts/fix-opera-omnia.ts
 */

import { MongoClient } from 'mongodb';

const BOOK_ID = '694fd600435f95fd0c9556d1';

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  if (!dbName) {
    console.error('MONGODB_DB not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    console.log('Fixing Opera Omnia page mapping...\n');

    // Get current state
    const book = await db.collection('books').findOne({ id: BOOK_ID });
    if (!book) {
      console.error('Book not found');
      process.exit(1);
    }

    console.log(`Book: ${book.title}`);
    console.log(`Total pages: ${book.pages_count}`);
    console.log(`Pages with OCR: ${book.pages_ocr}`);
    console.log(`Pages translated: ${book.pages_translated}\n`);

    // Find pages with bad OCR (pages 1-50 that have OCR with folio markers 500+)
    const badPages = await db.collection('pages')
      .find({
        book_id: BOOK_ID,
        page_number: { $lte: 50 },
        'ocr.data': { $exists: true, $regex: /\[\[page number:\s*(5\d{2}|[6-9]\d{2})\]\]/ }
      })
      .sort({ page_number: 1 })
      .toArray();

    console.log(`Found ${badPages.length} pages with mismatched folio numbers:\n`);

    for (const page of badPages) {
      const ocrData = page.ocr?.data || '';
      const folioMatch = ocrData.match(/\[\[page number:\s*(\d+)\]\]/);
      const folio = folioMatch ? parseInt(folioMatch[1]) : 'unknown';
      console.log(`  Page ${page.page_number}: Contains folio ${folio}`);
    }

    if (badPages.length === 0) {
      console.log('No bad pages found - may have been fixed already.');
      return;
    }

    console.log(`\nClearing OCR from ${badPages.length} pages...`);

    const pageIds = badPages.map(p => p.id);

    const result = await db.collection('pages').updateMany(
      { id: { $in: pageIds } },
      {
        $unset: { ocr: '' },
        $set: {
          updated_at: new Date(),
          cleared_at: new Date(),
          cleared_reason: 'Batch import error: OCR from folios 526+ was incorrectly mapped to pages 1-39'
        }
      }
    );

    console.log(`Cleared OCR from ${result.modifiedCount} pages.`);

    // Recalculate book stats
    const ocrCount = await db.collection('pages').countDocuments({
      book_id: BOOK_ID,
      'ocr.data': { $exists: true, $ne: '' }
    });

    const transCount = await db.collection('pages').countDocuments({
      book_id: BOOK_ID,
      'translation.data': { $exists: true, $ne: '' }
    });

    await db.collection('books').updateOne(
      { id: BOOK_ID },
      {
        $set: {
          pages_ocr: ocrCount,
          pages_translated: transCount,
          updated_at: new Date()
        }
      }
    );

    console.log(`\nUpdated book stats:`);
    console.log(`  Pages with OCR: ${ocrCount}`);
    console.log(`  Pages translated: ${transCount}`);

    console.log('\nDone!');

  } finally {
    await client.close();
  }
}

main().catch(console.error);
