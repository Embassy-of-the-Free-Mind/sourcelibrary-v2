#!/usr/bin/env node
/**
 * Collect results from completed Gemini Batch API jobs.
 * Runs locally with no timeout (unlike the Vercel cron).
 *
 * Usage:
 *   secret-lover run -- node scripts/collect-batch-results.mjs [--limit N] [--concurrency N]
 */

import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { findHumanEditedPageIds } from '../lib/translate-core.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { extractPageType, extractColumns, parseMultiPageOcr, parseDetectedImages } from '../lib/ocr-result-parse.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Try all available keys (batch jobs are only visible to the key that created them)
const ALL_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY,
].filter(Boolean);

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (ALL_KEYS.length === 0) { console.error('No GEMINI_API_KEY* set'); process.exit(1); }
console.log(`API keys available: ${ALL_KEYS.length}`);

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 10;
// Gemini discards batch output a couple of days after a job finishes. A job still
// uncollected weeks later is not "pending", it is unrecoverable — but it matched the
// selection query on every run, so each pass burned a lookup on it and reported it as
// an error. With the collector on a cron that meant a permanently red log, which is
// worse than useless: it hides a real failure among 22 that will never clear.
// --abandon-stale=N marks anything older than N days as given up on, with provenance.
const abandonArg = args.find(a => a.startsWith('--abandon-stale='));
const ABANDON_STALE_DAYS = abandonArg ? parseInt(abandonArg.split('=')[1], 10) : null;
const DRY_RUN = args.includes('--dry-run');

// --- OCR metadata extraction: shared with defaults.ts via scripts/lib/ocr-result-parse.mjs (#4443) ---

/** Check if this page is a digitizer insert — via OCR tag, body-text, or meta-descriptor fallback. */
function isDigitizerPage(pageType, ocrText) {
  if (pageType === 'digitizer-insert') return true;
  if (!ocrText) return false;
  // Body text: full Google "About this book" or IA credit boilerplate (not just a watermark mention)
  const bodyText = ocrText.replace(/<meta>[\s\S]*?<\/meta>/g, '');
  if (/this is a digital copy of a book|reproduction of a library book that was digitized|digitized by google as part of an ongoing/i.test(bodyText)) return true;
  if (/inserted by the internet archive|Digitized by the Internet Archive in \d{4}/i.test(bodyText)) return true;
  // Meta descriptor: the OCR model sometimes correctly identifies the page as a credit in <meta> but mislabels page-type.
  const metaText = ocrText.match(/<meta>[\s\S]*?<\/meta>/gi)?.join(' ') || '';
  if (/digitization credit from the Internet Archive|Google Books digital preservation notice|digital preservation notice/i.test(metaText)) return true;
  return false;
}

// `parseDetectedImages` now comes from scripts/lib/ocr-result-parse.mjs (#4456).
// The local copy walked `<image>` sub-tags, which no OCR prompt in this repo has
// ever asked for — the prompt asks for a JSON array — so it returned [] on every
// page, and the `length > 0` guard below turned that into silence.

// --- Gemini API ---
async function getJobData(jobName) {
  let lastError = '';
  for (const key of ALL_KEYS) {
    try {
      const url = `${GEMINI_API_BASE}/${jobName}?key=${key}`;
      const resp = await fetch(url);
      if (resp.ok) return { data: await resp.json(), key };
      const errText = await resp.text();
      if (resp.status === 404 || errText.includes('not found')) continue;
      lastError = `${resp.status}: ${errText.slice(0, 100)}`;
      // Try next key (might be a key-specific error)
    } catch (e) {
      lastError = e.message;
    }
  }
  return null; // Not found with any key
}

function getJobState(geminiData) {
  return geminiData.metadata?.state || geminiData.state || 'UNKNOWN';
}

async function extractResults(geminiData, apiKey) {
  // File-based output (current Gemini API format)
  if (geminiData.metadata?.output?.responsesFile) {
    const fileName = geminiData.metadata.output.responsesFile;
    const fileResp = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`
    );
    if (!fileResp.ok) throw new Error(`Failed to download results file: ${await fileResp.text()}`);
    const text = await fileResp.text();
    return text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  // Legacy file-based output
  if (geminiData.metadata?.destFile) {
    const fileName = geminiData.metadata.destFile;
    const fileResp = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`
    );
    if (!fileResp.ok) throw new Error(`Failed to download results file: ${await fileResp.text()}`);
    const text = await fileResp.text();
    return text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  // Inline responses
  if (geminiData.metadata?.output?.inlinedResponses?.inlinedResponses) {
    return geminiData.metadata.output.inlinedResponses.inlinedResponses;
  }
  if (geminiData.response?.inlinedResponses) {
    return geminiData.response.inlinedResponses;
  }
  if (geminiData.dest?.inlinedResponses) {
    return geminiData.dest.inlinedResponses;
  }
  return [];
}

// --- Process one job ---
// Type allowlist (#3725): the save path treats anything that isn't
// 'ocr'/'image_extraction' as a translation, so a typo'd type on a new
// submitter would silently write model output into translation.data.
const KNOWN_JOB_TYPES = new Set(['ocr', 'translation', 'translate', 'image_extraction']);

async function processOneJob(db, job) {
  if (!KNOWN_JOB_TYPES.has(job.type)) {
    console.error(`  UNKNOWN job type '${job.type}' on ${job.id || job._id} — refusing to collect; marking failed for human triage.`);
    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      { $set: { status: 'failed', error: `unknown job type '${job.type}' — collector allowlist refused (#3725)`, updated_at: new Date() } }
    );
    return { status: 'unknown_type' };
  }
  const jobName = job.job_name || job.gemini_job_name;
  if (!jobName) return { status: 'skipped' };

  const result = await getJobData(jobName);
  if (!result) return { status: 'not_found' };
  const { data: geminiData, key: workingKey } = result;
  const state = getJobState(geminiData);

  if (state === 'JOB_STATE_SUCCEEDED' || state === 'BATCH_STATE_SUCCEEDED' || state === 'SUCCEEDED') {
    const responses = await extractResults(geminiData, workingKey);
    let successCount = 0;
    let failCount = 0;
    const now = new Date();
    const jobIdStr = job.id || String(job._id);
    const isMultiPage = (job.pages_per_request || 1) > 1;

    // Build flat list of { pageId, text, usage }
    const pageResults = [];

    if (isMultiPage && job.type === 'ocr') {
      // Multi-page OCR: parse <page id="...">...</page> blocks from each response
      for (const result of responses) {
        if (result.error) { failCount++; continue; }
        const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        const usage = result.response?.usageMetadata;
        const parsed = parseMultiPageOcr(text, { lenient: true });
        for (const [pageId, ocrText] of parsed) {
          pageResults.push({ pageId, text: ocrText, usage });
        }
      }
    } else {
      for (let idx = 0; idx < responses.length; idx++) {
        const result = responses[idx];
        const pageId = result.metadata?.key || (job.page_ids && job.page_ids[idx]);
        if (!pageId) { failCount++; continue; }
        const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        pageResults.push({ pageId, text, usage: result.response?.usageMetadata });
      }
    }

    // Human-edit guard (#3749): pages whose ocr/translation was written or
    // corrected by a person (source 'manual' or edited_by) are protected —
    // batch results submitted before the edit must not clobber them.
    const guardField = job.type === 'ocr' ? 'ocr' : 'translation';
    const humanEditedIds = await findHumanEditedPageIds(db, pageResults.map(r => r.pageId), guardField);
    let protectedCount = 0;

    // First pass: fix null ocr/translation subdocuments
    const nullFixOps = [];
    for (const { pageId } of pageResults) {
      if (job.type === 'ocr') {
        nullFixOps.push({ updateOne: { filter: { id: pageId, ocr: null }, update: { $set: { ocr: {} } } } });
      } else {
        nullFixOps.push({ updateOne: { filter: { id: pageId, translation: null }, update: { $set: { translation: {} } } } });
      }
    }
    if (nullFixOps.length > 0) {
      await db.collection('pages').bulkWrite(nullFixOps, { ordered: false });
    }

    // Second pass: save results
    const bulkOps = [];
    for (const { pageId, text, usage } of pageResults) {
      if (humanEditedIds.has(pageId)) {
        console.log(`  PROTECTED: page ${pageId} has a human-edited ${guardField} — skipping (#3749)`);
        protectedCount++;
        continue;
      }
      if (text.length > 25000) { failCount++; continue; }

      if (job.type === 'ocr') {
        const pageType = extractPageType(text, { validate: false });
        const columns = extractColumns(text);
        const detectedImages = parseDetectedImages(text);

        const setObj = {
          'ocr.data': text,
          // The model's own <warning> tag is a quality sensor that went unread
          // for months (false-split incident) — stamp it at write time so the
          // nightly snapshot can count it and repair lanes can query it.
          'ocr.has_warning': /<warning[\s>]/i.test(text),
          'ocr.updated_at': now,
          'ocr.model': job.model,
          'ocr.language': job.language,
          'ocr.source': 'batch_api',
          'ocr.prompt_version': job.prompt_version || 'v4.2026-02',
          'ocr.batch_job_id': jobIdStr,
          'ocr.input_tokens': usage?.promptTokenCount || 0,
          'ocr.output_tokens': usage?.candidatesTokenCount || 0,
          updated_at: now,
        };
        if (isMultiPage) setObj['ocr.pages_per_request'] = job.pages_per_request;
        // Trust the OCR model's page-type classification, with body-text fallback
        if (isDigitizerPage(pageType, text)) {
          setObj.page_type = 'digitizer-insert';
          setObj.hidden = true;
        } else if (pageType) {
          setObj.page_type = pageType;
        }
        if (columns) setObj.columns = columns;
        if (detectedImages.length > 0) setObj.detected_images = detectedImages;

        bulkOps.push({ updateOne: { filter: { id: pageId }, update: { $set: setObj } } });
      } else {
        bulkOps.push({
          updateOne: {
            filter: { id: pageId },
            update: {
              $set: {
                'translation.data': text,
                'translation.updated_at': now,
                'translation.model': job.model,
                'translation.source_language': job.language,
                'translation.target_language': 'English',
                'translation.source': 'batch_api',
                'translation.prompt_version': job.prompt_version || 'v4.2026-02',
                'translation.batch_job_id': jobIdStr,
                'translation.input_tokens': usage?.promptTokenCount || 0,
                'translation.output_tokens': usage?.candidatesTokenCount || 0,
                updated_at: now,
              },
            },
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      // Retain any existing content as a revision before overwriting (#3240).
      // No-op for pages getting their first OCR/translation.
      await saveRevisionsBeforeOverwrite(
        db,
        bulkOps.map(op => op.updateOne.filter.id),
        job.type === 'ocr' ? 'ocr' : 'translation',
        { jobId: jobIdStr, reason: job.type === 'ocr' ? 'reocr_batch' : 'retranslate_batch' }
      );
      const bulkResult = await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
      successCount = bulkResult.matchedCount;
      failCount += (bulkOps.length - bulkResult.matchedCount);
    }

    // Update job status using _id (not id — pipeline cron creates records with only _id)
    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'saved',
          gemini_state: 'JOB_STATE_SUCCEEDED',
          completed_pages: successCount,
          failed_pages: failCount,
          ...(protectedCount > 0 && { protected_pages: protectedCount }),
          results_collected: true,
          completed_at: now,
          updated_at: now,
        },
      }
    );

    return { status: 'collected', successCount, failCount, bookId: job.book_id, parentJobId: job.parent_job_id };

  } else if (['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'BATCH_STATE_PENDING', 'BATCH_STATE_RUNNING'].includes(state)) {
    return { status: 'pending' };
  } else if (['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED', 'BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED'].includes(state)) {
    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      { $set: { status: 'failed', gemini_state: state, updated_at: new Date() } }
    );
    return { status: 'failed', state };
  } else {
    return { status: 'unknown', state };
  }
}

// --- Main ---
/**
 * Mark jobs older than `days` as abandoned so the collector stops retrying them.
 *
 * Never deletes: sets a flag plus the reason and the status it had, so the decision is
 * auditable and reversible with a single $unset. Only touches jobs the collector would
 * otherwise select — a job already collected is left alone.
 */
async function abandonStaleJobs(db, days) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const filter = {
    child_job_ids: { $exists: false },
    collection_abandoned: { $ne: true },
    created_at: { $lt: cutoff },
    $or: [
      { status: { $in: ['pending', 'processing', 'completed', 'completed_with_errors', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] }, results_collected: { $ne: true } },
      { status: 'saved', completed_pages: 0 },
    ],
  };
  const stale = await db.collection('batch_jobs').countDocuments(filter);
  if (stale === 0) { console.log(`No jobs older than ${days}d to abandon.`); return; }
  if (DRY_RUN) { console.log(`[dry-run] would abandon ${stale} job(s) older than ${days}d`); return; }
  const res = await db.collection('batch_jobs').updateMany(filter, [
    {
      $set: {
        collection_abandoned: true,
        collection_abandoned_at: new Date(),
        collection_abandoned_reason: `uncollected after ${days}d — Gemini batch output has expired`,
        status_before_abandon: '$status',
      },
    },
  ]);
  console.log(`Abandoned ${res.modifiedCount} stale job(s) older than ${days}d (reversible: $unset collection_abandoned).`);
}

async function run() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Pick up jobs needing collection:
  // 1. pending/processing — not yet checked with Gemini
  // 2. completed/completed_with_errors — parent set status but results not collected
  // 3. saved with 0 pages — broken by metadata.key bug
  // Exclude parent jobs (child_job_ids exists) — they don't have Gemini results
  // Exclude jobs explicitly given up on (see --abandon-stale) — their output has
  // expired at Gemini and retrying them only manufactures errors.
  if (ABANDON_STALE_DAYS != null) await abandonStaleJobs(db, ABANDON_STALE_DAYS);

  const pendingJobs = await db.collection('batch_jobs')
    .find({
      child_job_ids: { $exists: false },
      collection_abandoned: { $ne: true },
      $or: [
        {
          status: { $in: ['pending', 'processing', 'completed', 'completed_with_errors', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
          results_collected: { $ne: true },
          $or: [
            { job_name: { $exists: true, $nin: [null, ''] } },
            { gemini_job_name: { $exists: true, $nin: [null, ''] } }
          ]
        },
        {
          status: 'saved',
          completed_pages: 0,
          $or: [
            { job_name: { $exists: true, $nin: [null, ''] } },
            { gemini_job_name: { $exists: true, $nin: [null, ''] } }
          ]
        }
      ]
    })
    .toArray();

  const jobsToProcess = pendingJobs.slice(0, Math.min(pendingJobs.length, LIMIT));
  console.log(`Found ${pendingJobs.length} jobs, processing ${jobsToProcess.length} with concurrency ${CONCURRENCY}\n`);

  let collected = 0;
  let errors = 0;
  let stillPending = 0;
  let totalPagesSaved = 0;
  const bookIdsToUpdate = new Set();
  const parentIdsToUpdate = new Set();
  const startTime = Date.now();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < jobsToProcess.length; i += CONCURRENCY) {
    const batch = jobsToProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(job => processOneJob(db, job))
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'rejected') {
        errors++;
        if (errors <= 10) console.error(`Error: ${r.reason?.message || r.reason}`);
        continue;
      }
      const val = r.value;
      if (val.status === 'collected') {
        collected++;
        totalPagesSaved += val.successCount;
        if (val.bookId) bookIdsToUpdate.add(val.bookId);
        if (val.parentJobId) parentIdsToUpdate.add(val.parentJobId);
      } else if (val.status === 'pending') {
        stillPending++;
      } else if (val.status === 'not_found') {
        errors++;
      } else if (val.status === 'failed') {
        errors++;
        if (errors <= 10) console.log(`  Job failed with state: ${val.state}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const processed = Math.min(i + CONCURRENCY, jobsToProcess.length);
    const rate = (collected / (elapsed || 1)).toFixed(1);
    console.log(`[${processed}/${jobsToProcess.length}] Collected: ${collected} (${totalPagesSaved} pages) | Pending: ${stillPending} | Errors: ${errors} | ${elapsed}s | ${rate} jobs/s`);
  }

  // Update book counts and parent progress (deduplicated)
  console.log(`\nUpdating ${bookIdsToUpdate.size} book counts and ${parentIdsToUpdate.size} parent jobs...`);

  for (const bookId of bookIdsToUpdate) {
    try {
      await updateBookCounts(db, bookId);
    } catch (e) {
      console.error(`Error updating book ${bookId}: ${e.message}`);
    }
  }

  for (const parentId of parentIdsToUpdate) {
    try {
      await updateParentJobProgress(db, parentId);
    } catch (e) {
      console.error(`Error updating parent ${parentId}: ${e.message}`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Jobs collected: ${collected}`);
  console.log(`Pages saved: ${totalPagesSaved}`);
  console.log(`Still pending: ${stillPending}`);
  console.log(`Errors: ${errors}`);
  console.log(`Books updated: ${bookIdsToUpdate.size}`);
  console.log(`Total time: ${totalElapsed}s`);

  await client.close();
}

async function updateParentJobProgress(db, parentJobId) {
  // Try both id and _id since parent jobs may use either
  const parent = await db.collection('batch_jobs').findOne({
    $or: [{ id: parentJobId }, { _id: parentJobId }]
  });
  if (!parent || !parent.child_job_ids) return;

  const children = await db.collection('batch_jobs')
    .find({ $or: [
      { id: { $in: parent.child_job_ids } },
      { _id: { $in: parent.child_job_ids } }
    ]})
    .toArray();

  const progress = { completed: 0, failed: 0, pending: 0, total: parent.total_pages };
  let allChildrenDone = true;
  let anyChildFailed = false;

  for (const child of children) {
    const childIsDone = ['saved', 'completed', 'failed'].includes(child.status);
    if (!childIsDone) allChildrenDone = false;
    if (child.status === 'saved' || child.status === 'completed') {
      progress.completed += child.page_count || 0;
    } else if (child.status === 'failed') {
      progress.failed += child.page_count || 0;
      anyChildFailed = true;
    } else {
      progress.pending += child.page_count || 0;
    }
  }

  let parentStatus;
  if (allChildrenDone) {
    parentStatus = anyChildFailed || progress.failed > 0 ? 'completed_with_errors' : 'completed';
  } else {
    parentStatus = progress.completed > 0 ? 'processing' : 'pending';
  }

  const update = { progress, status: parentStatus, updated_at: new Date() };
  if (allChildrenDone && !parent.completed_at) update.completed_at = new Date();

  await db.collection('batch_jobs').updateOne({ _id: parent._id }, { $set: update });

  if (allChildrenDone && parent.book_id) {
    await db.collection('books').updateOne(
      { id: parent.book_id },
      { $unset: { job: '' } }
    );
  }
}

async function updateBookCounts(db, bookId) {
  // Count VISIBLE pages only (page_number > 0) — see scripts/lib/page-counts.mjs
  // and issue #3293. Soft-hidden pages never render and must not inflate counts.
  const [counts] = await db.collection('pages')
    .aggregate(buildVisiblePageCountPipeline(bookId)).toArray();

  if (counts) {
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages_count: counts.total,
          pages_ocr: counts.with_ocr,
          pages_translated: counts.with_translation,
          updated_at: new Date(),
        },
      }
    );
  }
}

run().catch(err => { console.error(err); process.exit(1); });
