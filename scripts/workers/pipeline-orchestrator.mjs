#!/usr/bin/env node
/**
 * Pipeline Orchestrator Worker
 *
 * Replaces the Vercel `post-import-pipeline` cron. Drives books through all pipeline
 * phases with no time limit and higher submission limits.
 *
 * Designed to run every 5 minutes on Hetzner via crontab.
 *
 * Key improvements over the Vercel cron:
 *   - No 270s time budget — processes ALL books per phase
 *   - Higher submission limits (200 OCR, 100 translate, 30 enrich, etc.)
 *   - Still calls production API for complex operations (OCR/translate submission,
 *     enrichment, chapter extraction, image extraction)
 *   - Logs to cron_runs collection for observability
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/pipeline-orchestrator.mjs
 *   node scripts/workers/pipeline-orchestrator.mjs --dry-run
 *   node scripts/workers/pipeline-orchestrator.mjs --phase 2  # run only phase 2 (OCR submit)
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';

// Gemini Batch API config (for direct OCR submission, bypassing Vercel)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OCR_MODEL = 'gemini-3-flash-preview';
const OCR_PROMPT_VERSION = 'v5.2026-02';
const OCR_BATCH_SIZE = 20;        // Pages per Gemini inline batch
const IMAGE_CONCURRENCY = 20;     // Parallel image downloads per book
const MAX_PAGES_PER_BOOK = 500;   // Max pages to OCR per book

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const ONLY_PHASE = phaseIdx >= 0 ? parseInt(args[phaseIdx + 1], 10) : null;

// Submission limits — much higher than the Vercel cron since we have no time budget
const ENROLL_LIMIT = 100;
const ARCHIVE_LIMIT = 500;
const OCR_SUBMIT_LIMIT = 200;
const MAX_ACTIVE_BATCH_OCR = 500; // Gemini Batch API is resilient
const METADATA_ENRICH_LIMIT = 50;
const TRANSLATE_SUBMIT_LIMIT = 100;
const ENRICH_LIMIT = 30;
const CHAPTER_LIMIT = 50;
const IMAGE_SUBMIT_LIMIT = 10;
const FINALIZE_LIMIT = 200;
const MAX_ACTIVE_IMAGE_JOBS = 15;
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 14;

// Delay between API calls (ms) to avoid overwhelming production
const API_DELAY_MS = 500;

// Page types to skip for translation (mirrors defaults.ts)
const SKIP_TRANSLATION_PAGE_TYPES = [
  'blank', 'illustration', 'map', 'frontispiece', 'diagram',
];

// Sources whose pages need archiving
const ARCHIVABLE_SOURCES = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de|digi\.vatlib\.it|diglib\.hab\.de|e-rara|wellcomecollection|cudl\.lib\.cam|digital\.bodleian/;

console.log(`[pipeline-orchestrator] Base URL: ${BASE_URL} | Dry run: ${DRY_RUN}${ONLY_PHASE !== null ? ` | Phase: ${ONLY_PHASE}` : ''}`);

// ── Helpers ──

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CRON_SECRET}`,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setPipelineStatus(db, bookId, status, extra = {}) {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { 'pipeline_auto.status': 1, title: 1 } }
  );
  const prevStatus = book?.pipeline_auto?.status;

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        'pipeline_auto.status': status,
        'pipeline_auto.last_updated': new Date(),
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [`pipeline_auto.${k}`, v])
        ),
        updated_at: new Date(),
      },
    }
  );

  // Audit trail (fire-and-forget)
  if (prevStatus !== status) {
    db.collection('audit_log').insertOne({
      action: 'pipeline_status_changed',
      book_id: bookId,
      book_title: book?.title,
      metadata: { from: prevStatus || 'none', to: status, source: 'hetzner-worker', ...extra },
      timestamp: new Date(),
    }).catch(() => {});
  }
}

async function markFailed(db, bookId, error, retryCount) {
  await setPipelineStatus(db, bookId, 'failed', { error, retry_count: retryCount });
}

function shouldRun(phase) {
  return ONLY_PHASE === null || ONLY_PHASE === phase;
}

// ── Gemini Batch API helpers (direct OCR submission, no Vercel) ──

// All keys for rotation — try each until one works (batch jobs are per-key)
const GEMINI_BATCH_KEYS = [
  process.env.GEMINI_API_KEY_2,       // Prefer KEY_2 for batch (separate quota pool)
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
].filter(k => !!k);

function getGeminiApiKey(keyIndex = 0) {
  const key = GEMINI_BATCH_KEYS[keyIndex] || GEMINI_BATCH_KEYS[0];
  if (!key) throw new Error('No GEMINI_API_KEY found in env');
  return key;
}

function getPageImageUrl(page) {
  if (page.crop && page.cropped_photo) return page.cropped_photo;
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) return page.archived_photo;
  return page.photo_original || page.photo || null;
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
        const url = getPageImageUrl(page);
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
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
  }
  return results;
}

async function createBatchJobInline(model, requests, displayName) {
  // Try each API key — rotate on quota exhaustion (429)
  for (let ki = 0; ki < GEMINI_BATCH_KEYS.length; ki++) {
    const apiKey = getGeminiApiKey(ki);
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
    console.log(`    Key ${ki} failed (${response.status}): ${errorText.substring(0, 100)}`);
    if (response.status === 429) {
      continue;
    }
    throw new Error(`Batch create failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

async function getOcrPromptFromDb(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');

  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

  return prompt.content
    .replace('{language_instruction}', languageInstruction)
    .replace('{language}', '');
}

/**
 * Submit OCR for a single book directly to Gemini Batch API.
 * Downloads images on Hetzner (no Vercel memory limits), splits into batches of 20.
 * Returns { submitted: number, jobName: string } or throws.
 */
async function submitOcrDirectly(db, book) {
  // Find pages needing OCR
  const pages = await db.collection('pages')
    .find({
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
    })
    .sort({ page_number: 1 })
    .limit(MAX_PAGES_PER_BOOK)
    .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 })
    .toArray();

  if (pages.length === 0) {
    return { submitted: 0, jobName: null, alreadyDone: true };
  }

  console.log(`    Downloading ${pages.length} images...`);
  const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
  if (downloaded.length === 0) {
    throw new Error(`All ${pages.length} image downloads failed`);
  }
  console.log(`    Downloaded ${downloaded.length}/${pages.length} images`);

  const prompt = await getOcrPromptFromDb(db);
  const parentJobId = nanoid();
  const childJobIds = [];
  let totalSubmitted = 0;
  let firstJobName = null;

  for (let j = 0; j < downloaded.length; j += OCR_BATCH_SIZE) {
    const chunk = downloaded.slice(j, j + OCR_BATCH_SIZE);

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

    const childJobId = nanoid();
    const displayName = `pipeline-ocr-${book.id}-${childJobId}`;
    const batchJob = await createBatchJobInline(OCR_MODEL, inlineRequests, displayName);

    if (!firstJobName) firstJobName = batchJob.name;

    // Record in batch_jobs
    await db.collection('batch_jobs').insertOne({
      id: childJobId,
      parent_job_id: parentJobId,
      job_name: batchJob.name,
      type: 'ocr',
      book_id: book.id,
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      status: 'pending',
      model: OCR_MODEL,
      prompt_version: OCR_PROMPT_VERSION,
      force: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    childJobIds.push(childJobId);
    totalSubmitted += chunk.length;

    // Log to gemini_usage
    await db.collection('gemini_usage').insertOne({
      type: 'ocr',
      mode: 'batch',
      model: OCR_MODEL,
      book_id: book.id,
      book_title: book.title,
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      batch_job_id: childJobId,
      gemini_job_name: batchJob.name,
      input_tokens: 0,
      output_tokens: 0,
      status: 'submitted',
      endpoint: 'hetzner/pipeline-orchestrator',
      timestamp: new Date(),
    });
  }

  // Create parent job if multiple children
  if (childJobIds.length > 1) {
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'ocr',
      book_id: book.id,
      child_job_ids: childJobIds,
      total_pages: totalSubmitted,
      status: 'pending',
      model: OCR_MODEL,
      prompt_version: OCR_PROMPT_VERSION,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  return { submitted: totalSubmitted, jobName: firstJobName || parentJobId, childCount: childJobIds.length };
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Emergency stop check
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log('[pipeline-orchestrator] PAUSED by emergency stop. Exiting.');
    await client.close();
    return;
  }

  const log = {
    enrolled: 0,
    archived: 0,
    ocr_submitted: 0,
    ocr_advanced: 0,
    metadata_enriched: 0,
    metadata_skipped: 0,
    translate_submitted: 0,
    translate_advanced: 0,
    enriched: 0,
    chapters_extracted: 0,
    chapters_skipped: 0,
    images_submitted: 0,
    images_advanced: 0,
    finalized: 0,
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
    errors: [],
  };

  try {
    // ── Phase 0: Auto-enroll recently imported books ──
    if (shouldRun(0)) {
      console.log('\n--- Phase 0: Auto-enroll ---');
      const cutoff = new Date(Date.now() - ENROLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const newBooks = await db.collection('books')
        .find({
          pipeline_auto: { $exists: false },
          created_at: { $gte: cutoff },
        })
        .project({ id: 1 })
        .limit(ENROLL_LIMIT)
        .toArray();

      if (DRY_RUN) {
        console.log(`  Would enroll ${newBooks.length} books`);
      } else {
        for (const book of newBooks) {
          await db.collection('books').updateOne(
            { id: book.id },
            {
              $set: {
                pipeline_auto: {
                  status: 'queued',
                  source: 'cron',
                  queued_at: new Date(),
                  last_updated: new Date(),
                  retry_count: 0,
                },
                updated_at: new Date(),
              },
            }
          );
          log.enrolled++;
        }
      }
      console.log(`  Enrolled: ${log.enrolled}`);
    }

    // ── Phase 1: Archive check (queued/archiving -> archive_complete) ──
    if (shouldRun(1)) {
      console.log('\n--- Phase 1: Archive check ---');

      // Move queued -> archiving
      const queuedBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'queued' })
        .sort({ hidden: 1 })
        .project({ id: 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      if (!DRY_RUN) {
        for (const book of queuedBooks) {
          await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
          log.archived++;
        }
      }
      console.log(`  Queued -> archiving: ${queuedBooks.length}`);

      // Check archiving books for completion
      const archivingBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archiving' })
        .sort({ hidden: 1 })
        .project({ id: 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      let archiveCompleted = 0;
      for (const book of archivingBooks) {
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: { $regex: /^failed:/ } },
          ],
          $and: [{
            $or: [
              { photo: { $regex: ARCHIVABLE_SOURCES } },
              { photo_original: { $regex: ARCHIVABLE_SOURCES } },
            ],
          }],
        });

        if (remaining === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });
          }
          archiveCompleted++;
          log.archived++;
        }
      }
      console.log(`  Archive completed: ${archiveCompleted}/${archivingBooks.length}`);
    }

    // ── Phase 2: Submit OCR via Gemini Batch API (archive_complete -> ocr_submitted) ──
    if (shouldRun(2)) {
      console.log('\n--- Phase 2: OCR submission ---');

      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });
      console.log(`  Active OCR batch jobs: ${activeBatchOcr}/${MAX_ACTIVE_BATCH_OCR}`);

      const ocrLimit = activeBatchOcr >= MAX_ACTIVE_BATCH_OCR ? 0 : OCR_SUBMIT_LIMIT;

      const readyForOcr = ocrLimit > 0 ? await db.collection('books')
        .find({ 'pipeline_auto.status': 'archive_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ocrLimit)
        .toArray() : [];

      console.log(`  Books ready for OCR: ${readyForOcr.length}`);

      for (const book of readyForOcr) {
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          const label = (book.title || '').substring(0, 50);

          if (DRY_RUN) {
            console.log(`  Would submit OCR: ${label} (${book.pages_count} pages)`);
            continue;
          }

          // Direct OCR submission — downloads images on Hetzner, submits to Gemini Batch API
          console.log(`  Submitting OCR: ${label}...`);
          const result = await submitOcrDirectly(db, book);

          if (result.alreadyDone) {
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
            console.log(`  Already OCR'd: ${label}`);
          } else {
            await setPipelineStatus(db, book.id, 'ocr_submitted', {
              ocr_job_name: result.jobName,
              retry_count: 0,
            });
            log.ocr_submitted++;
            console.log(`  OCR submitted: ${label} — ${result.submitted} pages in ${result.childCount} batches`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          const msg = err.message || String(err);
          if (msg.includes('ALL_KEYS_QUOTA_EXHAUSTED')) {
            console.log(`  All Gemini keys quota exhausted — stopping OCR submissions`);
            log.errors.push('OCR: All API keys quota exhausted');
            break; // Stop trying more books
          } else if (msg.includes('image downloads failed')) {
            await setPipelineStatus(db, book.id, 'needs_attention', { error: msg });
            log.needs_attention++;
          } else if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `OCR submit: ${msg}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`OCR submit ${book.id}: ${msg}`);
        }
      }
      console.log(`  OCR submitted: ${log.ocr_submitted}, advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    if (shouldRun(3)) {
      console.log('\n--- Phase 3: OCR completion check ---');

      const ocrPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_job_id': 1, 'pipeline_auto.ocr_loop_count': 1 })
        .toArray();

      console.log(`  Books waiting for OCR: ${ocrPending.length}`);

      for (const book of ocrPending) {
        const jobName = book.pipeline_auto?.ocr_job_name;
        const jobId = book.pipeline_auto?.ocr_job_id;
        let isComplete = false;

        if (jobId) {
          const job = await db.collection('jobs').findOne({
            id: jobId,
            status: { $in: ['completed', 'completed_with_errors'] },
          });
          if (job) isComplete = true;
        } else if (jobName) {
          const batchJob = await db.collection('batch_jobs').findOne({
            book_id: book.id,
            type: 'ocr',
            $or: [{ job_name: jobName }, { gemini_job_name: jobName }],
            status: { $in: ['completed', 'saved', 'completed_with_errors'] },
          });
          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'ocr',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors'] },
              })
            : null;
          if (batchJob || parentJob) isComplete = true;
        }

        if (isComplete) {
          // Check for remaining un-OCR'd pages
          const remainingOcr = await db.collection('pages').countDocuments({
            book_id: book.id,
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } },
            ],
            $and: [{
              $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' },
              ],
            }],
          });

          if (remainingOcr > 0) {
            const loopCount = (book.pipeline_auto?.ocr_loop_count || 0) + 1;
            if (loopCount > MAX_RETRIES) {
              if (!DRY_RUN) {
                await setPipelineStatus(db, book.id, 'needs_attention', {
                  error: `OCR looped ${loopCount} times with ${remainingOcr} pages still un-OCR'd`,
                  ocr_loop_count: loopCount,
                });
              }
              log.needs_attention++;
              log.errors.push(`OCR circuit breaker ${book.id}: looped ${loopCount}x, ${remainingOcr} pages remaining`);
            } else {
              if (!DRY_RUN) {
                await setPipelineStatus(db, book.id, 'archive_complete', { ocr_loop_count: loopCount });
              }
              console.log(`  OCR loop ${loopCount} for ${book.title}: ${remainingOcr} pages remaining`);
            }
            log.ocr_advanced++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'ocr_complete');
            }
            log.ocr_advanced++;
            console.log(`  OCR complete: ${book.title}`);
          }
        }
      }
      console.log(`  OCR advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3.5: Metadata enrichment (ocr_complete -> metadata_enriched) ──
    if (shouldRun(3.5) || shouldRun(3)) {
      console.log('\n--- Phase 3.5: Metadata enrichment ---');

      const readyForMetadata = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1, 'ai_metadata.enriched_at': 1 })
        .limit(METADATA_ENRICH_LIMIT)
        .toArray();

      console.log(`  Books ready for metadata: ${readyForMetadata.length}`);

      for (const book of readyForMetadata) {
        try {
          if (book.ai_metadata?.enriched_at) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            }
            log.metadata_skipped++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would enrich metadata: ${book.title}`);
            continue;
          }

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/verify-metadata`, {
            method: 'POST',
            headers: headers(),
          });

          if (res.ok) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            log.metadata_enriched++;
          } else {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              // Non-blocking: skip on persistent failure
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
              log.metadata_skipped++;
            } else {
              await setPipelineStatus(db, book.id, 'ocr_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Metadata ${book.id}: HTTP ${res.status}`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
          }
          log.metadata_skipped++;
          log.errors.push(`Metadata ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Metadata enriched: ${log.metadata_enriched}, skipped: ${log.metadata_skipped}`);
    }

    // ── Phase 4: Submit translation (metadata_enriched -> translate_submitted) ──
    if (shouldRun(4)) {
      console.log('\n--- Phase 4: Translation submission ---');

      const readyForTranslate = await db.collection('books')
        .find({ 'pipeline_auto.status': 'metadata_enriched' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1 })
        .limit(TRANSLATE_SUBMIT_LIMIT)
        .toArray();

      console.log(`  Books ready for translation: ${readyForTranslate.length}`);

      for (const book of readyForTranslate) {
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          if (DRY_RUN) {
            console.log(`  Would submit translation: ${book.title} (${book.language})`);
            continue;
          }

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/batch-translate-async`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ limit: 500 }),
          });

          const text = await res.text();
          let data;
          try { data = JSON.parse(text); } catch {
            data = { error: `invalid JSON (${text.length} chars)` };
          }

          if (!res.ok) {
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate submit: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate submit ${book.id}: HTTP ${res.status}`);
          } else if (data.jobName) {
            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_name: data.jobName,
              retry_count: 0,
            });
            log.translate_submitted++;
            console.log(`  Translate submitted: ${book.title} -> ${data.jobName}`);
          } else if (data.processed === 0 || data.message?.includes('No pages need translation')) {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          } else {
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate unexpected: ${data.error || 'unknown'}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate submit ${book.id}: ${data.error || 'unexpected'}`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `Translate exception: ${err.message}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
          }
          log.errors.push(`Translate submit ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Translate submitted: ${log.translate_submitted}, advanced: ${log.translate_advanced}`);
    }

    // ── Phase 5: Check translation completion (translate_submitted -> translate_complete) ──
    if (shouldRun(5)) {
      console.log('\n--- Phase 5: Translation completion check ---');

      const translatePending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.translate_job_name': 1, 'pipeline_auto.translate_job_id': 1, 'pipeline_auto.translate_loop_count': 1 })
        .toArray();

      console.log(`  Books waiting for translation: ${translatePending.length}`);

      for (const book of translatePending) {
        const jobName = book.pipeline_auto?.translate_job_name;
        const jobId = book.pipeline_auto?.translate_job_id;
        let isComplete = false;

        if (jobId) {
          const job = await db.collection('jobs').findOne({
            id: jobId,
            status: { $in: ['completed', 'completed_with_errors'] },
          });
          if (job) isComplete = true;
        } else if (jobName) {
          const batchJob = await db.collection('batch_jobs').findOne({
            book_id: book.id,
            type: 'translation',
            $or: [{ job_name: jobName }, { gemini_job_name: jobName }],
            status: { $in: ['completed', 'saved', 'completed_with_errors'] },
          });
          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'translation',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors'] },
              })
            : null;
          if (batchJob || parentJob) isComplete = true;
        }

        if (isComplete) {
          const remainingTranslate = await db.collection('pages').countDocuments({
            book_id: book.id,
            'ocr.data': { $exists: true, $nin: [null, ''] },
            page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
            $or: [
              { 'translation.data': { $exists: false } },
              { 'translation.data': null },
              { 'translation.data': '' },
            ],
          });

          if (remainingTranslate > 0) {
            const tLoopCount = (book.pipeline_auto?.translate_loop_count || 0) + 1;
            if (tLoopCount > MAX_RETRIES) {
              if (!DRY_RUN) {
                await setPipelineStatus(db, book.id, 'needs_attention', {
                  error: `Translation looped ${tLoopCount} times with ${remainingTranslate} pages still untranslated`,
                  translate_loop_count: tLoopCount,
                });
              }
              log.needs_attention++;
              log.errors.push(`Translate circuit breaker ${book.id}: looped ${tLoopCount}x, ${remainingTranslate} remaining`);
            } else {
              if (!DRY_RUN) {
                await setPipelineStatus(db, book.id, 'metadata_enriched', { translate_loop_count: tLoopCount });
              }
              console.log(`  Translate loop ${tLoopCount} for ${book.title}: ${remainingTranslate} pages remaining`);
            }
            log.translate_advanced++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'translate_complete');
            }
            log.translate_advanced++;
            console.log(`  Translation complete: ${book.title}`);
          }
        }
      }
      console.log(`  Translation advanced: ${log.translate_advanced}`);
    }

    // ── Phase 6: Enrich — summary + index (translate_complete -> enriched) ──
    if (shouldRun(6)) {
      console.log('\n--- Phase 6: Enrichment (summary + index) ---');

      const readyForEnrich = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      console.log(`  Books ready for enrichment: ${readyForEnrich.length}`);

      for (const book of readyForEnrich) {
        try {
          if (DRY_RUN) {
            console.log(`  Would enrich: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'enriching');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
            method: 'GET',
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Enrich: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Enrich ${book.id}: HTTP ${res.status}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
          log.enriched++;
          console.log(`  Enriched: ${book.title}`);

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            // Non-critical — skip
            await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
            log.enriched++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`Enrich ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Enriched: ${log.enriched}`);
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    if (shouldRun(7)) {
      console.log('\n--- Phase 7: Chapter extraction ---');

      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'enriched' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(CHAPTER_LIMIT)
        .toArray();

      console.log(`  Books ready for chapters: ${readyForChapters.length}`);

      for (const book of readyForChapters) {
        try {
          if ((book.pages_count || 0) < 10) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            }
            log.chapters_skipped++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would extract chapters: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'chapters');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/extract-chapters`, {
            method: 'POST',
            headers: headers(),
          });

          if (res.ok) {
            await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            log.chapters_extracted++;
            console.log(`  Chapters extracted: ${book.title}`);
          } else {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              // Non-critical — skip
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
              log.chapters_skipped++;
            } else {
              await setPipelineStatus(db, book.id, 'enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Chapters ${book.id}: HTTP ${res.status}`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            }
            log.chapters_skipped++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'enriched', { retry_count: retries + 1 });
            }
          }
          log.errors.push(`Chapters ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Chapters extracted: ${log.chapters_extracted}, skipped: ${log.chapters_skipped}`);
    }

    // ── Phase 8: Image extraction (chapters_complete -> images_submitted/complete) ──
    if (shouldRun(8)) {
      console.log('\n--- Phase 8: Image extraction ---');

      const activeImageJobs = await db.collection('jobs').countDocuments({
        type: 'image_extraction',
        status: { $in: ['pending', 'processing'] },
      });
      console.log(`  Active image jobs: ${activeImageJobs}/${MAX_ACTIVE_IMAGE_JOBS}`);

      if (activeImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
        const readyForImages = await db.collection('books')
          .find({ 'pipeline_auto.status': 'chapters_complete' })
          .sort({ hidden: 1 })
          .project({ id: 1, title: 1 })
          .limit(IMAGE_SUBMIT_LIMIT)
          .toArray();

        console.log(`  Books ready for image extraction: ${readyForImages.length}`);

        for (const book of readyForImages) {
          try {
            if (DRY_RUN) {
              console.log(`  Would submit image extraction: ${book.title}`);
              continue;
            }

            // Use the queue-books API endpoint (needs SQS access)
            const res = await fetch(`${BASE_URL}/api/jobs/queue-books`, {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ bookIds: [book.id], action: 'image_extraction' }),
            });

            if (res.ok) {
              const data = await res.json();
              const jobId = data.jobs?.[0]?.jobId || data.jobId;
              await setPipelineStatus(db, book.id, 'images_submitted', {
                image_extraction_job_id: jobId,
              });
              log.images_submitted++;
              console.log(`  Image extraction submitted: ${book.title}`);
            } else {
              log.errors.push(`Images submit ${book.id}: HTTP ${res.status}`);
            }

            await sleep(API_DELAY_MS);
          } catch (err) {
            log.errors.push(`Images submit ${book.id}: ${err.message}`);
          }
        }
      }

      // Check completed image extraction jobs
      const imagesPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_submitted' })
        .project({ id: 1, 'pipeline_auto.image_extraction_job_id': 1 })
        .toArray();

      for (const book of imagesPending) {
        const imgJobId = book.pipeline_auto?.image_extraction_job_id;
        if (!imgJobId) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
          continue;
        }

        const imgJob = await db.collection('jobs').findOne({
          id: imgJobId,
          status: { $in: ['completed', 'completed_with_errors'] },
        });

        if (imgJob) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
        }
      }
      console.log(`  Images submitted: ${log.images_submitted}, advanced: ${log.images_advanced}`);
    }

    // ── Phase 8.5: Staleness detection ──
    if (shouldRun(8.5) || shouldRun(8)) {
      console.log('\n--- Phase 8.5: Staleness detection ---');

      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const staleBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted', 'enriching', 'chapters'] },
          'pipeline_auto.last_updated': { $lt: staleThreshold },
        })
        .project({ id: 1, title: 1, pipeline_auto: 1 })
        .limit(50)
        .toArray();

      console.log(`  Stale books: ${staleBooks.length}`);

      const rollbackMap = {
        'ocr_submitted': 'archive_complete',
        'translate_submitted': 'metadata_enriched',
        'images_submitted': 'chapters_complete',
        'enriching': 'translate_complete',
        'chapters': 'enriched',
      };

      for (const book of staleBooks) {
        const retries = book.pipeline_auto?.retry_count || 0;
        const status = book.pipeline_auto?.status;

        if (retries >= MAX_RETRIES) {
          if (!DRY_RUN) {
            await markFailed(db, book.id, `Stale in ${status} for >48h after ${retries} retries`, retries);
          }
          log.stale_failed++;
          console.log(`  Stale FAILED: ${book.title} (${status})`);
        } else {
          const rollbackTo = rollbackMap[status];
          if (rollbackTo && !DRY_RUN) {
            await setPipelineStatus(db, book.id, rollbackTo, { retry_count: retries + 1 });
          }
          log.stale_retried++;
          console.log(`  Stale RETRY: ${book.title} (${status} -> ${rollbackTo})`);
        }
        log.errors.push(`Stale ${book.id}: stuck in ${status}`);
      }
    }

    // ── Phase 9: Finalize (images_complete -> complete) ──
    if (shouldRun(9)) {
      console.log('\n--- Phase 9: Finalize ---');

      const readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, language: 1 })
        .limit(FINALIZE_LIMIT)
        .toArray();

      console.log(`  Books ready to finalize: ${readyToFinalize.length}`);

      for (const book of readyToFinalize) {
        const totalPages = book.pages_count || await db.collection('pages').countDocuments({ book_id: book.id });

        if (totalPages === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: 'Empty book: 0 pages. Likely a failed import.',
            });
          }
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id}: 0 pages`);
          continue;
        }

        const ocrCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: '', $not: { $eq: null } },
        });

        if (ocrCount === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'archive_complete', {
              error: 'Finalize blocked: 0 OCR pages. Resetting for re-processing.',
              retry_count: 0,
            });
          }
          log.errors.push(`Finalize blocked ${book.id}: 0/${totalPages} OCR pages`);
          continue;
        }

        const ocrPercent = ocrCount / totalPages;
        if (ocrPercent < 0.1) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Very low OCR coverage: ${ocrCount}/${totalPages} (${(ocrPercent * 100).toFixed(1)}%)`,
            });
          }
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id}: ${ocrCount}/${totalPages} OCR`);
          continue;
        }

        if (!DRY_RUN) {
          await setPipelineStatus(db, book.id, 'complete', { completed_at: new Date() });
        }
        log.finalized++;
        console.log(`  Finalized: ${book.title}`);
      }
      console.log(`  Finalized: ${log.finalized}`);
    }

    // ── Summary ──
    const duration = Date.now() - startTime;

    // Pipeline funnel snapshot
    const [facetResult] = await db.collection('books').aggregate([{
      $facet: {
        funnel: [
          { $match: { 'pipeline_auto.status': { $exists: true } } },
          { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
        ],
        totals: [{ $group: {
          _id: null,
          books: { $sum: 1 },
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        }}],
      },
    }]).toArray();

    const counts = Object.fromEntries((facetResult?.funnel || []).map(s => [s._id, s.count]));
    const totals = facetResult?.totals?.[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };

    console.log(`\n=== PIPELINE FUNNEL ===`);
    for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
    console.log(`\n=== PAGES ===`);
    console.log(`  Total: ${totals.pages} | OCR: ${totals.ocr} | Translated: ${totals.translated}`);

    console.log(`\n=== ACTIONS (${(duration / 1000).toFixed(0)}s) ===`);
    console.log(`  Enrolled: ${log.enrolled} | Archived: ${log.archived}`);
    console.log(`  OCR submitted: ${log.ocr_submitted} | OCR advanced: ${log.ocr_advanced}`);
    console.log(`  Metadata: ${log.metadata_enriched} enriched, ${log.metadata_skipped} skipped`);
    console.log(`  Translate submitted: ${log.translate_submitted} | Translate advanced: ${log.translate_advanced}`);
    console.log(`  Enriched: ${log.enriched} | Chapters: ${log.chapters_extracted} (${log.chapters_skipped} skipped)`);
    console.log(`  Images submitted: ${log.images_submitted} | Images advanced: ${log.images_advanced}`);
    console.log(`  Finalized: ${log.finalized} | Needs attention: ${log.needs_attention}`);
    console.log(`  Stale retried: ${log.stale_retried} | Stale failed: ${log.stale_failed}`);
    if (log.errors.length > 0) {
      console.log(`  Errors (${log.errors.length}):`);
      for (const err of log.errors.slice(0, 30)) {
        console.log(`    - ${err}`);
      }
    }

    // Write cron_runs + pipeline_snapshots
    if (!DRY_RUN) {
      const activeBatch = await db.collection('batch_jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: { $ifNull: ['$page_count', 0] } } } },
      ]).toArray();
      const batchByType = Object.fromEntries(activeBatch.map(b => [b._id, { count: b.count, pages: b.pages }]));

      await Promise.allSettled([
        db.collection('pipeline_snapshots').insertOne({
          timestamp: new Date(),
          funnel: counts,
          pages: { total: totals.pages, ocr: totals.ocr, translated: totals.translated },
          books: totals.books,
          active_batch: batchByType,
          source: 'hetzner-worker',
        }),
        db.collection('cron_runs').insertOne({
          cron: 'pipeline-orchestrator-worker',
          timestamp: new Date(),
          duration_ms: duration,
          status: log.errors.length > 0 ? 'partial' : 'success',
          failed: false,
          actions: {
            enrolled: log.enrolled,
            archived: log.archived,
            ocr_submitted: log.ocr_submitted,
            ocr_advanced: log.ocr_advanced,
            metadata_enriched: log.metadata_enriched,
            metadata_skipped: log.metadata_skipped,
            translate_submitted: log.translate_submitted,
            translate_advanced: log.translate_advanced,
            enriched: log.enriched,
            chapters_extracted: log.chapters_extracted,
            chapters_skipped: log.chapters_skipped,
            images_submitted: log.images_submitted,
            images_advanced: log.images_advanced,
            finalized: log.finalized,
            needs_attention: log.needs_attention,
            stale_retried: log.stale_retried,
            stale_failed: log.stale_failed,
          },
          errors: log.errors.slice(0, 50).map(msg => ({ message: msg, timestamp: new Date() })),
          error_count: log.errors.length,
          summary: `E:${log.enrolled} A:${log.archived} O:${log.ocr_submitted}/${log.ocr_advanced} M:${log.metadata_enriched} T:${log.translate_submitted}/${log.translate_advanced} R:${log.enriched} C:${log.chapters_extracted} I:${log.images_submitted}/${log.images_advanced} F:${log.finalized}`,
        }),
      ]);
    }

    await client.close();
  } catch (error) {
    console.error('[pipeline-orchestrator] Fatal error:', error);

    // Write failure record
    try {
      await db.collection('cron_runs').insertOne({
        cron: 'pipeline-orchestrator-worker',
        timestamp: new Date(),
        duration_ms: Date.now() - startTime,
        status: 'failed',
        failed: true,
        actions: log,
        errors: [{ message: error.message || 'Unknown error', timestamp: new Date() }],
        error_count: 1,
        summary: `FAILED: ${error.message}`,
      });
    } catch (_) { /* best effort */ }

    await client.close();
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
