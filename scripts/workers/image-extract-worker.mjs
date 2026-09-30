#!/usr/bin/env node
/**
 * Hetzner Realtime Image Extraction Worker
 *
 * Extracts illustrations from book page scans via direct Gemini generateContent calls.
 * Replaces the Batch API path which was blocked by batch quota limits while
 * only using 0.6% of available RPM capacity.
 *
 * Architecture:
 * - Picks up books in 'chapters_complete' status (or catch-up books)
 * - Downloads page images and calls Gemini Flash vision per page
 * - Writes detected_images to pages + gallery_images collection
 * - Advances pipeline status to 'images_complete'
 * - Runs on Hetzner cron via scheduler
 *
 * Explicit-list mode (operator run, #5197):
 *   node scripts/workers/image-extract-worker.mjs --books-file ids.txt [--since <ISO>] [--sweep-tag <kebab>]
 * Processes exactly the listed books (one id per line) instead of the status-driven
 * selection. Still gated by the dial / a scope envelope: ids outside an open envelope
 * are dropped, never run. A listed book whose status the normal selection would not
 * pick (parked, failed, archive_complete, ...) KEEPS its status — the worker writes
 * pages.detected_images + gallery_images but never rewrites `pipeline_auto.status`
 * for it (pipeline-status-truth.md). `--since` skips books already run after that
 * instant (page marker `image_extraction_updated_at`), so a re-invocation resumes.
 * `--sweep-tag` records one `sweep_log` row per book attempted (pages sent, images,
 * prior status) so "attempted, found nothing" is a row, not silence.
 * Env overrides for a long operator run: IMAGE_EXTRACT_BOOKS_PER_RUN, IMAGE_EXTRACT_DEADLINE_MIN.
 *
 * Batch routing (#4747): when IMAGE_EXTRACTION_USE_BATCH is anything but 'false' (set in
 * /root/sourcelibrary/.env.production.local on Hetzner), this worker stands down on the
 * status-driven selection and the orchestrator's Phase 8 submits those books to the Gemini
 * Batch API instead; batch-collector.mjs writes the results. Set it to 'false' to return
 * to realtime. Explicit-list mode (--books-file) always runs realtime.
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { buildGalleryDoc } from '../lib/gallery-doc.mjs';
import {
  GROUNDING_RADIUS, SAFETY_SETTINGS, SCAN_QUALITY_VERSION,
  buildImageExtractionText, imageExtractionGenerationConfig,
  parseImageExtractionResponse, computeBookScanQualityRollup,
} from '../lib/image-extraction-request.mjs';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { logUsage, outputTokensFrom } from './lib/supabase-usage-logger.mjs';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { normalizeBbox, normalizeRotation } from '../lib/bbox.mjs';
import { isTrivialGalleryDetection } from '../lib/gallery-image-types.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import fs from 'fs';

// ── CLI (explicit-list mode, see header) ──
const ARGV = process.argv.slice(2);
const argVal = (name) => { const i = ARGV.indexOf(`--${name}`); return i >= 0 ? ARGV[i + 1] : null; };
const BOOKS_FILE = argVal('books-file');
const SINCE = argVal('since') ? new Date(argVal('since')) : null;
const SWEEP_TAG = argVal('sweep-tag');
if (SINCE && Number.isNaN(SINCE.getTime())) { console.error('--since must be an ISO date'); process.exit(2); }
if ((SINCE || SWEEP_TAG) && !BOOKS_FILE) { console.error('--since / --sweep-tag need --books-file'); process.exit(2); }
// Routing (#4747, decided 2026-09-30): the orchestrator's Phase 8 reads the same flag and submits
// status-driven extraction to the Gemini Batch API (same model, half the price, boxes matched the
// realtime noise floor in PR #5238). Same default as the orchestrator: anything but 'false' = batch.
const BATCH_ROUTED = process.env.IMAGE_EXTRACTION_USE_BATCH !== 'false';
// Statuses the normal selection picks; anything else keeps its status in explicit mode.
const STATUS_ADVANCEABLE = new Set(['chapters_complete', 'complete', undefined, null]);

sharp.concurrency(1);

// ── Config ──
const CONCURRENCY = 25;           // Books processed simultaneously
const PAGE_CONCURRENCY = 10;      // Pages per book processed simultaneously
const IMAGE_DOWNLOAD_CONCURRENCY = 40;
const BOOKS_PER_RUN = Number(process.env.IMAGE_EXTRACT_BOOKS_PER_RUN) || 250;
const RUN_DEADLINE_MS = (Number(process.env.IMAGE_EXTRACT_DEADLINE_MIN) || 25) * 60 * 1000; // 25 min default (scheduler runs every 2 min)
const MODEL = 'gemini-3-flash-preview'; // Vision task needs accuracy
const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];

// Pages whose <image-desc> tags are ALL one of these (type, significance) combos
// can be skipped — OCR has already classified them as trivial (drop caps, library
// stamps, printer's marks, blank-page framing, decorative initials). Spot-checked
// on 8,033 never-extracted visible books — these categories never contain real
// gallery-worthy illustrations. Saves ~60% of the vision-call budget.
//
// Rules with `*` match any significance value.
const SKIP_MARKUP_RULES = [
  { type: 'symbol', significance: '*' },          // yig-mgo marks, library stamps
  { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' },        // printer's ornaments, tailpieces
  { type: 'blank', significance: '*' },
  { type: 'exlibris', significance: '*' },        // ownership bookplates — provenance, not content
  { type: 'bookplate', significance: '*' },
  { type: 'decorative', significance: 'low' },    // drop caps, framing rules
  { type: "printer's mark", significance: 'low' },
  { type: 'photograph', significance: 'low' },    // binding/fore-edge photos
  { type: 'photographic', significance: 'low' },
];

function shouldSkipPageByMarkup(ocrData) {
  if (!ocrData) return false;
  // If the page has <detected-images> JSON, never skip (we want to parse it).
  if (ocrData.includes('<detected-images>')) return false;
  const tags = [...ocrData.matchAll(/<image-desc([^>]*)>/g)];
  if (tags.length === 0) return false; // no markup to judge by — extract
  for (const m of tags) {
    const type = (m[1].match(/type="([^"]+)"/) || [])[1];
    const sig = (m[1].match(/significance="([^"]+)"/) || [])[1];
    const matchedRule = SKIP_MARKUP_RULES.find(r =>
      r.type === type && (r.significance === '*' || r.significance === sig)
    );
    if (!matchedRule) return false; // at least one tag is non-trivial — extract
  }
  return true; // every tag matched a skip rule
}

// ── API Keys (exclude free tier KEY_4) ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => {
    if (i + 2 === 4) return null; // Skip KEY_4 (free tier)
    return process.env[`GEMINI_API_KEY_${i + 2}`];
  }),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('[IMAGE-EXTRACT] No Gemini API keys configured');
  process.exit(1);
}

let _keyIndex = 0;
function getClient() {
  return new GoogleGenerativeAI(API_KEYS[_keyIndex % API_KEYS.length]);
}
function rotateKey() {
  _keyIndex++;
  console.log(`[IMAGE-EXTRACT] Rotated to key ${(_keyIndex % API_KEYS.length) + 1}/${API_KEYS.length}`);
}

// ── Helpers ──
// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

async function fetchImage(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      buffer,
      data: buffer.toString('base64'),
      mimeType: contentType.split(';')[0].trim(),
    };
  } catch {
    return null;
  }
}

// Layer 1 deterministic characteristics — sharp pixel-stats + Laplacian variance,
// histogram entropy, bimodality, chroma spread. Returns null on decode failure.
async function computeImageCharacteristics(buffer) {
  try {
    const [meta, stats] = await Promise.all([
      sharp(buffer).metadata(),
      sharp(buffer).stats(),
    ]);
    const ch = stats.channels;
    if (!ch || ch.length === 0) return null;

    const numChannels = ch.length;
    const meanBrightness = ch.reduce((s, c) => s + c.mean, 0) / numChannels;
    const meanStdev = ch.reduce((s, c) => s + c.stdev, 0) / numChannels;
    const dynamicRange = Math.max(...ch.map(c => c.max - c.min));
    const chromaSpread = numChannels >= 3
      ? Math.max(
          Math.abs(ch[0].mean - ch[1].mean),
          Math.abs(ch[1].mean - ch[2].mean),
          Math.abs(ch[0].mean - ch[2].mean),
        )
      : 0;

    // Downsample once to grayscale for Laplacian + entropy + bimodality.
    const small = await sharp(buffer)
      .resize(512, null, { fit: 'inside' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = small;
    const w = info.width;
    const h = info.height;

    let lapSum = 0, lapSumSq = 0, lapN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = -4 * data[i] + data[i - 1] + data[i + 1] + data[i - w] + data[i + w];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapN++;
      }
    }
    const lapMean = lapN ? lapSum / lapN : 0;
    const sharpnessVar = lapN ? lapSumSq / lapN - lapMean * lapMean : 0;

    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    let entropy = 0;
    for (const c of hist) {
      if (c) {
        const p = c / data.length;
        entropy -= p * Math.log2(p);
      }
    }
    const sortedHist = [...hist].sort((a, b) => b - a);
    const bimodality = (sortedHist[0] + sortedHist[1]) / data.length;

    const pixels = (meta.width || 1) * (meta.height || 1);
    const bytesPerPixel = buffer.length / pixels;
    const megapixels = pixels / 1_000_000;

    const flags = {
      is_blank: dynamicRange < 5 && sharpnessVar < 10,
      is_monochrome: chromaSpread < 5,
      is_bitonal: bimodality > 0.5 && entropy < 4,
      is_over_compressed: bytesPerPixel < 0.015,
      is_low_resolution: megapixels < 1,
    };

    return {
      width: meta.width,
      height: meta.height,
      megapixels: Math.round(megapixels * 100) / 100,
      bytes_per_pixel: Math.round(bytesPerPixel * 1000) / 1000,
      mean_brightness: Math.round(meanBrightness * 10) / 10,
      mean_stdev: Math.round(meanStdev * 10) / 10,
      dynamic_range: dynamicRange,
      chroma_spread: Math.round(chromaSpread * 10) / 10,
      sharpness_var: Math.round(sharpnessVar),
      histogram_entropy: Math.round(entropy * 100) / 100,
      bimodality: Math.round(bimodality * 1000) / 1000,
      flags,
      version: SCAN_QUALITY_VERSION,
    };
  } catch {
    return null;
  }
}



async function setPipelineStatus(db, bookId, status, extra = {}) {
  const update = {
    'pipeline_auto.status': status,
    'pipeline_auto.updated_at': new Date(),
    updated_at: new Date(),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.startsWith('pipeline_auto.') ? k : `pipeline_auto.${k}`, v])),
  };
  // Also set legacy pipeline_status
  update.pipeline_status = status;
  await db.collection('books').updateOne({ id: bookId }, { $set: update });
}

async function revalidateBookPage(bookId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.REVALIDATE_SECRET) headers['x-revalidate-secret'] = process.env.REVALIDATE_SECRET;
    await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers });
  } catch { /* best-effort */ }
}

// ── Process one page ──
// The request (prompt, schema, grounding, generationConfig) comes from
// scripts/lib/image-extraction-request.mjs; the orchestrator's Batch API path
// sends the same one (#4747).
async function extractImagesFromPage(page, book, groundingCtx) {
  const url = getPageImageUrl(page);
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;

  const image = await fetchImage(url);
  if (!image) return null;

  // Layer 1 — deterministic characteristics from the raw buffer.
  // Run in parallel with the Gemini call to keep latency flat.
  const characteristicsPromise = computeImageCharacteristics(image.buffer);

  const model = getClient().getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: imageExtractionGenerationConfig(),
  });

  const requestText = buildImageExtractionText({
    book,
    page,
    pagesByNumber: groundingCtx?.pagesByNumber,
    bookSummary: groundingCtx?.bookSummary || '',
  });

  const result = await model.generateContent([
    { text: requestText },
    { inlineData: { mimeType: image.mimeType, data: image.data } },
  ]);

  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata || {};
  const characteristics = await characteristicsPromise;

  return {
    pageId: page.id,
    page, // carry the page doc forward so the gallery materializer can read photo fields + page_number
    text,
    characteristics,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: outputTokensFrom(usage),
  };
}

// ── Process one book ──
async function processBook(db, book) {
  // Find candidate pages
  const rawCandidates = await db.collection('pages')
    .find({
      book_id: book.id,
      page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
      $or: [
        { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
        { 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
      ],
    }, { projection: { id: 1, page_number: 1, page_type: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, crop: 1, split_from_spread: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray();

  // Pre-filter: drop pages where OCR has already classified all illustrations
  // as trivial (drop caps, library stamps, etc.) — saves the vision call.
  // Only apply to pages outside the IMAGE_CANDIDATE_PAGE_TYPES list, since
  // a page typed `illustration`/`frontispiece`/etc. is the page-typer's
  // affirmative judgment.
  let skippedTrivial = 0;
  const candidatePages = rawCandidates.filter(p => {
    const inCandidateType = IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type);
    if (inCandidateType) return true;
    if (shouldSkipPageByMarkup(p.ocr?.data)) {
      skippedTrivial++;
      return false;
    }
    return true;
  });
  if (skippedTrivial > 0) {
    console.log(`  [${book.title?.slice(0, 50)}] skipped ${skippedTrivial} trivial-markup pages`);
  }

  if (candidatePages.length === 0) {
    if (!book._preserveStatus) await setPipelineStatus(db, book.id, 'images_complete');
    return { title: book.title, pages: 0, images: 0, skipped: true };
  }

  // Surrounding-text grounding (#2707): fetch the page window around each
  // illustration so the captioner can read the narrative the picture sits in.
  // Neighbours are usually NOT illustration pages (text / blank), so they need a
  // separate light fetch. One query per book over the union of windows. When an
  // illustration is isolated among blanks, buildPageGrounding falls back to the
  // book summary instead.
  const candidateNumbers = candidatePages.map(p => p.page_number).filter(n => typeof n === 'number');
  const windowNumbers = new Set();
  for (const n of candidateNumbers) {
    for (let d = -GROUNDING_RADIUS; d <= GROUNDING_RADIUS; d++) windowNumbers.add(n + d);
  }
  const pagesByNumber = new Map();
  if (windowNumbers.size > 0) {
    const windowPages = await db.collection('pages')
      .find(
        { book_id: book.id, page_number: { $in: [...windowNumbers] } },
        { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
      )
      .toArray();
    for (const wp of windowPages) pagesByNumber.set(wp.page_number, wp);
  }
  const groundingCtx = { pagesByNumber, bookSummary: book.summary || '' };

  const now = new Date();
  let totalImages = 0;
  let pagesProcessed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const galleryDocs = [];
  const bulkOps = [];

  // Process pages with concurrency
  for (let i = 0; i < candidatePages.length; i += PAGE_CONCURRENCY) {
    const chunk = candidatePages.slice(i, i + PAGE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(page => extractImagesFromPage(page, book, groundingCtx))
    );

    for (const settled of results) {
      if (settled.status !== 'fulfilled' || !settled.value) {
        if (settled.reason?.message?.includes('429') || settled.reason?.message?.includes('RESOURCE_EXHAUSTED')) {
          rotateKey();
        }
        continue;
      }

      const { pageId, page, text, characteristics, inputTokens, outputTokens } = settled.value;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      pagesProcessed++;

      const { extracted_images: extractedRaw, scan_quality: scanQualityRaw } = parseImageExtractionResponse(text);

      // Build the page-level scan_quality object that will land on `pages` and
      // be inherited by each gallery_image extracted from this page.
      const pageScanQuality = scanQualityRaw
        ? {
            ...scanQualityRaw,
            model: MODEL,
            version: SCAN_QUALITY_VERSION,
            assessed_at: now,
          }
        : null;

      const pageSet = {
        image_extraction_updated_at: now,
        updated_at: now,
      };
      if (characteristics) pageSet.image_characteristics = characteristics;
      if (pageScanQuality) pageSet.scan_quality = pageScanQuality;

      if (extractedRaw.length > 0) {
        const detectedImages = extractedRaw.map(img => ({
          description: img.description || '',
          type: img.type || 'unknown',
          bbox: normalizeBbox(img.bbox) ?? undefined,
          rotation: normalizeRotation(img.rotation),
          confidence: img.confidence,
          gallery_quality: typeof img.gallery_quality === 'number' ? img.gallery_quality : undefined,
          gallery_rationale: img.gallery_rationale || undefined,
          metadata: img.metadata || undefined,
          museum_description: img.museum_description || undefined,
          detected_at: now,
          detection_source: 'vision_model',
          model: MODEL,
        }));

        totalImages += detectedImages.length;
        pageSet.detected_images = detectedImages;

        // Filter matches src/workers/image-extraction-processor-logic.ts (SQS path):
        //  - bbox required (skips malformed responses / zombie rows)
        //  - gallery_quality must be present and >= QUALITY_THRESHOLD
        // Threshold is under review; coordinate any change with the SQS path
        // and scripts/workers/batch-collector.mjs.
        const QUALITY_THRESHOLD = 0.5;
        // Inherit page-level scan quality so the gallery_image carries it standalone.
        // Per-crop sharpness can be added later in a separate pass on extracted_url.
        const inheritedScanQuality = pageScanQuality
          ? {
              score: pageScanQuality.scan_score,
              scan_class: pageScanQuality.scan_class,
              illustration_fidelity: pageScanQuality.illustration_fidelity,
              page_completeness: pageScanQuality.page_completeness,
              concerns: pageScanQuality.concerns,
              source: 'page_inherited',
              version: SCAN_QUALITY_VERSION,
              assessed_at: now,
            }
          : null;
        const pageImageCharacteristics = characteristics
          ? {
              megapixels: characteristics.megapixels,
              sharpness_var: characteristics.sharpness_var,
              chroma_spread: characteristics.chroma_spread,
              flags: characteristics.flags,
            }
          : null;
        for (let di = 0; di < detectedImages.length; di++) {
          const img = detectedImages[di];
          if (!img.bbox) continue;
          if (typeof img.gallery_quality !== 'number') continue;
          if (img.gallery_quality < QUALITY_THRESHOLD) continue;
          // A small decorative or an initial is not gallery content whatever its
          // quality score — the prompt's SKIP list was never enforced (#4780).
          if (isTrivialGalleryDetection(img)) continue;
          // Build the fully-denormalized doc via the shared helper so the field
          // set stays identical across all writers (#2531). `page` is the source
          // page doc with photo fields + page_number; `book` carries visible/
          // hidden/provider so the image is gallery-visible without a sync pass.
          galleryDocs.push(buildGalleryDoc({
            page,
            book,
            detectedImage: img,
            index: di,
            now,
            scanQuality: inheritedScanQuality,
            pageImageCharacteristics,
          }));
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { id: pageId },
          update: { $set: pageSet },
        },
      });
    }
  }

  // Write results
  if (bulkOps.length > 0) {
    await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
  }

  if (galleryDocs.length > 0) {
    try {
      await db.collection('gallery_images').bulkWrite(
        galleryDocs.map(doc => ({
          updateOne: {
            filter: { id: doc.id },
            update: { $set: doc },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    } catch (err) {
      console.error(`  Gallery write error: ${err.message}`);
    }
  }

  // Update book detected_images_count
  const imgCount = await db.collection('pages').countDocuments({
    book_id: book.id,
    'detected_images.0': { $exists: true },
  });
  const bookUpdate = { detected_images_count: imgCount, updated_at: now };

  // Phase 2: roll up page-level scan_quality (v2) into book.scan_quality so downstream
  // use cases (dedupe, re-source queue, dashboards) don't have to aggregate on the fly.
  // Best-effort: any error here doesn't fail the book or block pipeline advance.
  try {
    const rollup = await computeBookScanQualityRollup(db, book.id);
    if (rollup) bookUpdate.scan_quality = rollup;
  } catch (err) {
    console.error(`  scan_quality rollup failed for ${book.id}: ${err.message}`);
  }

  await db.collection('books').updateOne(
    { id: book.id },
    { $set: bookUpdate },
  );

  // Advance pipeline — unless this is an explicit-list book whose status the
  // normal selection would never have picked (parked/failed/mid-pipeline):
  // extraction is a side lane for it, not a stage it has reached.
  if (!book._preserveStatus) await setPipelineStatus(db, book.id, 'images_complete');
  revalidateBookPage(book.id).catch(() => {});

  // Log usage
  await logUsage({
    type: 'extract_images', mode: 'realtime', model: MODEL,
    book_id: book.id, book_title: book.title,
    page_count: pagesProcessed,
    input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
    endpoint: 'hetzner/image-extract-worker',
  }, db).catch(() => {});

  return { title: book.title, pages: pagesProcessed, images: totalImages, skipped: false };
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  console.log(`[IMAGE-EXTRACT] Worker starting — ${new Date().toISOString()}`);
  console.log(`[IMAGE-EXTRACT] Keys: ${API_KEYS.length}, concurrency: ${CONCURRENCY}, page-concurrency: ${PAGE_CONCURRENCY}`);

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db('bookstore');

  // Check processing control. Selective unpause: scoped books extract while
  // globally paused; SCOPE_FILTER confines every candidate query (empty {} in
  // normal operation).
  const ctrl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(ctrl)) {
    console.log('[IMAGE-EXTRACT] Pipeline paused, exiting');
    await client.close();
    return;
  }
  let SCOPE_FILTER = {};
  if (ctrl?.paused && hasScope(ctrl)) {
    const scopeIds = [...await resolveScopeBookIds(db, ctrl)];
    SCOPE_FILTER = { id: { $in: scopeIds } };
    console.log(`[IMAGE-EXTRACT] PAUSED globally, scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  // The dial caps money regardless of pause/scope state (#3826): a scope
  // confines WHICH books, the budget caps HOW MUCH. Vision calls are paid work.
  // A scope envelope (#4540) can open a confined lane when the dial is closed.
  const _gate = await budgetAllowsDispatchScoped(db, 'image-extract-worker', { control: ctrl });
  if (!_gate.allowed) {
    await client.close();
    return;
  }
  if (_gate.envelopeIds) {
    SCOPE_FILTER = { id: { $in: [..._gate.envelopeIds] } };
    console.log(`[IMAGE-EXTRACT] Global dial closed, scope envelope open — confining to ${_gate.envelopeIds.size} envelope book(s).`);
  }

  const PROJECTION = { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, subjects: 1, summary: 1, visible: 1, hidden: 1, 'image_source.provider': 1 };
  let books;
  if (BOOKS_FILE) {
    // Explicit-list mode: the file names the books; the envelope/scope still
    // decides which of them may run. Never widen past the gate.
    const listed = [...new Set(fs.readFileSync(BOOKS_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
    const allowed = SCOPE_FILTER.id ? new Set(SCOPE_FILTER.id.$in) : null;
    const runnable = allowed ? listed.filter(id => allowed.has(id)) : listed;
    console.log(`[IMAGE-EXTRACT] Explicit list: ${listed.length} ids, ${runnable.length} inside the open scope/envelope${SINCE ? `, skipping books run since ${SINCE.toISOString()}` : ''}`);
    let skippedDone = 0;
    if (SINCE) {
      const done = new Set((await db.collection('pages').distinct('book_id', { book_id: { $in: runnable }, image_extraction_updated_at: { $gte: SINCE } })));
      skippedDone = runnable.filter(id => done.has(id)).length;
      for (let i = runnable.length - 1; i >= 0; i--) if (done.has(runnable[i])) runnable.splice(i, 1);
    }
    const found = await db.collection('books')
      .find({ id: { $in: runnable } })
      .project({ ...PROJECTION, 'pipeline_auto.status': 1 })
      .toArray();
    const byId = new Map(found.map(b => [b.id, b]));
    books = runnable.map(id => byId.get(id)).filter(Boolean).slice(0, BOOKS_PER_RUN);
    for (const b of books) {
      b._priorStatus = b.pipeline_auto?.status ?? null;
      b._preserveStatus = !STATUS_ADVANCEABLE.has(b._priorStatus);
    }
    const preserved = books.filter(b => b._preserveStatus).length;
    console.log(`[IMAGE-EXTRACT] Explicit list: ${books.length} to run this invocation (${skippedDone} already run, ${runnable.length - found.length} ids not found, ${preserved} keep their status)`);
  } else if (BATCH_ROUTED) {
    // The orchestrator's Phase 8 owns status-driven extraction on the Batch API (#4747).
    // Picking the same chapters_complete books here would race it and pay realtime for them.
    console.log('[IMAGE-EXTRACT] IMAGE_EXTRACTION_USE_BATCH is on: status-driven extraction goes through the orchestrator Batch API path (Phase 8). Standing down; --books-file still runs realtime.');
    books = [];
  } else {
  // Find books ready for image extraction
  books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'chapters_complete', ...SCOPE_FILTER })
    .sort({ processing_priority: -1, hidden: 1 })
    .project(PROJECTION)
    .limit(BOOKS_PER_RUN)
    .toArray();

  // Catch-up: books that reached 'complete' or have no pipeline status but were never image-extracted
  if (books.length < BOOKS_PER_RUN) {
    const catchUp = await db.collection('books')
      .find({
        $or: [
          { 'pipeline_auto.status': { $exists: false } },
          { 'pipeline_auto.status': 'complete' },
        ],
        pages_ocr: { $gt: 0 },
        detected_images_count: { $exists: false },
        ...SCOPE_FILTER,
      })
      .sort({ visible: -1, pages_count: -1 })
      .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, subjects: 1, summary: 1, visible: 1, hidden: 1, 'image_source.provider': 1 })
      .limit(BOOKS_PER_RUN - books.length)
      .toArray();
    if (catchUp.length > 0) {
      books.push(...catchUp);
      console.log(`[IMAGE-EXTRACT] Catch-up: ${catchUp.length} books (complete or pre-pipeline)`);
    }
  }
  } // end status-driven selection

  console.log(`[IMAGE-EXTRACT] Books to process: ${books.length}`);

  if (books.length === 0) {
    console.log('[IMAGE-EXTRACT] No books ready, exiting');
    await client.close();
    return;
  }

  // Process with concurrency pool
  const queue = [...books];
  let processed = 0;
  let totalImages = 0;
  let totalPages = 0;
  let errors = 0;
  const deadline = startTime + RUN_DEADLINE_MS;

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const book = queue.shift();
      try {
        const result = await processBook(db, book);
        processed++;
        totalImages += result.images;
        totalPages += result.pages;
        if (result.skipped) {
          console.log(`  [skip] ${result.title} — no candidates`);
        } else {
          console.log(`  [done] ${result.title} — ${result.pages}pp, ${result.images} images`);
        }
        if (SWEEP_TAG) {
          await recordSweepAction(db, {
            sweep: SWEEP_TAG, book_id: book.id, action: 'image-extract-explicit',
            detail: { pages_sent: result.pages, images: result.images, no_candidates: !!result.skipped, prior_status: book._priorStatus, status_preserved: !!book._preserveStatus },
          }).catch(e => console.error(`  sweep_log write failed for ${book.id}: ${e.message}`));
        }
      } catch (err) {
        errors++;
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          rotateKey();
        }
        console.error(`  [error] ${book.title}: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[IMAGE-EXTRACT] Done — ${processed} books, ${totalPages} pages, ${totalImages} images, ${errors} errors, ${elapsed}s`);

  await client.close();
}

main().catch(err => {
  console.error('[IMAGE-EXTRACT] Fatal:', err);
  process.exit(1);
});
