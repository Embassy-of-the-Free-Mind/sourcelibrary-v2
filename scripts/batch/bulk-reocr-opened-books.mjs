#!/usr/bin/env node
/**
 * Bulk Re-OCR opened books via Gemini Batch API (50% cheaper than realtime).
 *
 * Finds all books with read_count >= 1 that have pages OCR'd with older models
 * (not gemini-3-flash-preview), downloads images, submits batch jobs to Gemini,
 * and creates batch_jobs records. The process-batches cron (every 2h) collects results.
 *
 * Usage:
 *   secret-lover run -- node scripts/bulk-reocr-opened-books.mjs [--dry-run] [--limit N] [--book-id ID]
 *
 * Options:
 *   --dry-run     Show what would be queued without actually submitting
 *   --limit N     Only process the first N books (sorted by read_count desc)
 *   --book-id ID  Process a single book by ID
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { PAGE_RATE_USD, PAGE_RATES_MEASURED_ON } from '../lib/model-pricing.mjs';

// --- Config ---
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TARGET_MODEL = 'gemini-3-flash-preview';
const PROMPT_VERSION = 'v4.2026-02';
const BATCH_SIZE = 10; // Pages per Gemini batch submission (matches batch-ocr-multi)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Skip manually edited pages — re-OCR would overwrite human corrections
const SKIP_MODELS = ['manual', 'manual-correction'];

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY && !process.argv.includes('--dry-run')) {
  console.error('GEMINI_API_KEY not set (use --dry-run to skip)');
  process.exit(1);
}

// --- Parse args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const bookIdIdx = args.indexOf('--book-id');
const SINGLE_BOOK_ID = bookIdIdx >= 0 ? args[bookIdIdx + 1] : null;

// --- Image fetching ---
async function fetchImageAsBase64(url, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    let mimeType = response.headers.get('content-type')?.split(';')[0];
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'jp2') mimeType = 'image/jp2';
      else mimeType = 'image/jpeg';
    }
    return { base64, mimeType };
  } catch (error) {
    clearTimeout(timeoutId);
    return null;
  }
}

// --- Gemini Batch API ---
async function createBatchJobInline(model, requests, displayName) {
  const formattedRequests = requests.map(r => ({
    request: r.request,
    metadata: { key: r.key },
  }));

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: {
            requests: { requests: formattedRequests },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Batch API error: ${error}`);
  }

  const result = await response.json();
  return { name: result.name, state: result.state || 'JOB_STATE_PENDING' };
}

// --- Main ---
async function run() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // 1. Get OCR prompt from DB
  const promptDoc = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!promptDoc && !DRY_RUN) {
    console.error('No default OCR prompt found in DB');
    process.exit(1);
  }

  // 2. Find candidate books
  const bookFilter = { deleted: { $ne: true } };
  if (SINGLE_BOOK_ID) {
    bookFilter.id = SINGLE_BOOK_ID;
  } else {
    bookFilter.read_count = { $gte: 1 };
  }

  const books = await db.collection('books').find(bookFilter, {
    projection: {
      _id: 0, id: 1, title: 1, display_title: 1,
      language: 1, original_language: 1,
      job: 1, read_count: 1
    }
  }).sort({ read_count: -1 }).toArray();

  console.log(`Found ${books.length} candidate book(s)\n`);

  let totalQueued = 0;
  let totalSkipped = 0;
  let booksQueued = 0;
  let booksSkipped = 0;
  const bookCount = Math.min(books.length, LIMIT);

  for (let i = 0; i < bookCount; i++) {
    const book = books[i];
    const label = (book.display_title || book.title || '').substring(0, 55);

    // 3. Find pages with old OCR models
    const eligiblePages = await db.collection('pages').find(
      {
        book_id: book.id,
        'ocr.data': { $exists: true, $ne: '' },
        'ocr.model': { $exists: true, $ne: TARGET_MODEL, $nin: SKIP_MODELS },
        $or: [
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } }
        ]
      },
      {
        projection: {
          _id: 0, id: 1, page_number: 1, 'ocr.model': 1,
          photo: 1, photo_original: 1, archived_photo: 1,
          cropped_photo: 1, crop: 1
        }
      }
    ).sort({ page_number: 1 }).toArray();

    if (eligiblePages.length === 0) {
      booksSkipped++;
      continue;
    }

    const oldModel = eligiblePages[0].ocr?.model || 'unknown';
    console.log(`[${i + 1}/${bookCount}] ${label}`);
    console.log(`  ${eligiblePages.length} pages on ${oldModel} → ${TARGET_MODEL}`);

    if (DRY_RUN) {
      totalQueued += eligiblePages.length;
      booksQueued++;
      continue;
    }

    // 4. Check for active batch jobs on this book
    const activeBatchJob = await db.collection('batch_jobs').findOne({
      book_id: book.id,
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] }
    });
    if (activeBatchJob) {
      console.log(`  SKIPPED — active batch job ${activeBatchJob.id || activeBatchJob.job_name}`);
      booksSkipped++;
      totalSkipped += eligiblePages.length;
      continue;
    }

    // 5. Build prompt with language
    const language = book.original_language || book.language || '';
    const languageInstruction = language
      ? `**Source language:** The primary language is likely **${language}**, but pages may contain text in multiple languages. Transcribe all languages present. Report the primary language in the <lang> tag.`
      : `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <lang> tag.`;
    const prompt = promptDoc.text
      .replace('{language_instruction}', languageInstruction)
      .replace('{language}', language);

    // 6. Create parent batch_job record
    const parentJobId = nanoid();
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'ocr',
      book_id: book.id,
      book_title: book.title,
      total_pages: eligiblePages.length,
      child_job_ids: [],
      progress: {
        completed: 0,
        failed: 0,
        pending: eligiblePages.length,
        total: eligiblePages.length
      },
      status: 'pending',
      model: TARGET_MODEL,
      language,
      prompt_version: PROMPT_VERSION,
      force: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    // 7. Process in chunks of BATCH_SIZE — download images + submit to Gemini
    const childJobIds = [];
    let bookPagesSubmitted = 0;

    for (let j = 0; j < eligiblePages.length; j += BATCH_SIZE) {
      const chunk = eligiblePages.slice(j, j + BATCH_SIZE);
      const batchRequests = [];

      for (const page of chunk) {
        const imageUrl = getPageImageUrl(page);
        if (!imageUrl) continue;

        const image = await fetchImageAsBase64(imageUrl);
        if (!image) {
          console.log(`    WARN: Failed to fetch image for page ${page.page_number}`);
          continue;
        }

        batchRequests.push({
          key: page.id,
          request: {
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: image.mimeType, data: image.base64 } }
              ],
              role: 'user'
            }]
          }
        });
      }

      if (batchRequests.length === 0) continue;

      try {
        const childJobId = nanoid();
        const batchJob = await createBatchJobInline(
          TARGET_MODEL,
          batchRequests,
          `reocr-${book.id}-${childJobId}-${Date.now()}`
        );

        // Create child batch_job record
        await db.collection('batch_jobs').insertOne({
          id: childJobId,
          parent_job_id: parentJobId,
          job_name: batchJob.name,
          type: 'ocr',
          book_id: book.id,
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          status: 'pending',
          model: TARGET_MODEL,
          language,
          prompt_version: PROMPT_VERSION,
          force: true,
          created_at: new Date(),
          updated_at: new Date()
        });

        childJobIds.push(childJobId);
        bookPagesSubmitted += batchRequests.length;

        // Log to gemini_usage
        await db.collection('gemini_usage').insertOne({
          type: 'ocr',
          mode: 'batch',
          model: TARGET_MODEL,
          book_id: book.id,
          book_title: book.title,
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          batch_job_id: childJobId,
          gemini_job_name: batchJob.name,
          input_tokens: 0,
          output_tokens: 0,
          status: 'submitted',
          endpoint: 'bulk-reocr-script',
          timestamp: new Date(),
          created_at: new Date(),
        });

        process.stdout.write(`    Batch ${Math.floor(j / BATCH_SIZE) + 1}/${Math.ceil(eligiblePages.length / BATCH_SIZE)}: ${batchRequests.length} pages → ${batchJob.name}\n`);
      } catch (error) {
        console.error(`    ERROR batch ${Math.floor(j / BATCH_SIZE) + 1}: ${error.message}`);
        // Continue with next batch
      }
    }

    // 8. Update parent with child IDs
    await db.collection('batch_jobs').updateOne(
      { id: parentJobId },
      { $set: { child_job_ids: childJobIds, updated_at: new Date() } }
    );

    // 9. Set active batch job on book
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'batch', job_id: parentJobId } } }
    );

    console.log(`  Submitted ${bookPagesSubmitted} pages in ${childJobIds.length} batches (parent: ${parentJobId})`);
    totalQueued += bookPagesSubmitted;
    booksQueued++;
  }

  console.log(`\n=== SUMMARY ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Books submitted: ${booksQueued}`);
  console.log(`Books skipped: ${booksSkipped}`);
  console.log(`Pages submitted: ${totalQueued.toLocaleString()}`);
  if (totalSkipped > 0) console.log(`Pages skipped (active job): ${totalSkipped.toLocaleString()}`);
  const costPerPage = PAGE_RATE_USD.ocrBatch;
  console.log(`Est. cost @ $${costPerPage}/page (batch, measured ${PAGE_RATES_MEASURED_ON}): $${(totalQueued * costPerPage).toFixed(2)}`);
  if (!DRY_RUN) {
    console.log(`\nResults will be collected by /api/cron/process-batches (every 2h)`);
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
