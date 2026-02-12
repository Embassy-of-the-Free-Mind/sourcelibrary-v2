/**
 * Batch generate thumbnails for all books.
 *
 * Calls the per-book generate-thumbnails API endpoint for each book.
 * Books are processed smallest-first for quick wins.
 *
 * Usage:
 *   npx tsx scripts/generate-thumbnails.ts                    # all books
 *   npx tsx scripts/generate-thumbnails.ts --book-id=abc123   # single book
 *   npx tsx scripts/generate-thumbnails.ts --limit=50         # per-book page limit
 *   npx tsx scripts/generate-thumbnails.ts --dry-run          # preview only
 */

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';

interface ThumbnailResult {
  success?: boolean;
  generated?: number;
  failed?: number;
  remaining?: number;
  totalPages?: number;
  thumbnailedPages?: number;
  percentComplete?: number;
  message?: string;
  error?: string;
  dryRun?: boolean;
  wouldGenerate?: number;
}

async function main() {
  const args = process.argv.slice(2);
  const bookIdArg = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
  const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '500', 10);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  console.log(`Thumbnail generation — base URL: ${BASE_URL}, limit: ${limitArg}/book, dryRun: ${dryRun}, force: ${force}`);

  // If single book, just call it
  if (bookIdArg) {
    await processBook(bookIdArg, limitArg, dryRun, force);
    return;
  }

  // Otherwise, fetch all books and process
  const res = await fetch(`${BASE_URL}/api/books?limit=5000&sort=page_count`);
  if (!res.ok) {
    console.error(`Failed to fetch books: ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  const books: Array<{ id: string; title: string; page_count?: number }> = data.books || data;

  console.log(`Found ${books.length} books\n`);

  let totalGenerated = 0;
  let totalFailed = 0;
  let booksProcessed = 0;
  let booksSkipped = 0;

  for (const book of books) {
    const result = await processBook(book.id, limitArg, dryRun, force);

    if (result?.message === 'All pages have thumbnails' || result?.generated === 0) {
      booksSkipped++;
      continue;
    }

    totalGenerated += result?.generated || 0;
    totalFailed += result?.failed || 0;
    booksProcessed++;

    // Log progress
    const pct = result?.percentComplete || 0;
    console.log(
      `  [${booksProcessed}/${books.length}] ${book.title?.slice(0, 50)}: ` +
      `+${result?.generated || 0} thumbnails (${pct}% complete, ${result?.remaining || 0} remaining)`
    );

    // Rate limit: pause between books
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone. Generated: ${totalGenerated}, Failed: ${totalFailed}, Books processed: ${booksProcessed}, Skipped: ${booksSkipped}`);
}

async function processBook(
  bookId: string,
  limit: number,
  dryRun: boolean,
  force: boolean
): Promise<ThumbnailResult | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/books/${bookId}/generate-thumbnails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, dryRun, force }),
    });

    if (!res.ok) {
      console.error(`  Error for book ${bookId}: HTTP ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`  Error for book ${bookId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

main().catch(console.error);
