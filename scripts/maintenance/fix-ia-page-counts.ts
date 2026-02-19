/**
 * Fix IA page count bug: trim excess pages from books imported before Dec 30, 2025.
 * 
 * Usage:
 *   npx tsx scripts/maintenance/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY [--dry-run]
 * 
 * What it does:
 *   1. Deletes pages where page_number > correct_count
 *   2. Updates book.pages_count, pages_ocr, pages_translated
 *   3. Preserves all OCR/translation on valid pages
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

const bookId = getArg('book-id');
const correctCount = getArg('correct-count');
const dryRun = args.includes('--dry-run');

if (!bookId || !correctCount) {
  console.error('Usage: npx tsx scripts/maintenance/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY [--dry-run]');
  process.exit(1);
}

const correctCountNum = parseInt(correctCount, 10);
if (isNaN(correctCountNum) || correctCountNum < 1) {
  console.error('--correct-count must be a positive integer');
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'bookstore';

  if (!uri) {
    console.error('MONGODB_URI environment variable not set. Use secret-lover run -- ...');
    process.exit(1);
  }

  const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  
  try {
    await client.connect();
    const db = client.db(dbName);
    
    // Fetch the book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      console.error(`Book not found: ${bookId}`);
      process.exit(1);
    }

    console.log(`Book: ${book.title || book.display_title}`);
    console.log(`Current pages_count: ${book.pages_count}`);
    console.log(`Correct count: ${correctCountNum}`);

    if (book.pages_count <= correctCountNum) {
      console.log('Book already has correct or fewer pages. Nothing to do.');
      process.exit(0);
    }

    // Count pages to delete (page_number is 1-indexed)
    const excessFilter = { book_id: bookId, page_number: { $gt: correctCountNum } };
    const excessCount = await db.collection('pages').countDocuments(excessFilter);
    
    // Count pages with OCR/translation that would be deleted
    const excessWithOcr = await db.collection('pages').countDocuments({
      ...excessFilter,
      'ocr.data': { $exists: true, $ne: '' }
    });
    const excessWithTranslation = await db.collection('pages').countDocuments({
      ...excessFilter,
      'translation.data': { $exists: true, $ne: '' }
    });

    console.log(`\nPages to delete: ${excessCount} (page_number > ${correctCountNum})`);
    console.log(`  - with OCR: ${excessWithOcr}`);
    console.log(`  - with translation: ${excessWithTranslation}`);

    if (dryRun) {
      console.log('\n[DRY RUN] No changes made.');
      return;
    }

    // Delete excess pages
    const deleteResult = await db.collection('pages').deleteMany(excessFilter);
    console.log(`\nDeleted ${deleteResult.deletedCount} excess pages.`);

    // Recount remaining pages with OCR and translations
    const remainingTotal = await db.collection('pages').countDocuments({ book_id: bookId });
    const remainingOcr = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' }
    });
    const remainingTranslated = await db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $ne: '' }
    });

    // Update book record
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages_count: remainingTotal,
          pages_ocr: remainingOcr,
          pages_translated: remainingTranslated,
          updated_at: new Date().toISOString()
        }
      }
    );

    console.log(`\nUpdated book record:`);
    console.log(`  pages_count: ${remainingTotal}`);
    console.log(`  pages_ocr: ${remainingOcr}`);
    console.log(`  pages_translated: ${remainingTranslated}`);

    // Log to audit_log
    await db.collection('audit_log').insertOne({
      action: 'fix_page_count',
      book_id: bookId,
      book_title: book.title || book.display_title,
      details: {
        previous_count: book.pages_count,
        correct_count: correctCountNum,
        pages_deleted: deleteResult.deletedCount,
        deleted_with_ocr: excessWithOcr,
        deleted_with_translation: excessWithTranslation,
        reason: 'IA page count bug (pre-Dec 30, 2025 import)'
      },
      created_at: new Date().toISOString()
    });

    console.log(`\nAudit log entry created.`);
    console.log(`Done. View at: https://sourcelibrary.org/book/${bookId}`);

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
