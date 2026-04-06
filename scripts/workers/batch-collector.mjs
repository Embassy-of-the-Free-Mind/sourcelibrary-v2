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
import { randomBytes } from 'crypto';

/**
 * Save current page content as a revision before overwriting.
 * Lightweight inline version of src/lib/page-revisions.ts createRevision().
 */
async function saveRevisionBeforeOverwrite(db, pageId, field, jobId) {
  try {
    const page = await db.collection('pages').findOne(
      { id: pageId },
      { projection: { book_id: 1, ocr: 1, translation: 1 } }
    );
    if (!page) return;
    const fieldData = page[field];
    if (!fieldData?.data) return; // No existing content — first write

    await db.collection('page_revisions').insertOne({
      id: randomBytes(6).toString('hex'),
      page_id: pageId,
      book_id: page.book_id,
      field,
      data: fieldData.data,
      source: fieldData.source || 'ai',
      model: fieldData.model,
      language: fieldData.language,
      prompt_version: fieldData.prompt_version,
      edited_by: fieldData.edited_by,
      job_id: jobId,
      original_date: fieldData.updated_at,
      created_at: new Date(),
    });
  } catch (e) {
    // Non-fatal — don't block collection on revision failure
    console.error(`  [revision] Failed for ${pageId}/${field}: ${e.message?.slice(0, 50)}`);
  }
}

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALL_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
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

// ── Cost calculation (mirrors gemini-logger.ts) ──

const MODEL_PRICING = {
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};
const BATCH_DISCOUNT = 0.5;

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-2.5-flash'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input * BATCH_DISCOUNT;
  const outputCost = (outputTokens / 1_000_000) * pricing.output * BATCH_DISCOUNT;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

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

/**
 * Parse image extraction response — expects a JSON array of detected images.
 * Handles markdown code fences and extra whitespace.
 */
function parseImageExtractionResponse(text) {
  if (!text || typeof text !== 'string') return [];
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Normalize bbox values to 0-1 range.
 * AI models sometimes return 0-1000 scale instead of the requested 0-1.
 */
function normalizeBbox(raw) {
  const x = parseFloat(raw.x) || 0;
  const y = parseFloat(raw.y) || 0;
  const width = parseFloat(raw.width) || 0;
  const height = parseFloat(raw.height) || 0;
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    const scale = Math.max(x + width, y + height, 1000);
    return {
      x: Math.min(x / scale, 0.95),
      y: Math.min(y / scale, 0.95),
      width: Math.min(width / scale, 1),
      height: Math.min(height / scale, 1),
    };
  }
  return { x, y, width, height };
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
        const pageId = r.metadata?.key;
        if (!pageId) {
          // NEVER fall back to index-based matching — response order is not guaranteed.
          // Index fallback caused cross-book contamination (2026-03-24 incident).
          console.warn(`  SKIP: response ${idx} missing metadata.key (book: ${job.book_id})`);
          failCount++;
          continue;
        }
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

    // First pass: fix null ocr/translation subdocuments (skip for image_extraction)
    if (job.type !== 'image_extraction') {
      const nullFixOps = pageResults.map(({ pageId }) => ({
        updateOne: {
          filter: { id: pageId, [job.type === 'ocr' ? 'ocr' : 'translation']: null },
          update: { $set: { [job.type === 'ocr' ? 'ocr' : 'translation']: {} } },
        },
      }));
      if (nullFixOps.length > 0) {
        await db.collection('pages').bulkWrite(nullFixOps, { ordered: false });
      }

      // Save revisions for pages that already have content (non-blocking, parallel)
      const field = job.type === 'ocr' ? 'ocr' : 'translation';
      const revisionPromises = pageResults
        .filter(r => r.text.length <= HALLUCINATION_LIMIT)
        .map(r => saveRevisionBeforeOverwrite(db, r.pageId, field, jobIdStr));
      await Promise.allSettled(revisionPromises);
    }

    const bulkOps = [];
    let galleryDocs = null; // Populated by image_extraction jobs
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
      } else if (job.type === 'image_extraction') {
        // Parse JSON array of detected images from Gemini response
        const parsed = parseImageExtractionResponse(text);
        if (parsed.length > 0) {
          const detectedImages = parsed.map(img => ({
            description: img.description || '',
            type: img.type || 'unknown',
            bbox: img.bbox ? normalizeBbox(img.bbox) : undefined,
            confidence: img.confidence,
            gallery_quality: typeof img.gallery_quality === 'number' ? img.gallery_quality : undefined,
            gallery_rationale: img.gallery_rationale || undefined,
            metadata: img.metadata || undefined,
            museum_description: img.museum_description || undefined,
            detected_at: now,
            detection_source: 'vision_model',
            model: job.model,
            batch_job_id: jobIdStr,
          }));

          bulkOps.push({
            updateOne: {
              filter: { id: pageId },
              update: {
                $set: {
                  detected_images: detectedImages,
                  image_extraction_updated_at: now,
                  updated_at: now,
                },
              },
            },
          });

          // Queue gallery_images docs for bulk insert after the loop
          if (!galleryDocs) galleryDocs = [];
          for (let di = 0; di < detectedImages.length; di++) {
            const img = detectedImages[di];
            galleryDocs.push({
              id: `${pageId}-${di}`,
              page_id: pageId,
              book_id: job.book_id,
              detection_index: di,
              description: img.description,
              type: img.type,
              bbox: img.bbox,
              gallery_quality: img.gallery_quality,
              gallery_rationale: img.gallery_rationale,
              museum_description: img.museum_description,
              metadata: img.metadata,
              detected_at: now,
              detection_source: 'vision_model',
              model: job.model,
              batch_job_id: jobIdStr,
              updated_at: now,
            });
          }
        } else {
          // No images detected — still mark as processed
          bulkOps.push({
            updateOne: {
              filter: { id: pageId },
              update: { $set: { image_extraction_updated_at: now, updated_at: now } },
            },
          });
        }
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

    // Insert gallery_images for image extraction jobs (upsert to avoid dupes on re-collection)
    if (galleryDocs && galleryDocs.length > 0) {
      try {
        // Fetch page numbers + image URLs for gallery docs
        const pageIdsForGallery = [...new Set(galleryDocs.map(d => d.page_id))];
        const pageInfoMap = new Map();
        const pageInfos = await db.collection('pages')
          .find({ id: { $in: pageIdsForGallery } })
          .project({ id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 })
          .toArray();
        for (const p of pageInfos) pageInfoMap.set(p.id, p);

        // Fetch book metadata for gallery docs
        const bookDoc = await db.collection('books').findOne(
          { id: job.book_id },
          { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1 } }
        );

        for (const doc of galleryDocs) {
          const pageInfo = pageInfoMap.get(doc.page_id);
          if (pageInfo) {
            doc.page_number = pageInfo.page_number;
            // Image URL fallback chain (same as image-extraction-processor)
            doc.image_url = pageInfo.cropped_photo || pageInfo.archived_photo || pageInfo.photo_original || pageInfo.photo;
          }
          if (bookDoc) {
            doc.book_title = bookDoc.display_title || bookDoc.title;
            doc.book_author = bookDoc.author;
            doc.book_year = bookDoc.year;
            doc.book_language = bookDoc.language;
          }
        }

        const galleryOps = galleryDocs.map(doc => ({
          updateOne: {
            filter: { id: doc.id },
            update: { $set: doc },
            upsert: true,
          },
        }));
        await db.collection('gallery_images').bulkWrite(galleryOps, { ordered: false });
        console.log(`  Gallery: ${galleryDocs.length} images written for book ${job.book_id}`);
      } catch (galleryErr) {
        console.error(`  Gallery write error: ${galleryErr.message}`);
      }
    }

    // Update batch_jobs status — mark as 'failed' if zero pages saved
    const finalStatus = successCount > 0 ? 'saved' : 'failed';
    const errorDetail = successCount === 0 && recitationCount > 0
      ? `All ${recitationCount} pages blocked by RECITATION filter`
      : successCount === 0 ? `All ${failCount} pages failed` : undefined;

    const costUsd = calculateCost(job.model, totalInputTokens, totalOutputTokens);

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
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          cost_usd: costUsd,
          ...(errorDetail && { error: errorDetail }),
        },
      }
    );

    // Log to gemini_usage
    await db.collection('gemini_usage').insertOne({
      type: job.type || 'ocr',
      mode: 'batch',
      model: job.model,
      book_id: job.book_id,
      page_count: successCount,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: costUsd,
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
    // Check for stale jobs — if PENDING for >24 hours with no progress, cancel and let orchestrator retry
    // Note: Flash Lite batches routinely take 8-9h. Previous 6h timeout was killing valid jobs.
    const STALE_HOURS = 24;
    const jobAge = (Date.now() - new Date(job.created_at).getTime()) / 3600000;
    if (state === 'JOB_STATE_PENDING' && jobAge > STALE_HOURS) {
      console.log(`  Stale PENDING job (${jobAge.toFixed(1)}h old): ${job.job_name || job.gemini_job_name} — cancelling`);
      if (!DRY_RUN) {
        // Cancel the Gemini job
        try {
          const cancelUrl = `${GEMINI_API_BASE}/${job.job_name || job.gemini_job_name}:cancel?key=${ALL_KEYS[0]}`;
          await fetch(cancelUrl, { method: 'POST' });
        } catch (_) { /* best effort */ }

        await db.collection('batch_jobs').updateOne(
          { _id: job._id },
          { $set: { status: 'failed', gemini_state: state, error: `Stale: PENDING for ${jobAge.toFixed(1)}h with no progress`, updated_at: new Date() } }
        );
      }
      return { status: 'failed', state: 'STALE_PENDING', bookId: job.book_id, type: job.type };
    }

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
    // Children handle the actual page saves — parent is just a tracker.
    // Mark as 'saved' (not 'completed') so it doesn't linger as a ghost job.
    parentStatus = anyChildFailed || progress.failed > 0 ? 'completed_with_errors' : 'saved';
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

  if (jobType === 'image_extraction' && status === 'images_submitted') {
    const pendingImages = await db.collection('batch_jobs').countDocuments({
      book_id: bookId,
      type: 'image_extraction',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (pendingImages === 0) {
      // Update detected_images_count from actual page data
      const imgCount = await db.collection('pages').countDocuments({
        book_id: bookId,
        'detected_images.0': { $exists: true },
      });
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            detected_images_count: imgCount,
            'pipeline_auto.status': 'images_complete',
            'pipeline_auto.last_updated': new Date(),
            updated_at: new Date(),
          },
        }
      );
      console.log(`  Pipeline: ${bookId} images_submitted -> images_complete (${imgCount} images)`);
    }
  }
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check processing_control pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log(`[batch-collector] Pipeline paused. Exiting.`);
    await client.close();
    process.exit(0);
  }

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

  // ── Recovery sweep: re-check recently-failed jobs against Gemini ──
  // Race condition: collector marks a job as "failed" (stale PENDING), but Gemini
  // completes it afterward. Without this sweep, those results are lost forever.
  // Runs once per hour (not every 10-min cycle) — no urgency for already-stale jobs.
  let recoveredJobs = 0;
  let recoveredPages = 0;
  const RECOVERY_BATCH_SIZE = 20;
  const RECOVERY_WINDOW_DAYS = 7;
  const RECOVERY_INTERVAL_MS = 3600000; // 1 hour

  // Only run if last sweep was >1h ago
  const lastSweep = await db.collection('system_config').findOne({ _id: 'batch_recovery_last_sweep' });
  const shouldSweep = !lastSweep || (Date.now() - new Date(lastSweep.timestamp).getTime()) > RECOVERY_INTERVAL_MS;

  if (shouldSweep) try {
    await db.collection('system_config').updateOne(
      { _id: 'batch_recovery_last_sweep' },
      { $set: { timestamp: new Date() } },
      { upsert: true }
    );
    const failedWithJobName = await db.collection('batch_jobs')
      .find({
        status: 'failed',
        job_name: { $exists: true, $nin: [null, ''] },
        created_at: { $gte: new Date(Date.now() - RECOVERY_WINDOW_DAYS * 24 * 3600000) },
        recovery_checked_at: { $exists: false }, // skip already-checked jobs
      })
      .sort({ created_at: -1 })
      .limit(RECOVERY_BATCH_SIZE)
      .toArray();

    if (failedWithJobName.length > 0) {
      console.log(`\n[recovery] Checking ${failedWithJobName.length} recently-failed jobs against Gemini...`);
    }

    for (const job of failedWithJobName) {
      const result = await getJobData(job.job_name);
      // Mark as checked regardless of outcome — avoid re-checking every cycle
      await db.collection('batch_jobs').updateOne(
        { _id: job._id },
        { $set: { recovery_checked_at: new Date() } }
      );

      if (!result) continue;
      const state = getJobState(result.data);
      const normalized = normalizeState(state);

      if (normalized !== 'JOB_STATE_SUCCEEDED') continue;

      // This job actually succeeded on Gemini! Re-process it.
      console.log(`  [recovery] FOUND: ${job.book_id} | ${job.job_name} | ${job.page_count} pages`);
      // Reset status so processOneJob can handle it
      await db.collection('batch_jobs').updateOne(
        { _id: job._id },
        { $set: { status: 'pending', recovery_note: 'Recovered — Gemini completed after collector marked failed' } }
      );

      if (!DRY_RUN) {
        try {
          const val = await processOneJob(db, { ...job, status: 'pending' });
          if (val.status === 'collected') {
            recoveredJobs++;
            recoveredPages += val.successCount;
            if (val.bookId) {
              bookIdsToUpdate.add(val.bookId);
              try { await updateBookCounts(db, val.bookId); } catch (_) {}
              try { await advancePipelineStatus(db, val.bookId, val.type); } catch (_) {}
            }
          }
        } catch (e) {
          console.error(`  [recovery] Error processing ${job.book_id}: ${e.message}`);
        }
      }
    }

    if (recoveredJobs > 0) {
      console.log(`[recovery] Recovered ${recoveredJobs} jobs (${recoveredPages} pages)`);
    }
  } catch (e) {
    console.error(`[recovery] Sweep error: ${e.message}`);
  }

  // ── Zombie Reaper: cancel stale processing jobs (>6h no update) ──
  let zombiesReaped = 0;
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const zombieResult = await db.collection('jobs').updateMany(
      { status: 'processing', updated_at: { $lt: sixHoursAgo } },
      { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: 'zombie reaper — stale >6h' } }
    );
    zombiesReaped = zombieResult.modifiedCount;
    if (zombiesReaped > 0) console.log(`\n[zombie-reaper] Cancelled ${zombiesReaped} stale jobs (>6h)`);
  } catch (e) { console.error(`[zombie-reaper] Error: ${e.message}`); }

  // ── Ghost Cleanup: mark orphaned parent batch jobs as saved ──
  // Parent jobs (no job_name) get stuck at 'completed' because the collector
  // only queries jobs with job_name. Their children already saved the pages.
  let ghostsCleaned = 0;
  try {
    const ghostResult = await db.collection('batch_jobs').updateMany(
      {
        status: 'completed',
        parent_job_id: { $exists: false },
        $or: [
          { job_name: { $in: [null, ''] } },
          { job_name: { $exists: false } },
        ],
      },
      { $set: { status: 'saved', saved_at: new Date(), save_note: 'ghost cleanup — parent job, children already collected' } }
    );
    ghostsCleaned = ghostResult.modifiedCount;
    if (ghostsCleaned > 0) console.log(`[ghost-cleanup] Marked ${ghostsCleaned} orphaned parent jobs as saved`);
  } catch (e) { console.error(`[ghost-cleanup] Error: ${e.message}`); }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Jobs collected: ${collected}`);
  console.log(`Pages saved: ${totalPagesSaved}`);
  console.log(`Still pending: ${stillPending}`);
  console.log(`Errors: ${errors}`);
  console.log(`Books updated: ${bookIdsToUpdate.size}`);
  if (recitationBooks.size > 0) console.log(`RECITATION resets: ${recitationBooks.size}`);
  if (recoveredJobs > 0) console.log(`Recovery: ${recoveredJobs} jobs (${recoveredPages} pages)`);
  if (zombiesReaped > 0) console.log(`Zombies reaped: ${zombiesReaped}`);
  if (ghostsCleaned > 0) console.log(`Ghosts cleaned: ${ghostsCleaned}`);
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
    recovered_jobs: recoveredJobs,
    recovered_pages: recoveredPages,
    zombies_reaped: zombiesReaped,
    ghosts_cleaned: ghostsCleaned,
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

// Clean up stale Gemini File API files to prevent 20GB quota exhaustion.
async function cleanupStaleFiles() {
  console.log("[batch-collector] Cleaning up stale Gemini files...");
  let totalDeleted = 0;
  for (let ki = 0; ki < ALL_KEYS.length; ki++) {
    const apiKey = ALL_KEYS[ki];
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/files?key=" + apiKey + "&pageSize=100");
      if (!res.ok) continue;
      const data = await res.json();
      const files = data.files || [];
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      for (const f of files) {
        if (new Date(f.createTime) < oneHourAgo) {
          try {
            await fetch("https://generativelanguage.googleapis.com/v1beta/" + f.name + "?key=" + apiKey, { method: "DELETE" });
            totalDeleted++;
          } catch (cleanErr) { /* ignore */ }
        }
      }
    } catch (listErr) { /* ignore */ }
  }
  if (totalDeleted > 0) console.log("[batch-collector] Deleted " + totalDeleted + " stale files");
}

run().then(() => cleanupStaleFiles()).catch(err => { console.error(err); process.exit(1); });
