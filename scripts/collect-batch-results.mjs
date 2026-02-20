#!/usr/bin/env node
/**
 * Local batch result collector
 *
 * Polls Gemini for pending/processing batch_jobs, downloads results,
 * saves OCR/translation data to pages, updates job status to 'saved'.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/collect-batch-results.mjs
 *   node scripts/collect-batch-results.mjs --limit=50 --dry-run
 */

import { MongoClient } from 'mongodb';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PROMPT_VERSION = 'v5.2026-02';

// Parse args
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? 'true'];
  })
);
const LIMIT = parseInt(args.limit || '200');
const DRY_RUN = args['dry-run'] === 'true';
const CONCURRENCY = parseInt(args.concurrency || '5');

function getAllApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY_TIER3,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean);
  return [...new Set(keys)];
}

function extractPageType(text) {
  const match = text.match(/<page-type>\s*(.*?)\s*<\/page-type>/i);
  return match ? match[1].trim().toLowerCase() : null;
}

function extractColumns(text) {
  const match = text.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  return n >= 2 ? n : null;
}

function parseDetectedImages(text) {
  const match = text.match(/<detected-images>([\s\S]*?)<\/detected-images>/i);
  if (!match) return [];
  try {
    const images = [];
    const imgMatches = match[1].matchAll(/<image\b([\s\S]*?)\/?\s*>/gi);
    for (const m of imgMatches) {
      const attrs = m[1];
      const get = (name) => {
        const a = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return a ? a[1] : undefined;
      };
      images.push({
        type: get('type') || 'illustration',
        description: get('description') || get('desc') || '',
        bbox: {
          x: parseFloat(get('x') || '0'),
          y: parseFloat(get('y') || '0'),
          width: parseFloat(get('width') || get('w') || '100'),
          height: parseFloat(get('height') || get('h') || '100'),
        },
      });
    }
    return images;
  } catch { return []; }
}

async function fetchJobWithResults(jobName) {
  const keys = getAllApiKeys();
  for (const apiKey of keys) {
    const response = await fetch(`${GEMINI_API_BASE}/${jobName}?key=${apiKey}`, {
      method: 'GET', headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      if (response.status === 404) continue;
      throw new Error(`Failed: ${response.status}`);
    }
    const data = await response.json();
    const metadata = data.metadata || {};
    const batchStats = metadata.batchStats || {};

    // Normalize state — Gemini uses both JOB_STATE_* and BATCH_STATE_* prefixes
    let state = metadata.state || 'JOB_STATE_PENDING';
    if (state === 'JOB_STATE_ACTIVE') state = 'JOB_STATE_RUNNING';
    if (state === 'BATCH_STATE_SUCCEEDED') state = 'JOB_STATE_SUCCEEDED';
    if (state === 'BATCH_STATE_FAILED') state = 'JOB_STATE_FAILED';
    if (state === 'BATCH_STATE_CANCELLED') state = 'JOB_STATE_CANCELLED';
    if (state === 'BATCH_STATE_EXPIRED') state = 'JOB_STATE_EXPIRED';
    if (state === 'BATCH_STATE_PENDING') state = 'JOB_STATE_PENDING';
    if (state === 'BATCH_STATE_RUNNING' || state === 'BATCH_STATE_ACTIVE') state = 'JOB_STATE_RUNNING';
    const succeeded = parseInt(batchStats.successfulRequestCount || batchStats.succeededCount || '0');
    const total = parseInt(batchStats.requestCount || batchStats.totalCount || '0');
    if (state === 'JOB_STATE_RUNNING' && succeeded > 0 && succeeded >= total) {
      state = 'JOB_STATE_SUCCEEDED';
    }

    const status = { name: data.name, state, stats: {
      totalCount: total,
      successCount: succeeded,
      failedCount: parseInt(batchStats.failedRequestCount || batchStats.failedCount || '0'),
    }};

    if (state !== 'JOB_STATE_SUCCEEDED') return { status, results: null };

    // Extract results
    let results = null;
    if (metadata.output?.inlinedResponses?.inlinedResponses) {
      results = metadata.output.inlinedResponses.inlinedResponses;
    } else if (data.response?.inlinedResponses) {
      results = data.response.inlinedResponses;
    } else if (data.dest?.inlinedResponses) {
      results = data.dest.inlinedResponses;
    } else {
      const fileName = metadata.output?.responsesFile || metadata.destFile || data.dest?.fileName;
      if (fileName) {
        const fileResp = await fetch(
          `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`
        );
        if (fileResp.ok) {
          const text = await fileResp.text();
          results = text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        }
      }
    }
    return { status, results };
  }
  throw new Error(`Job not found with any key`);
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Find jobs to check
  const jobs = await db.collection('batch_jobs').find({
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    $or: [
      { job_name: { $exists: true, $nin: [null, ''] } },
      { gemini_job_name: { $exists: true, $nin: [null, ''] } },
    ]
  }).limit(LIMIT).toArray();

  console.log(`Found ${jobs.length} jobs to check (limit ${LIMIT}, dry-run: ${DRY_RUN})`);

  let collected = 0, stillPending = 0, failed = 0, pagesSaved = 0;

  // Process in batches for concurrency
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (job) => {
      const jobName = job.job_name || job.gemini_job_name;
      const jobId = job.id || String(job._id);
      try {
        const { status, results } = await fetchJobWithResults(jobName);

        if (status.state === 'JOB_STATE_SUCCEEDED' && results) {
          const pageIds = job.page_ids || [];
          const isMultiPage = (job.pages_per_request || 1) > 1;
          const now = new Date();
          let successCount = 0, failCount = 0;

          // Build page results
          const pageResults = [];
          for (let idx = 0; idx < results.length; idx++) {
            const result = results[idx];
            const pageId = result.metadata?.key || pageIds[idx];
            if (!pageId) { failCount++; continue; }
            if (result.error || !result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
              failCount++; continue;
            }
            const text = result.response.candidates[0].content.parts[0].text;
            if (text.length > 25000) { failCount++; continue; } // hallucination guard
            pageResults.push({ pageId, text, usage: result.response.usageMetadata });
          }

          if (DRY_RUN) {
            console.log(`  [DRY] ${jobId} (${job.book_title?.slice(0, 40)}): ${pageResults.length} pages ready`);
            collected++;
            pagesSaved += pageResults.length;
            return;
          }

          // Build bulk ops
          const bulkOps = [];
          for (const { pageId, text, usage } of pageResults) {
            if (job.type === 'ocr') {
              const pageType = extractPageType(text);
              const columns = extractColumns(text);
              const detectedImages = parseDetectedImages(text);
              bulkOps.push({ updateOne: { filter: { id: pageId, ocr: null }, update: { $set: { ocr: {} } } } });
              bulkOps.push({ updateOne: {
                filter: { id: pageId },
                update: { $set: {
                  'ocr.data': text, 'ocr.updated_at': now, 'ocr.model': job.model,
                  'ocr.language': job.language, 'ocr.source': 'batch_api',
                  'ocr.prompt_version': job.prompt_version || PROMPT_VERSION,
                  'ocr.batch_job_id': jobId,
                  'ocr.input_tokens': usage?.promptTokenCount || 0,
                  'ocr.output_tokens': usage?.candidatesTokenCount || 0,
                  ...(pageType && { page_type: pageType }),
                  ...(columns && { columns }),
                  ...(detectedImages.length > 0 && { detected_images: detectedImages }),
                  updated_at: now,
                }}
              }});
            } else {
              bulkOps.push({ updateOne: { filter: { id: pageId, translation: null }, update: { $set: { translation: {} } } } });
              bulkOps.push({ updateOne: {
                filter: { id: pageId },
                update: { $set: {
                  'translation.data': text, 'translation.updated_at': now,
                  'translation.model': job.model, 'translation.source_language': job.language,
                  'translation.target_language': 'English', 'translation.source': 'batch_api',
                  'translation.prompt_version': job.prompt_version || PROMPT_VERSION,
                  'translation.batch_job_id': jobId,
                  updated_at: now,
                }}
              }});
            }
          }

          if (bulkOps.length > 0) {
            const result = await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
            successCount = result.modifiedCount;
          }

          // Update job status
          await db.collection('batch_jobs').updateOne({ _id: job._id }, { $set: {
            status: 'saved', gemini_state: 'JOB_STATE_SUCCEEDED',
            completed_pages: successCount, failed_pages: failCount,
            results_collected: true, completed_at: now, updated_at: now,
          }});

          // Update parent if needed
          if (job.parent_job_id) {
            // Simple: just mark — the parent aggregation logic is complex, skip for now
          }

          // Update book counts
          const [counts] = await db.collection('pages').aggregate([
            { $match: { book_id: job.book_id } },
            { $group: { _id: null, total: { $sum: 1 },
              with_ocr: { $sum: { $cond: [{ $and: [{ $ne: ['$ocr.data', null] }, { $ne: ['$ocr.data', ''] }] }, 1, 0] } },
              with_translation: { $sum: { $cond: [{ $and: [{ $ne: ['$translation.data', null] }, { $ne: ['$translation.data', ''] }] }, 1, 0] } },
            }}
          ]).toArray();
          if (counts) {
            await db.collection('books').updateOne({ id: job.book_id }, { $set: {
              pages_count: counts.total, pages_ocr: counts.with_ocr,
              pages_translated: counts.with_translation, updated_at: now,
            }});
          }

          collected++;
          pagesSaved += pageResults.length;
          console.log(`  OK ${jobId}: ${pageResults.length} pages saved (${job.book_title?.slice(0, 50)})`);

        } else if (status.state === 'JOB_STATE_PENDING' || status.state === 'JOB_STATE_RUNNING') {
          stillPending++;
          await db.collection('batch_jobs').updateOne({ _id: job._id }, { $set: {
            status: status.state === 'JOB_STATE_RUNNING' ? 'processing' : 'pending',
            gemini_state: status.state, updated_at: new Date(),
          }});
        } else if (status.state === 'JOB_STATE_FAILED' || status.state === 'JOB_STATE_CANCELLED' || status.state === 'JOB_STATE_EXPIRED') {
          failed++;
          await db.collection('batch_jobs').updateOne({ _id: job._id }, { $set: {
            status: 'failed', gemini_state: status.state,
            error: `Gemini: ${status.state}`, updated_at: new Date(),
          }});
          console.log(`  FAIL ${jobId}: ${status.state}`);
        }
      } catch (err) {
        failed++;
        console.error(`  ERR ${jobId}: ${err.message}`);
      }
    }));

    // Progress
    const done = Math.min(i + CONCURRENCY, jobs.length);
    if (done % 20 === 0 || done === jobs.length) {
      console.log(`Progress: ${done}/${jobs.length} checked, ${collected} collected, ${pagesSaved} pages saved, ${stillPending} pending, ${failed} failed`);
    }
  }

  console.log(`\nDone: ${collected} collected (${pagesSaved} pages), ${stillPending} still pending, ${failed} failed`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
