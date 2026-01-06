/**
 * Fix IA books with incorrect page counts
 *
 * Two modes:
 * - trim: Delete excess pages (for books with TOO MANY pages)
 * - reimport: Full reimport from IA (for books with TOO FEW pages)
 *
 * Run: npx tsx scripts/fix-ia-page-counts.ts --mode=trim --dry-run
 *      npx tsx scripts/fix-ia-page-counts.ts --mode=reimport --dry-run
 *      npx tsx scripts/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

interface BookFix {
  bookId: string;
  title: string;
  iaIdentifier: string;
  currentPages: number;
  correctPages: number;
  difference: number;
  mode: 'trim' | 'reimport';
}

async function fetchIAImagecount(identifier: string): Promise<number | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.metadata?.imagecount) {
      return parseInt(data.metadata.imagecount, 10);
    }
    return null;
  } catch {
    return null;
  }
}

async function trimExcessPages(
  db: ReturnType<MongoClient['db']>,
  bookId: string,
  correctCount: number,
  dryRun: boolean
): Promise<{ deleted: number; newOcr: number; newTranslated: number }> {
  if (dryRun) {
    const excessCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      page_number: { $gt: correctCount }
    });
    return { deleted: excessCount, newOcr: 0, newTranslated: 0 };
  }

  // Delete excess pages
  const deleteResult = await db.collection('pages').deleteMany({
    book_id: bookId,
    page_number: { $gt: correctCount }
  });

  // Count remaining OCR'd and translated pages
  const ocrCount = await db.collection('pages').countDocuments({
    book_id: bookId,
    'ocr.data': { $ne: '' }
  });

  const translatedCount = await db.collection('pages').countDocuments({
    book_id: bookId,
    'translation.data': { $ne: '' }
  });

  // Update book metadata
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        pages_count: correctCount,
        pages_ocr: ocrCount,
        pages_translated: translatedCount,
        updated_at: new Date()
      }
    }
  );

  return { deleted: deleteResult.deletedCount, newOcr: ocrCount, newTranslated: translatedCount };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const modeArg = args.find(a => a.startsWith('--mode='));
  const bookIdArg = args.find(a => a.startsWith('--book-id='));
  const correctCountArg = args.find(a => a.startsWith('--correct-count='));

  const mode = modeArg?.split('=')[1] as 'trim' | 'reimport' | undefined;
  const specificBookId = bookIdArg?.split('=')[1];
  const specificCorrectCount = correctCountArg ? parseInt(correctCountArg.split('=')[1], 10) : undefined;

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

    // Single book fix mode
    if (specificBookId && specificCorrectCount) {
      const book = await db.collection('books').findOne({ id: specificBookId });
      if (!book) {
        console.error('Book not found:', specificBookId);
        process.exit(1);
      }

      console.log(`\nFixing: ${book.title}`);
      console.log(`Current pages: ${book.pages_count}`);
      console.log(`Correct pages: ${specificCorrectCount}`);
      console.log(`Dry run: ${dryRun}`);

      if (book.pages_count > specificCorrectCount) {
        const result = await trimExcessPages(db, specificBookId, specificCorrectCount, dryRun);
        console.log(`\nResult: Would delete ${result.deleted} excess pages`);
        if (!dryRun) {
          console.log(`Deleted ${result.deleted} pages`);
          console.log(`New OCR count: ${result.newOcr}`);
          console.log(`New translated count: ${result.newTranslated}`);
        }
      } else {
        console.log(`\nBook has TOO FEW pages - use reimport mode or API:`);
        console.log(`curl -X POST https://sourcelibrary.org/api/books/${specificBookId}/reimport -H "Content-Type: application/json" -d '{"mode":"full"}'`);
      }
      return;
    }

    // Batch mode - find all discrepancies
    if (!mode) {
      console.log('Usage:');
      console.log('  --mode=trim      Fix books with TOO MANY pages (delete excess)');
      console.log('  --mode=reimport  List books with TOO FEW pages (need reimport)');
      console.log('  --dry-run        Show what would be done without making changes');
      console.log('  --book-id=X --correct-count=Y  Fix specific book');
      process.exit(0);
    }

    // Get all IA books
    const iaBooks = await db.collection('books').find({
      ia_identifier: { $exists: true, $ne: null }
    }).toArray();

    console.log(`Found ${iaBooks.length} IA books`);
    console.log(`Mode: ${mode}`);
    console.log(`Dry run: ${dryRun}\n`);

    const fixes: BookFix[] = [];
    let checked = 0;
    let errors = 0;

    for (const book of iaBooks) {
      checked++;
      if (checked % 50 === 0) {
        process.stdout.write(`\r[${checked}/${iaBooks.length}] Scanning... (${fixes.length} found, ${errors} errors)`);
      }

      const iaImagecount = await fetchIAImagecount(book.ia_identifier);
      if (!iaImagecount) {
        errors++;
        continue;
      }

      const diff = (book.pages_count || 0) - iaImagecount;

      // Skip if difference is small (within 5 pages and 10%)
      if (Math.abs(diff) <= 5 || Math.abs(diff / iaImagecount) < 0.1) continue;

      const fixMode = diff > 0 ? 'trim' : 'reimport';

      if (fixMode === mode) {
        fixes.push({
          bookId: book.id,
          title: book.title?.substring(0, 50) || 'Unknown',
          iaIdentifier: book.ia_identifier,
          currentPages: book.pages_count || 0,
          correctPages: iaImagecount,
          difference: diff,
          mode: fixMode
        });
      }

      // Rate limit (50ms is fine for IA)
      await new Promise(r => setTimeout(r, 50));
    }
    console.log(`\r[${checked}/${iaBooks.length}] Scan complete.                    `);

    console.log(`Found ${fixes.length} books to ${mode}\n`);

    if (mode === 'trim') {
      // Sort by difference (most excess first)
      fixes.sort((a, b) => b.difference - a.difference);

      let totalDeleted = 0;
      for (const fix of fixes) {
        console.log(`\n${fix.title}`);
        console.log(`  ID: ${fix.bookId}`);
        console.log(`  Current: ${fix.currentPages} → Correct: ${fix.correctPages} (excess: ${fix.difference})`);

        const result = await trimExcessPages(db, fix.bookId, fix.correctPages, dryRun);
        totalDeleted += result.deleted;

        if (dryRun) {
          console.log(`  Would delete: ${result.deleted} pages`);
        } else {
          console.log(`  Deleted: ${result.deleted} pages`);
          console.log(`  New OCR: ${result.newOcr}, New translated: ${result.newTranslated}`);
        }
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`Total pages ${dryRun ? 'to delete' : 'deleted'}: ${totalDeleted}`);

    } else if (mode === 'reimport') {
      // Sort by missing pages (most missing first)
      fixes.sort((a, b) => a.difference - b.difference);

      console.log('Books that need reimporting (will lose OCR/translation):\n');
      for (const fix of fixes) {
        console.log(`${fix.title}`);
        console.log(`  ID: ${fix.bookId}`);
        console.log(`  Current: ${fix.currentPages} → Correct: ${fix.correctPages} (missing: ${Math.abs(fix.difference)})`);
        console.log(`  curl -X POST https://sourcelibrary.org/api/books/${fix.bookId}/reimport -H "Content-Type: application/json" -d '{"mode":"full"}'`);
        console.log('');
      }
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
