#!/usr/bin/env node
/**
 * Batch Collector Worker
 *
 * Replaces the Vercel `process-batches` cron. Collects ALL pending Gemini Batch API
 * results with no time limit. Designed to run every 10 minutes on Hetzner via crontab.
 *
 * Key improvements over the Vercel cron:
 *   - No 270s time budget — processes ALL pending jobs per run
 *   - Updates pipeline_auto status on completion (ocr_submitted -> ocr_complete, etc.)
 *   - Logs to cron_runs collection for observability
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/batch-collector.mjs
 *   node scripts/workers/batch-collector.mjs --dry-run
 *   node scripts/workers/batch-collector.mjs --limit 50 --concurrency 5
 */

import { MongoClient } from 'mongodb';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALL_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY,
].filter(Boolean);

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (ALL_KEYS.length === 0) { console.error('No GEMINI_API_KEY* set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 10;
const HALLUCINATION_LIMIT = 25_000;

console.log(`[batch-collector] Keys: ${ALL_KEYS.length} | Concurrency: ${CONCURRENCY} | Dry run: ${DRY_RUN}`);

// ── OCR metadata extraction (mirrors defaults.ts) ──

function extractPageType(text) {
  const match = text.match(/<page-type>\s*(.*?)\s*<\/page-type>/i);
  if (!match) return null;
  const type = match[1].toLowerCase().trim();
  const valid = new Set([
    'title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index',
    'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text',
  ]);
  return valid.has(type) ? type : null;
}

function extractColumns(text) {
  const match = text.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= 2 ? n : null;
}

function parseDetectedImages(text) {
  const match = text.match(/<detected-images>([\s\S]*?)<\/detected-images>/);
  if (!match) return [];
  const imagesText = match[1].trim();
  const images = [];
  const imgRegex = /<image>([\s\S]*?)<\/image>/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(imagesText)) !== null) {
    const imgContent = imgMatch[1];
    const getTag = (tag) => {
      const m = imgContent.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].trim() : null;
    };
    const bbox = getTag('bbox');
    const image = {
      type: getTag('type') || 'illustration',
      description: getTag('description') || '',
      subject: getTag('subject')?.split(',').map(s => s.trim()).filter(Boolean) || [],
    };
    if (bbox) {
      const coords = bbox.split(',').map(Number);
      if (coords.length === 4) {
        image.bbox = { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
      }
    }
    images.push(image);
  }
  return images;
}

function parseMultiPageOcr(text) {
  const results = new Map();
  const regex = /<page\s+id="([^"]+)">([\s\S]*?)(?=<page\s+id="|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const pageId = match[1];
    let content = match[2].trim();
    content = content.replace(/<\/page>\s*$/, '').trim();
    if (content) results.set(pageId, content);
  }
  return results;
}

// ── Gemini API ──

async function getJobData(jobName) {
  for (const key of ALL_KEYS) {
    try {
      const url = `${GEMINI_API_BASE}/${jobName}?key=${key}`;
      const resp = await fetch(url);
      if (resp.ok) return { data: await resp.json(), key };
      const errText = await resp.text();
      if (resp.status === 404 || errText.includes('not found')) continue;
    } catch (_) { /* try next key */ }
  }
  return null;
}

function getJobState(geminiData) {
  return geminiData.metadata?.state || geminiData.state || 'UNKNOWN';
}

function normalizeState(state) {
  const map = {
    'BATCH_STATE_SUCCEEDED': 'JOB_STATE_SUCCEEDED',
    'BATCH_STATE_PENDING': 'JOB_STATE_PENDING',
    'BATCH_STATE_RUNNING': 'JOB_STATE_RUNNING',
    'BATCH_STATE_FAILED': 'JOB_STATE_FAILED',
    'BATCH_STATE_CANCELLED': 'JOB_STATE_CANCELLED',
    'SUCCEEDED': 'JOB_STATE_SUCCEEDED',
    'PENDING': 'JOB_STATE_PENDING',
    'RUNNING': 'JOB_STATE_RUNNING',
    'FAILED': 'JOB_STATE_FAILED',
    'CANCELLED': 'JOB_STATE_CANCELLED',
  };
  return map[state] || state;
}

async function extractResults(geminiData, apiKey) {
  // File-based output
  const responsesFile = geminiData.metadata?.output?.responsesFile || geminiData.metadata?.destFile;
  if (responsesFile) {
    const fileResp = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${responsesFile}:download?alt=media&key=${apiKey}`
    );
    if (!fileResp.ok) throw new Error(`Failed to download results file: ${await fileResp.text()}`);
    const text = await fileResp.text();
    return text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  // Inline responses (check multiple possible locations)
  const inline =
    geminiData.metadata?.output?.inlinedResponses?.inlinedResponses ||
    geminiData.response?.inlinedResponses ||
    geminiData.dest?.inlinedResponses;
  return inline || [];
}

// ── Process one job ──

async function processOneJob(db, job) {
  const jobName = job.job_name || job.gemini_job_name;
  if (!jobName) return { status: 'skipped' };

  const result = await getJobData(jobName);
  if (!result) return { status: 'not_found', jobName };
  const { data: geminiData, key: workingKey } = result;
  const rawState = getJobState(geminiData);
  const state = normalizeState(rawState);

  if (state === 'JOB_STATE_SUCCEEDED') {
    if (DRY_RUN) return { status: 'would_collect', bookId: job.book_id };

    const responses = await extractResults(geminiData, workingKey);
    let successCount = 0;
    let failCount = 0;
    const now = new Date();
    const jobIdStr = job.id || String(job._id);
    const isMultiPage = (job.pages_per_request || 1) > 1;

    // Build flat list of { pageId, text, usage }
    const pageResults = [];

    let recitationCount = 0;

    if (isMultiPage && job.type === 'ocr') {
      for (const r of responses) {
        if (r.error) { failCount++; continue; }
        const candidate = r.response?.candidates?.[0];
        if (candidate?.finishReason === 'RECITATION') { recitationCount++; failCount++; continue; }
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        const usage = r.response?.usageMetadata;
        const parsed = parseMultiPageOcr(text);
        for (const [pageId, ocrText] of parsed) {
          pageResults.push({ pageId, text: ocrText, usage });
        }
      }
    } else {
      for (let idx = 0; idx < responses.length; idx++) {
        const r = responses[idx];
        const pageId = r.metadata?.key || (job.page_ids && job.page_ids[idx]);
        if (!pageId) { failCount++; continue; }
        const candidate = r.response?.candidates?.[0];
        if (candidate?.finishReason === 'RECITATION') { recitationCount++; failCount++; continue; }
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        pageResults.push({ pageId, text, usage: r.response?.usageMetadata });
      }
    }

    if (recitationCount > 0) {
      console.log(`  RECITATION: ${recitationCount}/${responses.length} responses blocked (book: ${job.book_id})`);
    }

    // First pass: fix null ocr/translation subdocuments
    const nullFixOps = pageResults.map(({ pageId }) => ({
      updateOne: {
        filter: { id: pageId, [job.type === 'ocr' ? 'ocr' : 'translation']: null },
        update: { $set: { [job.type === 'ocr' ? 'ocr' : 'translation']: {} } },
      },
    }));
    if (nullFixOps.length > 0) {
      await db.collection('pages').bulkWrite(nullFixOps, { ordered: false });
    }

    // Second pass: save results
    const bulkOps = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const { pageId, text, usage } of pageResults) {
      if (text.length > HALLUCINATION_LIMIT) { failCount++; continue; }

      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      if (job.type === 'ocr') {
        const pageType = extractPageType(text);
        const columns = extractColumns(text);
        const detectedImages = parseDetectedImages(text);

        const setObj = {
          'ocr.data': text,
          'ocr.updated_at': now,
          'ocr.model': job.model,
          'ocr.language': job.language,
          'ocr.source': 'batch_api',
          'ocr.prompt_version': job.prompt_version || 'v5.2026-02',
          'ocr.batch_job_id': jobIdStr,
          'ocr.input_tokens': inputTokens,
          'ocr.output_tokens': outputTokens,
          updated_at: now,
        };
        if (isMultiPage) setObj['ocr.pages_per_request'] = job.pages_per_request;
        if (pageType) setObj.page_type = pageType;
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
                'translation.prompt_version': job.prompt_version || 'v5.2026-02',
                'translation.batch_job_id': jobIdStr,
                'translation.input_tokens': inputTokens,
                'translation.output_tokens': outputTokens,
                updated_at: now,
              },
            },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      const bulkResult = await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
      successCount = bulkResult.matchedCount;
      failCount += (bulkOps.length - bulkResult.matchedCount);
    }

    // Update batch_jobs status — mark as 'failed' if zero pages saved
    const finalStatus = successCount > 0 ? 'saved' : 'failed';
    const errorDetail = successCount === 0 && recitationCount > 0
      ? `All ${recitationCount} pages blocked by RECITATION filter`
      : successCount === 0 ? `All ${failCount} pages failed` : undefined;

    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: finalStatus,
          gemini_state: 'JOB_STATE_SUCCEEDED',
          completed_pages: successCount,
          failed_pages: failCount,
          results_collected: true,
          completed_at: now,
          updated_at: now,
          ...(errorDetail && { error: errorDetail }),
        },
      }
    );

    // Log to gemini_usage
    await db.collection('gemini_usage').insertOne({
      type: job.type === 'ocr' ? 'ocr' : 'translation',
      mode: 'batch',
      model: job.model,
      book_id: job.book_id,
      page_count: successCount,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      status: 'success',
      batch_job_id: jobIdStr,
      timestamp: now,
    }).catch(() => {}); // non-blocking

    return {
      status: 'collected',
      successCount,
      failCount,
      recitationCount,
      bookId: job.book_id,
      parentJobId: job.parent_job_id,
      type: job.type,
    };

  } else if (state === 'JOB_STATE_PENDING' || state === 'JOB_STATE_RUNNING') {
    // Update status to reflect current state
    const newStatus = state === 'JOB_STATE_RUNNING' ? 'processing' : 'pending';
    if (job.status !== newStatus) {
      await db.collection('batch_jobs').updateOne(
        { _id: job._id },
        { $set: { status: newStatus, gemini_state: state, updated_at: new Date() } }
      );
    }
    return { status: 'pending', state };

  } else {
    // Failed / cancelled / expired
    if (!DRY_RUN) {
      await db.collection('batch_jobs').updateOne(
        { _id: job._id },
        { $set: { status: 'failed', gemini_state: state, error: `Gemini state: ${rawState}`, updated_at: new Date() } }
      );
    }
    return { status: 'failed', state: rawState, bookId: job.book_id, type: job.type };
  }
}

// ── Post-processing ──

async function updateBookCounts(db, bookId) {
  const [counts] = await db.collection('pages').aggregate([
    { $match: { book_id: bookId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        with_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] },
              ]},
              1, 0,
            ],
          },
        },
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] },
              ]},
              1, 0,
            ],
          },
        },
      },
    },
  ]).toArray();

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

async function updateParentJobProgress(db, parentJobId) {
  const parent = await db.collection('batch_jobs').findOne({
    $or: [{ id: parentJobId }, { _id: parentJobId }],
  });
  if (!parent || !parent.child_job_ids) return;

  const children = await db.collection('batch_jobs')
    .find({
      $or: [
        { id: { $in: parent.child_job_ids } },
        { _id: { $in: parent.child_job_ids } },
      ],
    })
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

/**
 * Update pipeline_auto status when batch jobs complete.
 * Transitions: ocr_submitted -> ocr_complete, translate_submitted -> translate_complete
 */
async function advancePipelineStatus(db, bookId, jobType) {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { 'pipeline_auto.status': 1 } }
  );
  if (!book?.pipeline_auto?.status) return;

  const status = book.pipeline_auto.status;

  if (jobType === 'ocr' && status === 'ocr_submitted') {
    // Check if ALL OCR batch jobs for this book are done
    const pendingOcr = await db.collection('batch_jobs').countDocuments({
      book_id: bookId,
      type: 'ocr',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (pendingOcr === 0) {
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            'pipeline_auto.status': 'ocr_complete',
            'pipeline_auto.last_updated': new Date(),
            updated_at: new Date(),
          },
        }
      );
      console.log(`  Pipeline: ${bookId} ocr_submitted -> ocr_complete`);
    }
  }

  if (jobType === 'translation' && status === 'translate_submitted') {
    const pendingTranslate = await db.collection('batch_jobs').countDocuments({
      book_id: bookId,
      type: 'translation',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (pendingTranslate === 0) {
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            'pipeline_auto.status': 'translate_complete',
            'pipeline_auto.last_updated': new Date(),
            updated_at: new Date(),
          },
        }
      );
      console.log(`  Pipeline: ${bookId} translate_submitted -> translate_complete`);
    }
  }
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find all pending/processing batch jobs
  const pendingJobs = await db.collection('batch_jobs')
    .find({
      $or: [
        {
          status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
          $or: [
            { job_name: { $exists: true, $nin: [null, ''] } },
            { gemini_job_name: { $exists: true, $nin: [null, ''] } },
          ],
        },
        {
          // Recovery: pick up "saved" jobs with 0 completed AND 0 failed pages
          // (metadata.key bug). Jobs with failed_pages > 0 already ran but all
          // pages failed (e.g. RECITATION filter) — don't retry them endlessly.
          $and: [
            { status: 'saved' },
            { completed_pages: 0 },
            { $or: [{ failed_pages: 0 }, { failed_pages: { $exists: false } }] },
            { $or: [
              { job_name: { $exists: true, $nin: [null, ''] } },
              { gemini_job_name: { $exists: true, $nin: [null, ''] } },
            ]},
          ],
        },
      ],
    })
    .toArray();

  const jobsToProcess = pendingJobs.slice(0, Math.min(pendingJobs.length, LIMIT));
  console.log(`[batch-collector] Found ${pendingJobs.length} jobs, processing ${jobsToProcess.length}\n`);

  if (jobsToProcess.length === 0) {
    await writeCronRun(db, startTime, { jobs_found: 0, collected: 0, pages_saved: 0 }, []);
    await client.close();
    return;
  }

  let collected = 0;
  let errors = 0;
  let stillPending = 0;
  let totalPagesSaved = 0;
  const bookIdsToUpdate = new Set();
  const parentIdsToUpdate = new Set();
  const pipelineAdvances = []; // { bookId, type } pairs for pipeline status updates
  const recitationBooks = new Set(); // books where ALL pages hit RECITATION — need Lambda retry
  const errorMessages = [];

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
        const msg = `Error: ${r.reason?.message || r.reason}`;
        if (errors <= 20) console.error(msg);
        errorMessages.push(msg);
        continue;
      }
      const val = r.value;
      if (val.status === 'collected') {
        collected++;
        totalPagesSaved += val.successCount;
        if (val.bookId) {
          bookIdsToUpdate.add(val.bookId);
          pipelineAdvances.push({ bookId: val.bookId, type: val.type });
          // Track books where all pages hit RECITATION — these need Lambda retry
          if (val.successCount === 0 && val.recitationCount > 0) {
            recitationBooks.add(val.bookId);
          }
        }
        if (val.parentJobId) parentIdsToUpdate.add(val.parentJobId);
      } else if (val.status === 'pending') {
        stillPending++;
      } else if (val.status === 'not_found') {
        errors++;
      } else if (val.status === 'failed') {
        errors++;
        if (val.bookId) {
          pipelineAdvances.push({ bookId: val.bookId, type: val.type });
        }
        if (errors <= 20) console.log(`  Job failed: ${val.state}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const processed = Math.min(i + CONCURRENCY, jobsToProcess.length);
    console.log(`[${processed}/${jobsToProcess.length}] Collected: ${collected} (${totalPagesSaved} pages) | Pending: ${stillPending} | Errors: ${errors} | ${elapsed}s`);
  }

  // Post-processing: update book counts, parent jobs, pipeline status
  console.log(`\nPost-processing: ${bookIdsToUpdate.size} books, ${parentIdsToUpdate.size} parents, ${pipelineAdvances.length} pipeline checks...`);

  for (const bookId of bookIdsToUpdate) {
    try { await updateBookCounts(db, bookId); }
    catch (e) { console.error(`  Book count error ${bookId}: ${e.message}`); }
  }

  for (const parentId of parentIdsToUpdate) {
    try { await updateParentJobProgress(db, parentId); }
    catch (e) { console.error(`  Parent progress error ${parentId}: ${e.message}`); }
  }

  // Deduplicate pipeline advances by bookId (skip RECITATION books — they get reset below)
  const seenBooks = new Set();
  for (const { bookId, type } of pipelineAdvances) {
    if (!bookId || seenBooks.has(bookId) || recitationBooks.has(bookId)) continue;
    seenBooks.add(bookId);
    try { await advancePipelineStatus(db, bookId, type); }
    catch (e) { console.error(`  Pipeline advance error ${bookId}: ${e.message}`); }
  }

  // RECITATION recovery: mark affected books for retry with a different model.
  // The batch API with gemini-3-flash-preview triggers RECITATION on some historical
  // texts. Lambda workers have a fallback chain (2.5-flash → 2.0-flash → 1.5-flash).
  // Reset to archive_complete with recitation_retry flag so the orchestrator can
  // route these through Lambda or use a different batch model.
  if (recitationBooks.size > 0) {
    console.log(`\nRECITATION recovery: flagging ${recitationBooks.size} books for retry`);
    for (const bookId of recitationBooks) {
      try {
        await db.collection('books').updateOne(
          { id: bookId, 'pipeline_auto.status': { $in: ['ocr_submitted', 'ocr_complete'] } },
          {
            $set: {
              'pipeline_auto.status': 'archive_complete',
              'pipeline_auto.last_updated': new Date(),
              'pipeline_auto.recitation_retry': true,
              updated_at: new Date(),
            },
          }
        );
        console.log(`  Reset ${bookId} -> archive_complete (recitation_retry)`);
      } catch (e) { console.error(`  RECITATION reset error ${bookId}: ${e.message}`); }
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Jobs collected: ${collected}`);
  console.log(`Pages saved: ${totalPagesSaved}`);
  console.log(`Still pending: ${stillPending}`);
  console.log(`Errors: ${errors}`);
  console.log(`Books updated: ${bookIdsToUpdate.size}`);
  if (recitationBooks.size > 0) console.log(`RECITATION resets: ${recitationBooks.size}`);
  console.log(`Total time: ${totalElapsed}s`);

  // Write cron_runs record for observability
  await writeCronRun(db, startTime, {
    jobs_found: pendingJobs.length,
    jobs_processed: jobsToProcess.length,
    collected,
    pages_saved: totalPagesSaved,
    still_pending: stillPending,
    errors,
    books_updated: bookIdsToUpdate.size,
    parents_updated: parentIdsToUpdate.size,
  }, errorMessages);

  await client.close();
}

async function writeCronRun(db, startTime, actions, errorMessages) {
  try {
    await db.collection('cron_runs').insertOne({
      cron: 'batch-collector-worker',
      timestamp: new Date(),
      duration_ms: Date.now() - startTime,
      status: errorMessages.length > 0 ? 'partial' : 'success',
      failed: false,
      actions,
      errors: errorMessages.slice(0, 50).map(msg => ({
        message: msg,
        timestamp: new Date(),
      })),
      error_count: errorMessages.length,
      summary: `Collected ${actions.collected || 0} jobs (${actions.pages_saved || 0} pages), ${actions.still_pending || 0} pending, ${actions.errors || 0} errors`,
    });
  } catch (_) { /* non-blocking */ }
}

run().catch(err => { console.error(err); process.exit(1); });
