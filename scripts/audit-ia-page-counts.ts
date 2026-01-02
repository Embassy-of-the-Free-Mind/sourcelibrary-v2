/**
 * Audit Internet Archive books for page count discrepancies
 *
 * Compares each IA book's pages_count against the authoritative
 * imagecount from IA metadata to find books affected by the
 * jp2.zip size estimation bug.
 *
 * Run: npx tsx scripts/audit-ia-page-counts.ts
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

interface IAMetadata {
  metadata?: {
    imagecount?: string;
    title?: string;
  };
}

interface DiscrepancyReport {
  bookId: string;
  title: string;
  iaIdentifier: string;
  currentPages: number;
  iaImagecount: number;
  difference: number;
  percentOff: number;
}

async function fetchIAImagecount(identifier: string): Promise<number | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!res.ok) return null;
    const data: IAMetadata = await res.json();
    if (data.metadata?.imagecount) {
      return parseInt(data.metadata.imagecount, 10);
    }
    return null;
  } catch {
    return null;
  }
}

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

    // Get all IA books
    const iaBooks = await db.collection('books').find({
      ia_identifier: { $exists: true, $ne: null }
    }).toArray();

    console.log(`Found ${iaBooks.length} Internet Archive books to audit\n`);
    console.log('Checking each book against IA metadata...\n');

    const discrepancies: DiscrepancyReport[] = [];
    const errors: { title: string; iaIdentifier: string; error: string }[] = [];

    for (let i = 0; i < iaBooks.length; i++) {
      const book = iaBooks[i];
      const iaIdentifier = book.ia_identifier;
      const title = book.title?.substring(0, 50) || 'Unknown';

      process.stdout.write(`[${i + 1}/${iaBooks.length}] ${title}... `);

      const iaImagecount = await fetchIAImagecount(iaIdentifier);

      if (iaImagecount === null) {
        console.log('⚠️  Could not fetch IA metadata');
        errors.push({ title, iaIdentifier, error: 'Failed to fetch metadata' });
        continue;
      }

      const currentPages = book.pages_count || 0;
      const difference = currentPages - iaImagecount;
      const percentOff = iaImagecount > 0 ? Math.round((difference / iaImagecount) * 100) : 0;

      if (Math.abs(difference) > 5 && Math.abs(percentOff) > 10) {
        console.log(`❌ MISMATCH: ${currentPages} vs ${iaImagecount} (${difference > 0 ? '+' : ''}${difference})`);
        discrepancies.push({
          bookId: book.id,
          title,
          iaIdentifier,
          currentPages,
          iaImagecount,
          difference,
          percentOff
        });
      } else {
        console.log(`✓ OK (${currentPages} pages)`);
      }

      // Rate limit to avoid hammering IA API
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total IA books: ${iaBooks.length}`);
    console.log(`Books with discrepancies: ${discrepancies.length}`);
    console.log(`Books with fetch errors: ${errors.length}`);

    if (discrepancies.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('BOOKS WITH PAGE COUNT DISCREPANCIES:');
      console.log('-'.repeat(80));

      // Sort by difference (largest first)
      discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      for (const d of discrepancies) {
        console.log(`\n${d.title}`);
        console.log(`  Book ID: ${d.bookId}`);
        console.log(`  IA ID: ${d.iaIdentifier}`);
        console.log(`  Current pages: ${d.currentPages}`);
        console.log(`  IA imagecount: ${d.iaImagecount}`);
        console.log(`  Difference: ${d.difference > 0 ? '+' : ''}${d.difference} (${d.percentOff > 0 ? '+' : ''}${d.percentOff}%)`);
        console.log(`  URL: https://sourcelibrary.org/book/${d.bookId}`);
      }

      // Generate fix commands
      console.log('\n' + '-'.repeat(80));
      console.log('SUGGESTED FIX COMMANDS:');
      console.log('-'.repeat(80));
      console.log('\nFor books with TOO MANY pages (positive difference), delete excess pages:');

      const tooManyPages = discrepancies.filter(d => d.difference > 0);
      for (const d of tooManyPages) {
        console.log(`\n# ${d.title} (${d.currentPages} -> ${d.iaImagecount})`);
        console.log(`# Delete pages ${d.iaImagecount + 1}-${d.currentPages}`);
      }

      const tooFewPages = discrepancies.filter(d => d.difference < 0);
      if (tooFewPages.length > 0) {
        console.log('\nFor books with TOO FEW pages (negative difference), consider reimporting:');
        for (const d of tooFewPages) {
          console.log(`\n# ${d.title} (${d.currentPages} -> ${d.iaImagecount})`);
          console.log(`curl -X POST https://sourcelibrary.org/api/books/${d.bookId}/reimport -H "Content-Type: application/json" -d '{"mode":"full"}'`);
        }
      }
    }

    if (errors.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('BOOKS WITH FETCH ERRORS (may need manual check):');
      console.log('-'.repeat(80));
      for (const e of errors) {
        console.log(`  ${e.title} (${e.iaIdentifier}): ${e.error}`);
      }
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
