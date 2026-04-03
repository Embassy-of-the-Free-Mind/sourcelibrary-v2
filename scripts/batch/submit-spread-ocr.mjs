#!/usr/bin/env node
/**
 * Submit BPH spread books for combined split+OCR via existing batch-ocr-async route.
 *
 * Uses the proven file-based batch submission infrastructure. Each page gets:
 * - <split-position>N</split-position> for image cropping
 * - Left page OCR + <page-break/> + Right page OCR
 * - Full v10 metadata tags per page
 *
 * The batch-collector.mjs will need updates to handle <page-break/> splitting.
 * Until then, results land in ocr.data as the full spread OCR (both pages).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/batch/submit-spread-ocr.mjs --count=5 --dry-run
 *   node scripts/batch/submit-spread-ocr.mjs --count=50 --key=auto
 *   node scripts/batch/submit-spread-ocr.mjs --book-id=69c89f386c6f3cc53c85dc0d
 *
 * Options:
 *   --count=N       Number of books to submit (default: 10)
 *   --max-pages=N   Skip books with more than N pages (default: 500)
 *   --delay=N       Seconds between submissions (default: 3)
 *   --key=N|auto    API key index (0=TIER3, 1=KEY_2, 2=primary, auto=round-robin)
 *   --book-id=X     Submit a specific book
 *   --dry-run       List candidates without submitting
 *   --model=X       Override model (default: gemini-3.1-flash-lite-preview)
 *
 * Prerequisites:
 *   - MONGODB_URI, CRON_SECRET set in env
 *   - sourcelibrary.org reachable (submits via API route)
 *
 * Known issues mitigated:
 *   1. Inline batch payload limit: route uses file-based submission for >20 pages (automatic)
 *   2. API key quota: route rotates keys on 429. --key=auto distributes across keys.
 *   3. UvA IIIF timeouts: route has per-image timeout. Failed images are skipped, not fatal.
 *   4. Safety blocks: ~2-5% of pages blocked by Gemini. Collector handles partial results.
 *   5. Model support: gemini-3.1-flash-lite-preview confirmed working via file-based batch
 *      (431 completed + 1564 saved in DB). Our earlier failure was inline submission.
 */

import { MongoClient } from 'mongodb';

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_COUNT = parseInt(getArg('count') || '10', 10);
const MAX_PAGES = parseInt(getArg('max-pages') || '500', 10);
const DELAY_SEC = parseInt(getArg('delay') || '3', 10);
const DRY_RUN = hasFlag('dry-run');
const BOOK_ID = getArg('book-id');
const MODEL = getArg('model') || 'gemini-3.1-flash-lite-preview';
const KEY_ARG = getArg('key');

const uniqueKeys = [...new Set([
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY,
].filter(Boolean))];
const NUM_KEYS = uniqueKeys.length;

function getKeyIndex(bookIndex) {
  if (KEY_ARG === 'auto') return bookIndex % NUM_KEYS;
  if (KEY_ARG !== null && KEY_ARG !== undefined) return parseInt(KEY_ARG, 10);
  return undefined;
}

// --- Build spread prompt ---
async function buildSpreadPrompt(db) {
  const ocrPromptDoc = await db.collection('prompts').findOne({ type: 'ocr', is_default: true });
  if (!ocrPromptDoc?.content) throw new Error('OCR prompt not found in DB');

  const spreadPrefix = `**TWO-PAGE SPREAD HANDLING:**
This image is a two-page spread (open book scan). Process BOTH pages separately.

CRITICAL: Each page may have its own multi-column layout. Handle columns WITHIN each page:
- If a page has 2+ columns, use <column-break/> between columns ON THAT PAGE
- Each page MUST include its own <vocab> tag with key terms from THAT page only.
- Use ISO 639-1 language codes (de, fr, la, en, nl, he, grc — NOT "German", "Latin", etc.)

If this is NOT a two-page spread (single page), set split_position to null and process normally.

Output structure:
1. <split-position>N</split-position> (0-1000, or null if single page) at the very top
2. All metadata and content for LEFT page
3. <page-break/> on its own line
4. All metadata and content for RIGHT page

`;

  return {
    prompt: spreadPrefix + ocrPromptDoc.content.replace('{language_instruction}', ''),
    version: `spread-v2+ocr-v${ocrPromptDoc.version}`,
  };
}

// --- Submit one book ---
async function submitBook(bookId, cronSecret, apiKeyIndex, prompt) {
  const url = `${BASE_URL}/api/books/${bookId}/batch-ocr-async`;
  const body = {
    limit: 500,
    model: MODEL,
    promptOverride: prompt,
  };
  if (apiKeyIndex !== undefined) body.apiKeyIndex = apiKeyIndex;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // 2 min timeout for image download
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

// --- Main ---
async function main() {
  console.log('=== BPH Spread OCR Batch Submission ===');
  console.log(`Model: ${MODEL}`);
  console.log(`Dry run: ${DRY_RUN}, Count: ${BOOK_COUNT}, Max pages: ${MAX_PAGES}, Delay: ${DELAY_SEC}s`);
  console.log(`API keys: ${NUM_KEYS}, Key mode: ${KEY_ARG || 'default (TIER3)'}`);
  console.log(`Route: ${BASE_URL}/api/books/{id}/batch-ocr-async`);
  console.log();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not set');
    process.exit(1);
  }

  // Build prompt
  const { prompt, version } = await buildSpreadPrompt(db);
  console.log(`Prompt version: ${version} (${prompt.length} chars)`);

  // Find books
  let query;
  if (BOOK_ID) {
    query = { id: BOOK_ID };
  } else {
    query = {
      'image_source.provider': 'bph',
      needs_splitting: true,
      split_completed: { $ne: true },
      pages_count: { $gt: 0, $lte: MAX_PAGES },
      // Skip books that already have a pending/processing spread-ocr batch job
    };
  }

  const candidates = await db.collection('books')
    .find(query)
    .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, slug: 1 })
    .sort({ pages_count: 1 }) // smallest first for faster feedback
    .limit(BOOK_COUNT)
    .toArray();

  console.log(`Found ${candidates.length} candidates\n`);

  if (candidates.length === 0) {
    console.log('No books to process.');
    await client.close();
    return;
  }

  // Check for existing pending batch jobs to avoid double-submission
  const existingJobs = await db.collection('batch_jobs').find({
    book_id: { $in: candidates.map(b => b.id) },
    status: { $in: ['pending', 'processing'] },
  }).project({ book_id: 1 }).toArray();
  const pendingBookIds = new Set(existingJobs.map(j => j.book_id));

  if (DRY_RUN) {
    console.log('DRY RUN — would submit:');
    for (const book of candidates) {
      const skip = pendingBookIds.has(book.id) ? ' [SKIP: pending job]' : '';
      console.log(`  ${book.title?.slice(0, 55)} | ${book.pages_count}pp | ocr:${book.pages_ocr || 0}${skip}`);
    }
    await client.close();
    return;
  }

  // Submit
  let submitted = 0, skipped = 0, failed = 0, totalPages = 0;

  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];

    if (pendingBookIds.has(book.id)) {
      console.log(`[${i + 1}/${candidates.length}] SKIP (pending job): ${book.title?.slice(0, 45)}`);
      skipped++;
      continue;
    }

    const keyIndex = getKeyIndex(i);

    try {
      const result = await submitBook(book.id, cronSecret, keyIndex, prompt);

      if (result.status === 200 && result.data?.success) {
        submitted++;
        totalPages += result.data.pagesSubmitted || book.pages_count;
        console.log(`[${i + 1}/${candidates.length}] OK: ${book.title?.slice(0, 40)} | ${result.data.pagesSubmitted}pp | job: ${result.data.jobName?.slice(-20)}`);
      } else if (result.data?.message === 'No pages need OCR') {
        console.log(`[${i + 1}/${candidates.length}] SKIP (already has OCR): ${book.title?.slice(0, 45)}`);
        skipped++;
      } else {
        console.log(`[${i + 1}/${candidates.length}] FAIL (${result.status}): ${book.title?.slice(0, 40)} | ${JSON.stringify(result.data).slice(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.log(`[${i + 1}/${candidates.length}] ERROR: ${book.title?.slice(0, 40)} | ${err.message?.slice(0, 60)}`);
      failed++;
    }

    // Delay between submissions to avoid overwhelming the route
    if (i < candidates.length - 1 && DELAY_SEC > 0) {
      await new Promise(r => setTimeout(r, DELAY_SEC * 1000));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Submitted: ${submitted} books (${totalPages} pages)`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`\nCollect results with: node scripts/workers/batch-collector.mjs`);
  console.log(`NOTE: Collector needs update to handle <page-break/> in spread OCR results.`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
