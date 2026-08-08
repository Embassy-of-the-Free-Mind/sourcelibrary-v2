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
import { GoogleGenAI } from '@google/genai';
import { completeBatchUsage, sumBatchResponseUsage } from './lib/supabase-usage-logger.mjs';
import { syncPageBatch } from './lib/supabase-page-writer.mjs';
import { hasScope } from './lib/selective-unpause.mjs';
import { buildGalleryDoc } from '../lib/gallery-doc.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { findHumanEditedPageIds } from '../lib/translate-core.mjs';

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

// SDK clients — one per unique key for batch job inspection
const UNIQUE_KEYS = [...new Set(ALL_KEYS)];
const SDK_CLIENTS = UNIQUE_KEYS.map(key => new GoogleGenAI({ apiKey: key }));

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
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};
const BATCH_DISCOUNT = 0.5;

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3-flash-preview'];
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

/**
 * Get batch job data via SDK. Tries all keys (jobs are key-scoped).
 * Returns { sdkJob, apiKey, keyIndex } or null if not found.
 * The apiKey is needed for result file download (SDK download doesn't work for batch results).
 */
async function getJobData(jobName) {
  for (let i = 0; i < SDK_CLIENTS.length; i++) {
    try {
      const sdkJob = await SDK_CLIENTS[i].batches.get({ name: jobName });
      if (sdkJob) return { sdkJob, apiKey: UNIQUE_KEYS[i], keyIndex: i };
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('not found') || msg.includes('NOT_FOUND') || msg.includes('404')) continue;
      // Other errors (network, etc) — try next key
    }
  }
  return null;
}

/**
 * Get job state from SDK response. SDK normalizes to JOB_STATE_* already.
 */
function getJobState(sdkJob) {
  return sdkJob.state || 'UNKNOWN';
}

/**
 * Download and parse batch results. Uses raw fetch because SDK files.download()
 * doesn't work for batch result files.
 */
async function extractResults(sdkJob, apiKey) {
  // File-based output — SDK returns dest.fileName
  const fileName = sdkJob.dest?.fileName;
  if (fileName) {
    const fileResp = await fetch(
      `${GEMINI_API_BASE}/${fileName}:download?alt=media&key=${apiKey}`
    );
    if (!fileResp.ok) throw new Error(`Failed to download results file: ${await fileResp.text()}`);
    const text = await fileResp.text();
    return text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  // Inline responses
  const inline = sdkJob.dest?.inlinedResponses;
  return inline || [];
}

/**
 * Mark a batch's submit-time gemini_usage placeholder as finished with zero
 * spend (#3452). Used when a job ends without ever producing results — Gemini
 * failure/cancellation, generation-guard supersession, ghost/nameless jobs.
 *
 * Best-effort: a usage-meter write must never fail a collection run.
 */
async function closeUsagePlaceholder(db, job, reason, status = 'failed') {
  const jobIdStr = job?.id || (job?._id && String(job._id));
  if (!jobIdStr) return;
  try {
    await completeBatchUsage({
      type: job.type || 'ocr',
      mode: 'batch',
      model: job.model,
      book_id: job.book_id,
      page_count: job.page_count || job.page_ids?.length || 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      status,
      error_message: reason,
      batch_job_id: jobIdStr,
      // No placeholder to close means the job predates the row or was already
      // reconciled — don't manufacture a new zero row for it.
      insertIfMissing: false,
    }, db);
  } catch (err) {
    console.warn(`  Usage placeholder close failed (${jobIdStr}): ${err.message}`);
  }
}

// ── Process one job ──

// Types this collector knows how to save. Everything else is refused (#3725).
const KNOWN_JOB_TYPES = new Set(['ocr', 'translation', 'translate', 'image_extraction']);

async function processOneJob(db, job) {
  const jobName = job.job_name || job.gemini_job_name;
  if (!jobName) return { status: 'skipped' };

  // Type allowlist (#3725): the save path below treats anything that isn't
  // 'ocr'/'image_extraction' as a translation, so a typo'd type on a new
  // submitter would silently write model output into translation.data.
  // Refuse to collect unknown types and mark the job so it stops re-matching.
  if (!KNOWN_JOB_TYPES.has(job.type)) {
    console.error(`  UNKNOWN job type '${job.type}' on ${job.id || job._id} — refusing to collect; marking failed for human triage.`);
    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      { $set: { status: 'failed', error: `unknown job type '${job.type}' — collector allowlist refused (#3725)`, updated_at: new Date() } }
    );
    return { status: 'unknown_type' };
  }

  const result = await getJobData(jobName);
  if (!result) return { status: 'not_found', jobName };
  const { sdkJob, apiKey: workingKey } = result;
  const state = getJobState(sdkJob);

  if (state === 'JOB_STATE_SUCCEEDED') {
    console.log(`  Collecting: ${job.book_id} | ${job.type} | ${state}`);
    if (DRY_RUN) return { status: 'would_collect', bookId: job.book_id };

    // ── Generation guard (#2449) ──
    // If a book's OCR was deliberately reset after this job was submitted
    // (scripts/maintenance/reset-book-ocr.mjs bumps pipeline_auto.ocr_generation),
    // these results are stale: saving them would resurrect cleared marker-less
    // text and silently undo the reset. Jobs submitted before this shipped have
    // no ocr_generation field and are exempt.
    let staleDropPages = null; // Set of pageIds to skip (cross-book partial staleness)
    if (job.type === 'ocr' && job.ocr_generation !== undefined) {
      const genBookIds = job.book_ids?.length ? job.book_ids : [job.book_id];
      const genDocs = await db.collection('books').find(
        { id: { $in: genBookIds } },
        { projection: { id: 1, 'pipeline_auto.ocr_generation': 1 } }
      ).toArray();
      const jobGens = job.book_generations || { [job.book_id]: job.ocr_generation };
      const staleBooks = new Set();
      for (const b of genDocs) {
        const current = b.pipeline_auto?.ocr_generation || 0;
        const submitted = jobGens[b.id] ?? job.ocr_generation ?? 0;
        if (current !== submitted) staleBooks.add(b.id);
      }
      if (staleBooks.size >= genBookIds.length) {
        // Every book in the job was reset — nothing to save.
        await db.collection('batch_jobs').updateOne(
          { _id: job._id },
          { $set: { status: 'superseded', error: `OCR generation advanced after submit (job gen ${job.ocr_generation})`, updated_at: new Date() } }
        );
        // The job DID run, so Gemini billed for it — we just discard the
        // output. We never read the result file here, so the tokens are
        // genuinely unknown; record that rather than leaving the row 'submitted'
        // (#3452). An unknown marked as such is recoverable; one that looks
        // in-flight forever is not.
        await closeUsagePlaceholder(
          db, job,
          'Superseded by generation guard — results discarded, tokens not read',
          'superseded',
        );
        console.log(`  SUPERSEDED (generation guard): ${jobName} (book: ${job.book_id})`);
        return { status: 'superseded', bookId: job.book_id };
      }
      if (staleBooks.size > 0 && job.page_ids?.length) {
        // Cross-book job, some books reset: drop only their pages.
        const stalePages = await db.collection('pages').find(
          { id: { $in: job.page_ids }, book_id: { $in: [...staleBooks] } },
          { projection: { id: 1 } }
        ).toArray();
        staleDropPages = new Set(stalePages.map(pg => pg.id));
        console.log(`  Generation guard: dropping ${staleDropPages.size} pages from ${staleBooks.size} reset book(s) in cross-book job ${jobName}`);
      }
    }

    const responses = await extractResults(sdkJob, workingKey);
    let successCount = 0;
    let failCount = 0;
    const now = new Date();
    const jobIdStr = job.id || String(job._id);
    const isMultiPage = (job.pages_per_request || 1) > 1;

    // Build flat list of { pageId, text, usage }
    const pageResults = [];

    let recitationCount = 0;
    const recitationPageIds = []; // Track page IDs for per-page recitation stamping (single-page path only)

    // Job totals come from the RESPONSES, not from the pages we end up saving
    // (#3452) — Gemini bills every response, including the ones we discard.
    const { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } =
      sumBatchResponseUsage(responses);

    if (isMultiPage && job.type === 'ocr') {
      for (const r of responses) {
        if (r.error) { failCount++; continue; }
        const candidate = r.response?.candidates?.[0];
        if (candidate?.finishReason === 'RECITATION') { recitationCount++; failCount++; continue; }
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        const parsed = parseMultiPageOcr(text);
        // One response covers N pages and reports one usageMetadata — split it
        // evenly for the per-page stamp so pages.ocr.input_tokens doesn't claim
        // the whole request's tokens N times over.
        const usage = r.response?.usageMetadata;
        const share = parsed.length || 1;
        const pageUsage = usage ? {
          promptTokenCount: Math.round((usage.promptTokenCount || 0) / share),
          candidatesTokenCount: Math.round((usage.candidatesTokenCount || 0) / share),
        } : undefined;
        for (const [pageId, ocrText] of parsed) {
          pageResults.push({ pageId, text: ocrText, usage: pageUsage });
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
        if (candidate?.finishReason === 'RECITATION') {
          recitationCount++;
          failCount++;
          if (job.type === 'ocr') recitationPageIds.push(pageId); // Stamp page-level tracking
          continue;
        }
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) { failCount++; continue; }
        pageResults.push({ pageId, text, usage: r.response?.usageMetadata });
      }
    }

    if (recitationCount > 0) {
      console.log(`  RECITATION: ${recitationCount}/${responses.length} responses blocked (book: ${job.book_id})`);
    }

    // ── Per-page RECITATION tracking (single-page OCR path only, where we have pageId) ──
    // Mirrors the archive_metadata.failure_count pattern: stamp count + timestamp, and after
    // N=3 consecutive blocks mark ocr.recitation_blocked: true to skip future submissions.
    if (recitationPageIds.length > 0) {
      const RECITATION_BLOCK_THRESHOLD = 3;
      const recitationNow = new Date();
      // Use $inc + $set so we don't need to read each page before writing
      const recitationOps = recitationPageIds.map(pageId => ({
        updateOne: {
          filter: { id: pageId },
          update: [
            // Ensure ocr subdocument exists
            { $set: { ocr: { $cond: { if: { $eq: ['$ocr', null] }, then: {}, else: '$ocr' } } } },
            {
              $set: {
                'ocr.recitation_count': { $add: [{ $ifNull: ['$ocr.recitation_count', 0] }, 1] },
                'ocr.last_recitation_at': recitationNow,
                // Mark as blocked after threshold so the page-selection query can skip it
                'ocr.recitation_blocked': {
                  $gte: [{ $add: [{ $ifNull: ['$ocr.recitation_count', 0] }, 1] }, RECITATION_BLOCK_THRESHOLD],
                },
              },
            },
          ],
        },
      }));
      try {
        await db.collection('pages').bulkWrite(recitationOps, { ordered: false });
        console.log(`  Stamped recitation tracking on ${recitationPageIds.length} pages`);
      } catch (recErr) {
        console.error(`  Failed to stamp recitation tracking: ${recErr.message}`);
      }
    }

    // Human-edit guard (#3749): pages whose ocr/translation was written or
    // corrected by a person (source 'manual' or edited_by) are protected —
    // batch results submitted before the edit must not clobber them.
    let humanEditedIds = new Set();
    let protectedCount = 0;

    // First pass: fix null ocr/translation subdocuments (skip for image_extraction)
    if (job.type !== 'image_extraction') {
      const field = job.type === 'ocr' ? 'ocr' : 'translation';
      humanEditedIds = await findHumanEditedPageIds(db, pageResults.map(r => r.pageId), field);

      const nullFixOps = pageResults
        .filter(({ pageId }) => !humanEditedIds.has(pageId))
        .map(({ pageId }) => ({
          updateOne: {
            filter: { id: pageId, [job.type === 'ocr' ? 'ocr' : 'translation']: null },
            update: { $set: { [job.type === 'ocr' ? 'ocr' : 'translation']: {} } },
          },
        }));
      if (nullFixOps.length > 0) {
        await db.collection('pages').bulkWrite(nullFixOps, { ordered: false });
      }

      // Save revisions for pages that already have content (non-blocking, parallel)
      const revisionPromises = pageResults
        .filter(r => r.text.length <= HALLUCINATION_LIMIT && !humanEditedIds.has(r.pageId))
        .map(r => saveRevisionBeforeOverwrite(db, r.pageId, field, jobIdStr));
      await Promise.allSettled(revisionPromises);
    }

    const bulkOps = [];
    let galleryDocs = null; // Populated by image_extraction jobs

    // OCR provenance (#2297): map page_id → the exact image URL the orchestrator
    // fetched + sent, recorded on the batch job at submit. Lets us stamp
    // ocr.source_url so `ocr.source_url ≠ getPageSource(page)` becomes a query
    // (the #2298 re-OCR set) instead of an aspect-ratio guess. Empty for jobs
    // submitted before this shipped — those pages stay pre-provenance (null).
    const sourceUrlByPage = new Map((job.page_sources || []).map(s => [s.page_id, s.source_url]));

    for (const { pageId, text, usage } of pageResults) {
      if (staleDropPages?.has(pageId)) { continue; } // generation guard (#2449)
      if (humanEditedIds.has(pageId)) {
        console.log(`  PROTECTED: page ${pageId} has a human-edited ${job.type === 'ocr' ? 'ocr' : 'translation'} — skipping (#3749)`);
        protectedCount++;
        continue;
      }
      if (text.length > HALLUCINATION_LIMIT) { failCount++; continue; }

      // Per-page stamp only — the job totals are summed per response above.
      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;

      if (job.type === 'ocr') {
        const pageType = extractPageType(text);
        const columns = extractColumns(text);
        const detectedImages = parseDetectedImages(text);

        const setObj = {
          'ocr.data': text,
          'ocr.has_warning': /<warning[\s>]/i.test(text), // write-time sensor (see collect-batch-results)
          'ocr.updated_at': now,
          'ocr.model': job.model,
          'ocr.language': job.language,
          'ocr.source': 'batch_api',
          'ocr.prompt_version': job.prompt_version || 'v5.2026-02',
          'ocr.prompt_id': job.prompt_id,
          'ocr.prompt_hash': job.prompt_hash,
          'ocr.prompt_name': job.prompt_name,
          'ocr.batch_job_id': jobIdStr,
          'ocr.input_tokens': inputTokens,
          'ocr.output_tokens': outputTokens,
          updated_at: now,
        };
        // Provenance (#2297) — only stamp when present, so older jobs without
        // page_sources don't write null and look like a drift mismatch.
        const srcUrl = sourceUrlByPage.get(pageId);
        if (srcUrl) setObj['ocr.source_url'] = srcUrl;
        if (job.code_version) setObj['ocr.code_version'] = job.code_version;
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

          // Queue gallery_images docs for bulk insert after the loop.
          // Filter matches src/workers/image-extraction-processor-logic.ts (SQS path):
          //  - bbox required (skips malformed responses / zombie rows)
          //  - gallery_quality must be present and >= QUALITY_THRESHOLD
          //  - detection_source already known ('vision_model' here), no need to gate
          // Threshold is under review; coordinate any change with the SQS path
          // and scripts/workers/image-extract-worker.mjs.
          const QUALITY_THRESHOLD = 0.5;
          if (!galleryDocs) galleryDocs = [];
          // Collect the gated detections; the full denormalized docs are built
          // after the loop (once page + book metadata is fetched) via the shared
          // buildGalleryDoc helper so the field set matches every other writer.
          for (let di = 0; di < detectedImages.length; di++) {
            const img = detectedImages[di];
            if (!img.bbox) continue;
            if (typeof img.gallery_quality !== 'number') continue;
            if (img.gallery_quality < QUALITY_THRESHOLD) continue;
            galleryDocs.push({ pageId, detectedImage: img, index: di });
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
                'translation.prompt_id': job.prompt_id,
                'translation.prompt_hash': job.prompt_hash,
                'translation.prompt_name': job.prompt_name,
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
      // Throttle writes to avoid IOPS spikes on Atlas (3K ceiling on M30)
      const CHUNK_SIZE = 25;
      const CHUNK_DELAY_MS = 200; // ~125 writes/s max
      for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
        const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
        const chunkResult = await db.collection('pages').bulkWrite(chunk, { ordered: false });
        successCount += chunkResult.matchedCount;
        failCount += (chunk.length - chunkResult.matchedCount);
        if (i + CHUNK_SIZE < bulkOps.length) await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
      }
      // Dual-write to Supabase (fire-and-forget)
      syncPageBatch(bulkOps.map(op => ({
        pageId: op.updateOne.filter.id,
        mongoSet: op.updateOne.update.$set,
      })));
    }

    // Insert gallery_images for image extraction jobs (upsert to avoid dupes on re-collection)
    if (galleryDocs && galleryDocs.length > 0) {
      try {
        // Fetch page numbers + image URLs for gallery docs
        const pageIdsForGallery = [...new Set(galleryDocs.map(d => d.pageId))];
        const pageInfoMap = new Map();
        const pageInfos = await db.collection('pages')
          .find({ id: { $in: pageIdsForGallery } })
          .project({ id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, crop: 1 })
          .toArray();
        for (const p of pageInfos) pageInfoMap.set(p.id, p);

        // Fetch book metadata for gallery docs (incl. visible/hidden/provider so
        // batch-collected images are gallery-visible without a separate sync — #2531).
        const bookDoc = await db.collection('books').findOne(
          { id: job.book_id },
          { projection: { id: 1, display_title: 1, title: 1, author: 1, year: 1, language: 1, visible: 1, hidden: 1, 'image_source.provider': 1 } }
        );

        // Build the full denormalized docs via the shared helper; override the
        // provenance fields the batch path owns (model / detected_at / batch id).
        const builtDocs = galleryDocs.map(({ pageId: pid, detectedImage, index }) => {
          const pageInfo = pageInfoMap.get(pid) || { id: pid, book_id: job.book_id };
          const doc = buildGalleryDoc({ page: pageInfo, book: bookDoc, detectedImage, index, now });
          doc.model = job.model;
          doc.detected_at = now;
          doc.detection_source = 'vision_model';
          doc.batch_job_id = jobIdStr;
          return doc;
        });
        galleryDocs = builtDocs;

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
    // (pages skipped by the human-edit guard count as handled, not failed)
    const finalStatus = successCount > 0 || protectedCount > 0 ? 'saved' : 'failed';
    const errorDetail = finalStatus !== 'failed' ? undefined
      : recitationCount > 0
        ? `All ${recitationCount} pages blocked by RECITATION filter`
        : `All ${failCount} pages failed`;

    const costUsd = calculateCost(job.model, totalInputTokens, totalOutputTokens);

    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: finalStatus,
          gemini_state: 'JOB_STATE_SUCCEEDED',
          completed_pages: successCount,
          failed_pages: failCount,
          ...(protectedCount > 0 && { protected_pages: protectedCount }),
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

    // Close out the placeholder row this batch's submission wrote (#3452),
    // rather than inserting a second row: the submit-time row is the one that
    // reads $0.00 forever otherwise, and two rows per batch double-count pages
    // in the dashboard_usage rollup. Falls back to an insert when there is no
    // placeholder (re-collected or pre-#3452 batches).
    // page_count: prefer the batch's own page_count (always populated on batch_jobs).
    // successCount tracks DB matchedCount which is 0 for re-collected batches.
    // status mirrors the batch job's real outcome — reporting 'success' for a
    // job where every page was blocked is how the meter learned to lie.
    // Awaited, unlike the old fire-and-forget insert: the meter write is now
    // the only record of this batch's spend, so it must not race the process.
    await completeBatchUsage({
      type: job.type || 'ocr',
      mode: 'batch',
      model: job.model,
      book_id: job.book_id,
      page_ids: job.page_ids,
      page_count: job.page_count || job.page_ids?.length || successCount,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: costUsd,
      status: finalStatus === 'saved' ? 'success' : 'failed',
      error_message: errorDetail ?? null,
      batch_job_id: jobIdStr,
    }, db).catch(err => console.warn(`  Usage log failed: ${err.message}`));

    return {
      status: 'collected',
      successCount,
      failCount,
      recitationCount,
      bookId: job.book_id,
      bookIds: job.book_ids || [job.book_id], // cross-book batches have book_ids array
      parentJobId: job.parent_job_id,
      type: job.type,
    };

  } else if (state === 'JOB_STATE_PENDING' || state === 'JOB_STATE_RUNNING') {
    // Stale detection: 24h flat timeout for PENDING, or 12h with no progress for RUNNING
    const jobAge = (Date.now() - new Date(job.created_at).getTime()) / 3600000;
    const stats = sdkJob.batchStats || {};
    const pendingCount = parseInt(stats.pendingRequestCount || '0');
    const totalCount = parseInt(stats.requestCount || '0');
    const hasProgress = totalCount > 0 && pendingCount < totalCount;
    const isStale = (state === 'JOB_STATE_PENDING' && jobAge > 24)
      || (state === 'JOB_STATE_RUNNING' && jobAge > 12 && !hasProgress);
    if (isStale) {
      console.log(`  Stale PENDING job (${jobAge.toFixed(1)}h old): ${job.job_name || job.gemini_job_name} — cancelling`);
      if (!DRY_RUN) {
        // Cancel the Gemini job via SDK
        try {
          const jobName = job.job_name || job.gemini_job_name;
          for (const client of SDK_CLIENTS) {
            try { await client.batches.cancel({ name: jobName }); break; } catch (_) { /* try next key */ }
          }
        } catch (_) { /* best effort */ }

        await db.collection('batch_jobs').updateOne(
          { _id: job._id },
          { $set: { status: 'failed', gemini_state: state, error: `Stale: PENDING for ${jobAge.toFixed(1)}h with no progress`, updated_at: new Date() } }
        );
      }
      return { status: 'failed', state: 'STALE_PENDING', bookId: job.book_id, bookIds: job.book_ids || [job.book_id], type: job.type };
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
    const isCancelled = state === 'JOB_STATE_CANCELLED';
    const jobAge = (Date.now() - new Date(job.created_at).getTime()) / 3600000;
    if (isCancelled) {
      console.log(`  GEMINI_CANCELLED: ${job.book_id || 'cross-book'} | age ${jobAge.toFixed(1)}h | ${jobName}`);
    }
    if (!DRY_RUN) {
      await db.collection('batch_jobs').updateOne(
        { _id: job._id },
        { $set: {
          status: 'failed',
          gemini_state: state,
          error: `Gemini state: ${state}`,
          job_age_hours: parseFloat(jobAge.toFixed(1)),
          updated_at: new Date(),
        } }
      );
      // Close the submit-time usage placeholder — a job that never ran spent
      // nothing, but the row must say so rather than sit at 'submitted'
      // forever, indistinguishable from a batch still in flight (#3452).
      await closeUsagePlaceholder(db, job, `Gemini state: ${state}`);
    }
    return { status: 'failed', state, bookId: job.book_id, bookIds: job.book_ids || [job.book_id], type: job.type };
  }
}

// ── Post-processing ──

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

  if (jobType === 'image_extraction' && (status === 'images_submitted' || status === 'chapters_complete')) {
    // Check both book_id (legacy single-book) and book_ids (cross-book batches)
    const pendingImages = await db.collection('batch_jobs').countDocuments({
      $or: [
        { book_id: bookId },
        { book_ids: bookId },
      ],
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
      console.log(`  Pipeline: ${bookId} ${status} -> images_complete (${imgCount} images)`);
    }
  }
}

// ── Batch Health Probe ──

/**
 * Reconcile DB batch_jobs state with real Gemini-side state.
 * - Counts active jobs on each Gemini key via SDK batches.list()
 * - Detects DB zombies (pending in DB, no gemini_job_name)
 * - Detects Gemini orphans (active on Gemini, not tracked in DB) and cancels them
 * - Computes recent completion velocity
 * - Returns metrics for logging and system_config persistence
 */
async function reconcileBatchState(db) {
  const activeStates = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING']);
  const result = {
    geminiActive: 0,
    geminiActiveByKey: [],
    dbActive: 0,
    dbZombies: 0,
    orphansCancelled: 0,
    ghostsDetected: 0,
    recentCompletions1h: 0,
    recentCompletions6h: 0,
    recentPagesSaved1h: 0,
    recentPagesSaved6h: 0,
    healthy: true,
    issues: [],
  };

  // 1. Count real Gemini active jobs per key
  const geminiJobNames = new Set();
  for (let i = 0; i < SDK_CLIENTS.length; i++) {
    let keyActive = 0;
    try {
      const pager = await SDK_CLIENTS[i].batches.list({ config: { pageSize: 100 } });
      let consecutiveInactive = 0;
      for await (const job of pager) {
        if (activeStates.has(job.state)) {
          keyActive++;
          if (job.name) geminiJobNames.add(job.name);
          consecutiveInactive = 0;
        } else {
          consecutiveInactive++;
          if (consecutiveInactive >= 50) break;
        }
      }
    } catch (err) {
      result.issues.push(`Key ${i} list failed: ${err.message?.substring(0, 80)}`);
    }
    result.geminiActiveByKey.push(keyActive);
    result.geminiActive += keyActive;
  }

  // 2. Count DB active jobs and detect zombies
  const dbActiveJobs = await db.collection('batch_jobs').find({
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
  }).project({ _id: 1, job_name: 1, gemini_job_name: 1, status: 1, created_at: 1 }).toArray();

  result.dbActive = dbActiveJobs.length;

  // Zombies: in DB as active but no job_name (never submitted to Gemini)
  const zombies = dbActiveJobs.filter(j => !j.job_name && !j.gemini_job_name);
  result.dbZombies = zombies.length;

  // Auto-cancel DB zombies older than 1 hour
  if (zombies.length > 0) {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const staleZombies = zombies.filter(z => new Date(z.created_at) < oneHourAgo);
    if (staleZombies.length > 0) {
      await db.collection('batch_jobs').updateMany(
        { _id: { $in: staleZombies.map(z => z._id) } },
        { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: 'batch-health: zombie (no gemini_job_name, >1h old)' } }
      );
      result.dbZombies = staleZombies.length;
      result.issues.push(`Auto-cancelled ${staleZombies.length} DB zombie jobs`);
    }
  }

  // 3. Detect Gemini orphans (active on Gemini, not in DB) and cancel them
  const dbJobNames = new Set(dbActiveJobs.map(j => j.job_name || j.gemini_job_name).filter(Boolean));
  const orphanNames = [...geminiJobNames].filter(name => !dbJobNames.has(name));
  if (orphanNames.length > 0) {
    for (const name of orphanNames) {
      for (const client of SDK_CLIENTS) {
        try { await client.batches.cancel({ name }); result.orphansCancelled++; break; } catch (_) {}
      }
    }
    if (result.orphansCancelled > 0) {
      result.issues.push(`Cancelled ${result.orphansCancelled} Gemini orphans`);
    }
  }

  // 3b. Detect ghost jobs: named in DB but not found on Gemini (404)
  // These sit in pending forever because processOneJob returns 'not_found' which wasn't handled.
  // Now processOneJob marks them failed, but reconcile also catches stragglers.
  const namedDbJobs = dbActiveJobs.filter(j => j.job_name || j.gemini_job_name);
  const ghostJobs = namedDbJobs.filter(j => {
    const name = j.job_name || j.gemini_job_name;
    return !geminiJobNames.has(name);
  });
  result.ghostsDetected = ghostJobs.length;
  if (ghostJobs.length > 0) {
    // Only auto-fail ghosts older than 30 minutes (give fresh jobs time to appear on Gemini)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
    const staleGhosts = ghostJobs.filter(g => new Date(g.created_at) < thirtyMinAgo);
    if (staleGhosts.length > 0) {
      await db.collection('batch_jobs').updateMany(
        { _id: { $in: staleGhosts.map(g => g._id) } },
        { $set: { status: 'failed', error: 'Ghost: named in DB but 404 on all Gemini keys', updated_at: new Date() } }
      );
      result.issues.push(`Auto-failed ${staleGhosts.length} ghost jobs (named but 404 on Gemini)`);
    }
  }

  // 4. Recent completion velocity
  const now = Date.now();
  result.recentCompletions1h = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['completed', 'saved'] }, updated_at: { $gte: new Date(now - 3600000) }
  });
  result.recentCompletions6h = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['completed', 'saved'] }, updated_at: { $gte: new Date(now - 6 * 3600000) }
  });
  result.recentPagesSaved1h = await db.collection('pages').countDocuments({
    'ocr.updated_at': { $gte: new Date(now - 3600000) }
  });
  result.recentPagesSaved6h = await db.collection('pages').countDocuments({
    'ocr.updated_at': { $gte: new Date(now - 6 * 3600000) }
  });

  // 5. Health assessment
  if (result.geminiActive > 80) {
    result.healthy = false;
    result.issues.push(`Gemini active jobs (${result.geminiActive}) near limit (100)`);
  }
  if (result.dbZombies > 10) {
    result.healthy = false;
    result.issues.push(`${result.dbZombies} DB zombie jobs`);
  }
  if (result.geminiActive > 0 && result.recentCompletions1h === 0 && result.recentPagesSaved1h === 0) {
    // Jobs are active but nothing completing — possible freeze
    result.healthy = false;
    result.issues.push(`${result.geminiActive} Gemini jobs active but 0 completions in last hour`);
  }

  return result;
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check processing_control pause.
  // Selective unpause: if a scope is configured (allow_book_ids / allow_collections),
  // keep collecting — pulling already-generated batch results costs no Gemini spend,
  // and the scoped books the orchestrator submitted while paused need their results
  // ingested or the OCR/translation text never lands. Empty scope = full stop.
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const _scopeActive = hasScope(control);
  if (control?.paused && !_scopeActive) {
    console.log(`[batch-collector] Pipeline paused. Exiting.`);
    await client.close();
    process.exit(0);
  }
  if (control?.paused && _scopeActive) {
    console.log(`[batch-collector] Paused, but selective-unpause scope is active — collecting results (free) for in-flight jobs.`);
  }

  // ── Batch Health Probe: reconcile DB vs Gemini state ──
  // Runs every collector cycle. Detects orphans (in Gemini but not DB, or vice versa),
  // auto-cancels Gemini orphans, and writes metrics for the enrichment snapshot.
  const batchHealth = await reconcileBatchState(db);
  console.log(`[batch-health] Gemini active: ${batchHealth.geminiActive} | DB active: ${batchHealth.dbActive} | Orphans cancelled: ${batchHealth.orphansCancelled}`);

  // Persist batch health for /status and enrichment snapshot
  try {
    await db.collection('system_config').updateOne(
      { _id: 'batch_health' },
      { $set: { ...batchHealth, updated_at: new Date() } },
      { upsert: true }
    );
  } catch (_) { /* non-blocking */ }

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
  let notFoundCount = 0;
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
        // Handle cross-book batches: iterate all bookIds
        const allBookIds = val.bookIds || (val.bookId ? [val.bookId] : []);
        for (const bid of allBookIds) {
          bookIdsToUpdate.add(bid);
          pipelineAdvances.push({ bookId: bid, type: val.type });
          // Track books where all pages hit RECITATION — these need Lambda retry
          if (val.successCount === 0 && val.recitationCount > 0) {
            recitationBooks.add(bid);
          }
        }
        if (val.parentJobId) parentIdsToUpdate.add(val.parentJobId);
      } else if (val.status === 'pending') {
        stillPending++;
      } else if (val.status === 'not_found') {
        notFoundCount++;
        // Job has a gemini_job_name but Gemini returns 404 on all keys — it's gone.
        // Mark as failed so it doesn't sit in pending forever.
        const jobToFail = batch[j];
        if (jobToFail && !DRY_RUN) {
          try {
            await db.collection('batch_jobs').updateOne(
              { _id: jobToFail._id },
              { $set: { status: 'failed', error: 'Gemini 404: job no longer exists on any key', updated_at: new Date() } }
            );
            console.log(`  NOT_FOUND -> failed: ${jobToFail.gemini_job_name || jobToFail.job_name} (book: ${jobToFail.book_id})`);
            // Track for pipeline advance so book can be requeued
            const allBookIds = jobToFail.book_ids || (jobToFail.book_id ? [jobToFail.book_id] : []);
            for (const bid of allBookIds) {
              bookIdsToUpdate.add(bid);
              pipelineAdvances.push({ bookId: bid, type: jobToFail.type });
            }
          } catch (e) { console.error(`  Failed to mark 404 job: ${e.message}`); }
        }
      } else if (val.status === 'failed') {
        errors++;
        const allBookIds = val.bookIds || (val.bookId ? [val.bookId] : []);
        for (const bid of allBookIds) {
          pipelineAdvances.push({ bookId: bid, type: val.type });
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
  // The batch API triggers RECITATION on ubiquitous canonical texts. Escalation
  // before a permanent block (never any model below v3 — see CLAUDE.md):
  //   1. First failure  -> recitation_retry      -> orchestrator retries with gemini-3.1-flash-lite.
  //   2. Second failure -> recitation_retry_lite -> orchestrator retries with gemini-3-flash-preview.
  //   3. Third failure  -> recitation_blocked    -> both Gemini tiers refuse.
  //      Such a book is NOT hopeless: route it to the MinerU + grounded-correction
  //      lane (mineru-ocr-worker.mjs, then ocr-correct-grounded.mjs — #3389), which
  //      reads with an engine that has no recitation filter and then corrects the
  //      result against the page image.
  if (recitationBooks.size > 0) {
    console.log(`\nRECITATION recovery: flagging ${recitationBooks.size} books for retry`);
    for (const bookId of recitationBooks) {
      try {
        const book = await db.collection('books').findOne(
          { id: bookId },
          { projection: { 'pipeline_auto.recitation_retry': 1, 'pipeline_auto.recitation_retry_lite': 1 } }
        );
        const retriedFallback = book?.pipeline_auto?.recitation_retry === true;
        const retriedLite = book?.pipeline_auto?.recitation_retry_lite === true;

        if (retriedLite) {
          // Third RECITATION failure: flash-lite also blocked. Permanently skip.
          await db.collection('books').updateOne(
            { id: bookId },
            {
              $set: {
                'pipeline_auto.status': 'needs_attention',
                'pipeline_auto.last_updated': new Date(),
                'pipeline_auto.recitation_blocked': true,
                'pipeline_auto.recitation_blocked_at': new Date(),
                updated_at: new Date(),
              },
              $unset: { 'pipeline_auto.recitation_retry_lite': '' },
            }
          );
          console.log(`  RECITATION blocked on both Gemini tiers ${bookId} -> needs_attention (route to MinerU + grounded correction, #3389)`);
        } else if (retriedFallback) {
          // Second RECITATION failure: gemini-3.1-flash-lite also blocked. Escalate to gemini-3-flash-preview.
          await db.collection('books').updateOne(
            { id: bookId, 'pipeline_auto.status': { $in: ['ocr_submitted', 'ocr_complete'] } },
            {
              $set: {
                'pipeline_auto.status': 'archive_complete',
                'pipeline_auto.last_updated': new Date(),
                'pipeline_auto.recitation_retry_lite': true,
                updated_at: new Date(),
              },
              $unset: { 'pipeline_auto.recitation_retry': '' },
            }
          );
          console.log(`  RECITATION escalate to flash-lite ${bookId} -> archive_complete (recitation_retry_lite)`);
        } else {
          // First RECITATION failure: reset to archive_complete for retry with fallback model.
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
        }
      } catch (e) { console.error(`  RECITATION reset error ${bookId}: ${e.message}`); }
    }
  }
  // NOTE: Translation-side RECITATION is a separate per-page mechanism in translate-worker.mjs
  // and is NOT handled here. A parallel flash-lite translation-retry tier is a possible follow-up.

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
      const state = getJobState(result.sdkJob);

      if (state !== 'JOB_STATE_SUCCEEDED') continue;

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
            const recoveredBookIds = val.bookIds || (val.bookId ? [val.bookId] : []);
            for (const bid of recoveredBookIds) {
              bookIdsToUpdate.add(bid);
              try { await updateBookCounts(db, bid); } catch (_) {}
              try { await advancePipelineStatus(db, bid, val.type); } catch (_) {}
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

  // ── Nameless Batch Job Reaper: kill batch_jobs created but never submitted to Gemini ──
  // These have no job_name/gemini_job_name — the Gemini API call failed after the DB insert.
  // They block active-job counts and never resolve. Reap after 30 minutes.
  let namelessReaped = 0;
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const namelessResult = await db.collection('batch_jobs').updateMany(
      {
        status: { $in: ['pending', 'processing'] },
        created_at: { $lt: thirtyMinAgo },
        $and: [
          { $or: [{ job_name: { $exists: false } }, { job_name: null }, { job_name: '' }] },
          { $or: [{ gemini_job_name: { $exists: false } }, { gemini_job_name: null }, { gemini_job_name: '' }] },
        ],
        parent_job_id: { $exists: false }, // Don't reap parent jobs (they never have job_name)
      },
      { $set: { status: 'failed', error: 'Nameless: created in DB but never submitted to Gemini', updated_at: new Date() } }
    );
    namelessReaped = namelessResult.modifiedCount;
    if (namelessReaped > 0) console.log(`\n[nameless-reaper] Failed ${namelessReaped} batch jobs with no Gemini job name (>30min old)`);
  } catch (e) { console.error(`[nameless-reaper] Error: ${e.message}`); }

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
  // Parent jobs (no job_name) get stuck at 'completed' or 'processing' because
  // the collector only queries jobs with job_name. Their children already saved
  // the pages. Parent jobs enter 'processing' when some children complete, and
  // 'completed' when all children are done — but both states can linger forever.
  let ghostsCleaned = 0;
  try {
    const ghostResult = await db.collection('batch_jobs').updateMany(
      {
        status: { $in: ['completed', 'processing'] },
        parent_job_id: { $exists: false },
        child_job_ids: { $exists: true },
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
  if (namelessReaped > 0) console.log(`Nameless reaped: ${namelessReaped}`);
  if (zombiesReaped > 0) console.log(`Zombies reaped: ${zombiesReaped}`);
  if (notFoundCount > 0) console.log(`Gemini 404 (gone): ${notFoundCount}`);
  if (ghostsCleaned > 0) console.log(`Ghosts cleaned: ${ghostsCleaned}`);

  // ── 404-on-all-keys alert (#2455) ──
  // A burst of jobs that 404 on EVERY key almost always means key drift between
  // the submitting host (Vercel) and this collector — the jobs exist, we just
  // can't see them (348 jobs were falsely failed this way on 2026-06-05). Email
  // instead of failing silently. 12h cooldown so a drift doesn't spam.
  const NOT_FOUND_ALERT_THRESHOLD = 10;
  if (notFoundCount >= NOT_FOUND_ALERT_THRESHOLD && process.env.RESEND_API_KEY && !DRY_RUN) {
    try {
      const COOLDOWN_MS = 12 * 60 * 60 * 1000;
      const state = await db.collection('system_config').findOne({ _id: 'collector_404_alert_state' });
      const elapsed = state?.last_sent_at ? Date.now() - new Date(state.last_sent_at).getTime() : Infinity;
      if (elapsed >= COOLDOWN_MS) {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Source Library <noreply@sourcelibrary.org>',
          to: process.env.ALERT_EMAIL || 'derek@sourcelibrary.org',
          subject: `[COLLECTOR] ${notFoundCount} batch jobs 404 on all Gemini keys — likely key drift`,
          html: [
            '<h2>Batch jobs invisible to every collector key</h2>',
            `<p><strong>${notFoundCount}</strong> jobs this run returned 404 from <code>batches.get</code> on all ${ALL_KEYS.length} keys and were marked failed.</p>`,
            '<p>This pattern almost always means the submitting host (Vercel) holds a Gemini key this box does not — the jobs exist and their results are recoverable. See memory/pipeline-ops.md (2026-06-05 key-drift lesson): mirror the missing key into the Hetzner env, reset the jobs to pending, and re-run the collector.</p>',
          ].join('\n'),
        });
        await db.collection('system_config').updateOne(
          { _id: 'collector_404_alert_state' },
          { $set: { last_sent_at: new Date(), last_count: notFoundCount } },
          { upsert: true },
        );
        console.log(`[collector] 404-drift alert emailed (${notFoundCount} jobs)`);
      } else {
        console.log(`[collector] 404-drift alert suppressed (cooldown, ${notFoundCount} jobs)`);
      }
    } catch (e) {
      console.error(`[collector] 404-drift alert failed: ${e.message}`);
    }
  }
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
    nameless_reaped: namelessReaped,
    zombies_reaped: zombiesReaped,
    ghosts_cleaned: ghostsCleaned,
    batch_health: batchHealth,
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
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      let pageToken = null;
      do {
        const url = "https://generativelanguage.googleapis.com/v1beta/files?key=" + apiKey + "&pageSize=100" + (pageToken ? "&pageToken=" + pageToken : "");
        const res = await fetch(url);
        if (!res.ok) break;
        const data = await res.json();
        const files = data.files || [];
        for (const f of files) {
          if (new Date(f.createTime) < oneHourAgo) {
            try {
              await fetch("https://generativelanguage.googleapis.com/v1beta/" + f.name + "?key=" + apiKey, { method: "DELETE" });
              totalDeleted++;
            } catch (cleanErr) { /* ignore */ }
          }
        }
        pageToken = data.nextPageToken || null;
      } while (pageToken);
    } catch (listErr) { /* ignore */ }
  }
  if (totalDeleted > 0) console.log("[batch-collector] Deleted " + totalDeleted + " stale files");
}

run().then(() => cleanupStaleFiles()).catch(err => { console.error(err); process.exit(1); });
