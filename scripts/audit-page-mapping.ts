/**
 * Audit and optionally fix page mapping issues across all books.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/audit-page-mapping.ts [--fix]
 *
 * Without --fix: Reports issues only
 * With --fix: Clears bad OCR from affected pages
 */

import { MongoClient } from 'mongodb';

interface PageIssue {
  pageNumber: number;
  pageId: string;
  detectedFolio: number;
  delta: number;
}

interface BookIssue {
  bookId: string;
  title: string;
  totalPages: number;
  ocrPages: number;
  issues: PageIssue[];
  pattern: 'consistent' | 'mixed' | 'scattered';
  averageDelta: number;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const shouldFix = process.argv.includes('--fix');
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    console.log('Auditing page mappings...\n');

    // Get all books with OCR
    const books = await db.collection('books').find({
      pages_ocr: { $gt: 0 }
    }).toArray();

    console.log(`Found ${books.length} books with OCR\n`);

    const allIssues: BookIssue[] = [];

    for (const book of books) {
      const bookId = book.id || book._id.toString();
      const title = book.title || 'Unknown';

      // Get all pages with OCR for this book
      const pages = await db.collection('pages').find({
        book_id: bookId,
        'ocr.data': { $exists: true, $ne: '' }
      }).sort({ page_number: 1 }).toArray();

      const issues: PageIssue[] = [];

      for (const page of pages) {
        const ocrData = page.ocr?.data || '';
        const pageNumber = page.page_number;

        // Look for folio markers
        const folioMatch = ocrData.match(/\[\[page number:\s*(\d+)\]\]/);
        if (folioMatch) {
          const detectedFolio = parseInt(folioMatch[1], 10);
          const delta = detectedFolio - pageNumber;

          // Flag if delta is significant (>10 pages off)
          if (Math.abs(delta) > 10) {
            issues.push({
              pageNumber,
              pageId: page.id,
              detectedFolio,
              delta
            });
          }
        }
      }

      if (issues.length > 0) {
        // Analyze pattern
        const deltas = issues.map(i => i.delta);
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const variance = deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length;
        const stdDev = Math.sqrt(variance);

        let pattern: 'consistent' | 'mixed' | 'scattered';
        if (stdDev < 5) {
          pattern = 'consistent'; // All pages off by same amount
        } else if (stdDev < 50) {
          pattern = 'mixed'; // Some variation
        } else {
          pattern = 'scattered'; // Random issues, likely false positives
        }

        allIssues.push({
          bookId,
          title: title.substring(0, 50),
          totalPages: book.pages_count || 0,
          ocrPages: pages.length,
          issues,
          pattern,
          averageDelta: Math.round(avgDelta)
        });
      }
    }

    // Sort by severity (consistent patterns first, most issues)
    allIssues.sort((a, b) => {
      if (a.pattern === 'consistent' && b.pattern !== 'consistent') return -1;
      if (a.pattern !== 'consistent' && b.pattern === 'consistent') return 1;
      return b.issues.length - a.issues.length;
    });

    // Report
    console.log('=== Page Mapping Audit Report ===\n');

    const critical = allIssues.filter(i => i.pattern === 'consistent' && i.issues.length > 10);
    const moderate = allIssues.filter(i => i.pattern === 'consistent' && i.issues.length <= 10);
    const uncertain = allIssues.filter(i => i.pattern !== 'consistent');

    console.log(`CRITICAL (consistent offset, >10 pages): ${critical.length} books`);
    for (const issue of critical) {
      console.log(`  ${issue.title}`);
      console.log(`    ID: ${issue.bookId}`);
      console.log(`    Affected: ${issue.issues.length}/${issue.ocrPages} OCR pages`);
      console.log(`    Average offset: ${issue.averageDelta}`);
      console.log(`    Example: Page ${issue.issues[0].pageNumber} has folio ${issue.issues[0].detectedFolio}`);
    }

    console.log(`\nMODERATE (consistent offset, ≤10 pages): ${moderate.length} books`);
    for (const issue of moderate) {
      console.log(`  ${issue.title}: ${issue.issues.length} pages, avg Δ${issue.averageDelta}`);
    }

    console.log(`\nUNCERTAIN (mixed/scattered, may be false positives): ${uncertain.length} books`);
    for (const issue of uncertain) {
      console.log(`  ${issue.title}: ${issue.issues.length} pages, pattern: ${issue.pattern}`);
    }

    // Fix if requested
    if (shouldFix && critical.length > 0) {
      console.log('\n=== Fixing Critical Issues ===\n');

      for (const issue of critical) {
        console.log(`Fixing ${issue.title}...`);

        const pageIds = issue.issues.map(i => i.pageId);

        const result = await db.collection('pages').updateMany(
          { id: { $in: pageIds } },
          {
            $unset: { ocr: '' },
            $set: {
              updated_at: new Date(),
              cleared_at: new Date(),
              cleared_reason: `Page mapping audit: avg delta ${issue.averageDelta}`
            }
          }
        );

        console.log(`  Cleared OCR from ${result.modifiedCount} pages`);

        // Update book stats
        const remainingOcr = await db.collection('pages').countDocuments({
          book_id: issue.bookId,
          'ocr.data': { $exists: true, $ne: '' }
        });

        await db.collection('books').updateOne(
          { $or: [{ id: issue.bookId }, { _id: issue.bookId }] },
          { $set: { pages_ocr: remainingOcr, updated_at: new Date() } }
        );

        console.log(`  Book now has ${remainingOcr} OCR pages`);
      }
    } else if (shouldFix) {
      console.log('\nNo critical issues to fix.');
    } else {
      console.log('\n\nRun with --fix to clear OCR from critical issues.');
    }

    console.log('\nDone.');

  } finally {
    await client.close();
  }
}

main().catch(console.error);
