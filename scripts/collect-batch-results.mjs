#!/usr/bin/env node
/**
 * Collect results from completed Gemini Batch API jobs.
 * Runs locally with no timeout (unlike the Vercel cron).
 *
 * Usage:
 *   secret-lover run -- node scripts/collect-batch-results.mjs [--limit N] [--concurrency N]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 10;

// --- OCR metadata extraction (mirrors defaults.ts) ---
function extractPageType(text) {
  const match = text.match(/<page-type>\s*(.*?)\s*<\/page-type>/i);
  return match ? match[1].toLowerCase().trim() : null;
}

function extractColumns(text) {
  const match = text.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= 2 ? n : null;
}

function parseDetectedImages(text) {
  const match = text.match(/<detected-images>([\s\S]*?)<\/detected-images>/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// --- Gemini API ---
async function getJobData(jobName) {
  const url = `${GEMINI_API_BASE}/${jobName}?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function getJobState(geminiData) {
  return geminiData.metadata?.state || geminiData.state || 'UNKNOWN';
}

async function extractResults(geminiData) {
  // File-based output (current Gemini API format)
  if (geminiData.metadata?.output?.responsesFile) {
    const fileName = geminiData.metadata.output.responsesFile;
    const fileResp = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${GEMINI_API_KEY}`
    );
    if (!fileResp.ok) throw new Error(`Failed to download results file: ${await fileResp.text()}`);
    const text = await fileResp.text();
    return text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  // Legacy file-based output
  if (geminiData.metadata?.destFile) {
    const fileName = geminiData.metadata.destFile;
    const fileResp = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${GEMINI_API_KEY}`
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
async function processOneJob(db, job) {
  const jobName = job.job_name || job.gemini_job_name;
  if (!jobName) return { status: 'skipped' };

  const geminiData = await getJobData(jobName);
  const state = getJobState(geminiData);

  if (state === 'JOB_STATE_SUCCEEDED' || state === 'BATCH_STATE_SUCCEEDED') {
    const responses = await extractResults(geminiData);
    let successCount = 0;
    let failCount = 0;
    const now = new Date();

    // Batch all page updates for efficiency
    const bulkOps = [];

    for (let idx = 0; idx < responses.length; idx++) {
      const result = responses[idx];
      const pageId = result.metadata?.key || (job.page_ids && job.page_ids[idx]);
      if (!pageId) { failCount++; continue; }

      const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { failCount++; continue; }

      const usage = result.response?.usageMetadata;

      if (job.type === 'ocr') {
        const pageType = extractPageType(text);
        const columns = extractColumns(text);
        const detectedImages = parseDetectedImages(text);

        const updateObj = {
          ocr: {
            data: text,
            updated_at: now,
            model: job.model,
            language: job.language,
            source: 'batch_api',
            prompt_version: job.prompt_version || 'v4.2026-02',
            batch_job_id: job.id,
            input_tokens: usage?.promptTokenCount || 0,
            output_tokens: usage?.candidatesTokenCount || 0,
          },
          updated_at: now,
        };
        if (pageType) updateObj.page_type = pageType;
        if (columns) updateObj.columns = columns;
        if (detectedImages.length > 0) updateObj.detected_images = detectedImages;

        bulkOps.push({
          updateOne: { filter: { id: pageId }, update: { $set: updateObj } }
        });
      } else {
        bulkOps.push({
          updateOne: {
            filter: { id: pageId },
            update: {
              $set: {
                translation: {
                  data: text,
                  updated_at: now,
                  model: job.model,
                  source_language: job.language,
                  target_language: 'English',
                  source: 'batch_api',
                  prompt_version: job.prompt_version || 'v4.2026-02',
                  batch_job_id: job.id,
                  input_tokens: usage?.promptTokenCount || 0,
                  output_tokens: usage?.candidatesTokenCount || 0,
                },
                updated_at: now,
              },
            },
          }
        });
      }
    }

    // Execute bulk write
    if (bulkOps.length > 0) {
      const bulkResult = await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
      successCount = bulkResult.matchedCount;
      failCount += (bulkOps.length - bulkResult.matchedCount);
    }

    // Update job status
    await db.collection('batch_jobs').updateOne(
      { id: job.id },
      {
        $set: {
          status: 'saved',
          gemini_state: 'JOB_STATE_SUCCEEDED',
          completed_pages: successCount,
          failed_pages: failCount,
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
      { id: job.id },
      { $set: { status: 'failed', gemini_state: state, updated_at: new Date() } }
    );
    return { status: 'failed', state };
  } else {
    return { status: 'unknown', state };
  }
}

// --- Main ---
async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Also pick up "saved" jobs that have 0 pages (broken by metadata.key bug)
  const pendingJobs = await db.collection('batch_jobs')
    .find({
      $or: [
        {
          status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
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
  const parent = await db.collection('batch_jobs').findOne({ id: parentJobId });
  if (!parent || !parent.child_job_ids) return;

  const children = await db.collection('batch_jobs')
    .find({ id: { $in: parent.child_job_ids } })
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

  await db.collection('batch_jobs').updateOne({ id: parentJobId }, { $set: update });

  if (allChildrenDone && parent.book_id) {
    await db.collection('books').updateOne(
      { id: parent.book_id },
      { $unset: { job: '' } }
    );
  }
}

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
                { $ifNull: ['$ocr.data', false] }
              ]},
              1, 0
            ]
          }
        },
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] }
              ]},
              1, 0
            ]
          }
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

run().catch(err => { console.error(err); process.exit(1); });
