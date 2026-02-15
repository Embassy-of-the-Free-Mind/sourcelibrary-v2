/**
 * Scan all IA books for inflated page counts and fix them.
 * Only fixes books where DB count > IIIF count.
 */
import { MongoClient, ObjectId, Db } from 'mongodb';

const dryRun = process.argv.includes('--dry-run');

async function getIiifPageCount(iaIdentifier: string): Promise<number> {
  const url = `https://iiif.archive.org/iiif/${iaIdentifier}/manifest.json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  
  // IIIF v2
  const v2 = data?.sequences?.[0]?.canvases;
  if (Array.isArray(v2) && v2.length > 0) return v2.length;
  
  // IIIF v3
  const v3 = data?.items;
  if (Array.isArray(v3) && v3.length > 0) return v3.length;
  
  throw new Error('No canvases/items');
}

async function fixBook(db: Db, book: any, correctCount: number): Promise<number> {
  const bookId = book.id || book._id.toString();
  const excessFilter = { book_id: bookId, page_number: { $gt: correctCount } };
  const excessCount = await db.collection('pages').countDocuments(excessFilter);
  
  if (excessCount === 0) return 0;
  if (dryRun) {
    console.log(`  [DRY RUN] Would delete ${excessCount} pages`);
    return excessCount;
  }
  
  const deleteResult = await db.collection('pages').deleteMany(excessFilter);
  
  // Recount and update
  const remaining = await db.collection('pages').countDocuments({ book_id: bookId });
  const ocrCount = await db.collection('pages').countDocuments({ book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } });
  const transCount = await db.collection('pages').countDocuments({ book_id: bookId, 'translation.data': { $exists: true, $ne: '' } });
  
  await db.collection('books').updateOne(
    { _id: book._id },
    { $set: { pages_count: remaining, pages_ocr: ocrCount, pages_translated: transCount, updated_at: new Date().toISOString() } }
  );
  
  await db.collection('audit_log').insertOne({
    action: 'fix_page_count',
    book_id: bookId,
    book_title: book.title || book.display_title,
    details: {
      previous_count: remaining + deleteResult.deletedCount,
      correct_count: correctCount,
      pages_deleted: deleteResult.deletedCount,
      reason: 'IA page count bug (batch fix remaining 2026-02-16)'
    },
    created_at: new Date().toISOString()
  });
  
  return deleteResult.deletedCount;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  
  // Find all IA books created before the fix date
  const cutoff = new Date('2025-12-30');
  const books = await db.collection('books').find({
    ia_identifier: { $exists: true, $nin: [null, ''] },
    created_at: { $lt: cutoff.toISOString() }
  }, {
    projection: { _id: 1, id: 1, title: 1, display_title: 1, ia_identifier: 1, pages_count: 1 }
  }).toArray();
  
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Scanning ${books.length} IA books...\n`);
  
  let totalDeleted = 0;
  let fixed = 0;
  let ok = 0;
  let deflated = 0;
  let errors = 0;
  const deflatedBooks: any[] = [];
  
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const name = (book.title || book.display_title || '').substring(0, 50);
    
    try {
      const iiifCount = await getIiifPageCount(book.ia_identifier);
      
      if (book.pages_count > iiifCount) {
        const excess = book.pages_count - iiifCount;
        console.log(`[${i+1}/${books.length}] FIX ${name}: ${book.pages_count} → ${iiifCount} (-${excess})`);
        const deleted = await fixBook(db, book, iiifCount);
        totalDeleted += deleted;
        fixed++;
      } else if (book.pages_count < iiifCount) {
        const missing = iiifCount - book.pages_count;
        if (missing > 5) {
          deflatedBooks.push({ name, id: book.id || book._id.toString(), db: book.pages_count, iiif: iiifCount, missing });
        }
        deflated++;
        // Don't log minor deflation
      } else {
        ok++;
      }
    } catch (err: any) {
      // Don't spam errors for every book
      errors++;
    }
    
    // Progress every 50 books
    if ((i + 1) % 50 === 0) {
      console.log(`  ... processed ${i + 1}/${books.length} (fixed: ${fixed}, ok: ${ok}, errors: ${errors})`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Done. Scanned: ${books.length}`);
  console.log(`  Fixed (inflated): ${fixed}`);
  console.log(`  OK (correct): ${ok}`);
  console.log(`  Deflated (missing pages): ${deflated}`);
  console.log(`  Errors (IIIF unavailable): ${errors}`);
  console.log(`  Total pages deleted: ${totalDeleted}`);
  
  if (deflatedBooks.length > 0) {
    console.log('\nDeflated books (missing >5 pages):');
    deflatedBooks.sort((a, b) => b.missing - a.missing);
    for (const b of deflatedBooks) {
      console.log(`  ${b.name}: ${b.db} → should be ${b.iiif} (missing ${b.missing}) | https://sourcelibrary.org/book/${b.id}`);
    }
  }
  
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
