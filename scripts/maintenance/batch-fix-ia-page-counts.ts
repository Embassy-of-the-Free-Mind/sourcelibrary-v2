/**
 * Batch fix IA page count bug: for each book, fetch the IIIF manifest to get
 * the real page count, then trim excess pages.
 *
 * Usage:
 *   secret-lover run -- npx tsx scripts/maintenance/batch-fix-ia-page-counts.ts [--dry-run]
 */

import { MongoClient, ObjectId, Db } from 'mongodb';

const dryRun = process.argv.includes('--dry-run');

// Critical inflated books from audit (_id hex strings)
const BOOKS_TO_FIX = [
  { _id: '695273a1ab34727b1f049baf', name: 'Oedipus Aegyptiacus Vol II' },
  { _id: '694f4a642bef28522211754b', name: 'Oedipus Aegyptiacus Vol. I' },
  { _id: '695311a477f38f6761bcc8b8', name: 'Codex Alexandrinus' },
  { _id: '695273a7ab34727b1f04a708', name: 'Oedipus Aegyptiacus Vol III' },
  { _id: '694f3df1be37f451a5324fae', name: 'La Divina Commedia' },
  { _id: '694fe5fcf844de8615417e04', name: 'Canon Medicinae' },
  { _id: '695285a6ab34727b1f04b9e8', name: 'Conciliator Differentiarum' },
  { _id: '694fe5fdf844de8615417e09', name: 'Comento sopra la Commedia' },
  { _id: '694f4a632bef28522211753e', name: 'De Occulta Philosophia (1533)' },
  { _id: '694e7c5146953358dafc3867', name: 'Nova et accurata vestibuli' },
  { _id: '6952950cb184004c526a296c', name: 'Essayes or Covnsels (Bacon)' },
  { _id: '695258d1ab34727b1f045aed', name: 'Magia naturalis' },
  { _id: '6952d08877f38f6761bc5560', name: 'True and Faithful Relation' },
  { _id: '69528b6bab34727b1f04f53e', name: 'Introduction to Yoga' },
  { _id: '69528729ab34727b1f04cfb6', name: 'Arcana Coelestia' },
  { _id: '694fe5faf844de8615417dfb', name: 'Mysterium Cosmographicum' },
];

async function getIiifPageCount(iaIdentifier: string): Promise<number> {
  const url = `https://iiif.archive.org/iiif/${iaIdentifier}/manifest.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`IIIF fetch failed: ${resp.status} for ${iaIdentifier}`);
  const data = await resp.json() as any;

  // Handle both IIIF v2 (sequences[0].canvases) and v3 (items) formats
  const v2Canvases = data?.sequences?.[0]?.canvases;
  if (Array.isArray(v2Canvases) && v2Canvases.length > 0) {
    return v2Canvases.length;
  }

  const v3Items = data?.items;
  if (Array.isArray(v3Items) && v3Items.length > 0) {
    return v3Items.length;
  }

  throw new Error(`No canvases/items in manifest for ${iaIdentifier}`);
}

async function findBook(db: Db, hexId: string) {
  // Try _id as ObjectId first
  try {
    const book = await db.collection('books').findOne({ _id: new ObjectId(hexId) });
    if (book) return book;
  } catch {}

  // Try id as string
  const book = await db.collection('books').findOne({ id: hexId });
  return book;
}

async function fixBook(db: Db, bookId: string, correctCount: number, bookTitle: string): Promise<{ deleted: number; newCount: number }> {
  const excessFilter = { book_id: bookId, page_number: { $gt: correctCount } };
  const excessCount = await db.collection('pages').countDocuments(excessFilter);

  if (excessCount === 0) {
    console.log(`  No excess pages to delete.`);
    return { deleted: 0, newCount: correctCount };
  }

  const excessWithOcr = await db.collection('pages').countDocuments({
    ...excessFilter,
    'ocr.data': { $exists: true, $ne: '' }
  });

  console.log(`  Deleting ${excessCount} excess pages (${excessWithOcr} had OCR)...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would delete ${excessCount} pages.`);
    return { deleted: 0, newCount: 0 };
  }

  const deleteResult = await db.collection('pages').deleteMany(excessFilter);

  // Recount
  const remainingTotal = await db.collection('pages').countDocuments({ book_id: bookId });
  const remainingOcr = await db.collection('pages').countDocuments({
    book_id: bookId, 'ocr.data': { $exists: true, $ne: '' }
  });
  const remainingTranslated = await db.collection('pages').countDocuments({
    book_id: bookId, 'translation.data': { $exists: true, $ne: '' }
  });

  // Update book — try both id styles
  const updateFilter = bookId.match(/^[0-9a-f]{24}$/)
    ? { _id: new ObjectId(bookId) }
    : { id: bookId };
  await db.collection('books').updateOne(
    updateFilter,
    { $set: { pages_count: remainingTotal, pages_ocr: remainingOcr, pages_translated: remainingTranslated, updated_at: new Date().toISOString() } }
  );

  // Audit log
  await db.collection('audit_log').insertOne({
    action: 'fix_page_count',
    book_id: bookId,
    book_title: bookTitle,
    details: {
      previous_count: remainingTotal + deleteResult.deletedCount,
      correct_count: correctCount,
      pages_deleted: deleteResult.deletedCount,
      deleted_with_ocr: excessWithOcr,
      reason: 'IA page count bug (batch fix 2026-02-15)'
    },
    created_at: new Date().toISOString()
  });

  return { deleted: deleteResult.deletedCount, newCount: remainingTotal };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Batch fixing ${BOOKS_TO_FIX.length} books...\n`);

  let totalDeleted = 0;
  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of BOOKS_TO_FIX) {
    try {
      const book = await findBook(db, entry._id);
      if (!book) {
        console.log(`SKIP ${entry.name}: not found in DB`);
        skipped++;
        continue;
      }

      // Get the book's id field (used as book_id in pages collection)
      const bookId = book.id || book._id.toString();
      const iaId = book.ia_identifier;
      if (!iaId) {
        console.log(`SKIP ${entry.name}: no ia_identifier`);
        skipped++;
        continue;
      }

      console.log(`${book.title || book.display_title || entry.name}`);
      console.log(`  DB: ${book.pages_count} pages | IA: ${iaId}`);

      // Fetch real count from IIIF
      const iiifCount = await getIiifPageCount(iaId);
      console.log(`  IIIF manifest: ${iiifCount} canvases`);

      if (book.pages_count <= iiifCount) {
        console.log(`  OK — no excess pages.`);
        skipped++;
        continue;
      }

      const excess = book.pages_count - iiifCount;
      console.log(`  INFLATED by ${excess} pages (${book.pages_count} → ${iiifCount})`);

      const result = await fixBook(db, bookId, iiifCount, book.title || book.display_title);
      if (result.deleted > 0) {
        totalDeleted += result.deleted;
        fixed++;
        console.log(`  FIXED: ${result.newCount} pages remaining.`);
      }
    } catch (err: any) {
      console.log(`  ERROR ${entry.name}: ${err.message}`);
      errors++;
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`Done. Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log(`Total pages deleted: ${totalDeleted}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
