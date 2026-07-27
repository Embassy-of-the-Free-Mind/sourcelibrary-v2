#!/usr/bin/env node
/**
 * Local bulk re-OCR script — no Vercel timeout limits.
 *
 * Downloads images, builds JSONL, uploads to Gemini File API,
 * submits batch jobs. Runs locally or on Hetzner.
 *
 * Usage:
 *   secret-lover run -- node scripts/bulk-reocr-local.mjs [options]
 *
 * Options:
 *   --offset=N       Start at book offset N (default: 0)
 *   --limit=N        Books per run (default: 10)
 *   --pages=N        Max pages per book (default: 500)
 *   --dry-run        Show what would be submitted
 *   --book-id=ID     Process a single book
 *   --new-only       Only target pages WITHOUT OCR (instead of re-OCR)
 *   --provider=X     Filter by provider (e.g. 'efm', 'ia')
 *
 * Requires: MONGODB_URI, GEMINI_API_KEY_TIER3 (or GEMINI_API_KEY) in env
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';

// --- Config ---
const TARGET_MODEL = 'gemini-3-flash-preview';
const TARGET_PROMPT = 'v5.2026-02';
const SKIP_MODELS = ['manual', 'manual-correction'];
const INLINE_BATCH_SIZE = 20;  // Pages per inline batch (base64 in HTTP body, ~20MB limit)
// Pages per file-based batch (JSONL uploaded to File API). Overridable via --batch-size:
// full-res images can overflow V8's max string length at 150/batch, so the contamination
// repair (#3362) uses a smaller size for high-resolution scans.
const FILE_BATCH_SIZE = parseInt((process.argv.find(a => a.startsWith('--batch-size=')) || '').split('=')[1] || '150', 10);
const IMAGE_CONCURRENCY = 20; // Parallel image downloads
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const OFFSET = parseInt(getArg('offset') || '0', 10);
const LIMIT = parseInt(getArg('limit') || '10', 10);
const MAX_PAGES = parseInt(getArg('pages') || '500', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const NEW_ONLY = hasFlag('new-only');
const PROVIDER = getArg('provider');
// Optional image-source override. 'ia-fullres' forces the IA native full-resolution
// image (bypasses the possibly-downscaled archived R2 copy). Used by the batch-OCR
// contamination repair (#3362) so re-OCR reads full-res, correct source images.
const SOURCE = getArg('source');

// --- Gemini API ---
function getApiKey() {
  // Try all keys — TIER3 first, then KEY_2, then regular
  const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GEMINI_API_KEY found in env');
  return key;
}

// For batch jobs, try TIER3 first (highest quota), then KEY_2, then regular
function getBatchApiKey() {
  const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GEMINI_API_KEY found in env');
  return key;
}

async function uploadBatchFile(jsonlContent, displayName) {
  const apiKey = getBatchApiKey();
  const contentLength = Buffer.byteLength(jsonlContent);

  // Start resumable upload
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': contentLength.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({ file: { displayName } }),
    }
  );

  if (!startResponse.ok) {
    throw new Error(`Upload start failed: ${await startResponse.text()}`);
  }

  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('No upload URL returned');

  // Upload content
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: jsonlContent,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${await uploadResponse.text()}`);
  }

  const fileInfo = await uploadResponse.json();
  if (!fileInfo.file?.name) {
    throw new Error(`Missing file.name in response: ${JSON.stringify(fileInfo)}`);
  }

  return { name: fileInfo.file.name, uri: fileInfo.file.uri };
}

async function createBatchJobFromFile(model, fileName, displayName, retries = 3) {
  const apiKey = getBatchApiKey();
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: {
            display_name: displayName,
            input_config: { file_name: fileName },
          },
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING' };
    }

    const errorText = await response.text();
    if (response.status === 429 && attempt < retries - 1) {
      const waitSec = 60 * (attempt + 1); // 60s, 120s, 180s
      console.log(`  Rate limited (429), waiting ${waitSec}s before retry ${attempt + 2}/${retries}...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
    throw new Error(`Batch create failed (${response.status}): ${errorText}`);
  }
}

// Inline batch job creation — no file upload needed, bypasses file storage quota
async function createBatchJobInline(model, requests, displayName, retries = 3) {
  const apiKey = getBatchApiKey();
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: {
            display_name: displayName,
            input_config: {
              requests: { requests },
            },
          },
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING' };
    }

    const errorText = await response.text();
    if (response.status === 429 && attempt < retries - 1) {
      const waitSec = 60 * (attempt + 1);
      console.log(`  Rate limited (429), waiting ${waitSec}s before retry ${attempt + 2}/${retries}...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
    throw new Error(`Batch create failed (${response.status}): ${errorText}`);
  }
}

// --- Image helpers ---
// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

// Derive the IA native full-resolution URL from an archive.org page URL (the display
// size `pct:50`/`pct:NN` becomes `full`). Returns null for non-archive.org sources.
function iaFullResUrl(page) {
  const src = page.photo_original || page.photo;
  if (typeof src === 'string' && /archive\.org\/download\//.test(src)) {
    return src.replace(/\/full\/pct:\d+\//, '/full/full/');
  }
  return null;
}

// Resolve the image URL to submit for OCR, honoring the optional --source override.
function resolveImageUrl(page) {
  if (SOURCE === 'ia-fullres') return iaFullResUrl(page) || getPageImageUrl(page);
  return getPageImageUrl(page);
}

async function fetchImageBase64(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      data: Buffer.from(buffer).toString('base64'),
      mimeType: contentType.split(';')[0].trim(),
    };
  } catch {
    return null;
  }
}

async function downloadImagesParallel(pages, concurrency) {
  const results = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (page) => {
        const url = resolveImageUrl(page);
        if (!url) return null;
        const image = await fetchImageBase64(url);
        if (!image) return null;
        return { pageId: page.id, image };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
    if (i + concurrency < pages.length) {
      process.stdout.write(`  Downloaded ${Math.min(i + concurrency, pages.length)}/${pages.length} images\r`);
    }
  }
  console.log(`  Downloaded ${results.length}/${pages.length} images successfully`);
  return results;
}

// --- Prompt lookup ---
async function getOcrPrompt(db) {
  // Always use the default OCR prompt (Standard OCR v5) with auto-detect.
  // No language hint — Gemini auto-detects reliably.
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );

  if (!prompt?.content) {
    throw new Error('No default OCR prompt found in DB');
  }

  console.log(`  Using prompt: ${prompt.name} v${prompt.version}`);

  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

  return prompt.content
    .replace('{language_instruction}', languageInstruction)
    .replace('{language}', '');
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Bulk ${NEW_ONLY ? 'OCR (new)' : 'Re-OCR'} — Local Mode ===`);
  console.log(`  offset=${OFFSET}, limit=${LIMIT}, pages/book=${MAX_PAGES}`);
  if (PROVIDER) console.log(`  provider=${PROVIDER}`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // Build book filter
    const bookFilter = { deleted: { $ne: true } };
    if (SINGLE_BOOK) {
      bookFilter.id = SINGLE_BOOK;
    }
    if (PROVIDER) {
      bookFilter['image_source.provider'] = PROVIDER;
    }

    // Exclude books with active batch jobs
    const recentCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const activeBatchBookIds = await db.collection('batch_jobs').distinct('book_id', {
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      created_at: { $gte: recentCutoff },
    });
    if (activeBatchBookIds.length > 0 && !SINGLE_BOOK) {
      bookFilter.id = { $nin: activeBatchBookIds };
    }

    const books = await db.collection('books').find(bookFilter, {
      projection: {
        _id: 0, id: 1, title: 1, display_title: 1,
        language: 1, original_language: 1, read_count: 1, pages_count: 1,
      }
    })
      .sort({ read_count: -1, pages_count: -1 })
      .skip(OFFSET)
      .limit(LIMIT + 50)
      .toArray();

    let totalPages = 0;
    let totalBooks = 0;
    let quotaExhausted = false;

    for (const book of books) {
      if (totalBooks >= LIMIT || quotaExhausted) break;

      const label = (book.display_title || book.title || '').substring(0, 60);
      const language = book.original_language || book.language || '';

      // Build page filter
      let pageFilter;
      if (NEW_ONLY) {
        // Pages WITHOUT OCR
        pageFilter = {
          book_id: book.id,
          $or: [
            { 'ocr.data': { $exists: false } },
            { 'ocr.data': null },
            { 'ocr.data': '' },
          ],
          $and: [{
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } },
            ]
          }]
        };
      } else {
        // Pages with OLD OCR (re-OCR)
        pageFilter = {
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: '' },
          'ocr.model': { $nin: SKIP_MODELS },
          $or: [
            { 'ocr.model': { $ne: TARGET_MODEL } },
            { 'ocr.prompt_version': { $ne: TARGET_PROMPT } },
          ],
          $and: [{
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } },
            ]
          }]
        };
      }

      const eligiblePages = await db.collection('pages').find(pageFilter, {
        projection: {
          _id: 0, id: 1, page_number: 1,
          photo: 1, photo_original: 1, archived_photo: 1,
          cropped_photo: 1, crop: 1, split_from_spread: 1,
        }
      }).sort({ page_number: 1 }).limit(MAX_PAGES).toArray();

      if (eligiblePages.length === 0) continue;

      totalBooks++;
      console.log(`[${totalBooks}/${LIMIT}] ${label} — ${eligiblePages.length} pages`);

      if (DRY_RUN) {
        totalPages += eligiblePages.length;
        continue;
      }

      // Get prompt
      const prompt = await getOcrPrompt(db);

      // Download all images
      const downloaded = await downloadImagesParallel(eligiblePages, IMAGE_CONCURRENCY);
      if (downloaded.length === 0) {
        console.log(`  SKIPPED: all image downloads failed`);
        continue;
      }

      // Build and submit in chunks — use file-based for larger batches (7.5x quota savings)
      const parentJobId = nanoid();
      const childJobIds = [];
      let bookPagesSubmitted = 0;
      const useFileBased = downloaded.length > INLINE_BATCH_SIZE;
      const batchSize = useFileBased ? FILE_BATCH_SIZE : INLINE_BATCH_SIZE;

      for (let j = 0; j < downloaded.length; j += batchSize) {
        const chunk = downloaded.slice(j, j + batchSize);

        try {
          const childJobId = nanoid();
          const displayName = `reocr-${book.id}-${childJobId}`;
          const batchNum = Math.floor(j / batchSize) + 1;
          let batchJob;

          if (useFileBased) {
            // File-based: build JSONL, upload to File API, submit one batch job
            console.log(`  Building JSONL for batch ${batchNum} (${chunk.length} pages, file-based)...`);
            const jsonlLines = chunk.map(item => JSON.stringify({
              request: {
                contents: [{
                  parts: [
                    { text: prompt },
                    { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
                  ],
                }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 16384,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              },
              metadata: { key: item.pageId },
            }));
            const jsonlContent = jsonlLines.join('\n');
            const sizeMB = (Buffer.byteLength(jsonlContent) / 1024 / 1024).toFixed(1);
            console.log(`  Uploading ${sizeMB} MB JSONL...`);
            const fileResult = await uploadBatchFile(jsonlContent, displayName);
            console.log(`  Uploaded: ${fileResult.name}`);
            batchJob = await createBatchJobFromFile(TARGET_MODEL, fileResult.name, displayName);
          } else {
            // Inline: small batch, base64 in HTTP body
            console.log(`  Submitting batch ${batchNum} (${chunk.length} pages, inline)...`);
            const inlineRequests = chunk.map(item => ({
              request: {
                contents: [{
                  parts: [
                    { text: prompt },
                    { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
                  ],
                }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 16384,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              },
              metadata: { key: item.pageId },
            }));
            batchJob = await createBatchJobInline(TARGET_MODEL, inlineRequests, displayName);
          }

          console.log(`  Submitted: ${batchJob.name} (${batchJob.state})`);

          // Record in DB
          await db.collection('batch_jobs').insertOne({
            id: childJobId,
            parent_job_id: parentJobId,
            job_name: batchJob.name,
            type: 'ocr',
            book_id: book.id,
            page_ids: chunk.map(c => c.pageId),
            page_count: chunk.length,
            status: 'pending',
            model: TARGET_MODEL,
            language,
            prompt_version: TARGET_PROMPT,
            submission_method: useFileBased ? 'file' : 'inline',
            force: !NEW_ONLY,
            created_at: new Date(),
            updated_at: new Date(),
          });

          childJobIds.push(childJobId);
          bookPagesSubmitted += chunk.length;

          // Log to gemini_usage
          await db.collection('gemini_usage').insertOne({
            type: 'ocr',
            mode: 'batch',
            model: TARGET_MODEL,
            book_id: book.id,
            book_title: book.title,
            page_ids: chunk.map(c => c.pageId),
            page_count: chunk.length,
            batch_job_id: childJobId,
            gemini_job_name: batchJob.name,
            input_tokens: 0,
            output_tokens: 0,
            status: 'submitted',
            endpoint: 'scripts/bulk-reocr-local.mjs',
            submission_method: useFileBased ? 'file' : 'inline',
            timestamp: new Date(),
          });
        } catch (error) {
          console.error(`  ERROR submitting batch: ${error.message}`);
          // If quota exhausted, stop processing more books
          if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            console.error('  Batch API quota exhausted. Stopping all processing.');
            quotaExhausted = true;
            break;
          }
        }
      }

      if (bookPagesSubmitted === 0) {
        console.log(`  SKIPPED: no batches submitted`);
        continue;
      }

      // Create parent job
      await db.collection('batch_jobs').insertOne({
        id: parentJobId,
        type: 'ocr',
        book_id: book.id,
        book_title: book.title,
        total_pages: bookPagesSubmitted,
        child_job_ids: childJobIds,
        progress: {
          completed: 0, failed: 0,
          pending: bookPagesSubmitted, total: bookPagesSubmitted,
        },
        status: 'pending',
        model: TARGET_MODEL,
        language,
        prompt_version: TARGET_PROMPT,
        force: !NEW_ONLY,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Mark book
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { job: { type: 'batch', job_id: parentJobId } } }
      );

      totalPages += bookPagesSubmitted;
      console.log(`  Done: ${bookPagesSubmitted} pages in ${childJobIds.length} batches`);
      console.log('');
    }

    console.log('=== Summary ===');
    console.log(`Books: ${totalBooks}`);
    console.log(`Pages: ${totalPages}`);
    console.log(`Estimated cost: $${(totalPages * 0.00079).toFixed(2)}`);
    if (DRY_RUN) console.log('(dry run — nothing submitted)');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
