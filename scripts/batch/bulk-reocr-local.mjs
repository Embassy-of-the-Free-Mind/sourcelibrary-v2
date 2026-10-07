#!/usr/bin/env node
/**
 * Batch-API OCR by hand — THE default path for paid OCR outside the pipeline (#5244).
 *
 * Paid model work runs through the Gemini Batch API unless the caller says otherwise
 * (Derek, 2026-09-28). This script is that path: it downloads the page images, builds
 * JSONL, uploads it to the File API and submits batch jobs; `scripts/workers/batch-collector.mjs`
 * (Hetzner cron) writes the results back, with the same #4613 provenance block the pipeline
 * writes. `scripts/batch/realtime-ocr.mjs` is the ~2× realtime alternative and refuses to run
 * without `--realtime`.
 *
 * It never changes `pipeline_auto.status`, so it works on HELD books (#4790) and leaves them
 * held: the collector only advances `ocr_submitted` books, and never a held one.
 *
 * Usage (run on Hetzner — large File-API uploads fail from a residential Mac, #3974):
 *   node scripts/batch/bulk-reocr-local.mjs --page-ids-file=pages.json --reason="..." --dry-run
 *
 * Targeting (at most one of the first three; without them, a sweep over books by read_count):
 *   --page-ids-file=F  An explicit page list (JSON). A bare array of ids, or objects carrying
 *                      `page_id` under `confirmed` / `suspected` / `pages` — the same shapes
 *                      realtime-ocr.mjs takes. The list IS the decision: no OCR-state filter.
 *   --ids=F            Book ids, one per line (`#` comments allowed). Uses the --new-only /
 *                      re-OCR page filter per book.
 *   --book-id=ID       A single book (same page filter).
 *   --new-only         Only pages WITHOUT OCR (instead of re-OCR of old-model pages)
 *   --provider=X       Sweep only: filter by image_source.provider (e.g. 'efm', 'ia')
 *   --offset=N         Sweep only: start at book offset N (default: 0)
 *   --limit=N          Books per run (default: 10; with --ids, every listed book)
 *   --pages=N          Max pages per book (default: 500; not applied to --page-ids-file)
 *
 * Control:
 *   --model=lite|flash Force the model. Default: the OCR router's choice per book
 *                      (scripts/lib/ocr-routing.mjs — flash-lite for everything while
 *                      OCR_LITE_ONLY is on, except visible/new Greek, #5575).
 *   --max-chunk-mb=N   Byte cap per file-based job's JSONL (default 40). Chunks are bounded by
 *                      bytes first and pages second (#3974: a page-count bound overflowed V8's
 *                      string limit on large scans and silently dropped the chunk).
 *   --batch-size=N     Page cap per file-based job (default 500).
 *   --source=ia-fullres  Read IA's native full-resolution image instead of the R2 copy (#3362).
 *   --dry-run          Count pages and price them; submit nothing, write nothing.
 *   --reason="..."     Why this batch is being run by hand (recorded on each job, #4336)
 *
 * A chunk that fails to submit, or pages whose image could not be downloaded, are recorded as a
 * `batch_jobs` row with status `submit_failed` (book_id, page_ids, error), so "failed" can be told
 * apart from "still collecting" (#3974). Re-running with the same targeting picks them up again.
 *
 * Requires: MONGODB_URI, GEMINI_API_KEY_TIER3 (or GEMINI_API_KEY); SUPABASE_* for the usage row.
 */

import os from 'node:os';
import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { parseInitiatedReason, initiatedReasonFields } from '../lib/initiated-reason.mjs';
import { readPageIdsFile, readBookIdsFile, chunkByBytes } from '../lib/ocr-targeting.mjs';
import { getOcrModelForBook, OCR_MODEL_FLASH, OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';
import { batchJobProvenance, contentHash, codeVersion } from '../lib/write-provenance.mjs';
import { logUsage, estimateBatchCostUsd } from '../workers/lib/supabase-usage-logger.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';

// --- Config ---
const CALL_SITE = 'scripts/batch/bulk-reocr-local.mjs';
// The label realtime-ocr.mjs stamps for the same default prompt; a page carrying it is not stale.
const LEGACY_PROMPT_LABEL = 'v5.2026-02';
const SKIP_MODELS = ['manual', 'manual-correction'];
const INLINE_BATCH_SIZE = 20;               // Pages per inline batch (base64 in HTTP body)
const INLINE_MAX_BYTES = 15 * 1024 * 1024;  // Inline request body stays well under the ~20MB limit
const IMAGE_CONCURRENCY = 20;               // Parallel image downloads
const ACTIVE_JOB_STATUSES = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// One object, sent in every request AND recorded on the job's provenance (#4613).
const OCR_GENERATION_CONFIG = Object.freeze({
  temperature: 0.1,
  maxOutputTokens: 16384,
  thinkingConfig: { thinkingBudget: 0 },
});
// Same as the pipeline's OCR submission: a refusal on a historical plate is not a safety event.
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY',
].map(category => ({ category, threshold: 'BLOCK_NONE' }));

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_IDS_FILE = getArg('page-ids-file');
const IDS_FILE = getArg('ids');
const SINGLE_BOOK = getArg('book-id');
if ([PAGE_IDS_FILE, IDS_FILE, SINGLE_BOOK].filter(Boolean).length > 1) {
  console.error('Use at most one of --page-ids-file, --ids, --book-id');
  process.exit(1);
}
const MODEL_CHOICE = getArg('model');
if (MODEL_CHOICE && !['flash', 'lite'].includes(MODEL_CHOICE)) {
  console.error(`--model must be flash or lite, got ${MODEL_CHOICE}`);
  process.exit(1);
}
const FORCED_MODEL = MODEL_CHOICE === 'lite' ? OCR_MODEL_LITE : MODEL_CHOICE === 'flash' ? OCR_MODEL_FLASH : null;
const BOOK_IDS = IDS_FILE ? readBookIdsFile(IDS_FILE) : null;
const PAGE_IDS = PAGE_IDS_FILE ? readPageIdsFile(PAGE_IDS_FILE) : null;
const OFFSET = parseInt(getArg('offset') || '0', 10);
const LIMIT = parseInt(getArg('limit') || String(BOOK_IDS ? BOOK_IDS.length : 10), 10);
const MAX_PAGES = parseInt(getArg('pages') || '500', 10);
const FILE_BATCH_SIZE = parseInt(getArg('batch-size') || '500', 10);
const MAX_CHUNK_BYTES = Math.round(parseFloat(getArg('max-chunk-mb') || '40') * 1024 * 1024);
const DRY_RUN = hasFlag('dry-run');
const NEW_ONLY = hasFlag('new-only');
const PROVIDER = getArg('provider');
// Optional image-source override. 'ia-fullres' forces the IA native full-resolution
// image (bypasses the possibly-downscaled archived R2 copy). Used by the batch-OCR
// contamination repair (#3362) so re-OCR reads full-res, correct source images.
const SOURCE = getArg('source');
const INITIATED_BY = 'script:bulk-reocr-local';
const REASON = parseInitiatedReason(args, INITIATED_BY);

// --- Gemini API ---
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

  // Upload content — the PUT is the step that fails transiently on big files (#3974): retry once.
  let uploadResponse;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
        },
        body: jsonlContent,
      });
      if (uploadResponse.ok || attempt === 2) break;
      console.log(`  Upload PUT returned ${uploadResponse.status}, retrying in 30s...`);
    } catch (err) {
      if (attempt === 2) throw new Error(`Upload failed: ${err.message}`);
      console.log(`  Upload PUT failed (${err.message}), retrying in 30s...`);
    }
    await new Promise(r => setTimeout(r, 30000));
  }

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${await uploadResponse.text()}`);
  }

  const fileInfo = await uploadResponse.json();
  if (!fileInfo.file?.name) {
    throw new Error(`Missing file.name in response: ${JSON.stringify(fileInfo)}`);
  }

  return { name: fileInfo.file.name, uri: fileInfo.file.uri };
}

async function createBatchJob(model, inputConfig, displayName, retries = 3) {
  const apiKey = getBatchApiKey();
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: { display_name: displayName, input_config: inputConfig } }),
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

/** Returns { downloaded: [{ pageId, sourceUrl, image }], failedPageIds } — a failure is never silent. */
async function downloadImagesParallel(pages, concurrency) {
  const downloaded = [];
  const failedPageIds = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (page) => {
        const url = resolveImageUrl(page);
        if (!url) return null;
        const image = await fetchImageBase64(url);
        if (!image) return null;
        return { pageId: page.id, sourceUrl: url, image };
      })
    );
    settled.forEach((r, k) => {
      if (r.status === 'fulfilled' && r.value) downloaded.push(r.value);
      else failedPageIds.push(chunk[k].id);
    });
    if (i + concurrency < pages.length) {
      process.stdout.write(`  Downloaded ${Math.min(i + concurrency, pages.length)}/${pages.length} images\r`);
    }
  }
  console.log(`  Downloaded ${downloaded.length}/${pages.length} images successfully`);
  return { downloaded, failedPageIds };
}

// --- Prompt lookup (same prompt and language instruction as the pipeline's OCR submission) ---
async function getOcrPrompt(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');

  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

  return {
    text: prompt.content
      .replace('{language_instruction}', languageInstruction)
      .replace('{language}', ''),
    id: prompt._id?.toString(),
    name: prompt.name,
    version: String(prompt.version ?? 1),
    content_hash: prompt.content_hash,
  };
}

const PAGE_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1,
  photo: 1, photo_original: 1, archived_photo: 1,
  cropped_photo: 1, crop: 1, split_from_spread: 1,
};
const BOOK_PROJECTION = {
  _id: 0, id: 1, title: 1, display_title: 1, language: 1, original_language: 1, visible: 1, created_at: 1,
  read_count: 1, pages_count: 1, image_source: 1, 'pipeline_auto.status': 1,
  'pipeline_auto.hold': 1, 'pipeline_auto.ocr_generation': 1,
};
const HAS_IMAGE = { $or: [{ photo: { $exists: true, $ne: null } }, { photo_original: { $exists: true, $ne: null } }] };

function pageFilterForBook(bookId, model, promptVersion) {
  if (NEW_ONLY) {
    return {
      book_id: bookId,
      $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
      $and: [HAS_IMAGE],
    };
  }
  // Re-OCR: pages whose text came from another model or another prompt.
  return {
    book_id: bookId,
    'ocr.data': { $exists: true, $ne: '' },
    'ocr.model': { $nin: SKIP_MODELS },
    $and: [
      HAS_IMAGE,
      { $or: [{ 'ocr.model': { $ne: model } }, { 'ocr.prompt_version': { $nin: [promptVersion, LEGACY_PROMPT_LABEL] } }] },
    ],
  };
}

/**
 * Resolve the targeting into [{ book, model, pages }]. Pages already in a live batch job are
 * dropped (a second submission would pay twice for one page).
 */
async function resolveTargets(db, promptVersion) {
  const modelFor = (book) => FORCED_MODEL || getOcrModelForBook(book);
  const targets = [];

  if (PAGE_IDS) {
    const pages = await db.collection('pages').find({ id: { $in: PAGE_IDS } }, { projection: PAGE_PROJECTION }).toArray();
    const found = new Set(pages.map(p => p.id));
    const missing = PAGE_IDS.filter(id => !found.has(id));
    if (missing.length) console.log(`  ${missing.length} listed page ids not found (first: ${missing.slice(0, 3).join(', ')})`);
    const withImage = pages.filter(p => p.photo || p.photo_original);
    if (withImage.length < pages.length) console.log(`  ${pages.length - withImage.length} listed pages have no image — skipped`);
    const byBook = new Map();
    for (const p of withImage) (byBook.get(p.book_id) || byBook.set(p.book_id, []).get(p.book_id)).push(p);
    const books = await db.collection('books').find({ id: { $in: [...byBook.keys()] }, deleted: { $ne: true } }, { projection: BOOK_PROJECTION }).toArray();
    const known = new Set(books.map(b => b.id));
    const orphaned = [...byBook.keys()].filter(id => !known.has(id));
    if (orphaned.length) console.log(`  pages of ${orphaned.length} deleted/unknown books skipped: ${orphaned.slice(0, 3).join(', ')}`);
    for (const book of books) {
      targets.push({ book, model: modelFor(book), pages: byBook.get(book.id).sort((a, b) => a.page_number - b.page_number) });
    }
  } else {
    const bookFilter = { deleted: { $ne: true } };
    if (SINGLE_BOOK) bookFilter.id = SINGLE_BOOK;
    else if (BOOK_IDS) bookFilter.id = { $in: BOOK_IDS };
    if (PROVIDER) bookFilter['image_source.provider'] = PROVIDER;

    // A sweep skips books with a recent live batch job outright.
    if (!SINGLE_BOOK && !BOOK_IDS) {
      const recentCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const activeBatchBookIds = await db.collection('batch_jobs').distinct('book_id', {
        status: { $in: ACTIVE_JOB_STATUSES },
        created_at: { $gte: recentCutoff },
      });
      if (activeBatchBookIds.length > 0) bookFilter.id = { $nin: activeBatchBookIds };
    }

    let cursor = db.collection('books').find(bookFilter, { projection: BOOK_PROJECTION })
      .sort({ read_count: -1, pages_count: -1 });
    if (!BOOK_IDS && !SINGLE_BOOK) cursor = cursor.skip(OFFSET).limit(LIMIT + 50);
    const books = await cursor.toArray();
    if (BOOK_IDS && books.length < BOOK_IDS.length) {
      const known = new Set(books.map(b => b.id));
      const absent = BOOK_IDS.filter(id => !known.has(id));
      console.log(`  ${absent.length} listed book ids not found or deleted (first: ${absent.slice(0, 3).join(', ')})`);
    }

    for (const book of books) {
      if (targets.length >= LIMIT) break;
      const model = modelFor(book);
      const pages = await db.collection('pages').find(pageFilterForBook(book.id, model, promptVersion), { projection: PAGE_PROJECTION })
        .sort({ page_number: 1 }).limit(MAX_PAGES).toArray();
      if (pages.length) targets.push({ book, model, pages });
    }
  }

  // Page-level double-submission guard, for every targeting mode.
  const bookIds = targets.map(t => t.book.id);
  if (bookIds.length) {
    const live = await db.collection('batch_jobs').find(
      { book_id: { $in: bookIds }, type: 'ocr', status: { $in: ACTIVE_JOB_STATUSES }, created_at: { $gte: new Date(Date.now() - 48 * 3600 * 1000) } },
      { projection: { _id: 0, page_ids: 1 } }
    ).toArray();
    const inFlight = new Set(live.flatMap(j => j.page_ids || []));
    if (inFlight.size) {
      let dropped = 0;
      for (const t of targets) {
        const before = t.pages.length;
        t.pages = t.pages.filter(p => !inFlight.has(p.id));
        dropped += before - t.pages.length;
      }
      if (dropped) console.log(`  ${dropped} pages already in a live batch job — skipped`);
    }
  }
  return targets.filter(t => t.pages.length);
}

async function recordSubmitFailure(db, { book, model, parentJobId, pageIds, error, stage }) {
  await db.collection('batch_jobs').insertOne({
    id: nanoid(),
    parent_job_id: parentJobId,
    type: 'ocr',
    book_id: book.id,
    page_ids: pageIds,
    page_count: pageIds.length,
    // Not a Gemini job: nothing to collect. Distinct from `failed`, which the collector's
    // recovery sweep re-checks against Gemini by job_name.
    status: 'submit_failed',
    failure_stage: stage,
    error: String(error).slice(0, 2000),
    model,
    submitted_by: CALL_SITE,
    initiated_by: INITIATED_BY,
    ...initiatedReasonFields(REASON),
    created_at: new Date(),
    updated_at: new Date(),
  });
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  const targeting = PAGE_IDS ? `page list ${PAGE_IDS_FILE} (${PAGE_IDS.length} ids)`
    : BOOK_IDS ? `book list ${IDS_FILE} (${BOOK_IDS.length} ids)`
    : SINGLE_BOOK ? `book ${SINGLE_BOOK}` : `sweep offset=${OFFSET} limit=${LIMIT}`;
  console.log(`=== Batch ${PAGE_IDS ? 'OCR (page list)' : NEW_ONLY ? 'OCR (new)' : 'Re-OCR'} ===`);
  console.log(`  ${targeting}; model=${FORCED_MODEL || 'router'}; chunk cap ${(MAX_CHUNK_BYTES / 1048576).toFixed(0)} MB / ${FILE_BATCH_SIZE} pages`);
  if (PROVIDER) console.log(`  provider=${PROVIDER}`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    const promptRef = await getOcrPrompt(db);
    console.log(`  Prompt: ${promptRef.name} v${promptRef.version}`);
    const targets = await resolveTargets(db, promptRef.version);
    const promptSentHash = contentHash(promptRef.text);
    const promptBytes = Buffer.byteLength(promptRef.text);
    const runCodeVersion = await codeVersion();

    const totals = { books: 0, pages: 0, held: 0, cost: 0, failedPages: 0, byModel: {} };
    let quotaExhausted = false;

    for (const { book, model, pages } of targets) {
      if (quotaExhausted) break;
      totals.books++;
      if (book.pipeline_auto?.hold) totals.held++;
      const label = (book.display_title || book.title || '').substring(0, 60);
      const language = book.original_language || book.language || '';
      const held = book.pipeline_auto?.hold ? ' [HELD]' : '';
      console.log(`[${totals.books}/${targets.length}] ${book.id} ${label}${held} — ${pages.length} pages, ${model}`);

      if (DRY_RUN) {
        totals.pages += pages.length;
        totals.cost += estimateBatchCostUsd({ type: 'ocr', model, pageCount: pages.length });
        totals.byModel[model] = (totals.byModel[model] || 0) + pages.length;
        continue;
      }

      const parentJobId = nanoid();
      const { downloaded, failedPageIds } = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
      if (failedPageIds.length) {
        await recordSubmitFailure(db, { book, model, parentJobId, pageIds: failedPageIds, error: 'image download failed', stage: 'image_download' });
        totals.failedPages += failedPageIds.length;
      }
      if (downloaded.length === 0) {
        console.log(`  SKIPPED: all image downloads failed (recorded as submit_failed)`);
        continue;
      }

      const sizeOf = (item) => item.image.data.length + promptBytes + 1024;
      const totalBytes = downloaded.reduce((s, it) => s + sizeOf(it), 0);
      const useFileBased = downloaded.length > INLINE_BATCH_SIZE || totalBytes > INLINE_MAX_BYTES;
      const chunks = useFileBased
        ? chunkByBytes(downloaded, sizeOf, { maxBytes: MAX_CHUNK_BYTES, maxItems: FILE_BATCH_SIZE })
        : [{ items: downloaded, bytes: totalBytes }];
      const provenance = batchJobProvenance({
        call_site: CALL_SITE, model,
        prompt: { id: promptRef.id, name: promptRef.name, version: promptRef.version, hash: promptRef.content_hash, text: promptRef.text },
        generationConfig: OCR_GENERATION_CONFIG,
        run: { code_version: runCodeVersion, host: os.hostname() },
      });
      const ocrGeneration = book.pipeline_auto?.ocr_generation || 0;

      const childJobIds = [];
      let bookPagesSubmitted = 0;
      for (const [n, chunk] of chunks.entries()) {
        const pageIds = chunk.items.map(c => c.pageId);
        if (quotaExhausted) {
          await recordSubmitFailure(db, { book, model, parentJobId, pageIds, error: 'not attempted: Batch API quota exhausted earlier in this run', stage: 'quota' });
          totals.failedPages += pageIds.length;
          continue;
        }
        const childJobId = nanoid();
        const displayName = `reocr-${book.id}-${childJobId}`;
        const requestOf = (item) => ({
          request: {
            contents: [{ parts: [{ text: promptRef.text }, { inlineData: { mimeType: item.image.mimeType, data: item.image.data } }] }],
            safetySettings: SAFETY_SETTINGS,
            generationConfig: OCR_GENERATION_CONFIG,
          },
          metadata: { key: item.pageId },
        });
        try {
          let batchJob;
          if (useFileBased) {
            const jsonlContent = chunk.items.map(item => JSON.stringify(requestOf(item))).join('\n');
            console.log(`  Batch ${n + 1}/${chunks.length}: ${chunk.items.length} pages, ${(Buffer.byteLength(jsonlContent) / 1048576).toFixed(1)} MB JSONL, uploading...`);
            const fileResult = await uploadBatchFile(jsonlContent, displayName);
            // Delete the input as soon as create returns (#5544): left for the hourly sweep,
            // this lane's inputs filled the project's 20 GiB File API quota for every lane.
            batchJob = await createThenDeleteInput({
              fileName: fileResult.name, apiKey: getBatchApiKey(),
              create: () => createBatchJob(model, { file_name: fileResult.name }, displayName),
            });
          } else {
            console.log(`  Batch ${n + 1}/${chunks.length}: ${chunk.items.length} pages, inline...`);
            batchJob = await createBatchJob(model, { requests: { requests: chunk.items.map(requestOf) } }, displayName);
          }
          console.log(`  Submitted: ${batchJob.name} (${batchJob.state})`);

          // Same job shape as the pipeline's OCR submission, so batch-collector writes the
          // #4613 provenance block and the #2297 source url for these pages too.
          await db.collection('batch_jobs').insertOne({
            id: childJobId,
            parent_job_id: parentJobId,
            job_name: batchJob.name,
            type: 'ocr',
            book_id: book.id,
            page_ids: pageIds,
            page_sources: chunk.items.map(c => ({ page_id: c.pageId, source_url: c.sourceUrl, prompt_sent_hash: promptSentHash, prompt_sent_chars: promptRef.text.length })),
            code_version: runCodeVersion,
            page_count: pageIds.length,
            status: 'pending',
            model,
            language,
            prompt_version: promptRef.version,
            prompt_id: promptRef.id,
            prompt_name: promptRef.name,
            prompt_hash: promptRef.content_hash,
            provenance,
            submitted_by: CALL_SITE,
            submission_method: useFileBased ? 'file' : 'inline',
            ocr_generation: ocrGeneration, // #2449 generation guard
            force: !NEW_ONLY,
            initiated_by: INITIATED_BY,
            ...initiatedReasonFields(REASON),
            created_at: new Date(),
            updated_at: new Date(),
          });
          childJobIds.push(childJobId);
          bookPagesSubmitted += pageIds.length;

          // Priced at submit so the dial sees committed spend (#4567).
          const cost = estimateBatchCostUsd({ type: 'ocr', model, pageCount: pageIds.length });
          totals.cost += cost;
          await logUsage({
            type: 'ocr', mode: 'batch', model,
            book_id: book.id, book_title: book.title,
            page_ids: pageIds, page_count: pageIds.length,
            batch_job_id: childJobId, gemini_job_name: batchJob.name,
            input_tokens: 0, output_tokens: 0, status: 'submitted',
            cost_usd: cost, endpoint: CALL_SITE, triggered_by: 'manual',
          }, db);
        } catch (error) {
          console.error(`  ERROR submitting batch: ${error.message}`);
          await recordSubmitFailure(db, { book, model, parentJobId, pageIds, error: error.message, stage: 'submit' });
          totals.failedPages += pageIds.length;
          if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            console.error('  Batch API quota exhausted. Recording the rest as not attempted.');
            quotaExhausted = true;
          }
        }
      }

      if (bookPagesSubmitted === 0) {
        console.log(`  SKIPPED: no batches submitted (recorded as submit_failed)`);
        continue;
      }

      await db.collection('batch_jobs').insertOne({
        id: parentJobId,
        type: 'ocr',
        book_id: book.id,
        book_title: book.title,
        total_pages: bookPagesSubmitted,
        child_job_ids: childJobIds,
        progress: { completed: 0, failed: 0, pending: bookPagesSubmitted, total: bookPagesSubmitted },
        status: 'pending',
        model,
        language,
        prompt_version: promptRef.version,
        force: !NEW_ONLY,
        submitted_by: CALL_SITE,
        initiated_by: INITIATED_BY,
        ...initiatedReasonFields(REASON),
        created_at: new Date(),
        updated_at: new Date(),
      });

      // `job` is the reader's "being processed" marker; pipeline_auto is deliberately untouched.
      await db.collection('books').updateOne({ id: book.id }, { $set: { job: { type: 'batch', job_id: parentJobId } } });

      totals.pages += bookPagesSubmitted;
      totals.byModel[model] = (totals.byModel[model] || 0) + bookPagesSubmitted;
      console.log(`  Done: ${bookPagesSubmitted} pages in ${childJobIds.length} batches`);
      console.log('');
    }

    console.log('=== Summary ===');
    console.log(`Books: ${totals.books}${totals.held ? ` (${totals.held} held — status unchanged)` : ''}`);
    console.log(`Pages: ${totals.pages} ${JSON.stringify(totals.byModel)}`);
    console.log(`Estimated batch cost: $${totals.cost.toFixed(2)} (measured batch $/page, supabase-usage-logger)`);
    if (totals.failedPages) console.log(`NOT SUBMITTED: ${totals.failedPages} pages — batch_jobs status 'submit_failed'`);
    if (DRY_RUN) console.log('(dry run — nothing submitted)');
    if (totals.failedPages) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
