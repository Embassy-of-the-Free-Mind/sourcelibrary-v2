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
 *   node scripts/workers/pipeline-orchestrator.mjs --phase 8.9 --book=BOOK_ID  # run a specific phase on one book
 */

import { MongoClient, ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { buildPageGrounding } from '../lib/page-grounding.mjs';
import { VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';
import { budgetAllowsDispatch } from '../lib/spend-guard.mjs';
import { getTranslateModelForBook, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenAI } from '@google/genai';
import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logUsage, logUsageAsync } from './lib/supabase-usage-logger.mjs';
import { findTrailingDupes, applyHide } from './lib/trailing-dedup.mjs';
import { getScopeConfig, shouldBypassPause } from './lib/selective-unpause.mjs';
const execFileAsync = promisify(execFile);

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const SQS_TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const SQS_OCR_QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;
const SQS_IMAGE_EXTRACTION_QUEUE_URL = process.env.SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL;

// Gemini Batch API config (for direct OCR submission, bypassing Vercel)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/**
 * Save current page content as a revision before overwriting.
 * Lightweight inline version of src/lib/page-revisions.ts createRevision().
 */
async function saveRevisionBeforeOverwrite(db, pageId, field) {
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
      original_date: fieldData.updated_at,
      created_at: new Date(),
    });
  } catch (e) {
    // Non-fatal — don't block pipeline on revision failure
  }
}

const OCR_MODEL_FLASH = 'gemini-3-flash-preview';
const OCR_MODEL_LITE = 'gemini-3.1-flash-lite';

// Known-broken Gemini model aliases. The discovery API lists these as
// available but generateContent / batch execution returns FAILED_PRECONDITION
// for every page (verified 2026-05-26: 82/82 batches using gemini-3.1-flash-lite-preview
// in 24h returned 0 saved / 100% failed). Add entries as Google retires more aliases.
// The assertion runs from main() so it sees all module-level model constants.
const KNOWN_BROKEN_MODEL_ALIASES = new Set([
  'gemini-3.1-flash-lite-preview', // alias; stable is `gemini-3.1-flash-lite`
]);
function assertModelsAreNotBroken(constants) {
  const bad = Object.entries(constants).filter(([_, v]) => KNOWN_BROKEN_MODEL_ALIASES.has(v));
  if (bad.length) {
    const detail = bad.map(([k, v]) => `  ${k} = "${v}"`).join('\n');
    throw new Error(
      `Refusing to start: one or more model constants are deprecated Gemini aliases:\n${detail}\n` +
      `These accept batches but execute to "All N pages failed". Update to the stable variant ` +
      `(e.g. drop -preview suffix) before re-running. See PR #2065.`
    );
  }
}

// Latin-script languages safe for flash-lite. Anything else (Tibetan, Arabic,
// Hebrew, CJK, Cyrillic, Greek, Syriac, etc.) routes to flash because
// flash-lite hallucinates on low-resource scripts — it over-relies on
// linguistic priors when visual decoding is hard, producing plausible-sounding
// content that has nothing to do with the page. See src/app/blog/tibetan-ocr/.
// Must stay in sync with LATIN_SCRIPT_LANGUAGES in src/lib/types/ai-models.ts.
const LATIN_SCRIPT_LANGS_FOR_LITE = new Set([
  'english', 'en', 'eng',
  'latin', 'la', 'lat',
  'french', 'fr', 'fra',
  'italian', 'it', 'ita',
  'spanish', 'es', 'spa',
  'portuguese', 'pt', 'por',
  'romanian', 'ro', 'ron', 'rum',
  'catalan', 'ca', 'cat',
  'german', 'de', 'deu', 'ger',
  'dutch', 'nl', 'nld', 'dut',
  'swedish', 'sv', 'swe',
  'norwegian', 'no', 'nor',
  'danish', 'da', 'dan',
  'finnish', 'fi', 'fin',
  'icelandic', 'is', 'isl', 'ice',
  'welsh', 'cy', 'cym', 'wel',
  'irish', 'ga', 'gle',
  'polish', 'pl', 'pol',
  'czech', 'cs', 'ces', 'cze',
  'slovak', 'sk', 'slk', 'slo',
  'slovenian', 'sl', 'slv',
  'croatian', 'hr', 'hrv',
  'hungarian', 'hu', 'hun',
  'estonian', 'et', 'est',
  'latvian', 'lv', 'lav',
  'lithuanian', 'lt', 'lit',
  'albanian', 'sq', 'sqi', 'alb',
  'turkish', 'tr', 'tur',
  'indonesian', 'id', 'ind',
  'vietnamese', 'vi', 'vie',
  'malay', 'ms', 'msa',
  'tagalog', 'tl', 'tgl', 'filipino',
  'swahili', 'sw', 'swa',
]);

function getOcrModelForBook(book) {
  // BPH books use Flash Preview for higher quality on historical manuscripts
  if (book?.image_source?.provider === 'bph') return OCR_MODEL_FLASH;
  // Non-Latin scripts: flash-lite hallucinates on low-resource pretraining data
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGS_FOR_LITE.has(lang)) return OCR_MODEL_FLASH;
  return OCR_MODEL_LITE;
}
const OCR_MODEL = OCR_MODEL_FLASH; // Legacy fallback for recitation retry path
const OCR_PROMPT_VERSION = 'v10'; // Read from DB at runtime; this label is for batch_jobs metadata only

// Code provenance (#2297): the git SHA actually checked out on this worker box.
// Hetzner auto-pulls main every ~5 min, so HEAD == the running code. Falls back
// to the Vercel env SHA (if ever run there), then 'dev'. Computed once, cached.
let _codeVersion = null;
async function getCodeVersion() {
  if (_codeVersion) return _codeVersion;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD']);
    _codeVersion = stdout.trim() || 'dev';
  } catch {
    _codeVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev';
  }
  return _codeVersion;
}
const OCR_INLINE_BATCH_SIZE = 20;  // Pages per inline batch (base64 in body, ~20MB limit)
const OCR_FILE_BATCH_SIZE = 1000;  // Pages per file-based batch. With 1500px resize, 1000 pages = ~500MB JSONL (well under 2GB File API limit). Google recommends 1K-5K. Experiment 2026-04-13: identical OCR quality at 1500px vs full-res.
const CROSS_BOOK_BATCH_SIZE = 250; // Smaller batches for cross-book OCR — 500-page cross-book batches have 24% success vs 51% single-book. Half size = less blast radius on Gemini cancellation.
const IMAGE_CONCURRENCY = 20;     // Parallel image downloads per book
const MAX_PAGES_PER_BOOK = 1000;  // Max pages to OCR per book — raised from 500 to match larger batch size

// R2 config for split image uploads (mirrors batch-split-bph.mjs)
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const SPLIT_OVERLAP = 10; // overlap in 0-1000 scale
const SPLIT_PAGE_CONCURRENCY = 5;
const SPLIT_CROPPED_QUALITY = 90;
const SPLIT_DISPLAY_WIDTH = 1200;
const SPLIT_DISPLAY_QUALITY = 85;
const SPLIT_THUMB_WIDTH = 150;
const SPLIT_THUMB_QUALITY = 60;

// Image-extraction pre-filter: skip pages where OCR has already labelled every
// <image-desc> as trivial (drop caps, library stamps, printer's marks, etc.).
// Mirrors logic in image-extract-worker.mjs — keep the two in sync.
const SKIP_MARKUP_RULES = [
  { type: 'symbol', significance: '*' },
  { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' },
  { type: 'blank', significance: '*' },
  { type: 'exlibris', significance: '*' },        // ownership bookplates — provenance, not content
  { type: 'bookplate', significance: '*' },
  { type: 'decorative', significance: 'low' },
  { type: "printer's mark", significance: 'low' },
  { type: 'photograph', significance: 'low' },
  { type: 'photographic', significance: 'low' },
];

function shouldSkipPageByMarkup(ocrData) {
  if (!ocrData) return false;
  if (ocrData.includes('<detected-images>')) return false;
  const tags = [...ocrData.matchAll(/<image-desc([^>]*)>/g)];
  if (tags.length === 0) return false;
  for (const m of tags) {
    const type = (m[1].match(/type="([^"]+)"/) || [])[1];
    const sig = (m[1].match(/significance="([^"]+)"/) || [])[1];
    const matched = SKIP_MARKUP_RULES.find(r =>
      r.type === type && (r.significance === '*' || r.significance === sig)
    );
    if (!matched) return false;
  }
  return true;
}

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials for split image upload');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function uploadToR2(r2, key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

function splitPagePaths(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return { full: `${base}-full.jpg`, display: `${base}.jpg`, thumb: `${base}-thumb.jpg` };
}

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const ONLY_PHASE = phaseIdx >= 0 ? parseFloat(args[phaseIdx + 1]) : null;
const bookArg = args.find(a => a.startsWith('--book='));
const BOOK_OVERRIDE = bookArg ? bookArg.split('=')[1] : null;
// Phase 8.5 is RECOVERY, not production: it only rolls a stuck status back to
// the phase before it. It submits nothing and spends nothing. A run limited to
// it is therefore safe under a global pause — and must be allowed, because the
// pause is a SPEND control and gating bookkeeping on it is how six derived
// outputs froze for seven weeks (CLAUDE.md).
const RECOVERY_ONLY = ONLY_PHASE === 8.5;

if (BOOK_OVERRIDE && ONLY_PHASE === null) {
  console.error('--book requires --phase to be specified');
  process.exit(1);
}

// Submission limits — defaults, may be reduced by DB health probe
let ENROLL_LIMIT = 100;
let ARCHIVE_LIMIT = 500;
let OCR_SUBMIT_LIMIT = 200;
const MAX_ACTIVE_BATCH_OCR = 60; // Gemini concurrent batch limit is 100 total (OCR + images). Keep headroom for image extraction.
let METADATA_ENRICH_LIMIT = 50;
let TRANSLATE_SUBMIT_LIMIT = 50;
let MAX_INFLIGHT_TRANSLATIONS = 60; // Total books in translate_submitted — caps concurrent workers
let ENRICH_LIMIT = 30;
let CHAPTER_LIMIT = 50;
let IMAGE_SUBMIT_LIMIT = 50;
let FINALIZE_LIMIT = 200;
let TRANSLITERATE_LIMIT = 10;  // Books per run (pages processed inline)
const TRANSLITERATE_CONCURRENCY = 10;  // Parallel Gemini calls per book
let MAX_ACTIVE_IMAGE_JOBS = 50;
const PREVIEW_PAGE_COUNT = 25;
let PREVIEW_LIMIT = 20; // Books per run to queue preview OCR
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 14;

// Art/visual object providers — these are not text books and should never enter the pipeline
const ART_PROVIDERS = ['wikimedia_commons', 'rijksmuseum', 'met', 'cleveland'];

// Delay between API calls (ms) to avoid overwhelming production
const API_DELAY_MS = 500;

// ── DB Health Probe (ported from src/lib/adaptive-limits.ts) ──
// Probes DB latency and active job count before each run.
// On degraded: halves all submission limits.
// On critical: slams to minimums and cancels pending jobs.

async function probeDbHealth(db) {
  const t0 = Date.now();
  let findMs = 0, countMs = 0, activeJobs = 0;

  // Signal 1: Query latency — time a find + countDocuments on pages
  try {
    const sampleBook = await db.collection('books').findOne(
      { 'pipeline_auto.status': { $exists: true } },
      { projection: { id: 1 }, maxTimeMS: 3000 }
    );
    if (sampleBook) {
      const t1 = Date.now();
      await db.collection('pages').findOne(
        { book_id: sampleBook.id, 'translation.data': { $exists: true } },
        { projection: { id: 1 }, maxTimeMS: 3000 }
      );
      findMs = Date.now() - t1;

      const t2 = Date.now();
      await db.collection('pages').countDocuments(
        { book_id: sampleBook.id, 'ocr.data': { $exists: true, $ne: '' } },
        { maxTimeMS: 3000 }
      );
      countMs = Date.now() - t2;
    }
  } catch {
    findMs = 3000; // treat timeout as worst-case
    countMs = 3000;
  }

  // Signal 2: User-facing query latency — tests the browse pattern that actual users hit.
  // The pages-level probes above can report "healthy" (indexed findOne) while browse
  // queries time out due to WiredTiger cache pressure from write amplification.
  let browseMs = 0;
  try {
    const t3 = Date.now();
    await db.collection('books').find(
      { visible: true, pages_count: { $gt: 0 } }
    ).sort({ created_at: -1 }).limit(10).project({ _id: 1 }).toArray();
    browseMs = Date.now() - t3;
  } catch {
    browseMs = 5000; // treat timeout as worst-case
  }

  // Signal 3: Active jobs
  try {
    activeJobs = await db.collection('jobs').countDocuments(
      { status: 'processing' },
      { maxTimeMS: 5000 }
    );
  } catch {
    activeJobs = 999; // assume worst-case
  }

  // Grade — based on actual DB latency, not job count.
  // Job count was a proxy for DB load but stopped correlating when translation
  // moved to Hetzner (jobs stay "processing" for hours without DB pressure).
  // If high job counts actually stress Atlas, latency metrics will catch it.
  // browseMs is informational only — the $ne:true query is inherently slow on Atlas
  // and produces false positives that starve the pipeline. Use findMs/countMs for grading.
  let grade = 'healthy';
  if (findMs > 1000 || countMs > 1500) grade = 'critical';
  else if (findMs > 300 || countMs > 500) grade = 'degraded';

  const duration = Date.now() - t0;
  console.log(`[health] grade=${grade} find=${findMs}ms count=${countMs}ms browse=${browseMs}ms jobs=${activeJobs} (probed in ${duration}ms)`);

  // Apply throttling
  if (grade === 'critical') {
    console.log('[health] CRITICAL — slamming all limits to minimums, cancelling pending jobs');
    ENROLL_LIMIT = 5;
    ARCHIVE_LIMIT = 10;
    OCR_SUBMIT_LIMIT = 2;
    METADATA_ENRICH_LIMIT = 2;
    TRANSLATE_SUBMIT_LIMIT = 2;
    MAX_INFLIGHT_TRANSLATIONS = 3;
    ENRICH_LIMIT = 2;
    CHAPTER_LIMIT = 2;
    IMAGE_SUBMIT_LIMIT = 2;
    FINALIZE_LIMIT = 10;
    TRANSLITERATE_LIMIT = 2;
    MAX_ACTIVE_IMAGE_JOBS = 3;
    PREVIEW_LIMIT = 2;

    // Cancel pending jobs to relieve pressure
    try {
      const result = await db.collection('jobs').updateMany(
        { status: 'pending' },
        {
          $set: {
            status: 'cancelled',
            updated_at: new Date(),
            cancelled_at: new Date(),
            cancelled_by: 'adaptive-limits',
          },
        },
      );
      if (result.modifiedCount > 0) {
        console.log(`[health] Cancelled ${result.modifiedCount} pending jobs`);
        // Clear book.job references AND roll back pipeline status so books can be re-submitted
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'translate_submitted' },
          { $set: { 'pipeline_auto.status': 'ocr_complete', updated_at: new Date() }, $unset: { job: '' } },
        );
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'ocr_submitted' },
          { $set: { 'pipeline_auto.status': 'archive_complete', updated_at: new Date() }, $unset: { job: '' } },
        );
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'images_submitted' },
          { $set: { 'pipeline_auto.status': 'chapters_complete', updated_at: new Date() }, $unset: { job: '' } },
        );
      }
    } catch (e) {
      console.error('[health] Failed to cancel pending jobs:', e.message);
    }
  } else if (grade === 'healthy') {
    // Explicitly reset to full defaults — undoes any halving from a previous degraded probe.
    // Without this, a single degraded blip creates a throughput dip that persists until
    // the process restarts (limits are in-memory, halved but never restored).
    ENROLL_LIMIT = 100;
    ARCHIVE_LIMIT = 500;
    OCR_SUBMIT_LIMIT = 200;
    METADATA_ENRICH_LIMIT = 50;
    TRANSLATE_SUBMIT_LIMIT = 50;
    MAX_INFLIGHT_TRANSLATIONS = 60;
    ENRICH_LIMIT = 30;
    CHAPTER_LIMIT = 50;
    IMAGE_SUBMIT_LIMIT = 50;
    FINALIZE_LIMIT = 200;
    TRANSLITERATE_LIMIT = 10;
    MAX_ACTIVE_IMAGE_JOBS = 50;
    PREVIEW_LIMIT = 20;
  } else if (grade === 'degraded') {
    console.log('[health] DEGRADED — halving all submission limits');
    ENROLL_LIMIT = Math.max(5, Math.floor(ENROLL_LIMIT / 2));
    ARCHIVE_LIMIT = Math.max(10, Math.floor(ARCHIVE_LIMIT / 2));
    OCR_SUBMIT_LIMIT = Math.max(5, Math.floor(OCR_SUBMIT_LIMIT / 2));
    METADATA_ENRICH_LIMIT = Math.max(5, Math.floor(METADATA_ENRICH_LIMIT / 2));
    TRANSLATE_SUBMIT_LIMIT = Math.max(2, Math.floor(TRANSLATE_SUBMIT_LIMIT / 2));
    MAX_INFLIGHT_TRANSLATIONS = Math.max(5, Math.floor(MAX_INFLIGHT_TRANSLATIONS / 2));
    ENRICH_LIMIT = Math.max(5, Math.floor(ENRICH_LIMIT / 2));
    CHAPTER_LIMIT = Math.max(5, Math.floor(CHAPTER_LIMIT / 2));
    IMAGE_SUBMIT_LIMIT = Math.max(2, Math.floor(IMAGE_SUBMIT_LIMIT / 2));
    FINALIZE_LIMIT = Math.max(10, Math.floor(FINALIZE_LIMIT / 2));
    TRANSLITERATE_LIMIT = Math.max(2, Math.floor(TRANSLITERATE_LIMIT / 2));
    MAX_ACTIVE_IMAGE_JOBS = Math.max(3, Math.floor(MAX_ACTIVE_IMAGE_JOBS / 2));
    PREVIEW_LIMIT = Math.max(2, Math.floor(PREVIEW_LIMIT / 2));
  }

  // Persist health state for admin dashboard visibility
  try {
    await db.collection('system_config').updateOne(
      { _id: 'adaptive_limits' },
      {
        $set: {
          'health.grade': grade,
          'health.find_ms': findMs,
          'health.count_ms': countMs,
          'health.browse_ms': browseMs,
          'health.active_jobs': activeJobs,
          'health.measured_at': new Date(),
          'health.source': 'hetzner-orchestrator',
          updated_at: new Date(),
          updated_by: 'adaptive',
        },
      },
      { upsert: true }
    );
  } catch { /* best effort */ }

  return grade;
}

// Page types to skip for translation: canonical list from translate-core (#3734).

// Languages that get inline transliteration before translation.
// Currently Greek only — other scripts are handled by the translator directly.
const NON_LATIN_LANGUAGES = new Set([
  'greek',
]);

function isNonLatin(language) {
  return language && NON_LATIN_LANGUAGES.has(language.toLowerCase());
}

// Cover scoring — imported from shared module
import { scorePageForCover } from '../lib/cover-scoring.mjs';

/**
 * Select the best cover page for a book from its first N pages.
 * Uses scorePageForCover() for OCR-based intelligent scoring.
 *
 * @param {Object} db - MongoDB database instance
 * @param {string} bookId - Book ID
 * @param {number} maxPages - Max pages to consider (default 20)
 * @returns {Promise<{page: Object, score: number, reason: string} | null>}
 */
async function selectBestCoverPage(db, bookId, maxPages = 20, bookTitle = null) {
  const pages = await db.collection('pages').find(
    { book_id: bookId, page_number: { $lte: maxPages } },
    { projection: {
      page_number: 1, page_type: 1, hidden: 1,
      cropped_photo: 1, archived_photo: 1, photo: 1,
      'ocr.data': 1, detected_images: 1,
    }}
  ).sort({ page_number: 1 }).toArray();

  if (!pages.length) return null;

  const scored = pages
    .map(p => ({ page: p, ...scorePageForCover(p, { bookTitle }) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < 30) return null;

  // Get the best image URL (prefer R2)
  const url = best.page.cropped_photo || best.page.archived_photo || best.page.photo;
  if (!url || !url.startsWith('http')) return null;

  return { page: best.page, score: best.score, reason: best.reason, url };
}

function languageToScript(language) {
  if (!language) return 'Unknown';
  const map = {
    'greek': 'Greek', 'hebrew': 'Hebrew', 'arabic': 'Arabic',
    'persian': 'Arabic (Persian)', 'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac', 'chinese': 'Chinese', 'japanese': 'Japanese',
    'korean': 'Korean', 'sanskrit': 'Sanskrit/Devanagari', 'armenian': 'Armenian',
    'georgian': 'Georgian', 'ethiopic': 'Ethiopic', 'coptic': 'Coptic',
    'tibetan': 'Tibetan', 'russian': 'Cyrillic', 'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

const TRANSLATE_MODEL_FLASH = 'gemini-3-flash-preview';
const TRANSLATE_MODEL_LITE = 'gemini-3.1-flash-lite';
// Model routing imported from translate-core (issue #3725). The local copy
// this replaces routed ONLY on provider — it would have stamped non-Latin-
// script (e.g. Tibetan) jobs with the lite model that hallucinates on them.
const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite';
const TRANSLITERATION_PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE the <column-break/> tag exactly where it appears.
4. Remove all OTHER XML/markup tags from the output.
5. Include standard scholarly diacritics.
6. Do not translate — only transliterate.
7. If the text contains passages in Latin script already, preserve them as-is.

Romanization conventions by script:
- Greek: Standard scholarly. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, etc.
- Hebrew: SBL academic style.
- Arabic: DIN 31635 / Library of Congress.
- Syriac: Standard Semiticist conventions.
- Armenian: Library of Congress romanization.
- Chinese: Pinyin with tone marks.
- Japanese: Modified Hepburn.
- Korean: Revised Romanization.
- Sanskrit/Devanagari: IAST.`;

async function transliteratePage(db, page, sourceScript) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${sourceScript}**\n\n**Text to transliterate:**\n${page.ocr.data}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  if (!text) return null;

  const ocrHash = hashString(page.ocr.data);
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'transliteration.data': text,
        'transliteration.model': TRANSLITERATION_MODEL,
        'transliteration.updated_at': new Date(),
        'transliteration.source_ocr_hash': ocrHash,
        'transliteration.script': sourceScript,
        updated_at: new Date(),
      },
    }
  );

  // Log usage (fire-and-forget)
  const costUsd = (inputTokens / 1_000_000) * 0.10 + (outputTokens / 1_000_000) * 0.40;
  logUsageAsync({
    type: 'transliterate', mode: 'realtime', model: TRANSLITERATION_MODEL,
    book_id: page.book_id, page_ids: [page.id],
    input_tokens: inputTokens, output_tokens: outputTokens,
    cost_usd: costUsd, status: 'success', endpoint: 'hetzner/pipeline-orchestrator',
  }, db);

  return { inputTokens, outputTokens, costUsd };
}

// The realtime translatePage lane that lived here was dead code — a fully
// armed second writer never called from any phase. Translation is dispatched
// to translate-worker.mjs (Phase 4) and written through translate-core (#3725).

// Sources whose pages need archiving
const ARCHIVABLE_SOURCES = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de|digi\.vatlib\.it|diglib\.hab\.de|e-rara|wellcomecollection|cudl\.lib\.cam|digital\.bodleian|cdli\.earth|contentdm\.oclc\.org|digitalcollections\.manchester|viewer\.cbl\.ie|universiteitleiden|digi\.ub\.uni-heidelberg|iiif\.qdl\.qa|permalinkbnd\.bnportugal|dl\.ndl\.go\.jp/;

console.log(`[pipeline-orchestrator] Base URL: ${BASE_URL} | Dry run: ${DRY_RUN}${ONLY_PHASE !== null ? ` | Phase: ${ONLY_PHASE}` : ''}${BOOK_OVERRIDE ? ` | Book override: ${BOOK_OVERRIDE}` : ''}`);

// ── Helpers ──

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CRON_SECRET}`,
  };
}

// ── Inline metadata verification (replaces Vercel POST /api/books/[id]/verify-metadata) ──
// Searches external_catalog (EFM/IA) and USTC (Supabase) for catalog matches,
// then applies high-confidence suggestions to fill missing/Unknown fields.
// No Gemini dependency — pure catalog lookups.

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function metaNormalize(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function metaSimilarity(a, b) {
  const normA = metaNormalize(a);
  const normB = metaNormalize(b);
  if (!normA || !normB) return 0;
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((intersection / union) * 100);
}

function extractYear(text) {
  if (!text) return undefined;
  const match = text.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : undefined;
}

async function verifyMetadataInline(db, book) {
  const matches = [];

  // 1. Search local external_catalog (EFM + IA)
  const searchTerms = [book.title, book.author]
    .filter(Boolean)
    .join(' ')
    .split(' ')
    .filter(w => w.length >= 3)
    .slice(0, 3);

  if (searchTerms.length > 0) {
    const wordConditions = searchTerms.map(word => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { author: { $regex: word, $options: 'i' } },
      ]
    }));

    const catalogDocs = await db.collection('external_catalog')
      .find({ $and: wordConditions })
      .limit(20)
      .toArray();

    for (const doc of catalogDocs) {
      const titleSim = metaSimilarity(book.title, doc.title);
      const authorSim = metaSimilarity(book.author, doc.author);
      const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));
      if (confidence > 30) {
        matches.push({
          source: doc.source === 'bph' ? 'EFM' : 'IA',
          confidence,
          year: doc.year?.toString(),
          language: doc.language,
          place: doc.placeOfPublication,
          publisher: doc.publisher,
        });
      }
    }
  }

  // 2. Search USTC via Supabase
  try {
    const supaHeaders = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };
    const searchQuery = metaNormalize(book.title).split(' ').slice(0, 3).join(' ');
    if (searchQuery.length >= 3) {
      const enrichedUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
      enrichedUrl.searchParams.set('select', 'id,std_title,english_title,detected_language,original_author');
      enrichedUrl.searchParams.set('limit', '10');
      enrichedUrl.searchParams.set('or', `(std_title.ilike.*${searchQuery}*,english_title.ilike.*${searchQuery}*,original_author.ilike.*${searchQuery}*)`);

      const enrichRes = await fetch(enrichedUrl.toString(), { headers: supaHeaders });
      if (enrichRes.ok) {
        const enrichData = await enrichRes.json();
        for (const row of enrichData) {
          const titleSim = Math.max(
            metaSimilarity(book.title, row.std_title || ''),
            metaSimilarity(book.title, row.english_title || '')
          );
          const authorSim = metaSimilarity(book.author, row.original_author || '');
          const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));
          if (confidence > 30) {
            // Fetch edition data for year/place
            const edUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
            edUrl.searchParams.set('select', 'year,place,language_1');
            edUrl.searchParams.set('id', `eq.${row.id}`);
            const edRes = await fetch(edUrl.toString(), { headers: supaHeaders });
            const edData = edRes.ok ? await edRes.json() : [];
            const edition = edData[0];
            matches.push({
              source: 'USTC',
              confidence,
              year: edition?.year?.toString(),
              language: row.detected_language || edition?.language_1,
              place: edition?.place,
              publisher: undefined,
            });
          }
        }
      }
    }
  } catch (e) {
    console.log(`  [metadata] USTC search error for ${book.id}: ${e.message}`);
  }

  // Sort by confidence, pick best
  matches.sort((a, b) => b.confidence - a.confidence);
  const bestMatch = matches[0];
  if (!bestMatch || bestMatch.confidence <= 60) {
    return { applied: 0, matches: matches.length };
  }

  // Build updates — only fill missing/Unknown fields
  const updates = { updated_at: new Date() };
  const changes = [];

  if ((!book.published || book.published === 'Unknown') && bestMatch.year) {
    const yr = extractYear(bestMatch.year) || bestMatch.year;
    updates.published = yr;
    changes.push({ field: 'published', previous: book.published, new_value: yr });
  }
  if ((!book.language || book.language === 'Unknown') && bestMatch.language && bestMatch.language !== 'Unknown') {
    updates.language = bestMatch.language;
    changes.push({ field: 'language', previous: book.language, new_value: bestMatch.language });
  }
  if (!book.place_of_publication && bestMatch.place) {
    updates.place_of_publication = bestMatch.place;
    changes.push({ field: 'place_of_publication', previous: null, new_value: bestMatch.place });
  }
  if (!book.publisher && bestMatch.publisher) {
    updates.publisher = bestMatch.publisher;
    changes.push({ field: 'publisher', previous: null, new_value: bestMatch.publisher });
  }

  if (changes.length === 0) {
    return { applied: 0, matches: matches.length };
  }

  // Set field_provenance for each changed field
  const provenance = {
    source: 'metadata_verification',
    verified_source: bestMatch.source,
    confidence: bestMatch.confidence,
    date: new Date(),
  };
  for (const c of changes) {
    updates[`field_provenance.${c.field}`] = { ...provenance, previous_value: c.previous };
  }

  // Record verification metadata
  updates.metadata_verified = {
    date: new Date(),
    source: bestMatch.source,
    confidence: bestMatch.confidence,
    changes: changes.map(c => `${c.field}: ${c.previous || 'none'} → ${c.new_value}`),
  };

  await db.collection('books').updateOne({ id: book.id }, { $set: updates });

  // Append-only changelog
  try {
    await db.collection('book_metadata_changelog').insertOne({
      id: nanoid(12),
      book_id: book.id,
      source: 'catalog_verification',
      changes,
      note: `Source: ${bestMatch.source}, confidence: ${bestMatch.confidence}`,
      timestamp: new Date(),
    });
  } catch { /* non-fatal */ }

  return { applied: changes.length, matches: matches.length, source: bestMatch.source, confidence: bestMatch.confidence };
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

// Phases paused via DB (system_config.processing_control.paused_phases)
let PAUSED_PHASES = new Set();

function shouldRun(phase) {
  if (PAUSED_PHASES.has(phase)) return false;
  return ONLY_PHASE === null || ONLY_PHASE === phase;
}

// ── Gemini Batch API helpers (direct OCR submission, no Vercel) ──

// Multiple GCP projects, deduplicated to avoid wasting retry attempts on the same project.
// Batch rate limits are per-project AND per-endpoint (File API upload vs batchGenerateContent).
// Scans GEMINI_API_KEY, GEMINI_API_KEY_2 through _10, and GEMINI_API_KEY_TIER3.
const GEMINI_BATCH_KEYS = [...new Set([
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
].filter(k => !!k))];
console.log(`  Batch API: ${GEMINI_BATCH_KEYS.length} unique keys`);

// SDK clients — one per GCP project key for proper rate limit isolation
const GEMINI_SDK_CLIENTS = GEMINI_BATCH_KEYS.map(key => new GoogleGenAI({ apiKey: key }));

let _batchKeyCounter = 0;
function getGeminiApiKey(keyIndex) {
  if (keyIndex !== undefined) {
    const key = GEMINI_BATCH_KEYS[keyIndex] || GEMINI_BATCH_KEYS[0];
    if (!key) throw new Error('No GEMINI_API_KEY found in env');
    return key;
  }
  // Round-robin: spread load evenly across projects
  const key = GEMINI_BATCH_KEYS[_batchKeyCounter % GEMINI_BATCH_KEYS.length];
  _batchKeyCounter++;
  if (!key) throw new Error('No GEMINI_API_KEY found in env');
  return key;
}

function getSdkClient(keyIndex) {
  if (keyIndex !== undefined) return GEMINI_SDK_CLIENTS[keyIndex] || GEMINI_SDK_CLIENTS[0];
  return GEMINI_SDK_CLIENTS[_batchKeyCounter % GEMINI_SDK_CLIENTS.length];
}

// Get next key index for round-robin upload+create pairing
function nextBatchKeyIndex() {
  return _batchKeyCounter % GEMINI_BATCH_KEYS.length;
}

/**
 * Per-key active job counts from Gemini. Refreshed by getGeminiKeyLoads().
 * Used by getLeastLoadedKey() to route submissions to the least-loaded project.
 */
const _geminiKeyLoads = new Array(GEMINI_SDK_CLIENTS.length).fill(0);
let _geminiKeyLoadsAt = 0; // timestamp of last refresh

const MAX_ACTIVE_PER_KEY = 30; // Hard cap per GCP project — Gemini stalls above this

// Batch-broken keys (#2455): a key that returns FAILED_PRECONDITION from
// batches.create can't run Batch API at all (free tier / unbilled project).
// Such a key always LOOKS least-loaded — its batches die instantly — so the
// load-aware selector funnels every submission into it (602 books failed this
// way on 2026-06-05). Mark it broken for the rest of the run and route around.
const _batchBrokenKeys = new Set();
const _batchBrokenKeyEvents = [];
function markKeyBatchBroken(ki, context) {
  if (_batchBrokenKeys.has(ki)) return;
  _batchBrokenKeys.add(ki);
  const msg = `Gemini key ${ki} marked batch-broken (FAILED_PRECONDITION on batches.create, ${context}) — excluded for the rest of this run. Likely free-tier/unbilled; remove it from GEMINI_API_KEY_2..10 if persistent.`;
  _batchBrokenKeyEvents.push(msg);
  console.error(`    ALERT: ${msg}`);
}

/**
 * Query real Gemini-side active job counts per key.
 * Returns { total, perKey: number[] }. Also updates the cached _geminiKeyLoads.
 */
async function getGeminiKeyLoads() {
  const activeStates = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING']);
  let total = 0;
  for (let i = 0; i < GEMINI_SDK_CLIENTS.length; i++) {
    let count = 0;
    try {
      const pager = await GEMINI_SDK_CLIENTS[i].batches.list({ config: { pageSize: 100 } });
      let consecutiveInactive = 0;
      for await (const job of pager) {
        if (activeStates.has(job.state)) {
          count++;
          consecutiveInactive = 0;
        } else {
          consecutiveInactive++;
          if (consecutiveInactive >= 50) break;
        }
      }
    } catch (err) {
      console.log(`    Warning: batches.list failed for key ${i}: ${err.message?.substring(0, 100)}`);
      count = MAX_ACTIVE_PER_KEY; // Assume full if we can't check — don't submit blindly
    }
    _geminiKeyLoads[i] = count;
    total += count;
  }
  _geminiKeyLoadsAt = Date.now();
  return { total, perKey: [..._geminiKeyLoads] };
}

/** Backwards-compatible wrapper. */
async function getActiveGeminiJobCount() {
  const { total } = await getGeminiKeyLoads();
  return total;
}

/**
 * Pick the key with the fewest active jobs that's still under the per-key cap.
 * Returns keyIndex or -1 if all keys are saturated.
 * Uses cached counts (updated every submission cycle) + local tracking.
 */
function getLeastLoadedKey() {
  let bestKey = -1;
  let bestCount = Infinity;
  for (let i = 0; i < _geminiKeyLoads.length; i++) {
    if (_batchBrokenKeys.has(i)) continue; // batch-broken key (#2455) — never select
    if (_geminiKeyLoads[i] < MAX_ACTIVE_PER_KEY && _geminiKeyLoads[i] < bestCount) {
      bestCount = _geminiKeyLoads[i];
      bestKey = i;
    }
  }
  return bestKey;
}

/**
 * Record that we just submitted a job on keyIndex.
 * Increments the local cache so subsequent getLeastLoadedKey() calls see it
 * without needing a full Gemini re-query.
 */
function recordSubmission(keyIndex) {
  if (keyIndex >= 0 && keyIndex < _geminiKeyLoads.length) {
    _geminiKeyLoads[keyIndex]++;
  }
}

/**
 * Check if we can submit more jobs. Returns false if all keys are saturated
 * OR if total active jobs across all keys exceeds MAX_ACTIVE_BATCH_OCR.
 * Refreshes Gemini counts if cache is stale (>2 min old).
 */
async function canSubmitMore() {
  // Refresh real counts every 2 minutes to stay in sync with Gemini completions
  if (Date.now() - _geminiKeyLoadsAt > 120_000) {
    await getGeminiKeyLoads();
  }
  // Global cap: don't exceed MAX_ACTIVE_BATCH_OCR across all keys
  const totalActive = _geminiKeyLoads.reduce((sum, n) => sum + n, 0);
  if (totalActive >= MAX_ACTIVE_BATCH_OCR) {
    return false;
  }
  return getLeastLoadedKey() >= 0;
}

// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

/**
 * Fetch image and return as base64. If maxDim is set, resize to fit within that
 * dimension (for OCR batches — reduces JSONL size 6x, same quality).
 * Experiment 2026-04-13: 1500px resize produced identical OCR to full-res on BPH images.
 */
async function fetchImageBase64(url, { maxDim } = {}) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    let buf = Buffer.from(await response.arrayBuffer());
    let mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();

    if (maxDim && buf.length > 100_000) { // Only resize images > 100KB
      try {
        const sharp = (await import('sharp')).default;
        buf = await sharp(buf)
          .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        mimeType = 'image/jpeg';
      } catch { /* resize failed, use original */ }
    }

    return { data: buf.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

async function downloadImagesParallel(pages, concurrency, { maxDim } = {}) {
  const results = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (page) => {
        const url = getPageImageUrl(page);
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
        const image = await fetchImageBase64(url, { maxDim });
        if (!image) return null;
        // Carry the exact URL we fetched so the batch job can record OCR
        // provenance (#2297) — `url` is the canonical getPageSource result.
        return { pageId: page.id, image, sourceUrl: url };
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
  // Convert raw REST request format to SDK InlinedRequest format
  const sdkRequests = requests.map(r => ({
    contents: r.request.contents,
    config: {
      safetySettings: r.request.safetySettings,
      temperature: r.request.generationConfig?.temperature,
      maxOutputTokens: r.request.generationConfig?.maxOutputTokens,
      thinkingConfig: r.request.generationConfig?.thinkingConfig,
    },
    metadata: r.metadata,
  }));

  // Least-loaded key first, then try others on quota exhaustion (429)
  const bestKey = getLeastLoadedKey();
  const startKey = bestKey >= 0 ? bestKey : nextBatchKeyIndex();
  for (let attempt = 0; attempt < GEMINI_SDK_CLIENTS.length; attempt++) {
    const ki = (startKey + attempt) % GEMINI_SDK_CLIENTS.length;
    try {
      const batchJob = await GEMINI_SDK_CLIENTS[ki].batches.create({
        model,
        src: sdkRequests,
        config: { displayName },
      });
      recordSubmission(ki);
      return { name: batchJob.name, state: batchJob.state || 'JOB_STATE_PENDING', keyIndex: ki };
    } catch (err) {
      const msg = err.message || '';
      console.log(`    Key ${ki} failed: ${msg.substring(0, 150)}`);
      if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        _geminiKeyLoads[ki] = MAX_ACTIVE_PER_KEY; // Mark as full
        continue;
      }
      if (msg.includes('FAILED_PRECONDITION') || msg.includes('Precondition check failed')) {
        // Key can't run Batch API at all (#2455) — exclude it and try the next key
        markKeyBatchBroken(ki, 'inline batch');
        continue;
      }
      throw err;
    }
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

// Sweep stale sl-batch-*.jsonl files left behind by past runs.
// Each orchestrator run uploads + unlinks its JSONL inline, but a throw
// past the unlink call (network error, 5xx, FAILED_PRECONDITION, SIGKILL)
// strands the file. The orchestrator runs every ~2 min, so anything older
// than 30 min is definitively orphaned.
function cleanupStaleJsonlFiles() {
  const tmpRoot = os.tmpdir();
  const cutoff = Date.now() - 30 * 60 * 1000;
  let removed = 0;
  let bytesFreed = 0;
  let entries;
  try { entries = fs.readdirSync(tmpRoot); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith('sl-batch-') || !name.endsWith('.jsonl')) continue;
    const full = path.join(tmpRoot, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs >= cutoff) continue;
      bytesFreed += st.size;
      fs.unlinkSync(full);
      removed++;
    } catch {}
  }
  if (removed > 0) {
    console.log(`[orchestrator] Swept ${removed} stale JSONL files (${(bytesFreed / (1024 ** 3)).toFixed(2)} GB freed)`);
  }
}

/**
 * Build JSONL as a temp file, writing one line at a time to avoid holding
 * the entire string in memory. Frees each image buffer after serialization.
 * Returns { filePath, fileSize } — caller must delete the file after upload.
 */
function buildJsonlFile(chunk, requestBuilder) {
  const tmpFile = path.join(os.tmpdir(), `sl-batch-${nanoid()}.jsonl`);
  const fd = fs.openSync(tmpFile, 'w');
  let totalBytes = 0;
  for (let i = 0; i < chunk.length; i++) {
    const line = JSON.stringify(requestBuilder(chunk[i]));
    const buf = Buffer.from(line + (i < chunk.length - 1 ? '\n' : ''));
    fs.writeSync(fd, buf);
    totalBytes += buf.byteLength;
    // Free the base64 image data immediately to reduce memory pressure
    if (chunk[i].image) chunk[i].image.data = null;
  }
  fs.closeSync(fd);
  return { filePath: tmpFile, fileSize: totalBytes };
}

/**
 * Upload a file to Gemini File API using SDK.
 * Accepts a file path (string). Returns { name, uri }.
 */
async function uploadBatchFile(filePath, displayName, keyIndex) {
  const client = getSdkClient(keyIndex);
  const file = await client.files.upload({
    file: filePath,
    config: { mimeType: 'text/plain', displayName },
  });
  if (!file?.name) {
    throw new Error(`File upload response missing 'name': ${JSON.stringify(file).substring(0, 200)}`);
  }
  return { name: file.name, uri: file.uri };
}

/**
 * Create a batch job from an uploaded JSONL file using SDK.
 * IMPORTANT: Only use the key that uploaded the file. Other keys can't see it (404).
 */
async function createBatchJobFromFile(model, fileName, displayName, preferredKeyIndex = 0) {
  const client = getSdkClient(preferredKeyIndex);
  // Wait for the uploaded File API file to reach ACTIVE before creating the batch.
  // batches.create against a still-PROCESSING file returns 400 FAILED_PRECONDITION.
  // Larger file-based OCR JSONLs (big books) take longer to process, so they raced
  // and failed while small inline books succeeded — root cause of the OCR backlog.
  for (let i = 0; i < 30; i++) {
    let state;
    try { state = (await client.files.get({ name: fileName }))?.state; } catch { state = undefined; }
    if (state === 'ACTIVE') break;
    if (state === 'FAILED') throw new Error(`File API processing FAILED for ${fileName}`);
    await new Promise(r => setTimeout(r, 2000)); // up to ~60s
  }
  let batchJob;
  try {
    batchJob = await client.batches.create({
      model,
      src: { fileName },
      config: { displayName },
    });
  } catch (err) {
    const msg = err.message || '';
    // File reached ACTIVE but batch creation still 400s — the KEY can't run
    // Batch API (#2455). Mark it so the selector routes future uploads elsewhere.
    if (msg.includes('FAILED_PRECONDITION') || msg.includes('Precondition check failed')) {
      markKeyBatchBroken(preferredKeyIndex, 'file-based batch');
    }
    throw err;
  }
  return { name: batchJob.name, state: batchJob.state || 'JOB_STATE_PENDING', keyIndex: preferredKeyIndex };
}

async function getOcrPromptFromDb(db) {
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

/**
 * Submit OCR for a single book directly to Gemini Batch API.
 * Downloads images on Hetzner, then submits via:
 *   - Inline batch for ≤20 pages (base64 in HTTP body, simple)
 *   - File-based batch for >20 pages (JSONL uploaded to File API, ~150 pages/job)
 *
 * This is a 7.5x improvement in quota efficiency vs the old 20-page-per-job approach.
 * A 300-page book now uses 2 batch jobs instead of 15.
 */
async function submitOcrDirectly(db, book, { modelOverride, maxPages } = {}) {
  const ocrModel = modelOverride || getOcrModelForBook(book);
  const pageLimit = maxPages || MAX_PAGES_PER_BOOK;
  // Guard: check for existing active batch_jobs for this book
  const activeBatchForBook = await db.collection('batch_jobs').countDocuments({
    book_id: book.id,
    type: 'ocr',
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
  });
  if (activeBatchForBook > 0) {
    console.log(`    Skipping: ${activeBatchForBook} active batch jobs already exist for this book`);
    return { submitted: 0, jobName: null, alreadyDone: false, skippedDuplicate: true };
  }

  // Generation guard (#2449): stamp the book's current OCR generation on every
  // job so batch-collector can refuse to save results from before a deliberate
  // reset (reset-book-ocr.mjs bumps pipeline_auto.ocr_generation).
  const ocrGeneration = (await db.collection('books').findOne(
    { id: book.id }, { projection: { 'pipeline_auto.ocr_generation': 1 } }
  ))?.pipeline_auto?.ocr_generation || 0;

  // Find pages needing OCR — only pages with R2 images (archived_photo or cropped_photo).
  // Pages without R2 URLs are not ready for OCR (archiving incomplete).
  const pages = await db.collection('pages')
    .find({
      book_id: book.id,
      page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
      'ocr.recitation_blocked': { $ne: true }, // Skip pages permanently blocked after N=3 recitation hits
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' },
      ],
      $and: [{
        $or: [
          { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
          { cropped_photo: { $exists: true, $nin: [null, ''] } },
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } },
        ]
      }]
    })
    .sort({ page_number: 1 })
    .limit(pageLimit)
    .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
    .toArray();

  if (pages.length === 0) {
    return { submitted: 0, jobName: null, alreadyDone: true };
  }

  // Minimum batch size gate — don't burn a batch API call for a handful of pages.
  // Small batches (1-20 pages) are usually RECITATION/failure retries that won't succeed.
  // Skip them and let them accumulate or get accepted as gaps in Phase 3.
  const MIN_BATCH_PAGES = 25;
  if (pages.length < MIN_BATCH_PAGES && !maxPages) {
    // Exception: if this is the entire book (small book), submit anyway
    const totalBookPages = book.pages_count || 0;
    const ocrDone = book.pages_ocr || 0;
    if (ocrDone > 0 && pages.length < MIN_BATCH_PAGES && !book.needs_splitting) {
      // Spread books are exempt (#2449): their sub-25-page re-OCR remainders carry
      // the split markers Phase 3.1 depends on — starving them wedges the split.
      console.log(`    Skipping small retry batch: ${pages.length} pages remaining (min ${MIN_BATCH_PAGES})`);
      return { submitted: 0, jobName: null, skippedSmallBatch: true };
    }
  }

  // Warn if many pages lack R2 URLs — archiving may be incomplete
  const pagesWithR2 = pages.filter(p =>
    (p.cropped_photo) ||
    (p.archived_photo && /^https?:\/\//.test(p.archived_photo))
  );
  if (pagesWithR2.length < pages.length) {
    const noR2 = pages.length - pagesWithR2.length;
    console.log(`    WARNING: ${noR2}/${pages.length} pages lack R2 URLs — archiving may be incomplete`);
  }

  // Guard: skip pages that are unsplit spreads (have no crop but book needs splitting)
  // These would send two-page images to OCR, producing garbled results
  // EXCEPTION: if book.needs_splitting, we USE the spread OCR prompt which handles
  // two-page images directly — no physical split needed before OCR.
  // Also: if the book was already split_checked, it passed Phase 1.25 and was determined
  // to be portrait/single-page — no crop data expected, safe to OCR as-is.
  if (!book.needs_splitting) {
    const unsplitPages = pages.filter(p => !p.crop && !p.cropped_photo);
    if (unsplitPages.length > 0 && unsplitPages.length === pages.length && !book.pipeline_auto?.split_checked) {
      console.log(`    WARNING: All ${pages.length} pages lack crop data — possible unsplit spreads, skipping OCR (#523)`);
      return { submitted: 0, jobName: null, alreadyDone: false, skippedUnsplit: true };
    }
  }

  console.log(`    Downloading ${pages.length} images (resize to 1500px for OCR)...`);
  const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY, { maxDim: 1500 });
  if (downloaded.length === 0) {
    throw new Error(`All ${pages.length} image downloads failed`);
  }
  console.log(`    Downloaded ${downloaded.length}/${pages.length} images`);

  const ocrPromptRef = await getOcrPromptFromDb(db);
  let prompt = ocrPromptRef.text;

  // Spread OCR: for BPH two-page spread books, prepend instructions to process
  // both pages separately with <split-position> and <page-break/> markers.
  // This lets us OCR + split-detect in one Gemini call.
  // See: .claude/docs/spread-splitting.md
  if (book.needs_splitting) {
    const spreadPrefix = `**TWO-PAGE SPREAD HANDLING:**
This image is a two-page spread (open book scan). Process BOTH pages separately.

CRITICAL: Each page may have its own multi-column layout. Handle columns WITHIN each page:
- If a page has 2+ columns, use <column-break/> between columns ON THAT PAGE
- Each page MUST include its own <vocab> tag with key terms from THAT page only.
- Use ISO 639-1 language codes (de, fr, la, en, nl, he, grc — NOT "German", "Latin", etc.)

If this is NOT a two-page spread (single page), set split_position to null and process normally.

Output structure:
1. <split-position>N</split-position> (0-1000, or null if single page) at the very top
2. All metadata and content for LEFT page
3. <page-break/> on its own line
4. All metadata and content for RIGHT page

`;
    prompt = spreadPrefix + prompt;
    console.log(`    Spread OCR mode: prepended spread prefix for needs_splitting book`);
  }

  // Append book provenance context to help Gemini avoid recitation blocks
  // on public domain works it mistakes for copyrighted material
  const yearStr = book.year ? `Published ${book.year}.` : '';
  const copyrightNote = book.year && book.year < 1930
    ? 'This work is in the public domain.'
    : '';
  if (yearStr || book.title) {
    prompt += `\n\n**Document context:** "${book.title || 'Unknown'}" by ${book.author || 'Unknown'}. ${yearStr} ${copyrightNote}`.trim();
  }

  // Choose batch size based on page count.
  // Force file-based for needs_splitting books — inline doesn't work with Lite model
  // (confirmed: 300 inline Lite jobs stuck PENDING, 0 succeeded; 1995 file-based succeeded).
  const useFileBased = downloaded.length > OCR_INLINE_BATCH_SIZE || book.needs_splitting;
  const batchSize = useFileBased ? OCR_FILE_BATCH_SIZE : OCR_INLINE_BATCH_SIZE;

  const parentJobId = nanoid();
  const childJobIds = [];
  let totalSubmitted = 0;
  let firstJobName = null;

  for (let j = 0; j < downloaded.length; j += batchSize) {
    const chunk = downloaded.slice(j, j + batchSize);
    const childJobId = nanoid();
    const displayName = `pipeline-ocr-${book.id}-${childJobId}`;
    let batchJob;

    if (useFileBased) {
      // File-based: stream JSONL to temp file to avoid OOM on large books
      console.log(`    Building JSONL for ${chunk.length} pages (file-based)...`);
      const { filePath: jsonlFile, fileSize } = buildJsonlFile(chunk, (item) => ({
        request: {
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      const jsonlSizeMB = (fileSize / 1024 / 1024).toFixed(1);
      console.log(`    JSONL size: ${jsonlSizeMB} MB for ${chunk.length} pages`);

      // Upload JSONL + create batch — both must use the same key (files are key-scoped).
      // Round-robin start key across projects to spread load evenly.
      // Non-quota errors capture into __submitErr so we always reach the unlink below.
      let uploadKeyIndex = -1;
      let __submitErr = null;
      const bestKey = getLeastLoadedKey();
      const startKey = bestKey >= 0 ? bestKey : nextBatchKeyIndex();
      for (let attempt = 0; attempt < GEMINI_BATCH_KEYS.length; attempt++) {
        const uki = (startKey + attempt) % GEMINI_BATCH_KEYS.length;
        let fileResult;
        try {
          fileResult = await uploadBatchFile(jsonlFile, displayName, uki);
          uploadKeyIndex = uki;
          console.log(`    Uploaded file: ${fileResult.name} (key ${uki})`);
        } catch (uploadErr) {
          const msg = uploadErr.message || '';
          if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log(`    Upload key ${uki} FILE API quota exhausted, trying next...`);
            _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
            continue;
          }
          __submitErr = uploadErr;
          break;
        }

        try {
          batchJob = await createBatchJobFromFile(ocrModel, fileResult.name, displayName, uploadKeyIndex);
          recordSubmission(uki);
          try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (cleanupErr) {
            console.log(`    Warning: file cleanup failed: ${cleanupErr.message}`);
          }
          break; // success
        } catch (batchErr) {
          try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (_) {}
          const msg = batchErr.message || '';
          if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log(`    Batch create key ${uki} BATCH CREATION quota exhausted, re-uploading with next key...`);
            _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
            continue;
          }
          __submitErr = batchErr;
          break;
        }
      }
      // Clean up temp JSONL file (always runs, even on non-quota errors above)
      try { fs.unlinkSync(jsonlFile); } catch (_) {}
      if (__submitErr) throw __submitErr;
      if (!batchJob) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
    } else {
      // Inline: small batch, embed base64 directly in request body
      const inlineRequests = chunk.map(item => ({
        request: {
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      batchJob = await createBatchJobInline(ocrModel, inlineRequests, displayName);
    }

    if (!firstJobName) firstJobName = batchJob.name;

    // Record in batch_jobs
    await db.collection('batch_jobs').insertOne({
      id: childJobId,
      parent_job_id: parentJobId,
      job_name: batchJob.name,
      type: 'ocr',
      book_id: book.id,
      page_ids: chunk.map(c => c.pageId),
      // OCR provenance (#2297): the exact image URL fetched + sent for each page,
      // so batch-collector can stamp ocr.source_url at write-back. getPageSource
      // already chose this URL in downloadImagesParallel.
      page_sources: chunk.map(c => ({ page_id: c.pageId, source_url: c.sourceUrl || null })),
      code_version: await getCodeVersion(),
      page_count: chunk.length,
      status: 'pending',
      model: ocrModel,
      prompt_version: ocrPromptRef.version || OCR_PROMPT_VERSION,
      prompt_id: ocrPromptRef.id,
      prompt_name: ocrPromptRef.name,
      prompt_hash: ocrPromptRef.content_hash,
      submission_method: useFileBased ? 'file' : 'inline',
      key_index: batchJob.keyIndex,
      ocr_generation: ocrGeneration, // #2449 generation guard
      force: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    childJobIds.push(childJobId);
    totalSubmitted += chunk.length;

    // Log to Supabase gemini_usage
    await logUsage({
      type: 'ocr', mode: 'batch', model: ocrModel,
      book_id: book.id, book_title: book.title,
      page_ids: chunk.map(c => c.pageId), page_count: chunk.length,
      batch_job_id: childJobId, gemini_job_name: batchJob.name,
      input_tokens: 0, output_tokens: 0, status: 'submitted',
      endpoint: 'hetzner/pipeline-orchestrator',
    }, db);
  }

  // Create parent job if multiple children
  if (childJobIds.length > 1) {
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'ocr',
      book_id: book.id,
      child_job_ids: childJobIds,
      total_pages: totalSubmitted,
      ocr_generation: ocrGeneration, // #2449 generation guard
      status: 'pending',
      model: ocrModel,
      prompt_version: ocrPromptRef.version || OCR_PROMPT_VERSION,
      prompt_id: ocrPromptRef.id,
      prompt_name: ocrPromptRef.name,
      prompt_hash: ocrPromptRef.content_hash,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  const method = useFileBased ? 'file-based' : 'inline';
  return { submitted: totalSubmitted, jobName: firstJobName || parentJobId, childCount: childJobIds.length, method };
}

// ── Cross-book OCR pooling (#1082) ──
// Pools pages from multiple small books into shared OCR batches.
// Reduces batch creation count — one 500-page batch instead of 20 separate ones.
// Each page carries its own book-specific prompt (title/author/year context).
// Collector already supports book_ids arrays and metadata.key matching.
const CROSS_BOOK_OCR_THRESHOLD = 250; // Books with fewer pages go into cross-book pool

async function submitCrossBookOcrBatches(db, books) {
  const ocrModel = OCR_MODEL_LITE;
  const basePromptRef = await getOcrPromptFromDb(db);
  const basePrompt = basePromptRef.text;

  // Guard: skip books with active batch_jobs or needs_splitting
  const eligible = [];
  for (const book of books) {
    if (book.needs_splitting) continue; // Spread books need special prompt, keep per-book
    const activeBatch = await db.collection('batch_jobs').countDocuments({
      $or: [{ book_id: book.id }, { book_ids: book.id }],
      type: 'ocr',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (activeBatch > 0) {
      console.log(`    Skipping ${(book.title || '').substring(0, 40)}: active OCR batch exists`);
      continue;
    }
    eligible.push(book);
  }
  if (eligible.length === 0) return { submitted: 0, batchCount: 0, bookIds: [] };

  // Generation guard (#2449): per-book OCR generations, stamped on the job so
  // the collector can drop pages of any book that was reset after submit.
  const genDocs = await db.collection('books').find(
    { id: { $in: eligible.map(b => b.id) } },
    { projection: { id: 1, 'pipeline_auto.ocr_generation': 1 } }
  ).toArray();
  const bookGenerations = Object.fromEntries(genDocs.map(d => [d.id, d.pipeline_auto?.ocr_generation || 0]));

  // Gather pages from all eligible books
  const allDownloaded = []; // { pageId, image, prompt, bookId }
  const bookMap = new Map();

  for (const book of eligible) {
    if (allDownloaded.length >= CROSS_BOOK_BATCH_SIZE) break;

    const remaining = CROSS_BOOK_BATCH_SIZE - allDownloaded.length;
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
        'ocr.recitation_blocked': { $ne: true }, // Skip pages permanently blocked after N=3 recitation hits
        $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
        $and: [{
          $or: [
            { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
            { cropped_photo: { $exists: true, $nin: [null, ''] } },
            { photo: { $exists: true, $ne: null } },
          ]
        }]
      })
      .sort({ page_number: 1 })
      .limit(remaining)
      .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
      .toArray();

    if (pages.length === 0) continue;

    // Build book-specific prompt with provenance context
    let prompt = basePrompt;
    const yearStr = book.year ? `Published ${book.year}.` : '';
    const copyrightNote = book.year && book.year < 1930 ? 'This work is in the public domain.' : '';
    if (yearStr || book.title) {
      prompt += `\n\n**Document context:** "${book.title || 'Unknown'}" by ${book.author || 'Unknown'}. ${yearStr} ${copyrightNote}`.trim();
    }

    console.log(`    Downloading ${pages.length} images for ${(book.title || '').substring(0, 40)} (resize 1500px)...`);
    const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY, { maxDim: 1500 });
    if (downloaded.length === 0) {
      console.log(`    WARNING: All ${pages.length} downloads failed for ${(book.title || '').substring(0, 40)}`);
      continue;
    }
    console.log(`    Downloaded ${downloaded.length}/${pages.length} for ${(book.title || '').substring(0, 40)}`);

    bookMap.set(book.id, book);
    for (const item of downloaded) {
      allDownloaded.push({ pageId: item.pageId, image: item.image, prompt, bookId: book.id, sourceUrl: item.sourceUrl });
    }
  }

  if (allDownloaded.length === 0) return { submitted: 0, batchCount: 0, bookIds: [] };
  console.log(`  Cross-book OCR pool: ${allDownloaded.length} pages from ${bookMap.size} books`);

  // Build and submit a single cross-book batch
  const childJobId = nanoid();
  const chunkBookIds = [...bookMap.keys()];
  const displayName = `pipeline-ocr-cross-${chunkBookIds.length}books-${childJobId}`;

  console.log(`    Building JSONL for ${allDownloaded.length} pages (cross-book OCR, ${chunkBookIds.length} books)...`);
  const { filePath: jsonlFile, fileSize } = buildJsonlFile(allDownloaded, (item) => ({
    request: {
      contents: [{
        parts: [
          { text: item.prompt },
          { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
        ],
      }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    metadata: { key: item.pageId },
  }));
  console.log(`    JSONL size: ${(fileSize / 1024 / 1024).toFixed(1)} MB for ${allDownloaded.length} pages`);

  // Upload + create batch with key rotation (same pattern as image extraction)
  // Non-quota errors capture into __submitErr so we always reach the unlink below.
  let batchJob = null;
  let __submitErr = null;
  const bestKey = getLeastLoadedKey();
  const startKey = bestKey >= 0 ? bestKey : nextBatchKeyIndex();
  for (let attempt = 0; attempt < GEMINI_BATCH_KEYS.length; attempt++) {
    const uki = (startKey + attempt) % GEMINI_BATCH_KEYS.length;
    let fileResult;
    try {
      fileResult = await uploadBatchFile(jsonlFile, displayName, uki);
      console.log(`    Uploaded file: ${fileResult.name} (key ${uki})`);
    } catch (uploadErr) {
      const msg = uploadErr.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        console.log(`    Upload key ${uki} FILE API quota exhausted, trying next...`);
        _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
        continue;
      }
      __submitErr = uploadErr;
      break;
    }
    try {
      batchJob = await createBatchJobFromFile(ocrModel, fileResult.name, displayName, uki);
      recordSubmission(uki);
      try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (_) {}
      break;
    } catch (batchErr) {
      try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (_) {}
      const msg = batchErr.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        console.log(`    Batch create key ${uki} quota exhausted, trying next...`);
        _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
        continue;
      }
      __submitErr = batchErr;
      break;
    }
  }
  try { fs.unlinkSync(jsonlFile); } catch (_) {}
  if (__submitErr) throw __submitErr;
  if (!batchJob) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');

  // Record in batch_jobs with book_ids array
  await db.collection('batch_jobs').insertOne({
    id: childJobId,
    job_name: batchJob.name,
    gemini_job_name: batchJob.name,
    type: 'ocr',
    book_id: chunkBookIds[0],
    book_ids: chunkBookIds,
    page_ids: allDownloaded.map(d => d.pageId),
    // OCR provenance (#2297) — exact image fetched per page, for batch-collector.
    page_sources: allDownloaded.map(d => ({ page_id: d.pageId, source_url: d.sourceUrl || null })),
    code_version: await getCodeVersion(),
    page_count: allDownloaded.length,
    status: 'pending',
    model: ocrModel,
    prompt_version: basePromptRef.version || OCR_PROMPT_VERSION,
    prompt_id: basePromptRef.id,
    prompt_name: basePromptRef.name,
    prompt_hash: basePromptRef.content_hash,
    submission_method: 'file',
    key_index: batchJob.keyIndex,
    cross_book: true,
    ocr_generation: bookGenerations[chunkBookIds[0]] ?? 0, // #2449 generation guard
    book_generations: Object.fromEntries(chunkBookIds.map(id => [id, bookGenerations[id] ?? 0])),
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Mark all pooled books as ocr_submitted so they don't get re-submitted
  for (const bookId of chunkBookIds) {
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: {
        'pipeline_auto.status': 'ocr_submitted',
        'pipeline_auto.preview_batch_at': new Date(),
        'pipeline_auto.last_updated': new Date(),
      } }
    );
  }

  // Log usage
  await logUsage({
    type: 'ocr', mode: 'batch', model: ocrModel,
    book_id: chunkBookIds[0],
    page_ids: allDownloaded.map(d => d.pageId), page_count: allDownloaded.length,
    batch_job_id: childJobId, gemini_job_name: batchJob.name,
    input_tokens: 0, output_tokens: 0, status: 'submitted',
    endpoint: 'hetzner/pipeline-orchestrator',
  }, db);

  console.log(`  Cross-book OCR submitted: ${allDownloaded.length} pages from ${chunkBookIds.length} books — ${batchJob.name}`);
  return { submitted: allDownloaded.length, batchCount: 1, bookIds: chunkBookIds };
}

/**
 * Submit image extraction via Gemini Batch API.
 * Mirrors submitOcrDirectly() but uses the image extraction prompt instead of OCR.
 * Returns detected images as JSON arrays (parsed by batch-collector).
 *
 * Cost: ~50% discount vs Lambda realtime. Throughput: ~200+ books/hr vs ~50.
 */
const IMAGE_EXTRACTION_MODEL = 'gemini-3-flash-preview'; // Vision task — bbox accuracy critical
const IMAGE_EXTRACTION_BATCH_SIZE = 250; // Pages per file-based batch — match OCR to reduce batch creation count
const IMAGE_EXTRACTION_INLINE_SIZE = 20;

const IMAGE_EXTRACTION_PROMPT = `You are a museum curator analyzing a historical book page scan. Extract only significant illustrations — skip decorative elements like ornaments, borders, printer's marks, and initials.

BOUNDING BOX (0.0-1.0 normalized coordinates):
- x: LEFT edge (0=left, 1=right), y: TOP edge (0=top, 1=bottom)
- width, height: span of illustration
- TIGHTLY enclose the illustration only

IMAGE TYPES (use these exactly):
- emblem: Symbolic/allegorical with motto, often framed
- woodcut: Bold relief print lines
- engraving: Fine detailed intaglio lines, crosshatching
- portrait: Depiction of a person
- frontispiece: Decorative title page illustration
- musical_score: Sheet music, notation, fugues (NOT "table")
- diagram: Technical/scientific illustration
- symbol: Alchemical, astrological symbols
- map: Geographic representation

SKIP these — do NOT include them:
- Page ornaments, borders, decorative initials, printer's devices
- Marbled papers, blank frames, ruled lines
- Any element that is purely decorative with no intellectual content

If the page contains no significant illustrations, return \`[]\` — an empty array. Do NOT return placeholder objects with missing or null fields. Either fill in every field (description, type, bbox, confidence, gallery_quality, gallery_rationale) for an illustration, or omit it entirely.

For each significant illustration return:
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|map|exlibris",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
  "confidence": 0.95,
  "gallery_quality": 0.85,
  "gallery_rationale": "Why gallery-worthy or not",
  "metadata": {
    "subjects": ["alchemy", "transformation"],
    "figures": ["old man", "serpent"],
    "symbols": ["ouroboros", "athanor"],
    "style": "Northern European Renaissance",
    "technique": "woodcut"
  },
  "museum_description": "A robed figure holds a serpent that bites its own tail while standing over a lit furnace. The ouroboros and the athanor identify the scene as one of alchemical transmutation."
}

GALLERY QUALITY (0.0-1.0):
- 0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
- 0.8-0.9: Illustrations with people/figures
- 0.6-0.8: Good illustrations without people
- 0.4-0.6: Musical scores, alchemical symbols

MUSEUM DESCRIPTION: Write 2-3 plain sentences for a museum label: first what the viewer sees, then what it depicts or means. Name concrete things. Do NOT use promotional or filler language. Avoid the words "serves as", "stands as", "a testament to", "renowned", "profound", "delve", "intricate", "vibrant", "compelling", "exemplifies", "masterful", and the construction "not only X but also Y". State what is shown, not how significant it is.

Return ONLY a valid JSON array. If no significant illustrations, return: []`;

// Per-page text grounding for the batch image-extraction path (#2707), mirroring
// the realtime worker. Returns Map<pageId, groundingString>. Reads each candidate
// page's own OCR/translation, a ±radius window of neighbour pages (usually text/
// blank pages not in the candidate set), and the book summary as the isolated-
// plate fallback. One window query per book.
const BATCH_GROUNDING_RADIUS = 3;
async function buildGroundingByPageId(db, book, candidatePages) {
  const ids = candidatePages.map(p => p.id);
  const cps = await db.collection('pages')
    .find({ id: { $in: ids } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray();

  const windowNumbers = new Set();
  for (const p of cps) {
    if (typeof p.page_number !== 'number') continue;
    for (let d = -BATCH_GROUNDING_RADIUS; d <= BATCH_GROUNDING_RADIUS; d++) windowNumbers.add(p.page_number + d);
  }
  const pagesByNumber = new Map();
  if (windowNumbers.size > 0) {
    const wp = await db.collection('pages')
      .find({ book_id: book.id, page_number: { $in: [...windowNumbers] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
      .toArray();
    for (const p of wp) pagesByNumber.set(p.page_number, p);
  }

  let bookSummary = book.summary;
  if (bookSummary === undefined) {
    const b = await db.collection('books').findOne({ id: book.id }, { projection: { summary: 1 } });
    bookSummary = b?.summary || '';
  }

  const map = new Map();
  for (const p of cps) {
    const neighbors = [];
    if (typeof p.page_number === 'number') {
      for (let n = p.page_number - BATCH_GROUNDING_RADIUS; n <= p.page_number + BATCH_GROUNDING_RADIUS; n++) {
        if (n === p.page_number) continue;
        const np = pagesByNumber.get(n);
        if (np) neighbors.push({ page_number: n, ocr: np.ocr?.data, translation: np.translation?.data });
      }
    }
    map.set(p.id, buildPageGrounding({
      ocr: p.ocr?.data,
      translation: p.translation?.data,
      pageNumber: p.page_number,
      neighbors,
      bookSummary,
      radius: BATCH_GROUNDING_RADIUS,
    }));
  }
  return map;
}

async function submitImageExtractionBatch(db, book, candidatePages) {
  // Guard: check for existing active batch_jobs for this book
  const activeBatchForBook = await db.collection('batch_jobs').countDocuments({
    book_id: book.id,
    type: 'image_extraction',
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
  });
  if (activeBatchForBook > 0) {
    console.log(`    Skipping: ${activeBatchForBook} active image extraction batch jobs already exist`);
    return { submitted: 0, skippedDuplicate: true };
  }

  // Fetch page image URLs
  const pages = await db.collection('pages')
    .find({ id: { $in: candidatePages.map(p => p.id) } })
    .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
    .toArray();

  if (pages.length === 0) return { submitted: 0 };

  // Minimum batch size — don't burn a batch API call for a handful of pages
  if (pages.length < 25) {
    console.log(`    Skipping small image batch: ${pages.length} pages (min 25)`);
    return { submitted: 0, skippedSmallBatch: true };
  }

  console.log(`    Downloading ${pages.length} images for image extraction...`);
  const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
  if (downloaded.length === 0) {
    throw new Error(`All ${pages.length} image downloads failed`);
  }
  console.log(`    Downloaded ${downloaded.length}/${pages.length} images`);

  // Build prompt with book context
  const contextParts = [];
  if (book.title) contextParts.push(`Book: "${book.title}"`);
  if (book.author) contextParts.push(`Author: ${book.author}`);
  if (book.year) contextParts.push(`Year: ${book.year}`);
  if (book.language) contextParts.push(`Language: ${book.language}`);
  if (book.subjects?.length) contextParts.push(`Subjects: ${book.subjects.join(', ')}`);
  const contextPrefix = contextParts.length > 0
    ? `BOOK CONTEXT (background only — a hint for reading inscriptions and recognising a tradition; do NOT assert a person, figure, or scene unless it is actually visible in THIS image — a book about a subject does not mean every illustration depicts it):\n${contextParts.join(' | ')}\n\n`
    : '';
  const prompt = contextPrefix + IMAGE_EXTRACTION_PROMPT;

  // Per-page text grounding (#2707): subject identity comes from the page's own
  // OCR <image-desc>/<summary> + nearby text, not the book's topic. Appended per
  // item below so each page's prompt carries its own grounding.
  const groundingByPageId = await buildGroundingByPageId(db, book, candidatePages);

  const useFileBased = downloaded.length > IMAGE_EXTRACTION_INLINE_SIZE;
  const batchSize = useFileBased ? IMAGE_EXTRACTION_BATCH_SIZE : IMAGE_EXTRACTION_INLINE_SIZE;

  const parentJobId = nanoid();
  const childJobIds = [];
  let totalSubmitted = 0;
  let firstJobName = null;

  for (let j = 0; j < downloaded.length; j += batchSize) {
    const chunk = downloaded.slice(j, j + batchSize);
    const childJobId = nanoid();
    const displayName = `pipeline-images-${book.id}-${childJobId}`;
    let batchJob;

    if (useFileBased) {
      console.log(`    Building JSONL for ${chunk.length} pages (image extraction, file-based)...`);
      const { filePath: jsonlFile, fileSize } = buildJsonlFile(chunk, (item) => ({
        request: {
          contents: [{
            parts: [
              { text: prompt + (groundingByPageId.get(item.pageId) || '') },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      console.log(`    JSONL size: ${(fileSize / 1024 / 1024).toFixed(1)} MB for ${chunk.length} pages`);

      // Upload + create batch with same key (files are key-scoped). Round-robin across projects.
      // Non-quota errors capture into __submitErr so we always reach the unlink below.
      let uploadKeyIndex = -1;
      let __submitErr = null;
      const imgBestKey = getLeastLoadedKey();
      const imgStartKey = imgBestKey >= 0 ? imgBestKey : nextBatchKeyIndex();
      for (let attempt = 0; attempt < GEMINI_BATCH_KEYS.length; attempt++) {
        const uki = (imgStartKey + attempt) % GEMINI_BATCH_KEYS.length;
        let fileResult;
        try {
          fileResult = await uploadBatchFile(jsonlFile, displayName, uki);
          uploadKeyIndex = uki;
          console.log(`    Uploaded file: ${fileResult.name} (key ${uki})`);
        } catch (uploadErr) {
          const msg = uploadErr.message || '';
          if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log(`    Upload key ${uki} FILE API quota exhausted, trying next...`);
            continue;
          }
          __submitErr = uploadErr;
          break;
        }

        try {
          batchJob = await createBatchJobFromFile(IMAGE_EXTRACTION_MODEL, fileResult.name, displayName, uploadKeyIndex);
          recordSubmission(uki);
          try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (cleanupErr) {
            console.log(`    Warning: file cleanup failed: ${cleanupErr.message}`);
          }
          break;
        } catch (batchErr) {
          try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (_) {}
          const msg = batchErr.message || '';
          if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log(`    Batch create key ${uki} BATCH CREATION quota exhausted, re-uploading with next key...`);
            _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
            continue;
          }
          __submitErr = batchErr;
          break;
        }
      }
      try { fs.unlinkSync(jsonlFile); } catch (_) {}
      if (__submitErr) throw __submitErr;
      if (!batchJob) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
    } else {
      const inlineRequests = chunk.map(item => ({
        request: {
          contents: [{
            parts: [
              { text: prompt + (groundingByPageId.get(item.pageId) || '') },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      batchJob = await createBatchJobInline(IMAGE_EXTRACTION_MODEL, inlineRequests, displayName);
    }

    if (!firstJobName) firstJobName = batchJob.name;

    // Record in batch_jobs
    await db.collection('batch_jobs').insertOne({
      id: childJobId,
      parent_job_id: parentJobId,
      job_name: batchJob.name,
      type: 'image_extraction',
      book_id: book.id,
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      status: 'pending',
      model: IMAGE_EXTRACTION_MODEL,
      submission_method: useFileBased ? 'file' : 'inline',
      key_index: batchJob.keyIndex,
      created_at: new Date(),
      updated_at: new Date(),
    });

    childJobIds.push(childJobId);
    totalSubmitted += chunk.length;

    // Log to Supabase gemini_usage
    await logUsage({
      type: 'image_extraction', mode: 'batch', model: IMAGE_EXTRACTION_MODEL,
      book_id: book.id, book_title: book.title,
      page_ids: chunk.map(c => c.pageId), page_count: chunk.length,
      batch_job_id: childJobId, gemini_job_name: batchJob.name,
      input_tokens: 0, output_tokens: 0, status: 'submitted',
      endpoint: 'hetzner/pipeline-orchestrator',
    }, db);
  }

  // Create parent job if multiple children
  if (childJobIds.length > 1) {
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'image_extraction',
      book_id: book.id,
      child_job_ids: childJobIds,
      total_pages: totalSubmitted,
      status: 'pending',
      model: IMAGE_EXTRACTION_MODEL,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  const method = useFileBased ? 'file-based' : 'inline';
  return { submitted: totalSubmitted, jobName: firstJobName || parentJobId, childCount: childJobIds.length, method };
}

// Build per-page prompt with book context baked in
function buildPagePrompt(book) {
  const contextParts = [];
  if (book.title) contextParts.push(`Book: "${book.title}"`);
  if (book.author) contextParts.push(`Author: ${book.author}`);
  if (book.year) contextParts.push(`Year: ${book.year}`);
  if (book.language) contextParts.push(`Language: ${book.language}`);
  if (book.subjects?.length) contextParts.push(`Subjects: ${book.subjects.join(', ')}`);
  const contextPrefix = contextParts.length > 0
    ? `BOOK CONTEXT (background only — a hint for reading inscriptions and recognising a tradition; do NOT assert a person, figure, or scene unless it is actually visible in THIS image — a book about a subject does not mean every illustration depicts it):\n${contextParts.join(' | ')}\n\n`
    : '';
  return contextPrefix + IMAGE_EXTRACTION_PROMPT;
}

// Cross-book batch submission: pools pages from multiple books into shared 150-page batches.
// Each page carries its own book-specific prompt. Reduces batch creation count by ~60%.
async function submitCrossBookImageBatches(db, bookItems) {
  // bookItems: [{ book, candidatePages }]
  // Returns { submitted, batchCount, bookIds }

  // Guard: skip books with active batch_jobs
  const filteredItems = [];
  for (const item of bookItems) {
    const activeBatch = await db.collection('batch_jobs').countDocuments({
      $or: [
        { book_id: item.book.id },
        { book_ids: item.book.id },
      ],
      type: 'image_extraction',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (activeBatch > 0) {
      console.log(`    Skipping ${item.book.title}: ${activeBatch} active image extraction batch jobs`);
      continue;
    }
    filteredItems.push(item);
  }

  if (filteredItems.length === 0) return { submitted: 0, batchCount: 0, bookIds: [] };

  // Download images for all books, building per-page items with book context
  const allDownloaded = []; // { pageId, image, prompt, bookId }
  const bookMap = new Map(); // bookId -> book (for logging)

  for (const { book, candidatePages } of filteredItems) {
    bookMap.set(book.id, book);

    const pages = await db.collection('pages')
      .find({ id: { $in: candidatePages.map(p => p.id) } })
      .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
      .toArray();

    if (pages.length === 0) continue;

    console.log(`    Downloading ${pages.length} images for ${book.title}...`);
    const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
    if (downloaded.length === 0) {
      console.log(`    WARNING: All ${pages.length} image downloads failed for ${book.title}`);
      continue;
    }
    console.log(`    Downloaded ${downloaded.length}/${pages.length} images for ${book.title}`);

    const prompt = buildPagePrompt(book);
    // Per-page text grounding (#2707) for each book in the cross-book pool.
    const groundingByPageId = await buildGroundingByPageId(db, book, candidatePages);
    for (const item of downloaded) {
      allDownloaded.push({ pageId: item.pageId, image: item.image, prompt, grounding: groundingByPageId.get(item.pageId) || '', bookId: book.id });
    }
  }

  if (allDownloaded.length === 0) return { submitted: 0, batchCount: 0, bookIds: [] };

  console.log(`  Cross-book pool: ${allDownloaded.length} pages from ${bookMap.size} books`);

  // Split into shared batches of IMAGE_EXTRACTION_BATCH_SIZE (150)
  const parentJobId = nanoid();
  const childJobIds = [];
  let totalSubmitted = 0;
  let batchCount = 0;

  for (let j = 0; j < allDownloaded.length; j += IMAGE_EXTRACTION_BATCH_SIZE) {
    const chunk = allDownloaded.slice(j, j + IMAGE_EXTRACTION_BATCH_SIZE);
    const childJobId = nanoid();
    const chunkBookIds = [...new Set(chunk.map(c => c.bookId))];
    const displayName = `pipeline-images-cross-${chunkBookIds.length}books-${childJobId}`;

    console.log(`    Building JSONL for ${chunk.length} pages (cross-book batch, ${chunkBookIds.length} books)...`);
    const { filePath: jsonlFile, fileSize } = buildJsonlFile(chunk, (item) => ({
      request: {
        contents: [{
          parts: [
            { text: item.prompt + (item.grounding || '') },
            { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
          ],
        }],
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      metadata: { key: item.pageId },
    }));
    console.log(`    JSONL size: ${(fileSize / 1024 / 1024).toFixed(1)} MB for ${chunk.length} pages`);

    // Upload + create batch with same key (files are key-scoped). Least-loaded key first.
    // Non-quota errors capture into __submitErr so we always reach the unlink below.
    let batchJob = null;
    let __submitErr = null;
    const crossBestKey = getLeastLoadedKey();
    const crossStartKey = crossBestKey >= 0 ? crossBestKey : nextBatchKeyIndex();
    for (let attempt = 0; attempt < GEMINI_BATCH_KEYS.length; attempt++) {
      const uki = (crossStartKey + attempt) % GEMINI_BATCH_KEYS.length;
      let fileResult;
      try {
        fileResult = await uploadBatchFile(jsonlFile, displayName, uki);
        console.log(`    Uploaded file: ${fileResult.name} (key ${uki})`);
      } catch (uploadErr) {
        const msg = uploadErr.message || '';
        if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`    Upload key ${uki} quota exhausted, trying next...`);
          _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
          continue;
        }
        __submitErr = uploadErr;
        break;
      }

      try {
        batchJob = await createBatchJobFromFile(IMAGE_EXTRACTION_MODEL, fileResult.name, displayName, uki);
        recordSubmission(uki);
        try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (cleanupErr) {
          console.log(`    Warning: file cleanup failed: ${cleanupErr.message}`);
        }
        break;
      } catch (batchErr) {
        try { await getSdkClient(uki).files.delete({ name: fileResult.name }); } catch (_) {}
        const msg = batchErr.message || '';
        if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`    Batch create key ${uki} quota exhausted, re-uploading with next key...`);
          _geminiKeyLoads[uki] = MAX_ACTIVE_PER_KEY;
          continue;
        }
        __submitErr = batchErr;
        break;
      }
    }
    try { fs.unlinkSync(jsonlFile); } catch (_) {}
    if (__submitErr) throw __submitErr;
    if (!batchJob) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');

    // Record in batch_jobs — use book_ids array for cross-book, book_id for backward compat
    await db.collection('batch_jobs').insertOne({
      id: childJobId,
      parent_job_id: parentJobId,
      job_name: batchJob.name,
      type: 'image_extraction',
      book_id: chunkBookIds[0], // backward compat — first book
      book_ids: chunkBookIds,   // all books in this batch
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      status: 'pending',
      model: IMAGE_EXTRACTION_MODEL,
      submission_method: 'file',
      key_index: batchJob.keyIndex,
      cross_book: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    childJobIds.push(childJobId);
    totalSubmitted += chunk.length;
    batchCount++;

    // Log to Supabase gemini_usage (one entry per batch, listing all book IDs)
    await logUsage({
      type: 'image_extraction', mode: 'batch', model: IMAGE_EXTRACTION_MODEL,
      book_id: chunkBookIds[0],
      page_ids: chunk.map(c => c.pageId), page_count: chunk.length,
      batch_job_id: childJobId, gemini_job_name: batchJob.name,
      input_tokens: 0, output_tokens: 0, status: 'submitted',
      endpoint: 'hetzner/pipeline-orchestrator',
    }, db);
  }

  // Create parent job if multiple children
  if (childJobIds.length > 1) {
    const allBookIds = [...bookMap.keys()];
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'image_extraction',
      book_id: allBookIds[0],
      book_ids: allBookIds,
      child_job_ids: childJobIds,
      total_pages: totalSubmitted,
      status: 'pending',
      model: IMAGE_EXTRACTION_MODEL,
      cross_book: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  return { submitted: totalSubmitted, batchCount, bookIds: [...bookMap.keys()] };
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  assertModelsAreNotBroken({
    OCR_MODEL_FLASH, OCR_MODEL_LITE,
    TRANSLATE_MODEL_FLASH, TRANSLATE_MODEL_LITE,
    TRANSLITERATION_MODEL, IMAGE_EXTRACTION_MODEL,
  });
  cleanupStaleJsonlFiles();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  // Emergency stop check — no auto-resume (scheduler owns resume decisions)
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });

  // ── Selective unpause ──────────────────────────────────────────────
  // Process specific books even while globally paused. Driven by
  // system_config.processing_control.allow_book_ids[] / allow_collections[].
  // When a scope is set, the global pause is bypassed but EVERY phase is
  // confined to the allowlisted books (via applyBookOverride below). An
  // empty scope means the pause is a full stop, unchanged. The free
  // archiving workers already do this per-book (archive-bulk --book-id,
  // archive-iiif-local --ignore-pause); this brings the paid path in line.
  const { bookIds: _scopeBookIds, collections: _scopeCollections } = getScopeConfig(control);
  const _scopeIds = new Set(_scopeBookIds);
  if (_scopeCollections.length) {
    const scoped = await db.collection('books')
      .find({ collections: { $in: _scopeCollections } }, { projection: { id: 1 } })
      .toArray();
    for (const b of scoped) _scopeIds.add(String(b.id));
  }
  const SCOPED_MODE = _scopeIds.size > 0;
  // SCOPE_ACTIVE gates the per-phase applyBookOverride calls — true for either
  // a single --book override (existing behavior) or a config-driven allowlist.
  const SCOPE_ACTIVE = !!BOOK_OVERRIDE || SCOPED_MODE;

  if (RECOVERY_ONLY && !shouldBypassPause(control, { bookOverride: !!BOOK_OVERRIDE })) {
    console.log('[pipeline-orchestrator] PAUSED, but this is a recovery-only run (--phase 8.5): rolling back stuck statuses spends nothing, so it proceeds.');
  }
  if (!RECOVERY_ONLY && !shouldBypassPause(control, { bookOverride: !!BOOK_OVERRIDE })) {
    const pauseAgeMs = control.paused_at ? Date.now() - new Date(control.paused_at).getTime() : Infinity;
    console.log(`[pipeline-orchestrator] PAUSED (${Math.round(pauseAgeMs / 60000)}min ago by ${control.paused_by || 'unknown'}). Exiting.`);
    await db.collection('cron_runs').insertOne({
      cron: 'pipeline-orchestrator-worker', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'skipped', failed: false,
      actions: { skip_reason: 'pipeline paused', paused_by: control.paused_by, paused_at: control.paused_at },
      errors: [], error_count: 0,
      summary: `skipped: pipeline paused (by ${control.paused_by || 'unknown'}, ${Math.round(pauseAgeMs / 60000)}min ago)`,
    }).catch(() => {});
    await client.close();
    return;
  }
  if (control?.paused && SCOPED_MODE) {
    console.log(`[pipeline-orchestrator] PAUSED globally, but selective-unpause scope is active — processing ONLY ${_scopeIds.size} allowlisted book(s) (allow_book_ids + allow_collections).`);
  }

  // DB health probe — adjusts submission limits based on Atlas load
  const healthGrade = await probeDbHealth(db);
  if (healthGrade === 'critical') {
    console.log('[pipeline-orchestrator] DB critical — running with minimum limits. Will skip heavy phases.');
  }

  // DB-driven limit overrides — allows tuning without code deploys
  // Set via: db.system_config.updateOne({_id:'processing_control'}, {$set:{
  //   paused_phases: [2],           // pause specific phases (e.g. OCR=2)
  //   limit_overrides: { MAX_ACTIVE_IMAGE_JOBS: 80, IMAGE_SUBMIT_LIMIT: 100 }
  // }})
  if (control?.paused_phases?.length > 0) {
    PAUSED_PHASES = new Set(control.paused_phases);
    console.log(`[config] Paused phases: ${[...PAUSED_PHASES].join(', ')}`);
  }
  if (control?.limit_overrides) {
    const overrides = control.limit_overrides;
    const applied = [];
    if (overrides.OCR_SUBMIT_LIMIT != null) { OCR_SUBMIT_LIMIT = overrides.OCR_SUBMIT_LIMIT; applied.push(`OCR_SUBMIT_LIMIT=${OCR_SUBMIT_LIMIT}`); }
    if (overrides.MAX_ACTIVE_BATCH_OCR != null) { /* const, skip */ }
    if (overrides.IMAGE_SUBMIT_LIMIT != null) { IMAGE_SUBMIT_LIMIT = overrides.IMAGE_SUBMIT_LIMIT; applied.push(`IMAGE_SUBMIT_LIMIT=${IMAGE_SUBMIT_LIMIT}`); }
    if (overrides.MAX_ACTIVE_IMAGE_JOBS != null) { MAX_ACTIVE_IMAGE_JOBS = overrides.MAX_ACTIVE_IMAGE_JOBS; applied.push(`MAX_ACTIVE_IMAGE_JOBS=${MAX_ACTIVE_IMAGE_JOBS}`); }
    if (overrides.TRANSLATE_SUBMIT_LIMIT != null) { TRANSLATE_SUBMIT_LIMIT = overrides.TRANSLATE_SUBMIT_LIMIT; applied.push(`TRANSLATE_SUBMIT_LIMIT=${TRANSLATE_SUBMIT_LIMIT}`); }
    if (overrides.ENROLL_LIMIT != null) { ENROLL_LIMIT = overrides.ENROLL_LIMIT; applied.push(`ENROLL_LIMIT=${ENROLL_LIMIT}`); }
    if (overrides.METADATA_ENRICH_LIMIT != null) { METADATA_ENRICH_LIMIT = overrides.METADATA_ENRICH_LIMIT; applied.push(`METADATA_ENRICH_LIMIT=${METADATA_ENRICH_LIMIT}`); }
    if (overrides.ENRICH_LIMIT != null) { ENRICH_LIMIT = overrides.ENRICH_LIMIT; applied.push(`ENRICH_LIMIT=${ENRICH_LIMIT}`); }
    if (overrides.CHAPTER_LIMIT != null) { CHAPTER_LIMIT = overrides.CHAPTER_LIMIT; applied.push(`CHAPTER_LIMIT=${CHAPTER_LIMIT}`); }
    if (overrides.FINALIZE_LIMIT != null) { FINALIZE_LIMIT = overrides.FINALIZE_LIMIT; applied.push(`FINALIZE_LIMIT=${FINALIZE_LIMIT}`); }
    if (applied.length > 0) console.log(`[config] Limit overrides: ${applied.join(', ')}`);
  }

  // ── Book override: --book=ID runs a single book through any phase ──
  let _overrideBook = null;
  if (BOOK_OVERRIDE) {
    // Look up by id field first, fall back to _id (ObjectId)
    _overrideBook = await db.collection('books').findOne({ id: BOOK_OVERRIDE });
    if (!_overrideBook) {
      try {
        _overrideBook = await db.collection('books').findOne({ _id: new ObjectId(BOOK_OVERRIDE) });
      } catch { /* not a valid ObjectId, that's fine */ }
    }
    if (!_overrideBook) {
      console.error(`[pipeline-orchestrator] Book not found: ${BOOK_OVERRIDE}`);
      await client.close();
      process.exit(1);
    }
    console.log(`\n[OVERRIDE] Running phase ${ONLY_PHASE} on book: ${_overrideBook.title} (${_overrideBook.id || _overrideBook._id})`);
    console.log(`  Current pipeline status: ${_overrideBook.pipeline_auto?.status || 'none'}`);
  }

  /**
   * Replace a phase's normal book query results with the override book.
   * Re-fetches with the given projection to match what the phase expects.
   * Usage: `books = await applyBookOverride(db, books, { id: 1, title: 1 });`
   */
  async function applyBookOverride(db, normalBooks, projection) {
    // Single --book override: force exactly that book through the phase,
    // re-fetched with the phase's projection (ignores normal status gating).
    if (BOOK_OVERRIDE) {
      const bookId = _overrideBook.id || _overrideBook._id.toString();
      const book = await db.collection('books').findOne(
        { $or: [{ id: bookId }, { _id: _overrideBook._id }] },
        projection ? { projection } : undefined
      );
      return book ? [book] : [];
    }
    // Selective-unpause scope: keep the phase's own status-correct selection,
    // but confine it to the allowlisted books so they flow through naturally.
    if (SCOPED_MODE) {
      return normalBooks.filter(b => _scopeIds.has(String(b.id || b._id)));
    }
    return normalBooks;
  }

  const log = {
    enrolled: 0,
    archived: 0,
    preview_queued: 0,
    dedup_books: 0,
    dedup_pages_hidden: 0,
    dedup_flagged: 0,
    ocr_submitted: 0,
    ocr_advanced: 0,
    metadata_enriched: 0,
    metadata_skipped: 0,
    transliterated: 0,
    transliterate_pages: 0,
    translate_submitted: 0,
    translate_advanced: 0,
    enriched: 0,
    chapters_extracted: 0,
    chapters_skipped: 0,
    images_submitted: 0,
    images_advanced: 0,
    covers_selected: 0,
    digitizer_pages_hidden: 0,
    finalized: 0,
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
    zombie_jobs_cancelled: 0,
    errors: [],
  };

  // Selective-unpause: in scoped mode every phase post-filters its candidate
  // list down to the allowlist (applyBookOverride), so the per-phase limits
  // would otherwise hide scoped books behind the larger backlog (e.g. ~200+
  // un-enrolled imports ahead of them). Raise the limits past any realistic
  // backlog — real work stays capped to the allowlist by the post-filter, so
  // this only widens the candidate window, it does not widen what gets acted on.
  // Done here, after all health-grade and limit_overrides adjustments.
  if (SCOPED_MODE) {
    const SCOPE_LIMIT = 100000;
    ENROLL_LIMIT = ARCHIVE_LIMIT = OCR_SUBMIT_LIMIT = METADATA_ENRICH_LIMIT =
      TRANSLATE_SUBMIT_LIMIT = ENRICH_LIMIT = CHAPTER_LIMIT = IMAGE_SUBMIT_LIMIT =
      FINALIZE_LIMIT = TRANSLITERATE_LIMIT = PREVIEW_LIMIT = SCOPE_LIMIT;
    console.log(`[pipeline-orchestrator] Scoped mode: per-phase candidate limits raised to ${SCOPE_LIMIT} (work still confined to ${_scopeIds.size} allowlisted book(s)).`);
  }

  try {
    // ── Phase 0: Auto-enroll recently imported books ──
    if (shouldRun(0)) {
      console.log('\n--- Phase 0: Auto-enroll ---');
      const cutoff = new Date(Date.now() - ENROLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      let newBooks = await db.collection('books')
        .find({
          pipeline_auto: { $exists: false },
          created_at: { $gte: cutoff },
          'image_source.provider': { $nin: ART_PROVIDERS },
        })
        .project({ id: 1, language: 1 })
        .limit(ENROLL_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) newBooks = await applyBookOverride(db, newBooks, { id: 1, language: 1 });

      if (DRY_RUN) {
        console.log(`  Would enroll ${newBooks.length} books`);
      } else {
        const ENGLISH_VARIANTS_ENROLL = ['english', 'eng', 'en'];
        let ftFlagged = 0;
        for (const book of newBooks) {
          const lang = (book.language || '').toLowerCase();
          const likelyFT = lang && !ENGLISH_VARIANTS_ENROLL.includes(lang);
          const updates = {
            pipeline_auto: {
              status: 'queued',
              source: 'cron',
              queued_at: new Date(),
              last_updated: new Date(),
              retry_count: 0,
              likely_first_translation: likelyFT,
            },
            updated_at: new Date(),
          };
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: updates }
          );
          log.enrolled++;
          if (likelyFT) ftFlagged++;
        }
        console.log(`  FT-flagged: ${ftFlagged}/${log.enrolled}`);
      }
      console.log(`  Enrolled: ${log.enrolled}`);
    }

    // Artwork resource types — these skip the book pipeline entirely (no text to OCR/translate).
    // NOTE: 'papyrus_fragment' is deliberately NOT here — papyri (and cuneiform) are textual
    // sources and belong in the BOOK pipeline, like the Egyptian Book-of-the-Dead papyri.
    const ARTWORK_TYPES = ['painting', 'print', 'drawing', 'fresco', 'object'];
    // content_type is AUTHORITATIVE: 'book' is never artwork (overrides resource_type — needed
    // for object-typed textual papyri like "Papyrus, funerary, Book of the Dead"), 'artwork'
    // always is. resource_type is only a fallback when content_type is unset.
    // (See CLAUDE.md: don't gate artwork on resource_type alone.)
    const ARTWORK_MATCH = { content_type: { $ne: 'book' }, $or: [{ content_type: 'artwork' }, { resource_type: { $in: ARTWORK_TYPES } }] };

    // ── Phase 0: Skip artworks that somehow entered the pipeline ──
    if (shouldRun(1)) {
      const artworks = await db.collection('books').find({
        // Catch artwork at ANY pre-terminal stage, not just early ones. Some slip all the way
        // to finalize where Phase 9 mis-flags them "Empty book: 0 pages" (single-object
        // artworks legitimately have 0 pages).
        'pipeline_auto.status': { $nin: ['complete', 'needs_attention', 'failed', 'parked'] },
        ...ARTWORK_MATCH,
      }).project({ id: 1, title: 1 }).toArray();
      if (artworks.length > 0) {
        console.log(`\n--- Phase 0: Skipping ${artworks.length} artworks ---`);
        if (!DRY_RUN) {
          for (const art of artworks) {
            await setPipelineStatus(db, art.id, 'complete', { skipped: 'artwork' });
            console.log(`  Skipped artwork: ${art.title}`);
          }
        }
      }
    }

    // ── Phase 1: Archive check (queued/archiving -> archive_complete) ──
    if (shouldRun(1)) {
      console.log('\n--- Phase 1: Archive check ---');

      // Move queued -> archiving
      // Priority: confirmed first translations > non-English (likely first) > English
      const ENGLISH_VARIANTS_P1 = ['english', 'eng', 'en'];
      let queuedBooks = await db.collection('books')
        .aggregate([
          { $match: { 'pipeline_auto.status': 'queued', content_type: { $ne: 'artwork' }, $or: [{ content_type: 'book' }, { resource_type: { $nin: ARTWORK_TYPES } }] } },
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $ifNull: ['$pipeline_priority', 0] }, 1] }, then: -10 }, // Manual priority boost
                  { case: { $eq: ['$image_source.provider', 'bph'] }, then: -1 }, // BPH priority until backlog cleared
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P1] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1, hidden: 1 } },
          { $project: { id: 1 } },
          { $limit: ARCHIVE_LIMIT },
        ])
        .toArray();
      if (SCOPE_ACTIVE) queuedBooks = await applyBookOverride(db, queuedBooks, { id: 1 });

      if (!DRY_RUN) {
        for (const book of queuedBooks) {
          await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
          log.archived++;
        }
      }
      console.log(`  Queued -> archiving: ${queuedBooks.length}`);

      // Check archiving books for completion
      // Priority: confirmed first translations > non-English > English
      let archivingBooks = await db.collection('books')
        .aggregate([
          { $match: { 'pipeline_auto.status': 'archiving' } },
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $ifNull: ['$pipeline_priority', 0] }, 1] }, then: -10 }, // Manual priority boost
                  { case: { $eq: ['$image_source.provider', 'bph'] }, then: -1 }, // BPH priority until backlog cleared
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P1] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1, hidden: 1 } },
          { $project: { id: 1, pages_count: 1 } },
          { $limit: ARCHIVE_LIMIT },
        ])
        .toArray();
      if (SCOPE_ACTIVE) archivingBooks = await applyBookOverride(db, archivingBooks, { id: 1, pages_count: 1 });

      let archiveCompleted = 0;
      for (const book of archivingBooks) {
        // Count pages that have a valid R2 archive URL (not failed, not missing)
        const archivedPages = await db.collection('pages').countDocuments({
          book_id: book.id,
          archived_photo: { $exists: true, $regex: /^https?:\/\// },
        });

        // Also count pages with cropped photos (split pages already on R2)
        const croppedPages = await db.collection('pages').countDocuments({
          book_id: book.id,
          cropped_photo: { $exists: true, $nin: [null, ''] },
        });

        // A book is archive-complete when every page has either archived_photo or cropped_photo on R2.
        // Use pages_count as the target (avoids slow full-collection scans).
        const totalPages = book.pages_count || 0;
        // A page carrying BOTH archived_photo and cropped_photo is counted twice here,
        // so coveredPages can exceed the number of pages actually covered and drive
        // `remaining` to 0 while real pages still lack an archive. Observed on the small
        // idp_dunhuang books: pages_count 4, archived 2, cropped 4 -> covered 6 >= 4 ->
        // marked complete with 2 pages unarchived. Subtract the overlap.
        const bothPages = await db.collection('pages').countDocuments({
          book_id: book.id,
          archived_photo: { $exists: true, $regex: /^https?:\/\// },
          cropped_photo: { $exists: true, $nin: [null, ''] },
        });
        const coveredPages = archivedPages + croppedPages - bothPages;
        const remaining = Math.max(0, totalPages - coveredPages);

        // NEVER conclude "complete" from an unknown page count. With pages_count 0 or
        // unset, totalPages is 0, so `remaining` is 0 and the check below marks the book
        // archive_complete no matter how many unarchived pages it really has — and the
        // status sticks once pages_count is later filled in by the sync worker. 622 books
        // currently sit at archive_complete holding 291,310 unarchived pages, and the
        // zero-page branch is the only path in this function that can produce a book with
        // ZERO archived pages in that state (11 of 20 sampled). Not knowing the page count
        // is a reason to skip the book, not to declare it done.
        if (totalPages <= 0) continue;

        // Legacy fallback: for archivable sources, also check the old way
        // (pages from non-archivable sources that were never expected to be archived)
        const remainingArchivable = remaining > 0 ? await db.collection('pages').countDocuments({
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
        }) : 0;

        if (remaining === 0 || (remainingArchivable === 0 && coveredPages > 0)) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });

            // Auto-unhide books that were hidden because they were unarchived
            const bookDoc = await db.collection('books').findOne(
              { id: book.id, hidden: true, hidden_reason: 'unarchived' },
              { projection: { id: 1, title: 1 } }
            );
            if (bookDoc) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { hidden: false, visible: true, updated_at: new Date() }, $unset: { hidden_reason: '' } }
              );
              console.log(`    ✓ Auto-unhidden: ${bookDoc.title?.slice(0, 60)}`);
            }
          }
          archiveCompleted++;
          log.archived++;
        }
      }
      console.log(`  Archive completed: ${archiveCompleted}/${archivingBooks.length}`);

      // Also check warehouse books for archive completion
      // Archive workers update pages_archived on warehouse books, but Phase 1 only checks live.
      // Use pages_archived >= pages_count as a fast check (no per-page queries needed).
      const WAREHOUSE_ARCHIVE_CHECK_LIMIT = 200;
      const warehouseArchiving = await db.collection('books_warehouse')
        .find({
          'pipeline_auto.status': 'archiving',
          pages_count: { $gt: 0 },
          pages_archived: { $exists: true, $gt: 0 },
        })
        .project({ id: 1, title: 1, pages_count: 1, pages_archived: 1 })
        .limit(WAREHOUSE_ARCHIVE_CHECK_LIMIT)
        .toArray();

      let warehouseCompleted = 0;
      for (const book of warehouseArchiving) {
        if (book.pages_archived >= book.pages_count) {
          if (!DRY_RUN) {
            await db.collection('books_warehouse').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'archive_complete', 'pipeline_auto.last_updated': new Date() } }
            );
          }
          warehouseCompleted++;
        }
      }
      if (warehouseCompleted > 0 || warehouseArchiving.length > 0) {
        console.log(`  Warehouse archive check: ${warehouseCompleted}/${warehouseArchiving.length} completed (${await db.collection('books_warehouse').countDocuments({ 'pipeline_auto.status': 'archiving' })} total archiving)`);
      }
    }

    // ── Phase 1.25: Split detection for spread scans ──
    // Three-step flow:
    //   1. AR screening (free, sharp metadata) — filters obvious portrait pages
    //   2. Gemini visual check (cheap flash-lite) — confirms spread vs foldout/map/table
    //   3. Flag needs_splitting=true → Phase 2 OCR uses spread-aware prompt with
    //      <split-position> + <page-break/> → post-OCR split crops images
    // AR > 1.2 is necessary but NOT sufficient — foldouts and maps are wide single pages.
    // See: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/824
    if (shouldRun(1.25)) {
      console.log('\n--- Phase 1.25: Split detection (AR screen → Gemini confirm) ---');

      // Scoped mode raises the window so allowlisted books behind the backlog
      // aren't stranded (work stays confined by applyBookOverride below). The
      // module-level phase limits get this raise already; phase-local consts
      // like this one were missed — the selective-unpause stall bug.
      const SPLIT_LIMIT = SCOPED_MODE ? 100000 : 100; // Max books per cycle
      const ASPECT_RATIO_THRESHOLD = 1.2; // Width/height > 1.2 = likely spread

      // Find archive_complete books that haven't been split-checked yet
      let candidates = await db.collection('books')
        .find({
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.split_checked': { $ne: true },
        })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1 })
        .limit(SPLIT_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) candidates = await applyBookOverride(db, candidates, { id: 1, title: 1, pages_count: 1 });

      console.log(`  Candidates for split check: ${candidates.length}`);

      let splitChecked = 0;
      let splitFlagged = 0;

      for (const book of candidates) {
        try {
          const label = (book.title || '').substring(0, 50);

          // Sample first 5 pages to check aspect ratio
          const samplePages = await db.collection('pages')
            .find({ book_id: book.id, crop: { $exists: false } })
            .sort({ page_number: 1 })
            .limit(5)
            .project({ id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1 })
            .toArray();

          if (samplePages.length === 0) {
            // No pages without crop — already split or single-page
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
              );
            }
            splitChecked++;
            continue;
          }

          // Check aspect ratio of sample pages
          const sharp = (await import('sharp')).default;
          let isSpread = false;
          let checkedAny = false;
          let detectedAr = null;
          let spreadImageBuffer = null; // Keep buffer for Gemini confirmation

          for (const page of samplePages) {
            const imageUrl = page.archived_photo || page.photo_original || page.photo;
            if (!imageUrl) continue;

            try {
              const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
              if (!imgRes.ok) continue;
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              const meta = await sharp(buffer).metadata();
              if (meta.width && meta.height) {
                checkedAny = true;
                const ratio = meta.width / meta.height;
                if (ratio > ASPECT_RATIO_THRESHOLD) {
                  isSpread = true;
                  detectedAr = ratio;
                  spreadImageBuffer = buffer;
                  break; // One wide page is enough to flag the book
                }
              }
            } catch (err) {
              console.log(`    ${label}: AR check failed p${page.page_number}: ${err.message?.slice(0, 60)}`);
            }
          }

          if (!checkedAny) {
            console.log(`    ${label}: could not check any page images, skipping`);
            continue; // Don't mark split_checked — retry next cycle
          }

          if (!isSpread) {
            // All pages are portrait — no spread, mark as checked
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
              );
            }
            console.log(`    ${label}: portrait pages, no split needed`);
            splitChecked++;
            continue;
          }

          // AR > threshold — confirm with Gemini before flagging for spread-aware OCR.
          // This prevents wasting the spread OCR prompt on foldouts, maps, and wide tables.
          console.log(`    ${label}: AR=${detectedAr.toFixed(2)}, confirming with Gemini...`);

          if (DRY_RUN) {
            console.log(`    Would confirm with Gemini: ${label}`);
            splitChecked++;
            continue;
          }

          let isConfirmedSpread = false;
          try {
            // Use the already-downloaded buffer from AR check, resize for cheap call
            const candidateBuf = spreadImageBuffer;
            const resized = await sharp(candidateBuf).resize(1024).jpeg({ quality: 80 }).toBuffer();
            const base64 = resized.toString('base64');

            const SPLIT_CONFIRM_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
            const SPLIT_CONFIRM_MODEL = 'gemini-3.1-flash-lite';
            const geminiUrl = `${GEMINI_API_BASE}/models/${SPLIT_CONFIRM_MODEL}:generateContent?key=${SPLIT_CONFIRM_KEY}`;
            const geminiRes = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: `Is this a TWO-PAGE SPREAD (two book pages photographed together with a gutter in the middle) or a SINGLE WIDE PAGE (foldout, map, table, or illustration)?

Look for: central gutter/binding shadow, two separate text blocks, page numbers on both margins.

Reply with ONLY: {"is_spread": true} or {"is_spread": false}` },
                    { inline_data: { mime_type: 'image/jpeg', data: base64 } },
                  ],
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 30 },
              }),
              signal: AbortSignal.timeout(20000),
            });

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json();
              const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const jsonMatch = rawText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                isConfirmedSpread = !!result.is_spread;
              }
            }
          } catch (err) {
            // On Gemini failure, assume spread (safer — OCR prompt handles non-spreads gracefully)
            console.log(`    ${label}: Gemini check failed (${err.message?.slice(0, 60)}), assuming spread`);
            isConfirmedSpread = true;
          }

          if (!isConfirmedSpread) {
            // Gemini says NOT a spread — mark checked, skip spread-aware OCR
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: {
                needs_splitting: false,
                'pipeline_auto.split_checked': true,
                'pipeline_auto.split_ar': detectedAr,
                'pipeline_auto.last_updated': new Date(),
              } }
            );
            console.log(`    ${label}: Gemini says NOT a spread (wide single page), skipping`);
            splitChecked++;
            continue;
          }

          // Confirmed spread — flag for spread-aware OCR in Phase 2
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: {
              needs_splitting: true,
              'pipeline_auto.split_checked': true,
              'pipeline_auto.split_ar': detectedAr,
              'pipeline_auto.last_updated': new Date(),
            } }
          );
          console.log(`    ${label}: SPREAD confirmed, flagged for spread-aware OCR`);
          splitChecked++;
          splitFlagged++;

        } catch (err) {
          console.log(`    ${book.title?.slice(0, 50)}: ERROR — ${err.message?.slice(0, 120)}`);
        }
      }

      console.log(`  Split checked: ${splitChecked}, flagged for splitting: ${splitFlagged}`);
    }

    // ── Phase 1.3: Split spreads at detection time (#2454) ──
    // Books flagged needs_splitting by Phase 1.25 get their images split into
    // left/right pages BEFORE any OCR, via split-book.mjs --gutter-only (one
    // cheap "where is the gutter" Gemini call per page, no transcription).
    // Everything downstream — preview OCR, batch OCR, translation, extraction —
    // then only ever sees single pages, eliminating the entire marker-dance /
    // race-window class of bugs (#2449). Phase 3.1 remains for books already
    // past OCR with spread markers (legacy in-flight path).
    if (shouldRun(1.3)) {
      console.log('\n--- Phase 1.3: Pre-OCR spread split (gutter-only) ---');

      const PRE_SPLIT_LIMIT = SCOPED_MODE ? 100000 : 8; // each book downloads + crops + uploads all its images (scoped mode raises the window; work confined by applyBookOverride below)

      let readyForPreSplit = await db.collection('books')
        .find({
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.split_checked': true,
          needs_splitting: true,
          split_completed: { $ne: true },
          // Books that already have substantial OCR are mid-flight on the legacy
          // marker path (Phase 2 spread OCR → Phase 3.1) — let that finish rather
          // than discarding their spread OCR. Fresh books have at most preview OCR.
          $or: [{ pages_ocr: { $in: [0, null] } }, { pages_ocr: { $exists: false } }],
        })
        .sort({ pages_count: 1 }) // smallest first — fast wins
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.pre_split_retry_count': 1 })
        .limit(PRE_SPLIT_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForPreSplit = await applyBookOverride(db, readyForPreSplit, { id: 1, title: 1, pages_count: 1, pipeline_auto: 1 });

      if (readyForPreSplit.length > 0) {
        console.log(`  Books ready for pre-OCR split: ${readyForPreSplit.length}`);
      }

      for (const book of readyForPreSplit) {
        const label = (book.title || '').substring(0, 50);
        if (DRY_RUN) { console.log(`  Would pre-split: ${label} (${book.pages_count} pages)`); continue; }
        try {
          console.log(`  Pre-splitting: ${label} (${book.pages_count} pages)...`);
          const scriptPath = new URL('../split-book.mjs', import.meta.url).pathname;
          const { stderr } = await execFileAsync('node', [scriptPath, book.id, '--gutter-only'], {
            timeout: 600000, // 10 min per book (downloads + crops + uploads)
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
          });
          if (stderr) console.log(`    stderr: ${stderr.slice(0, 200)}`);
          // split-book.mjs sets split_completed, needs_splitting:false, and
          // requeues at archive_complete — the book now flows as single pages.
          console.log(`    Done: ${label}`);
        } catch (err) {
          const msg = err.stderr || err.message || String(err);
          console.log(`    FAIL: ${label} — ${msg.slice(0, 150)}`);
          const retryCount = (book.pipeline_auto?.pre_split_retry_count || 0) + 1;
          if (retryCount >= 3) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Pre-OCR split failed ${retryCount} times: ${msg.slice(0, 200)}`,
              pre_split_retry_count: retryCount,
            });
          } else {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.pre_split_retry_count': retryCount, 'pipeline_auto.last_updated': new Date() } }
            );
          }
        }
      }
    }

    // ── Phase 1.5: Preview OCR — first 25 pages via inline Gemini ──
    // OCRs the title page, TOC, and opening pages directly via Gemini realtime API.
    // Purpose: get text for AI metadata classification (Phase 1.6) before full OCR.
    // Prioritizes likely first translations (flagged at enrollment).
    if (shouldRun(1.5)) {
      console.log('\n--- Phase 1.5: Preview OCR (inline Gemini, first 25 pages) ---');

      let readyForPreview = await db.collection('books')
        .find({
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.split_checked': true,
          'pipeline_auto.preview_ocr_done': { $ne: true },
          'pipeline_auto.recitation_retry': { $ne: true },
          'pipeline_auto.recitation_blocked': { $ne: true },
          // Spread guard (#2449): preview OCR uses the standard prompt, which writes
          // marker-less text that poisons the post-OCR split. Spread books get their
          // first OCR from Phase 2's spread-aware path instead.
          $or: [{ needs_splitting: { $ne: true } }, { split_completed: true }],
        })
        .sort({ 'pipeline_auto.likely_first_translation': -1, hidden: 1 })
        .project({ id: 1, title: 1, language: 1, needs_splitting: 1 })
        .limit(PREVIEW_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForPreview = await applyBookOverride(db, readyForPreview, { id: 1, title: 1, language: 1, needs_splitting: 1 });

      console.log(`  Books ready for preview OCR: ${readyForPreview.length}`);

      const previewOcrPromptRef = await getOcrPromptFromDb(db);
      const previewOcrPrompt = previewOcrPromptRef.text;
      const previewApiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
      const previewModel = OCR_MODEL_LITE;
      let previewDone = 0;

      for (const book of readyForPreview) {
        try {
          const label = (book.title || '').substring(0, 50);

          // Get first 25 pages needing OCR with R2 images
          const previewPages = await db.collection('pages')
            .find({
              book_id: book.id,
              $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' },
              ],
              $and: [{
                $or: [
                  { cropped_photo: { $exists: true, $nin: [null, ''] } },
                  { archived_photo: { $regex: /^https?:\/\// } },
                ]
              }],
            })
            .sort({ page_number: 1 })
            .limit(PREVIEW_PAGE_COUNT)
            .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
            .toArray();

          if (previewPages.length === 0) {
            // All pages already have OCR — skip preview
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.preview_ocr_done': true, updated_at: new Date() } }
              );
            }
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would preview OCR: ${label} — ${previewPages.length} pages`);
            continue;
          }

          // Download images
          const downloaded = await downloadImagesParallel(previewPages, IMAGE_CONCURRENCY);
          if (downloaded.length < 3) {
            console.log(`  Too few images for preview: ${label} (${downloaded.length})`);
            continue;
          }

          // OCR each page via Gemini realtime (one call per page, parallel batches of 5)
          let pagesOcrd = 0;
          for (let i = 0; i < downloaded.length; i += 5) {
            const batch = downloaded.slice(i, i + 5);
            const results = await Promise.allSettled(batch.map(async ({ pageId, image }) => {
              const url = `${GEMINI_API_BASE}/models/${previewModel}:generateContent?key=${previewApiKey}`;
              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    role: 'user',
                    parts: [
                      { inlineData: { mimeType: image.mimeType, data: image.data } },
                      { text: previewOcrPrompt },
                    ],
                  }],
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                  ],
                  generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
                }),
              });

              if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Gemini ${response.status}: ${errText.substring(0, 100)}`);
              }

              const data = await response.json();
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const usage = data.usageMetadata || {};

              if (text) {
                await saveRevisionBeforeOverwrite(db, pageId, 'ocr');
                await db.collection('pages').updateOne(
                  { id: pageId },
                  { $set: {
                    'ocr.data': text,
                    'ocr.model': previewModel,
                    'ocr.prompt_version': previewOcrPromptRef.version || OCR_PROMPT_VERSION,
                    'ocr.prompt_id': previewOcrPromptRef.id,
                    'ocr.prompt_hash': previewOcrPromptRef.content_hash,
                    'ocr.prompt_name': previewOcrPromptRef.name,
                    'ocr.updated_at': new Date(),
                    'ocr.source': 'pipeline_preview',
                    updated_at: new Date(),
                  }}
                );
                pagesOcrd++;
              }

              // Log usage (fire-and-forget)
              const inputTokens = usage.promptTokenCount || 0;
              const outputTokens = usage.candidatesTokenCount || 0;
              const costUsd = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.30;
              logUsageAsync({
                type: 'ocr', mode: 'realtime', model: previewModel,
                book_id: book.id, page_ids: [pageId],
                input_tokens: inputTokens, output_tokens: outputTokens,
                cost_usd: costUsd, status: 'success', endpoint: 'hetzner/pipeline-preview-ocr',
              }, db);
            }));

            // Brief pause between batches
            await sleep(200);
          }

          // Update book: mark preview done, sync OCR count. VISIBLE pages only
          // (page_number > 0) — see scripts/lib/page-counts.mjs and issue #3293.
          const ocrCount = await db.collection('pages').countDocuments({
            book_id: book.id,
            ...VISIBLE_PAGE_MATCH,
            'ocr.data': { $exists: true, $ne: '', $not: { $eq: null } },
          });
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: {
              'pipeline_auto.preview_ocr_done': true,
              pages_ocr: ocrCount,
              updated_at: new Date(),
            }}
          );

          previewDone++;
          console.log(`  Preview OCR done: ${label} — ${pagesOcrd}/${downloaded.length} pages`);
        } catch (err) {
          log.errors.push(`Preview OCR ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Preview OCR completed: ${previewDone} books`);
    }

    // ── Phase 1.6: AI metadata classification ──
    // Reads preview OCR text (title page, TOC) and calls Gemini to classify:
    // language, description, display_title, categories, source_work_dates, FT pre-screen.
    // Also does catalog cross-reference (USTC/EFM) for year/place/publisher.
    // Writes ai_metadata and updates book fields at medium+ confidence.
    if (shouldRun(1.6) || shouldRun(1.5)) {
      console.log('\n--- Phase 1.6: AI metadata classification ---');

      const metadataApiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
      const metadataModel = OCR_MODEL_LITE; // flash-lite is sufficient for structured metadata extraction
      const MAX_METADATA_OCR_PAGES = 25;
      const MAX_TEXT_PER_PAGE = 2000;
      const METADATA_CATEGORIES = [
        'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala', 'neoplatonism',
        'rosicrucianism', 'freemasonry', 'natural-philosophy', 'astrology', 'natural-magic',
        'ritual-magic', 'theurgy', 'mysticism', 'theology', 'medicine', 'gnosticism',
        'theosophy', 'pythagoreanism', 'divination', 'ars-notoria', 'paracelsian',
        'spiritual-alchemy', 'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
        'astronomy', 'mathematics', 'botany', 'chemistry', 'geography', 'history',
        'law', 'literature', 'linguistics', 'music', 'architecture', 'art',
        'military', 'politics', 'philosophy',
        'sufism', 'vedanta', 'buddhism', 'daoism', 'biblical-studies',
      ];

      // Find books with preview OCR done but no AI metadata yet
      let readyForMetadata = await db.collection('books')
        .find({
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.preview_ocr_done': true,
          'ai_metadata.enriched_at': { $exists: false },
        })
        .sort({ 'pipeline_auto.likely_first_translation': -1, hidden: 1 })
        .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1,
                   description: 1, categories: 1, is_first_translation: 1, source_work_dates: 1,
                   field_provenance: 1, subject_keywords: 1, 'translation_verification.source': 1 })
        .limit(METADATA_ENRICH_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForMetadata = await applyBookOverride(db, readyForMetadata, { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, description: 1, categories: 1, is_first_translation: 1, source_work_dates: 1, field_provenance: 1, subject_keywords: 1, 'translation_verification.source': 1 });

      console.log(`  Books ready for AI metadata: ${readyForMetadata.length}`);
      let metadataEnriched = 0;

      for (const book of readyForMetadata) {
        try {
          const label = (book.title || '').substring(0, 50);

          // Fetch first N OCR pages
          const ocrPages = await db.collection('pages')
            .find(
              { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
              { projection: { page_number: 1, 'ocr.data': 1 } }
            )
            .sort({ page_number: 1 })
            .limit(MAX_METADATA_OCR_PAGES)
            .toArray();

          if (ocrPages.length < 3) {
            console.log(`  Too few OCR pages for metadata: ${label} (${ocrPages.length})`);
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would classify: ${label} — ${ocrPages.length} pages`);
            continue;
          }

          const ocrSamples = ocrPages.map(p => ({
            pageNumber: p.page_number,
            text: (p.ocr?.data || '').substring(0, MAX_TEXT_PER_PAGE),
          }));

          const ocrSection = `\n\nHere is the OCR text from ${ocrSamples.length} pages of this book:\n\n` +
            ocrSamples.map(s => `--- Page ${s.pageNumber} ---\n${s.text}`).join('\n\n');

          const classifyPrompt = `You are a rare books librarian and translation scholar examining transcribed text from a historical book.

Book metadata:
- Title: "${book.display_title || book.title || 'Unknown'}"
- Author: ${book.author || 'Unknown'}
- Current language field: ${book.language || 'Unknown'}
- Published: ${book.published || 'Unknown'}
- Year: ${book.year || 'Unknown'}
${ocrSection}

Based on this text and metadata, classify the book. Respond with JSON only — no markdown fences, no explanation.

{
  "language": "<primary language of the text>",
  "author": "<detected author name from title page. null if not identifiable>",
  "secondary_languages": ["<any other languages present>"],
  "script": "<writing system: Latin alphabet, Fraktur, Greek, Chinese characters, Hebrew, Arabic, Devanagari, etc.>",
  "categories": ["<1-4 subject tags from EXACTLY this list: ${METADATA_CATEGORIES.join(', ')}>"],
  "estimated_year": "<best estimate of publication year as number. null if impossible>",
  "estimated_century": "<e.g. '17th century' — fallback if exact year unclear>",
  "description": "<1-2 sentence scholarly description. No em-dashes. No filler.>",
  "display_title": "<Clear English title. Must be ENTIRELY in English — no foreign words. null for English books.>",
  "confidence": "<high, medium, or low>",
  "subject_keywords": ["<3-5 subject keywords>"],
  "first_translation": {
    "status": "<confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences>",
    "known_translations": ["<any known English translations>"],
    "confidence": "<high, medium, or low>"
  },
  "source_work_dates": {
    "layers": [{ "type": "<composition|translation|compilation|commentary|redaction|edition|abridgement>", "date": "<year string>", "date_display": "<human readable>", "date_precision": "<exact|decade|century|millennium>", "author": "<person>", "work_title": "<if different>", "language": "<language>", "notes": "<brief>" }],
    "confidence": "<high|medium|low>",
    "reasoning": "<1-2 sentences>"
  }
}

Rules:
- For language, identify the LANGUAGE OF THE TEXT, not library annotations
- For categories, use ONLY exact slugs from the list above
- Most pre-1800 non-English texts were NEVER translated to English
- If the book IS in English, set first_translation status to "not_applicable"
- For display_title: conventional English names when they exist, literal translation otherwise. No shelfmarks, library names, or edition info.
- For source_work_dates: empty layers [] if book IS the original work. Include composition/translation layers for older works.`;

          const startTime = Date.now();
          const url = `${GEMINI_API_BASE}/models/${metadataModel}:generateContent?key=${metadataApiKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: classifyPrompt }] }],
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
              },
            }),
          });

          const durationMs = Date.now() - startTime;

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
          }

          const data = await response.json();
          const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          const usage = data.usageMetadata || {};
          const inputTokens = usage.promptTokenCount || 0;
          const outputTokens = usage.candidatesTokenCount || 0;

          let parsed;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error('Failed to parse JSON response');
            }
          }

          // Build updates — only apply at medium+ confidence
          const confidence = parsed.confidence || 'low';
          const now = new Date();
          const changes = [];
          const updates = { updated_at: now };

          if (confidence !== 'low') {
            // Language: update if Unknown
            const currentLang = book.language || 'Unknown';
            const aiLang = parsed.language || '';
            if (aiLang && currentLang === 'Unknown') {
              updates.language = aiLang;
              updates.language_source = 'gemini_text';
              updates.language_confidence = confidence;
              changes.push({ field: 'language', previous: currentLang, new_value: aiLang });
            } else if (aiLang && aiLang.toLowerCase() !== currentLang.toLowerCase() && confidence === 'high') {
              updates.ai_detected_language = aiLang;
            }

            // Author: update if Unknown/missing
            const currentAuthor = book.author || 'Unknown';
            const aiAuthor = parsed.author || '';
            if (aiAuthor && (currentAuthor === 'Unknown' || !currentAuthor)) {
              updates.author = aiAuthor;
              changes.push({ field: 'author', previous: currentAuthor, new_value: aiAuthor });
            }

            // Year: set if missing
            if (!book.year && parsed.estimated_year) {
              const year = parseInt(String(parsed.estimated_year));
              if (!isNaN(year) && year > 0 && year < 2100) {
                updates.year = year;
                changes.push({ field: 'year', previous: null, new_value: year });
                if (!book.published || book.published === 'Unknown') {
                  updates.published = String(year);
                }
              }
            }

            // Categories: merge with existing. Canonicalize (lowercase, trim,
            // spaces → hyphens) so the AI's free-form casing ("Philosophy",
            // "Natural Philosophy") folds into the curated category ids instead
            // of drifting into separate buckets that `categories @> [id]` can't
            // match. Keep in sync with canonicalizeCategory() in src/lib/books-catalog.ts.
            if (parsed.categories?.length > 0) {
              const canon = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');
              const existing = (book.categories || []).map(canon);
              const merged = [...new Set([...existing, ...parsed.categories.map(canon)])].filter(Boolean);
              const changed = merged.length !== existing.length ||
                merged.some((c, i) => c !== (book.categories || [])[i]);
              if (changed) {
                updates.categories = merged;
                changes.push({ field: 'categories', previous: book.categories || [], new_value: merged });
              }
            }

            // Description: set if missing
            if (parsed.description && !book.description) {
              updates.description = parsed.description;
              changes.push({ field: 'description', previous: null, new_value: parsed.description });
            }

            // Display title: set if missing and non-English
            const effectiveLang = (updates.language || book.language || '').toLowerCase();
            if (parsed.display_title && !book.display_title && effectiveLang !== 'english') {
              updates.display_title = parsed.display_title;
              changes.push({ field: 'display_title', previous: null, new_value: parsed.display_title });
            }

            // Subject keywords
            if (parsed.subject_keywords?.length > 0) {
              updates.subject_keywords = parsed.subject_keywords;
            }

            // First translation: derive boolean + refine pipeline flag.
            // CATALOG PRECEDENCE (#1974): this is a content-based read of the
            // book's own pages — it CANNOT establish whether someone else already
            // published a translation, which is a catalog fact. So it must never
            // overwrite a catalog-grounded determination. Re-enrichment was
            // clobbering correct catalog verdicts and manufacturing false "first
            // translation" claims. Authoritative sources are the catalog-grounded
            // ones (catalog_search / catalog_and_llm from search+validate-
            // translation-evidence, and the deliberate canonical_kanjur tag) — NOT
            // gemini_knowledge_lookup, which is itself memory-based. The content
            // opinion is still preserved in ai_metadata.first_translation below.
            if (parsed.first_translation?.status) {
              const CATALOG_GROUNDED_SOURCES = ['catalog_search', 'catalog_and_llm', 'canonical_kanjur'];
              if (CATALOG_GROUNDED_SOURCES.includes(book.translation_verification?.source)) {
                changes.push({ field: 'is_first_translation', skipped: 'deferred_to_catalog_verification', verification_source: book.translation_verification.source, content_status: parsed.first_translation.status });
              } else {
                const isFirst = ['confirmed_first', 'likely_first'].includes(parsed.first_translation.status);
                updates.is_first_translation = isFirst;
                updates['pipeline_auto.likely_first_translation'] = isFirst;
                changes.push({ field: 'is_first_translation', previous: book.is_first_translation ?? null, new_value: isFirst });
              }
            }

            // Source work dates
            if (parsed.source_work_dates?.layers?.length > 0 && !book.source_work_dates) {
              const validTypes = ['composition', 'translation', 'compilation', 'commentary', 'redaction', 'edition', 'abridgement', 'adaptation'];
              const validPrecisions = ['exact', 'decade', 'century', 'millennium'];
              const validLayers = parsed.source_work_dates.layers.filter(l =>
                l.type && l.date && l.date_display && l.date_precision &&
                validTypes.includes(l.type.split('|')[0].trim()) &&
                validPrecisions.includes(l.date_precision)
              );
              if (validLayers.length > 0) {
                updates.source_work_dates = validLayers;
                updates.source_work_dates_meta = {
                  enriched_at: now, model: metadataModel,
                  confidence: parsed.source_work_dates.confidence || 'medium',
                  source: 'ai_enrichment',
                  reasoning: parsed.source_work_dates.reasoning || '',
                };
              }
            }

            // Field provenance
            const provenance = book.field_provenance || {};
            const aiSource = { source: 'ai_enrichment', model: metadataModel, date: now, confidence, pages_checked: ocrSamples.length };
            if (updates.language) provenance.language = { ...aiSource, previous_value: book.language };
            if (updates.author) provenance.author = { ...aiSource, previous_value: book.author };
            if (updates.is_first_translation !== undefined) provenance.is_first_translation = aiSource;
            if (updates.year) provenance.year = { ...aiSource, previous_value: null };
            if (updates.categories) provenance.categories = { ...aiSource, previous_value: book.categories || [] };
            if (updates.display_title) provenance.display_title = aiSource;
            if (updates.description) provenance.description = aiSource;
            if (updates.subject_keywords) provenance.subject_keywords = aiSource;
            updates.field_provenance = provenance;
          }

          // Always save ai_metadata (even at low confidence)
          updates.ai_metadata = {
            ...parsed,
            model: metadataModel,
            pages_checked: ocrSamples.length,
            enriched_at: now,
            enrichment_method: 'text',
            changes,
          };

          await db.collection('books').updateOne({ id: book.id }, { $set: updates });

          // Also run catalog cross-reference (folded from old Phase 3.5)
          try {
            const catalogResult = await verifyMetadataInline(db, book);
            if (catalogResult.applied > 0) {
              console.log(`    [catalog] ${book.id}: applied ${catalogResult.applied} fields from ${catalogResult.source}`);
            }
          } catch (catalogErr) {
            // Non-fatal — catalog lookup is best-effort
          }

          // Log usage
          const costUsd = (inputTokens / 1_000_000) * 0.50 + (outputTokens / 1_000_000) * 3.00;
          logUsageAsync({
            type: 'metadata_enrichment', mode: 'realtime', model: metadataModel,
            book_id: book.id, book_title: book.display_title || book.title,
            input_tokens: inputTokens, output_tokens: outputTokens,
            cost_usd: costUsd, duration_ms: durationMs, status: 'success',
            endpoint: 'hetzner/pipeline-metadata',
          }, db);

          // Log to audit_log if changes were made
          if (changes.length > 0) {
            db.collection('audit_log').insertOne({
              action: 'book_metadata_updated',
              book_id: book.id,
              book_title: book.display_title || book.title,
              metadata: { source: 'ai_enrichment', model: metadataModel, confidence, changes },
              created_at: now,
            }).catch(() => {});
          }

          metadataEnriched++;
          console.log(`  Classified: ${label} — ${confidence} confidence, ${changes.length} fields updated`);

          await sleep(API_DELAY_MS);
        } catch (err) {
          log.errors.push(`Metadata ${book.id}: ${err.message}`);
        }
      }
      console.log(`  AI metadata classified: ${metadataEnriched} books`);
    }

    // ── Phase 1.95: Warehouse promotion (books_warehouse -> live books) ──
    // Books sit in warehouse during archiving to reduce Atlas load. Once archive_complete,
    // they must be promoted to the live collection before OCR can run.
    // The old Vercel cron that did this was archived — this replaces it.
    if (shouldRun(2)) {
      const PROMOTE_LIMIT = 50; // Each book copies all pages — keep moderate to avoid Atlas spikes
      const ENGLISH_VARIANTS_WH = ['english', 'eng', 'en'];
      const promoteCandidates = await db.collection('books_warehouse')
        .aggregate([
          // promoted_to filter is CRITICAL: promotion marks the warehouse copy
          // promoted_to:'live' but never changes pipeline_auto.status, so
          // without it every promoted book stays a candidate forever and the
          // same top-50 get re-promoted every cycle — each pass $set the STALE
          // warehouse doc over the live one, silently reverting live edits
          // (caught 2026-07-05: a #3002 collection re-tag kept undoing itself).
          { $match: { 'pipeline_auto.status': 'archive_complete', promoted_to: { $ne: 'live' } } },
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $ifNull: ['$pipeline_priority', 0] }, 1] }, then: -10 },
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_WH] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1 } },
          { $project: { id: 1, title: 1, pages_count: 1 } },
          { $limit: PROMOTE_LIMIT },
        ])
        .toArray();

      if (promoteCandidates.length > 0) {
        console.log(`\n--- Phase 1.95: Warehouse promotion ---`);
        console.log(`  Candidates: ${promoteCandidates.length} (of ${await db.collection('books_warehouse').countDocuments({ 'pipeline_auto.status': 'archive_complete' })} total)`);
        let promoted = 0;
        for (const candidate of promoteCandidates) {
          try {
            const book = await db.collection('books_warehouse').findOne({ id: candidate.id });
            if (!book) continue;

            // Check if book already exists in live (can have different _id)
            const existingLive = await db.collection('books').findOne(
              { id: candidate.id },
              { projection: { _id: 1, slug: 1, collections: 1, visible: 1, hidden: 1 } }
            );
            if (existingLive) {
              // Update in place, preserving live _id and live slug.
              // The live slug may have been disambiguated on first promotion
              // (e.g. `foo-2`), while warehouse still holds the original `foo`.
              // Overwriting would re-trigger E11000 against the record that
              // owns `foo` in live.
              // Also preserve live-side curation: collections tags and the
              // visible/hidden pair are edited on the LIVE doc (merges,
              // enrich assignment, curators) — the warehouse copy is a stale
              // snapshot and must not roll them back.
              const { _id, ...bookWithoutId } = book;
              if (existingLive.slug) delete bookWithoutId.slug;
              if (existingLive.collections !== undefined) delete bookWithoutId.collections;
              if (existingLive.visible !== undefined) delete bookWithoutId.visible;
              if (existingLive.hidden !== undefined) delete bookWithoutId.hidden;
              bookWithoutId.updated_at = new Date();
              await db.collection('books').updateOne({ id: candidate.id }, { $set: bookWithoutId });
            } else {
              // Fresh insert — deduplicate slug to avoid E11000 on books_slug_idx
              if (book.slug) {
                const slugConflict = await db.collection('books').findOne(
                  { slug: book.slug, id: { $ne: book.id } },
                  { projection: { _id: 1 } }
                );
                if (slugConflict) {
                  let suffix = 2;
                  while (suffix < 100) {
                    const candidate = `${book.slug}-${suffix}`;
                    const exists = await db.collection('books').findOne({ slug: candidate }, { projection: { _id: 1 } });
                    if (!exists) { book.slug = candidate; break; }
                    suffix++;
                  }
                  console.log(`    Slug conflict resolved: ${book.slug}`);
                }
              }
              await db.collection('books').insertOne(book);
            }

            // Move pages — handle _id conflicts by stripping _id for upserts matched by book_id+page_number
            const pages = await db.collection('pages_warehouse').find({ book_id: candidate.id }).toArray();
            if (pages.length > 0) {
              const bulkOps = pages.map(page => {
                const { _id, ...pageWithoutId } = page;
                return {
                  updateOne: {
                    filter: { book_id: page.book_id, page_number: page.page_number },
                    update: { $set: pageWithoutId },
                    upsert: true,
                  },
                };
              });
              await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
            }

            // Mark warehouse copy as promoted but keep it (permanent backup)
            await db.collection('books_warehouse').updateOne(
              { id: candidate.id },
              { $set: { promoted_at: new Date(), promoted_to: 'live' } }
            );

            promoted++;
          } catch (err) {
            log.errors.push(`Promote ${candidate.id}: ${err.message}`);
            console.error(`  ERROR promoting ${candidate.title?.slice(0, 60)}: ${err.message}`);
          }
        }
        console.log(`  Promoted: ${promoted} books to live collection`);
      }
    }

    // ── Phase 1.97: Trailing-dupe dedup (archive_complete, before OCR) ──
    // IA's PDF→page extraction often repeats a back cover / title page hundreds
    // of times at the end of a book. These pages are byte-identical on R2 (same
    // ETag). Hide them BEFORE any per-page Gemini call so OCR/translation/image/
    // embedding budget is never spent on them. Reuses the same detection as the
    // standalone scripts/maintenance/dedup-ia-trailing-pages.mjs CLI.
    //
    // Independently pausable via paused_phases:[1.97]. When paused, Phase 2's
    // dedup_complete gate is relaxed (see below) so books flow straight to OCR.
    if (shouldRun(1.97)) {
      const DEDUP_LIMIT = SCOPED_MODE ? 100000 : 50;  // per tick — bounds runtime (~30+ R2 HEADs/book); drains backlog across ticks. Scoped mode raises the window so allowlisted books behind the backlog aren't stranded (work confined by the scope filter below).
      const DEDUP_MAX_ATTEMPTS = 3;  // transient-failure giveup; release the book so Phase 2 isn't blocked forever
      let candidates = await db.collection('books').find({
        'pipeline_auto.status': 'archive_complete',
        'pipeline_auto.dedup_complete': { $ne: true },
      }).project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.dedup_attempts': 1 })
        .limit(DEDUP_LIMIT).toArray();
      // Selective-unpause: confine dedup to the allowlist, like every other phase.
      // This phase previously had NO scope filter, so when globally paused with a
      // scope set, scoped books behind the backlog never got dedup_complete and
      // stalled at Phase 2's dedup gate (never reaching OCR).
      if (SCOPE_ACTIVE) candidates = await applyBookOverride(db, candidates, { id: 1, title: 1, pages_count: 1, 'pipeline_auto.dedup_attempts': 1 });

      if (candidates.length > 0) {
        console.log('\n--- Phase 1.97: Trailing-dupe dedup ---');
        let deduped = 0, pagesHidden = 0, flagged = 0;
        for (const book of candidates) {
          try {
            const result = await findTrailingDupes(db, book);
            if (result && !result.hit_book_start && result.dupes_to_hide.length > 0) {
              await applyHide(db, result.dupes_to_hide);
              await db.collection('books').updateOne({ id: book.id }, {
                $inc: { pages_count: -result.run_len },
                $set: { 'pipeline_auto.dedup_complete': true, updated_at: new Date() },
              });
              deduped++; pagesHidden += result.dupes_to_hide.length;
              console.log(`  ${(book.title || book.id).slice(0, 50)}: hid ${result.dupes_to_hide.length} trailing dupes`);
            } else {
              // null result (no dupes) OR hit_book_start (whole book may be one
              // repeated image — suspicious; mark done + flag, do NOT apply).
              await db.collection('books').updateOne({ id: book.id }, {
                $set: {
                  'pipeline_auto.dedup_complete': true,
                  updated_at: new Date(),
                  ...(result?.hit_book_start ? { 'pipeline_auto.dedup_needs_review': true } : {}),
                },
              });
              if (result?.hit_book_start) flagged++;
            }
          } catch (err) {
            // Transient (network / HEAD flake) — count the attempt. Leave
            // dedup_complete unset so it retries next tick, but after
            // DEDUP_MAX_ATTEMPTS release the book (mark complete + failed) so
            // Phase 2's gate doesn't strand it in archive_complete forever.
            const attempts = (book.pipeline_auto?.dedup_attempts || 0) + 1;
            if (attempts >= DEDUP_MAX_ATTEMPTS) {
              await db.collection('books').updateOne({ id: book.id }, {
                $set: { 'pipeline_auto.dedup_complete': true, 'pipeline_auto.dedup_failed': true, updated_at: new Date() },
                $inc: { 'pipeline_auto.dedup_attempts': 1 },
              });
            } else {
              await db.collection('books').updateOne({ id: book.id }, { $inc: { 'pipeline_auto.dedup_attempts': 1 } });
            }
            log.errors.push(`Dedup ${book.id}: ${err.message}`);
          }
        }
        log.dedup_books += deduped;
        log.dedup_pages_hidden += pagesHidden;
        log.dedup_flagged += flagged;
        console.log(`  Phase 1.97 dedup: ${deduped} books, ${pagesHidden} pages hidden, ${flagged} flagged`);
      }
    }

    // Shared Gemini active job count — queried once, reused by OCR (Phase 2) and image extraction (Phase 5)
    let geminiActiveJobs = null;

    // ── Phase 2: Submit OCR via Gemini Batch API (archive_complete -> ocr_submitted) ──
    // Two-pass strategy:
    //   Pass 1 ("preview"): First 25 pages of first-translation books — gives readers content fast
    //   Pass 2 ("full"): Remaining pages for books that already have preview OCR
    if (shouldRun(2) && await budgetAllowsDispatch(db, 'Phase 2 (OCR submit)', { bypass: !!BOOK_OVERRIDE })) {
      console.log('\n--- Phase 2: OCR submission ---');

      // Ordering gate: never OCR a book before Phase 1.97 has deduped it, else
      // trailing dupes flow through the whole pipeline. DEDUP_LIMIT (50) < this
      // pass's limit (~200), so without the gate the overflow would be OCR'd
      // un-deduped in the same tick and never revisited. When 1.97 is paused,
      // relax the gate so "pause dedup" means "let books flow straight to OCR".
      const requireDedup = !PAUSED_PHASES.has(1.97);
      const dedupGate = requireDedup ? { 'pipeline_auto.dedup_complete': true } : {};

      // Work-ID dedup: skip books if another copy of the same work is already complete
      async function filterDuplicateWorks(db, candidates) {
        const withWorkId = candidates.filter(b => b.work_id);
        if (withWorkId.length === 0) return candidates;

        const workIds = [...new Set(withWorkId.map(b => b.work_id))];
        const completedWorks = await db.collection('books').distinct('work_id', {
          work_id: { $in: workIds },
          'pipeline_auto.status': { $in: ['complete', 'translate_complete', 'chapters_complete', 'images_complete', 'enriched'] },
          hidden: { $ne: true },
        });
        const completedSet = new Set(completedWorks);

        if (completedSet.size > 0) {
          const before = candidates.length;
          candidates = candidates.filter(b => !b.work_id || !completedSet.has(b.work_id));
          const skipped = before - candidates.length;
          if (skipped > 0) console.log(`  Work-ID dedup: skipped ${skipped} books (completed copy exists)`);
        }
        return candidates;
      }

      // Check real Gemini-side active job count per key for load-aware routing
      const keyLoads = await getGeminiKeyLoads();
      geminiActiveJobs = keyLoads.total;
      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });
      console.log(`  Gemini per-key: [${keyLoads.perKey.join(', ')}] (cap ${MAX_ACTIVE_PER_KEY}/key) | Total: ${geminiActiveJobs} | DB: ${activeBatchOcr}`);

      // Gate: if no key has room, don't even query candidates
      const ocrLimit = getLeastLoadedKey() >= 0 ? OCR_SUBMIT_LIMIT : 0;
      if (ocrLimit === 0) {
        console.log(`  All keys at/above ${MAX_ACTIVE_PER_KEY} — skipping OCR submissions this cycle`);
      }

      const ENGLISH_VARIANTS_P2 = ['english', 'eng', 'en'];
      const PREVIEW_PAGES = 25;

      // --- Pass 1: Preview OCR (first 25 pages) for books that haven't had any OCR yet ---
      // Prioritize first-translation books. This spreads OCR across many books fast.
      if (ocrLimit > 0) {
        let previewCandidates = await db.collection('books')
          .aggregate([
            { $match: {
              'pipeline_auto.status': 'archive_complete',
              'pipeline_auto.split_checked': true,
              'pipeline_auto.recitation_blocked': { $ne: true },
              'pipeline_auto.recitation_retry': { $ne: true }, // Recitation books go to Pass 2 w/ fallback model
              pages_ocr: { $in: [0, null, undefined] }, // No OCR yet
              ...dedupGate, // Phase 1.97 must run first (relaxed when 1.97 paused)
            }},
            { $addFields: {
              _priority: {
                $switch: {
                  branches: [
                    { case: { $gte: [{ $ifNull: ['$pipeline_priority', 0] }, 1] }, then: -10 }, // Manual priority boost
                  { case: { $eq: ['$image_source.provider', 'bph'] }, then: -1 }, // BPH priority until backlog cleared
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                    { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P2] }, then: 2 },
                  ],
                  default: 1,
                },
              },
            }},
            // processing_priority (#3756): explicit queue weight, higher first
            // (absent sorts last under -1). Existing ordering kept as tiebreak.
            { $sort: { processing_priority: -1, _priority: 1, hidden: 1 } },
            { $project: { id: 1, title: 1, author: 1, year: 1, pages_count: 1, needs_splitting: 1, work_id: 1, 'pipeline_auto.retry_count': 1, 'pipeline_auto.split_checked': 1 } },
            { $limit: ocrLimit },
          ])
          .toArray();
        if (SCOPE_ACTIVE) previewCandidates = await applyBookOverride(db, previewCandidates, { id: 1, title: 1, author: 1, year: 1, pages_count: 1, needs_splitting: 1, pipeline_auto: 1 });

        const dedupedPreview = await filterDuplicateWorks(db, previewCandidates);

        if (dedupedPreview.length > 0) {
          console.log(`  Preview pass: ${dedupedPreview.length} books (first ${PREVIEW_PAGES} pages each)`);
        }

        // Split into small books (cross-book pool) vs large/spread books (per-book)
        const smallBooks = dedupedPreview.filter(b => !b.needs_splitting && (b.pages_count || 0) < CROSS_BOOK_OCR_THRESHOLD);
        const largeOrSpreadBooks = dedupedPreview.filter(b => b.needs_splitting || (b.pages_count || 0) >= CROSS_BOOK_OCR_THRESHOLD);

        // Cross-book pooling for small books — one batch instead of many
        if (smallBooks.length > 0 && !DRY_RUN && await canSubmitMore()) {
          try {
            console.log(`  Cross-book pool: ${smallBooks.length} small books (<${CROSS_BOOK_OCR_THRESHOLD} pages)`);
            const crossResult = await submitCrossBookOcrBatches(db, smallBooks);
            if (crossResult.submitted > 0) {
              log.ocr_submitted += crossResult.bookIds.length;
            }
          } catch (err) {
            const msg = err.message || String(err);
            if (msg === 'ALL_KEYS_QUOTA_EXHAUSTED') {
              console.log(`  All keys quota exhausted during cross-book OCR`);
            } else {
              console.error(`  Cross-book OCR error: ${msg.substring(0, 120)}`);
              // Fall back to per-book submission for these books
              largeOrSpreadBooks.push(...smallBooks);
            }
          }
        } else if (DRY_RUN && smallBooks.length > 0) {
          console.log(`  Would cross-book pool: ${smallBooks.length} small books`);
        }

        // Per-book submission for large books and spread books
        for (const book of largeOrSpreadBooks) {
          if (!await canSubmitMore()) {
            console.log(`  All keys saturated (${_geminiKeyLoads.join('/')}) — stopping OCR submissions`);
            break;
          }
          try {
            const label = (book.title || '').substring(0, 50);
            if (DRY_RUN) { console.log(`  Would preview OCR: ${label}`); continue; }
            console.log(`  Preview OCR: ${label}...`);
            const result = await submitOcrDirectly(db, book, { maxPages: PREVIEW_PAGES });

            if (result.alreadyDone) {
              await setPipelineStatus(db, book.id, 'ocr_complete');
              log.ocr_advanced++;
              console.log(`  Already OCR'd: ${label}`);
            } else if (result.skippedDuplicate) {
              console.log(`  Skipped (active batch exists): ${label}`);
            } else if (result.submitted > 0) {
              // Don't advance to ocr_submitted yet — still has remaining pages
              // Mark that preview batch was sent so full pass picks it up later
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.preview_batch_at': new Date() } }
              );
              log.ocr_submitted++;
              console.log(`  Preview submitted: ${label} — ${result.submitted}/${book.pages_count || '?'} pages`);
            } else {
              console.log(`  OCR submitted: ${label} — 0 pages`);
            }
            await sleep(API_DELAY_MS);
          } catch (err) {
            const msg = err.message || String(err);
            console.log(`  Preview OCR error: ${(book.title || '').substring(0, 40)} — ${msg.substring(0, 80)}`);
          }
        }
      }

      // --- Pass 2: Full OCR for books that already have some OCR (preview done, or partial),
      //            AND for books that hit RECITATION on a previous attempt (retried with fallback model) ---
      let readyForOcr = ocrLimit > 0 ? await db.collection('books')
        .aggregate([
          { $match: {
            'pipeline_auto.status': 'archive_complete',
            'pipeline_auto.split_checked': true,
            'pipeline_auto.recitation_blocked': { $ne: true },
            ...dedupGate, // Phase 1.97 must run first (relaxed when 1.97 paused)
            $or: [
              { pages_ocr: { $gt: 0 } }, // Already has some OCR (preview pass done)
              { 'pipeline_auto.recitation_retry': true }, // All pages were RECITATION-blocked — retry with fallback model regardless of pages_ocr
              { 'pipeline_auto.recitation_retry_lite': true }, // tier 1 also RECITATION-blocked — retry with gemini-3-flash-preview regardless of pages_ocr
            ],
          }},
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $ifNull: ['$pipeline_priority', 0] }, 1] }, then: -10 }, // Manual priority boost
                  { case: { $eq: ['$image_source.provider', 'bph'] }, then: -1 }, // BPH priority until backlog cleared
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P2] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          // processing_priority (#3756): explicit queue weight, higher first.
          { $sort: { processing_priority: -1, _priority: 1, hidden: 1 } },
          { $project: { id: 1, title: 1, author: 1, year: 1, pages_count: 1, needs_splitting: 1, work_id: 1, 'pipeline_auto.retry_count': 1, 'pipeline_auto.recitation_retry': 1, 'pipeline_auto.recitation_retry_lite': 1, 'pipeline_auto.split_checked': 1 } },
          { $limit: ocrLimit },
        ])
        .toArray() : [];
      if (SCOPE_ACTIVE) readyForOcr = await applyBookOverride(db, readyForOcr, { id: 1, title: 1, author: 1, year: 1, pages_count: 1, needs_splitting: 1, pipeline_auto: 1 });

      const dedupedFull = await filterDuplicateWorks(db, readyForOcr);

      if (dedupedFull.length > 0) {
        console.log(`  Full pass: ${dedupedFull.length} books (all remaining pages)`);
      }

      for (const book of dedupedFull) {
        if (!await canSubmitMore()) {
          console.log(`  All keys saturated (${_geminiKeyLoads.join('/')}) — stopping OCR submissions`);
          break;
        }
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          const label = (book.title || '').substring(0, 50);

          if (DRY_RUN) {
            console.log(`  Would submit OCR: ${label} (${book.pages_count} pages)`);
            continue;
          }

          // Direct OCR submission — downloads images on Hetzner, submits to Gemini Batch API.
          //
          // RECITATION escalation ladder (models below v3 are never used — see CLAUDE.md):
          //   tier 1  recitation_retry       -> gemini-3.1-flash-lite
          //   tier 2  recitation_retry_lite  -> gemini-3-flash-preview
          //   tier 3  still blocked          -> MinerU + grounded correction
          //                                     (mineru-ocr-worker.mjs, then
          //                                      ocr-correct-grounded.mjs — #3389)
          // The flag NAMES are historical; what matters is the order. Tier 3 is not
          // a Gemini model: once both Gemini tiers refuse, no prompt or model change
          // gets the text out, so the page has to be read by an engine without a
          // recitation filter and then corrected against its own image.
          const isLiteRetry = book.pipeline_auto?.recitation_retry_lite === true;
          const isRecitationRetry = book.pipeline_auto?.recitation_retry === true;
          const ocrOpts = isLiteRetry
            ? { modelOverride: OCR_MODEL_FLASH }
            : isRecitationRetry
              ? { modelOverride: OCR_MODEL_LITE }
              : {};
          if (isLiteRetry) console.log(`  RECITATION retry (tier 2) with ${OCR_MODEL_FLASH}: ${label}`);
          else if (isRecitationRetry) console.log(`  RECITATION retry (tier 1) with ${OCR_MODEL_LITE}: ${label}`);
          else console.log(`  Submitting OCR: ${label}...`);
          const result = await submitOcrDirectly(db, book, ocrOpts);

          if (result.alreadyDone) {
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
            console.log(`  Already OCR'd: ${label}`);
          } else if (result.skippedDuplicate) {
            // Don't change state — active batch jobs exist, wait for them
            console.log(`  Skipped (active batch exists): ${label}`);
          } else {
            const statusExtra = { ocr_job_name: result.jobName, retry_count: 0 };
            await setPipelineStatus(db, book.id, 'ocr_submitted', statusExtra);
            // Clear whichever recitation retry flag was set after successful resubmission.
            // (If this attempt also hits RECITATION, batch-collector re-flags the next tier.)
            if (isLiteRetry) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $unset: { 'pipeline_auto.recitation_retry_lite': '' } }
              );
            } else if (isRecitationRetry) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $unset: { 'pipeline_auto.recitation_retry': '' } }
              );
            }
            log.ocr_submitted++;
            console.log(`  OCR submitted: ${label} — ${result.submitted} pages in ${result.childCount} batches`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          const msg = err.message || String(err);
          if (msg.includes('ALL_KEYS_QUOTA_EXHAUSTED')) {
            console.log(`  All Gemini keys quota exhausted — stopping OCR submissions (${GEMINI_BATCH_KEYS.length} unique keys tried, check File API + batch creation limits separately)`);
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
          console.log(`  ERROR OCR submit ${book.id}: ${msg}`);
          log.errors.push(`OCR submit ${book.id}: ${msg}`);
        }
      }
      console.log(`  OCR submitted: ${log.ocr_submitted}, advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    if (shouldRun(3)) {
      console.log('\n--- Phase 3: OCR completion check ---');

      let ocrPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_job_id': 1, 'pipeline_auto.ocr_loop_count': 1 })
        .toArray();
      if (SCOPE_ACTIVE) ocrPending = await applyBookOverride(db, ocrPending, { id: 1, title: 1, pipeline_auto: 1 });

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
            status: { $in: ['completed', 'saved', 'completed_with_errors', 'failed'] },
          });
          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'ocr',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors', 'failed'] },
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
            // Check if there are uncollected batch_jobs — collector may not have saved results yet
            const uncollectedBatch = await db.collection('batch_jobs').countDocuments({
              book_id: book.id,
              type: 'ocr',
              status: { $in: ['pending', 'processing', 'completed'] }, // NOT 'saved' — results not yet written to pages
            });

            if (uncollectedBatch > 0) {
              // Results exist in Gemini but haven't been saved to pages yet — wait for collector
              console.log(`  Waiting for collector: ${book.title} — ${uncollectedBatch} uncollected batch jobs, ${remainingOcr} pages remaining`);
              // Don't change state, don't increment loop count — just wait
            } else {
              // All batch_jobs have been collected ('saved'), so remaining pages genuinely failed
              const loopCount = (book.pipeline_auto?.ocr_loop_count || 0) + 1;
              const totalPages = await db.collection('pages').countDocuments({ book_id: book.id });
              const failRate = totalPages > 0 ? remainingOcr / totalPages : 1;

              if (loopCount > MAX_RETRIES || (remainingOcr <= 20 && failRate < 0.05)) {
                // Accept small gaps (<5% or ≤20 pages) — retrying burns batch quota for pages
                // that likely fail for structural reasons (RECITATION, bad scan, blank)
                if (!DRY_RUN) {
                  if (loopCount > MAX_RETRIES) {
                    await setPipelineStatus(db, book.id, 'needs_attention', {
                      error: `OCR looped ${loopCount} times with ${remainingOcr} pages still un-OCR'd`,
                      ocr_loop_count: loopCount,
                    });
                    log.needs_attention++;
                    log.errors.push(`OCR circuit breaker ${book.id}: looped ${loopCount}x, ${remainingOcr} pages remaining`);
                  } else {
                    await setPipelineStatus(db, book.id, 'ocr_complete', { ocr_loop_count: loopCount });
                    console.log(`  OCR accepting ${remainingOcr} gaps (${(failRate*100).toFixed(1)}%): ${book.title}`);
                  }
                }
              } else {
                if (!DRY_RUN) {
                  await setPipelineStatus(db, book.id, 'archive_complete', { ocr_loop_count: loopCount });
                }
                console.log(`  OCR loop ${loopCount} for ${book.title}: ${remainingOcr} pages remaining (all batches collected)`);
              }
            }
            log.ocr_advanced++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'ocr_complete');

              // Early cover selection — pick a good cover now that OCR page_type is available.
              // This runs again in Phase 8.9 after image extraction, but gives books a decent
              // cover immediately instead of waiting for the full pipeline to complete.
              if (book.thumbnail_source !== 'manual') {
                try {
                  const coverResult = await selectBestCoverPage(db, book.id, 20, book.title);
                  if (coverResult) {
                    await db.collection('books').updateOne(
                      { id: book.id },
                      { $set: {
                        thumbnail: coverResult.url,
                        thumbnail_source: 'smart_ocr',
                        cover_page: coverResult.page.page_number,
                        cover_selected_at: new Date(),
                      }}
                    );
                    console.log(`    Cover: page ${coverResult.page.page_number} (${coverResult.reason})`);
                  }
                } catch (e) {
                  // Non-fatal — cover will be selected in Phase 8.9
                }
              }
            }
            log.ocr_advanced++;
            console.log(`  OCR complete: ${book.title}`);
          }
        }
      }
      console.log(`  OCR advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3.1: Post-OCR spread split (ocr_complete + needs_splitting -> split) ──
    // For books flagged needs_splitting in Phase 1.25, the spread-aware OCR (Phase 2)
    // stored <split-position> and <page-break/> in the OCR text. Now we crop images
    // at the detected gutter position and create separate left/right page records.
    // Delegates to split-book.mjs (battle-tested, handles R2 uploads, page replacement).
    if (shouldRun(3.1) || shouldRun(3)) {
      console.log('\n--- Phase 3.1: Post-OCR spread split ---');

      const SPLIT_BATCH_LIMIT = SCOPED_MODE ? 100000 : 10; // Books per cycle (each book is heavy: downloads + crops + uploads; scoped mode raises the window, work confined by applyBookOverride below)

      let readyForSplit = await db.collection('books')
        .find({
          'pipeline_auto.status': 'ocr_complete',
          needs_splitting: true,
          split_completed: { $ne: true },
        })
        .sort({ pages_count: 1 }) // smallest first — fast wins
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.split_retry_count': 1 })
        .limit(SPLIT_BATCH_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForSplit = await applyBookOverride(db, readyForSplit, { id: 1, title: 1, pages_count: 1, pipeline_auto: 1 });

      console.log(`  Books ready for split: ${readyForSplit.length}`);

      let splitDone = 0;
      let splitErrors = 0;

      for (const book of readyForSplit) {
        const label = (book.title || '').substring(0, 50);

        if (DRY_RUN) {
          console.log(`  Would split: ${label} (${book.pages_count} pages)`);
          continue;
        }

        try {
          console.log(`  Splitting: ${label} (${book.pages_count} pages)...`);
          const scriptPath = new URL('../split-book.mjs', import.meta.url).pathname;
          const { stdout, stderr } = await execFileAsync('node', [scriptPath, book.id], {
            timeout: 300000, // 5 min per book
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
          });
          if (stderr) console.log(`    stderr: ${stderr.slice(0, 200)}`);
          // split-book.mjs sets split_completed=true and needs_splitting=false on success
          console.log(`    Done: ${label}`);
          splitDone++;

          // NOTE: BPH spread dedup was here but removed — structural detection (crop position)
          // has false positives on non-overlapping books. Needs content-verified approach.
          // See: lesson-bph-spread-dedup.md
        } catch (err) {
          const msg = err.stderr || err.message || String(err);
          console.log(`    FAIL: ${label} — ${msg.slice(0, 150)}`);
          splitErrors++;
          // Don't block the pipeline — mark for attention if it fails repeatedly
          const retryCount = (book.pipeline_auto?.split_retry_count || 0) + 1;
          if (retryCount >= 3) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Split failed ${retryCount} times: ${msg.slice(0, 200)}`,
              split_retry_count: retryCount,
            });
          } else {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.split_retry_count': retryCount, 'pipeline_auto.last_updated': new Date() } }
            );
          }
        }
      }

      if (readyForSplit.length > 0) {
        console.log(`  Split: ${splitDone} done, ${splitErrors} errors`);
      }
    }

    // ── Phase 3.5: OCR quality gate (ocr_complete → low-OCR books sent back) ──
    // AI metadata classification now runs at Phase 1.6 (before full OCR).
    // This phase only checks OCR coverage and rejects books with <10%.
    if (shouldRun(3.5) || shouldRun(3)) {
      console.log('\n--- Phase 3.5: OCR quality gate ---');

      let readyBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1 })
        .limit(METADATA_ENRICH_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyBooks = await applyBookOverride(db, readyBooks, { id: 1, title: 1, pages_count: 1, pages_ocr: 1 });

      let gateRejected = 0;
      for (const book of readyBooks) {
        const ocrPct = book.pages_count > 0 ? (book.pages_ocr || 0) / book.pages_count : 0;
        if (ocrPct < 0.1 && book.pages_count > 50) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });
          }
          console.log(`  Low OCR gate: ${book.title?.slice(0, 50)} — ${book.pages_ocr}/${book.pages_count} (${(ocrPct * 100).toFixed(0)}%), sent back`);
          gateRejected++;
        }
      }
      console.log(`  OCR gate: ${readyBooks.length} checked, ${gateRejected} rejected`);
    }

    // ── Phase 3.7: Transliteration for non-Latin books (inline, runs on ocr_complete books) ──
    // Not a pipeline state — just enriches pages before translation. Cheap & fast (text-only, lite model).
    if (shouldRun(3.7) || shouldRun(3.5) || shouldRun(3)) {
      console.log('\n--- Phase 3.7: Transliteration (non-Latin books) ---');

      // Find ocr_complete books with non-Latin languages
      let nonLatinBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': 'ocr_complete',
          language: { $regex: new RegExp(`^(${[...NON_LATIN_LANGUAGES].join('|')})$`, 'i') },
        })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, language: 1 })
        .limit(TRANSLITERATE_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) nonLatinBooks = await applyBookOverride(db, nonLatinBooks, { id: 1, title: 1, language: 1 });

      console.log(`  Non-Latin books ready for transliteration: ${nonLatinBooks.length}`);

      for (const book of nonLatinBooks) {
        try {
          const sourceScript = languageToScript(book.language);
          const pages = await db.collection('pages')
            .find({
              book_id: book.id,
              'ocr.data': { $exists: true, $nin: [null, ''] },
              page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
              $or: [
                { 'transliteration.data': { $exists: false } },
                { 'transliteration.data': null },
                { 'transliteration.data': '' },
              ],
            })
            .sort({ page_number: 1 })
            .project({ id: 1, book_id: 1, ocr: 1, transliteration: 1 })
            .toArray();

          if (pages.length === 0) {
            console.log(`  Already transliterated: ${book.title}`);
            continue;
          }

          const label = (book.title || '').substring(0, 50);
          if (DRY_RUN) {
            console.log(`  Would transliterate: ${label} (${book.language}) — ${pages.length} pages`);
            continue;
          }

          console.log(`  Transliterating: ${label} (${book.language}) — ${pages.length} pages...`);
          let pagesDone = 0;
          let pagesErr = 0;

          for (let i = 0; i < pages.length; i += TRANSLITERATE_CONCURRENCY) {
            const chunk = pages.slice(i, i + TRANSLITERATE_CONCURRENCY);
            const results = await Promise.allSettled(
              chunk.map(page => transliteratePage(db, page, sourceScript))
            );

            for (const r of results) {
              if (r.status === 'fulfilled' && r.value) {
                pagesDone++;
              } else if (r.status === 'rejected') {
                pagesErr++;
                const msg = r.reason?.message || '';
                if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                  console.log('    Rate limited — waiting 30s...');
                  await sleep(30000);
                }
              }
            }
          }

          log.transliterated++;
          log.transliterate_pages += pagesDone;
          console.log(`  Done: ${label} — ${pagesDone} ok, ${pagesErr} errors`);
        } catch (err) {
          log.errors.push(`Transliterate ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Transliterated: ${log.transliterated} books, ${log.transliterate_pages} pages`);
    }

    // ── Phase 4: Dispatch translation to Lambda via SQS FIFO ──
    // Hetzner focuses on OCR; Lambdas scale out translation.
    // Creates a job record, enqueues pages to SQS FIFO, Lambdas process sequentially per book.
    if (shouldRun(4) && await budgetAllowsDispatch(db, 'Phase 4 (translation dispatch)', { bypass: !!BOOK_OVERRIDE })) {
      console.log('\n--- Phase 4: Dispatch translation to Lambda (SQS FIFO) ---');

      // Zombie job reaper: cancel ANY job stuck in processing with no update for >1h.
      // Workers crash, get OOM-killed, or stall — their jobs rot forever, blocking the in-flight cap.
      if (!DRY_RUN) {
        const zombieThreshold = new Date(Date.now() - 1 * 60 * 60 * 1000);
        const zombieJobs = await db.collection('jobs').find({
          status: 'processing',
          $or: [
            { updated_at: { $lt: zombieThreshold } },
            { updated_at: { $exists: false }, created_at: { $lt: zombieThreshold } },
          ],
        }).project({ _id: 1, book_id: 1, book_title: 1, type: 1 }).toArray();

        if (zombieJobs.length > 0) {
          const zombieBookIds = zombieJobs.map(j => j.book_id);
          await db.collection('jobs').updateMany(
            { _id: { $in: zombieJobs.map(j => j._id) } },
            { $set: { status: 'failed', error: 'Auto-cancelled: stuck >1h with no update', updated_at: new Date() } },
          );
          // Reset affected books so they can be re-dispatched
          const rollbackMap = {
            'translate_submitted': 'ocr_complete',
            'images_submitted': 'chapters_complete',
          };
          for (const [from, to] of Object.entries(rollbackMap)) {
            await db.collection('books').updateMany(
              { id: { $in: zombieBookIds }, 'pipeline_auto.status': from },
              { $set: { 'pipeline_auto.status': to, updated_at: new Date() }, $unset: { job: '' } },
            );
          }
          // Clear job locks on any zombie books
          await db.collection('books').updateMany(
            { id: { $in: zombieBookIds }, job: { $exists: true } },
            { $unset: { job: '' }, $set: { updated_at: new Date() } },
          );
          log.zombie_jobs_cancelled += zombieJobs.length;
          const byType = {};
          zombieJobs.forEach(j => { byType[j.type] = (byType[j.type] || 0) + 1; });
          console.log(`  Zombie reaper: cancelled ${zombieJobs.length} stuck jobs (${Object.entries(byType).map(([t,c]) => `${t}:${c}`).join(', ')})`);
        }
      }

      // Orphan detector: books in *_submitted state with no active job and no book.job reference.
      // These get stranded when jobs are cancelled without rolling back pipeline status.
      if (!DRY_RUN) {
        const orphanStates = [
          { from: 'translate_submitted', to: 'ocr_complete' },
          { from: 'ocr_submitted', to: 'archive_complete' },
          { from: 'images_submitted', to: 'chapters_complete' },
        ];
        for (const { from, to } of orphanStates) {
          const orphans = await db.collection('books').find({
            'pipeline_auto.status': from,
            $or: [{ job: { $exists: false } }, { job: null }],
          }).project({ id: 1 }).toArray();
          if (orphans.length > 0) {
            // Verify no active jobs exist for these books
            const orphanIds = orphans.map(b => b.id);
            const activeJobCount = await db.collection('jobs').countDocuments({
              book_id: { $in: orphanIds },
              status: { $in: ['pending', 'processing'] },
            });
            if (activeJobCount === 0) {
              await db.collection('books').updateMany(
                { id: { $in: orphanIds }, 'pipeline_auto.status': from },
                { $set: { 'pipeline_auto.status': to, updated_at: new Date() } },
              );
              console.log(`  Orphan detector: rolled back ${orphans.length} books from ${from} to ${to}`);
            }
          }
        }
      }

      // Phase 4 creates translation jobs. The Hetzner translate-worker.mjs picks them up.
      // SQS/Lambda path is deprecated — translate-worker runs on Hetzner cron and calls Gemini directly.
      {
        const inFlight = await db.collection('books').countDocuments({
          'pipeline_auto.status': 'translate_submitted',
        });
        const headroom = MAX_INFLIGHT_TRANSLATIONS - inFlight;
        const effectiveLimit = Math.max(0, Math.min(TRANSLATE_SUBMIT_LIMIT, headroom));
        console.log(`  In-flight translations: ${inFlight}/${MAX_INFLIGHT_TRANSLATIONS} — dispatching up to ${effectiveLimit}`);

        if (effectiveLimit === 0) {
          console.log('  SKIP: at in-flight cap, waiting for existing translations to complete');
        }

        // Fresh books first (never translated), then re-queue partially-translated books
        let freshBooks = effectiveLimit > 0 ? await db.collection('books').aggregate([
          // Spread guard (#2449): unsplit spread books must wait for Phase 3.1 —
          // translating them produces two-page texts the split then discards.
          { $match: {
            'pipeline_auto.status': { $in: ['ocr_complete'] },
            $or: [{ needs_splitting: { $ne: true } }, { split_completed: true }],
          } },
          { $addFields: { _speedTier: { $switch: {
            branches: [
              { case: { $in: ['$language', ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Spanish', 'Portuguese', 'English', 'Czech', 'Polish', 'Swedish', 'Danish']] }, then: 0 },
              { case: { $in: ['$language', ['Chinese', 'Japanese', 'Korean', 'Tibetan', 'Sanskrit', 'Tamil', 'Thai']] }, then: 2 },
            ],
            default: 1,
          }}}},
          { $addFields: { _bigBook: { $cond: [{ $gte: ['$pages_count', 200] }, 0, 1] } } },
          { $addFields: { _isBph: { $cond: [{ $eq: ['$image_source.provider', 'bph'] }, 0, 1] } } },
          // processing_priority (#3756/#3750) leads: explicit queue weight, higher
          // first (reader requests board at 100). Then BPH until backlog cleared,
          // then first translations, then speed tier. Descending sort puts books
          // without the field last.
          { $sort: { processing_priority: -1, _isBph: 1, is_first_translation: -1, _speedTier: 1, _bigBook: 1, hidden: 1 } },
          { $project: { id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1, 'image_source.provider': 1 } },
          { $limit: effectiveLimit }
        ]).toArray() : [];
        if (SCOPE_ACTIVE) freshBooks = await applyBookOverride(db, freshBooks, { id: 1, title: 1, pages_count: 1, language: 1, pipeline_auto: 1, image_source: 1 });

        // If no fresh books, re-queue partially-translated books (gap-fill)
        // Includes books at ANY pipeline stage with incomplete translation — not just translate_partial.
        // Books at chapters_complete/complete often have untranslated pages from batch failures or splits.
        let partialBooks = [];
        if (freshBooks.length === 0 && effectiveLimit > 0) {
          partialBooks = await db.collection('books').aggregate([
            { $match: {
              'pipeline_auto.status': { $in: ['translate_partial', 'translate_complete', 'chapters_complete', 'complete'] },
              pages_ocr: { $gt: 0 },
              // Spread guard (#2449)
              $or: [{ needs_splitting: { $ne: true } }, { split_completed: true }],
            }},
            { $addFields: { _denominator: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] } } },
            { $match: { _denominator: { $gt: 0 }, $expr: { $lt: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, '$_denominator'] }, 0.9] } } },
            // processing_priority + pages_translated must survive the projection
            // for the sort below to see them (#3756).
            { $project: { id: 1, title: 1, pages_count: 1, pages_translated: 1, processing_priority: 1, language: 1, 'pipeline_auto.retry_count': 1, 'image_source.provider': 1 } },
            { $addFields: { _isBph: { $cond: [{ $eq: ['$image_source.provider', 'bph'] }, 0, 1] } } },
            // Reader requests first (#3750) — see the fresh-books sort above.
            { $sort: { processing_priority: -1, _isBph: 1, pages_translated: -1 } },
            { $limit: effectiveLimit },
          ]).toArray();
          if (SCOPE_ACTIVE) partialBooks = await applyBookOverride(db, partialBooks, { id: 1, title: 1, pages_count: 1, language: 1, pipeline_auto: 1 });
          if (partialBooks.length > 0) {
            console.log(`  No fresh books — gap-filling ${partialBooks.length} under-translated books`);
          }
        }

        const readyForTranslate = [...freshBooks, ...partialBooks];

        console.log(`  Books ready for translation: ${readyForTranslate.length}`);

        for (const book of readyForTranslate) {
          try {
            const pages = await db.collection('pages')
              .find({
                book_id: book.id,
                page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
                'ocr.data': { $exists: true, $nin: [null, ''] },
                page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
                $or: [
                  { 'translation.data': { $exists: false } },
                  { 'translation.data': null },
                  { 'translation.data': '' },
                  { $expr: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } },
                ],
              })
              .sort({ page_number: 1 })
              .project({ id: 1 })
              .toArray();

            if (pages.length === 0) {
              // Guard: don't mark translate_complete if OCR isn't done yet
              // (preview OCR does 25 pages, translate-worker translates them, but full OCR hasn't run)
              const totalOcr = book.pages_ocr || 0;
              const totalPages = book.pages_count || 0;
              if (totalOcr < totalPages * 0.8 && totalPages > 30) {
                // OCR is incomplete — send back to archive_complete for full OCR
                if (!DRY_RUN) await setPipelineStatus(db, book.id, 'archive_complete');
                console.log(`  OCR incomplete (${totalOcr}/${totalPages}), recycling for full OCR: ${book.title}`);
                continue;
              }
              if (!DRY_RUN) await setPipelineStatus(db, book.id, 'translate_complete');
              log.translate_advanced++;
              console.log(`  No pages need translation: ${book.title}`);
              continue;
            }

            const label = (book.title || '').substring(0, 50);
            const pageIds = pages.map(p => p.id);
            const jobId = nanoid(12);

            if (DRY_RUN) {
              console.log(`  Would dispatch: ${label} — ${pageIds.length} pages`);
              continue;
            }

            // Create job record — translate-worker.mjs picks this up
            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'translation',
              book_id: book.id,
              book_title: book.title,
              status: 'pending',
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: {
                page_ids: pageIds,
                model: getTranslateModelForBook(book),
                language: book.language || 'auto-detect',
              },
              initiated_by: 'pipeline_orchestrator',
              created_at: new Date(),
              updated_at: new Date(),
            });

            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'hetzner-inline', job_id: jobId } } },
            );

            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_id: jobId,
              retry_count: 0,
            });
            log.translate_submitted++;
            console.log(`  Dispatched: ${label} — ${pageIds.length} pages (job ${jobId})`);
          } catch (err) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate dispatch: ${err.message}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'ocr_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate ${book.id}: ${err.message}`);
          }
        }
        console.log(`  Translate dispatched: ${log.translate_submitted}, advanced: ${log.translate_advanced}`);
      }
    }

    // ── Phase 5: Translation completion check (translate_submitted -> translate_complete) ──
    // Checks Lambda job progress — advances completed books, recycles partial failures.
    if (shouldRun(5)) {
      console.log('\n--- Phase 5: Legacy translation completion check ---');

      let translatePending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.translate_job_id': 1, 'pipeline_auto.translate_job_name': 1 })
        .toArray();
      if (SCOPE_ACTIVE) translatePending = await applyBookOverride(db, translatePending, { id: 1, title: 1, pipeline_auto: 1 });

      console.log(`  Books in translate_submitted (legacy): ${translatePending.length}`);

      for (const book of translatePending) {
        // Check if translation is actually done by looking at pages
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $nin: [null, ''] },
          page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
          $or: [
            { 'translation.data': { $exists: false } },
            { 'translation.data': null },
            { 'translation.data': '' },
          ],
        });

        if (remaining === 0) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'translate_complete');
          log.translate_advanced++;
          console.log(`  Translation complete: ${book.title}`);
        } else {
          // Check Lambda job completion
          const jobId = book.pipeline_auto?.translate_job_id;
          if (jobId) {
            const job = await db.collection('jobs').findOne({
              id: jobId,
              status: { $in: ['completed', 'completed_with_errors', 'failed'] },
            });
            if (job) {
              // Lambda job finished but pages remain — send back to Phase 4 for direct translation
              if (!DRY_RUN) await setPipelineStatus(db, book.id, 'ocr_complete');
              log.translate_advanced++;
              console.log(`  Recycling to Phase 4: ${book.title} (${remaining} pages remain after Lambda job)`);
            }
          } else {
            // No job ID — orphaned state, recycle
            if (!DRY_RUN) await setPipelineStatus(db, book.id, 'ocr_complete');
            log.translate_advanced++;
            console.log(`  Recycling orphan: ${book.title} (${remaining} pages remain, no job ID)`);
          }
        }
      }
      console.log(`  Translation advanced: ${log.translate_advanced}`);
    }

    // ── Phase 6: Summary + Index (translate_complete -> summary_indexed) ──
    // When ENRICHMENT_INLINE=true, the enrich-worker.mjs cron handles this.
    // Otherwise falls back to the Vercel API route.
    if (shouldRun(6) && process.env.ENRICHMENT_INLINE === 'true') {
      console.log('\n--- Phase 6: Summary + Index (INLINE — handled by enrich-worker.mjs) ---');
      const readyCount = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'translate_complete' });
      console.log(`  Books in translate_complete: ${readyCount} (enrich-worker processes these)`);
    } else if (shouldRun(6)) {
      console.log('\n--- Phase 6: Summary + Index ---');

      let readyForEnrich = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ENRICH_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForEnrich = await applyBookOverride(db, readyForEnrich, { id: 1, title: 1, pipeline_auto: 1 });

      console.log(`  Books ready for summary + index: ${readyForEnrich.length}`);

      for (const book of readyForEnrich) {
        try {
          if (DRY_RUN) {
            console.log(`  Would enrich: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'summarizing');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
            method: 'GET',
            headers: headers(),
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Summary+Index: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Summary+Index ${book.id}: HTTP ${res.status}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: 0 });
          log.enriched++;
          console.log(`  Summary + Index: ${book.title}`);

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: 0 });
            log.enriched++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`Summary+Index ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Summary + Index: ${log.enriched}`);
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    // When ENRICHMENT_INLINE=true, the enrich-worker.mjs cron handles this.
    if (shouldRun(7) && process.env.ENRICHMENT_INLINE === 'true') {
      console.log('\n--- Phase 7: Chapter Extraction (INLINE — handled by enrich-worker.mjs) ---');
      const readyCount = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'summary_indexed' });
      console.log(`  Books in summary_indexed: ${readyCount} (enrich-worker processes these)`);
    } else if (shouldRun(7)) {
      console.log('\n--- Phase 7: Chapter extraction ---');

      let readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'summary_indexed' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(CHAPTER_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyForChapters = await applyBookOverride(db, readyForChapters, { id: 1, title: 1, pages_count: 1, pipeline_auto: 1 });

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
              await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: retries + 1 });
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
              await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: retries + 1 });
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

      const USE_BATCH = process.env.IMAGE_EXTRACTION_USE_BATCH !== 'false'; // Default: true (batch)
      console.log(`  Mode: ${USE_BATCH ? 'BATCH API' : 'Lambda/SQS'}`);

      if (USE_BATCH) {
        // ── Batch API path: submit via Gemini Batch API (same as OCR) ──
        // Image extraction has its own budget — don't block on OCR's Gemini total.
        // The Gemini API returns 429 on actual quota exhaustion, handled by key rotation.
        const activeBatchImageJobs = await db.collection('batch_jobs').countDocuments({
          type: 'image_extraction',
          status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
        });
        console.log(`  Active batch image jobs: ${activeBatchImageJobs}/${MAX_ACTIVE_IMAGE_JOBS}`);

        if (activeBatchImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
          const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];

          let readyForImages = await db.collection('books')
            .find({ 'pipeline_auto.status': 'chapters_complete' })
            .sort({ processing_priority: -1, hidden: 1 })
            .project({ id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1 })
            .limit(IMAGE_SUBMIT_LIMIT)
            .toArray();
          if (SCOPE_ACTIVE) readyForImages = await applyBookOverride(db, readyForImages, { id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1 });

          // Catch-up: books processed outside pipeline with OCR but no image extraction
          const remainingSlots = IMAGE_SUBMIT_LIMIT - readyForImages.length;
          if (remainingSlots > 0) {
            const catchUp = await db.collection('books')
              .find({
                'pipeline_auto.status': { $exists: false },
                pages_ocr: { $gt: 0 },
                $or: [
                  { detected_images_count: { $exists: false } },
                  { detected_images_count: 0 },
                ],
                'job.type': { $ne: 'image_extraction' },
              })
              .sort({ visible: -1, pages_count: -1 })
              .project({ id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1 })
              .limit(remainingSlots)
              .toArray();
            if (catchUp.length > 0) {
              readyForImages.push(...catchUp);
              console.log(`  Catch-up: ${catchUp.length} pre-pipeline books queued for image extraction`);
            }
          }

          console.log(`  Books ready for image extraction: ${readyForImages.length}`);

          // Gather candidate pages from all books, then pool into cross-book batches
          const bookItems = []; // { book, candidatePages } for cross-book batching
          const smallBooks = []; // books with ≤ IMAGE_EXTRACTION_INLINE_SIZE pages — keep per-book inline

          for (const book of readyForImages) {
            try {
              const rawPages = await db.collection('pages')
                .find({
                  book_id: book.id,
                  page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
                  $or: [
                    { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
                    { page_type: { $nin: IMAGE_CANDIDATE_PAGE_TYPES }, 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
                  ],
                }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
                .toArray();

              // Pre-filter: drop pages with only trivial OCR markup (drop caps,
              // stamps, ornaments). Skip filter does NOT apply to pages typed
              // as illustration/frontispiece/etc.
              const bookPages = rawPages.filter(p => {
                if (IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type)) return true;
                return !shouldSkipPageByMarkup(p.ocr?.data);
              }).map(p => ({ id: p.id }));
              const skippedTrivial = rawPages.length - bookPages.length;
              if (skippedTrivial > 0) {
                console.log(`  ${book.title?.slice(0, 50)}: skipped ${skippedTrivial} trivial-markup pages`);
              }

              if (bookPages.length === 0) {
                if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
                log.images_advanced++;
                console.log(`  No image candidates, skipped: ${book.title}`);
                continue;
              }

              if (DRY_RUN) {
                console.log(`  Would submit batch image extraction: ${book.title} (${bookPages.length} pages)`);
                continue;
              }

              // Small books (≤20 pages) use per-book inline path
              if (bookPages.length <= IMAGE_EXTRACTION_INLINE_SIZE) {
                smallBooks.push({ book, candidatePages: bookPages });
              } else {
                bookItems.push({ book, candidatePages: bookPages });
              }
            } catch (err) {
              log.errors.push(`Images candidate scan ${book.id}: ${err.message}`);
            }
          }

          // Submit small books via per-book inline path (no cross-book pooling needed)
          for (const { book, candidatePages } of smallBooks) {
            try {
              const result = await submitImageExtractionBatch(db, book, candidatePages);
              if (result.skippedDuplicate) continue;
              if (result.submitted === 0) {
                await setPipelineStatus(db, book.id, 'images_complete');
                log.images_advanced++;
                continue;
              }

              await setPipelineStatus(db, book.id, 'images_submitted', {
                image_extraction_batch: true,
                image_extraction_job_name: result.jobName,
              });
              log.images_submitted++;
              console.log(`  Inline image extraction submitted: ${book.title} (${result.submitted} pages, inline)`);
              await sleep(API_DELAY_MS);
            } catch (err) {
              log.errors.push(`Images inline submit ${book.id}: ${err.message}`);
            }
          }

          // Submit larger books via cross-book pooled batches
          if (bookItems.length > 0) {
            try {
              const result = await submitCrossBookImageBatches(db, bookItems);
              if (result.submitted > 0) {
                // Set all participating books to images_submitted
                for (const bookId of result.bookIds) {
                  await setPipelineStatus(db, bookId, 'images_submitted', {
                    image_extraction_batch: true,
                    cross_book_batch: true,
                  });
                  log.images_submitted++;
                }
                console.log(`  Cross-book image extraction submitted: ${result.submitted} pages from ${result.bookIds.length} books in ${result.batchCount} batches`);
              }
            } catch (err) {
              log.errors.push(`Images cross-book submit: ${err.message}`);
            }
          }
        }
      } else {
        // ── Lambda/SQS path (original, fallback) ──
        const activeImageJobs = await db.collection('jobs').countDocuments({
          type: 'image_extraction',
          status: { $in: ['pending', 'processing'] },
        });
        console.log(`  Active image jobs: ${activeImageJobs}/${MAX_ACTIVE_IMAGE_JOBS}`);

        if (!SQS_IMAGE_EXTRACTION_QUEUE_URL) {
          console.log('  SKIP: SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL not configured');
        } else if (activeImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
          const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];
          const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

          let readyForImages = await db.collection('books')
            .find({ 'pipeline_auto.status': 'chapters_complete' })
            .sort({ processing_priority: -1, hidden: 1 })
            .project({ id: 1, title: 1 })
            .limit(IMAGE_SUBMIT_LIMIT)
            .toArray();
          if (SCOPE_ACTIVE) readyForImages = await applyBookOverride(db, readyForImages, { id: 1, title: 1 });

          const remainingSlots = IMAGE_SUBMIT_LIMIT - readyForImages.length;
          if (remainingSlots > 0) {
            const catchUp = await db.collection('books')
              .find({
                'pipeline_auto.status': { $exists: false },
                pages_ocr: { $gt: 0 },
                $or: [
                  { detected_images_count: { $exists: false } },
                  { detected_images_count: 0 },
                ],
                'job.type': { $ne: 'image_extraction' },
              })
              .sort({ visible: -1, pages_count: -1 })
              .project({ id: 1, title: 1 })
              .limit(remainingSlots)
              .toArray();
            if (catchUp.length > 0) {
              readyForImages.push(...catchUp);
              console.log(`  Catch-up: ${catchUp.length} pre-pipeline books queued for image extraction`);
            }
          }

          console.log(`  Books ready for image extraction: ${readyForImages.length}`);

          for (const book of readyForImages) {
            try {
              const rawPages = await db.collection('pages')
                .find({
                  book_id: book.id,
                  page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
                  $or: [
                    { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
                    { page_type: { $nin: IMAGE_CANDIDATE_PAGE_TYPES }, 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
                  ],
                }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
                .toArray();

              const bookPages = rawPages.filter(p => {
                if (IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type)) return true;
                return !shouldSkipPageByMarkup(p.ocr?.data);
              }).map(p => ({ id: p.id }));
              const skippedTrivial = rawPages.length - bookPages.length;
              if (skippedTrivial > 0) {
                console.log(`  ${book.title?.slice(0, 50)}: skipped ${skippedTrivial} trivial-markup pages`);
              }

              if (bookPages.length === 0) {
                if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
                log.images_advanced++;
                console.log(`  No image candidates, skipped: ${book.title}`);
                continue;
              }

              if (DRY_RUN) {
                console.log(`  Would submit image extraction: ${book.title} (${bookPages.length} pages)`);
                continue;
              }

              const pageIds = bookPages.map(p => p.id);
              const jobId = nanoid(12);

              await db.collection('jobs').insertOne({
                id: jobId,
                type: 'image_extraction',
                status: 'pending',
                book_id: book.id,
                book_title: book.title,
                progress: { total: pageIds.length, completed: 0, failed: 0 },
                config: { page_ids: pageIds },
                created_at: new Date(),
                updated_at: new Date(),
              });

              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { job: { type: 'image_extraction', job_id: jobId } } }
              );

              for (let i = 0; i < pageIds.length; i += 10) {
                const batch = pageIds.slice(i, i + 10);
                await sqsClient.send(new SendMessageBatchCommand({
                  QueueUrl: SQS_IMAGE_EXTRACTION_QUEUE_URL,
                  Entries: batch.map((pageId, idx) => ({
                    Id: String(idx),
                    MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId }),
                  })),
                }));
              }

              await setPipelineStatus(db, book.id, 'images_submitted', {
                image_extraction_job_id: jobId,
              });
              log.images_submitted++;
              console.log(`  Image extraction submitted: ${book.title} (${pageIds.length} pages)`);

              await sleep(API_DELAY_MS);
            } catch (err) {
              log.errors.push(`Images submit ${book.id}: ${err.message}`);
            }
          }
        }
      }

      // Check completed image extraction — both batch API and Lambda/SQS paths
      let imagesPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_submitted' })
        .project({ id: 1, pipeline_auto: 1 })
        .toArray();
      if (SCOPE_ACTIVE) imagesPending = await applyBookOverride(db, imagesPending, { id: 1, pipeline_auto: 1 });

      for (const book of imagesPending) {
        const isBatch = book.pipeline_auto?.image_extraction_batch;

        if (isBatch) {
          // Batch path: check if all batch_jobs for this book are done
          const pendingBatch = await db.collection('batch_jobs').countDocuments({
            book_id: book.id,
            type: 'image_extraction',
            status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
          });
          if (pendingBatch === 0) {
            if (!DRY_RUN) {
              const imgCount = await db.collection('pages').countDocuments({
                book_id: book.id,
                'detected_images.0': { $exists: true },
              });
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { detected_images_count: imgCount } }
              );
              await setPipelineStatus(db, book.id, 'images_complete');
            }
            log.images_advanced++;
          }
        } else {
          // Lambda/SQS path: check jobs collection
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
            if (!DRY_RUN) {
              const imgCount = await db.collection('pages').countDocuments({
                book_id: book.id,
                'detected_images.0': { $exists: true },
              });
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { detected_images_count: imgCount } }
              );
              await setPipelineStatus(db, book.id, 'images_complete');
            }
            log.images_advanced++;
          }
        }
      }
      console.log(`  Images submitted: ${log.images_submitted}, advanced: ${log.images_advanced}`);
    }

    // ── Phase 8.5: Staleness detection ──
    if (shouldRun(8.5) || shouldRun(8)) {
      console.log('\n--- Phase 8.5: Staleness detection ---');

      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
      let staleBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted', 'summarizing', 'chapters'] },
          'pipeline_auto.last_updated': { $lt: staleThreshold },
        })
        .project({ id: 1, title: 1, pipeline_auto: 1 })
        .limit(50)
        .toArray();
      // Recovery is deliberately NOT confined to the selective-unpause scope.
      // A rollback writes a status field and nothing else — no submission, no
      // spend — while every phase that DOES spend stays scope-gated, so making
      // a book eligible cannot leak paid work. Confining it here meant a book
      // outside the 160-book allowlist could never self-heal: 8 books had to be
      // repaired by hand (Thibault + 7 others, 10-23 days stuck) before this
      // was noticed. An explicit --book override still narrows the run.
      if (BOOK_OVERRIDE) staleBooks = await applyBookOverride(db, staleBooks, { id: 1, title: 1, pipeline_auto: 1 });

      console.log(`  Stale books: ${staleBooks.length}`);

      const rollbackMap = {
        'ocr_submitted': 'archive_complete',
        'translate_submitted': 'ocr_complete',
        'images_submitted': 'chapters_complete',
        'summarizing': 'translate_complete',
        'chapters': 'summary_indexed',
      };

      for (const book of staleBooks) {
        const retries = book.pipeline_auto?.retry_count || 0;
        const status = book.pipeline_auto?.status;

        // Before rolling back ocr_submitted/translate_submitted, check if batch_jobs are still active
        // Rolling back while Gemini is still processing creates duplicate submissions
        if (status === 'ocr_submitted' || status === 'translate_submitted') {
          const batchType = status === 'ocr_submitted' ? 'ocr' : 'translation';
          const activeBatch = await db.collection('batch_jobs').countDocuments({
            book_id: book.id,
            type: batchType,
            status: { $in: ['pending', 'processing', 'completed'] }, // completed = not yet collected
          });
          if (activeBatch > 0) {
            console.log(`  Stale SKIP: ${book.title} (${status}) — ${activeBatch} active/uncollected batch jobs, waiting for collector`);
            // Update last_updated to extend the staleness window
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.last_updated': new Date() } }
              );
            }
            continue;
          }
        }

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

    // ── Phase 8.9: Cover selection + digitizer page hiding ──
    // Runs on images_complete books before finalize. Hides Google/IA notice pages
    // and picks the best cover using page_type + detected_images scoring.
    if (shouldRun(8.9) || shouldRun(9)) {
      console.log('\n--- Phase 8.9: Cover selection + page cleanup ---');

      let coverBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 })
        .limit(50)
        .toArray();
      if (SCOPE_ACTIVE) coverBooks = await applyBookOverride(db, coverBooks, { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 });

      console.log(`  Books needing cover selection: ${coverBooks.length}`);
      let coversSelected = 0;
      let pagesHidden = 0;

      for (const book of coverBooks) {
        if (DRY_RUN) continue;
        try {
          // 1. Hide pages already tagged as digitizer-insert by OCR (trust the model)
          const edgePages = await db.collection('pages').find(
            { book_id: book.id, page_type: 'digitizer-insert', hidden: { $ne: true } },
            { projection: { id: 1 } }
          ).toArray();

          for (const page of edgePages) {
            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: {
                hidden: true,
                updated_at: new Date(),
                'field_provenance.page_type': {
                  source: 'pipeline', method: 'ocr-tag',
                  confidence: 1.0, date: new Date(),
                },
              }}
            );
            pagesHidden++;
          }

          // 2. Select best cover (skip if manually set)
          if (book.thumbnail_source === 'manual') {
            await setPipelineStatus(db, book.id, 'cover_selected', { cover_selected_at: new Date() });
            coversSelected++;
            continue;
          }

          // Smart OCR-based cover selection
          const coverResult = await selectBestCoverPage(db, book.id, 20, book.title);
          if (coverResult && coverResult.url !== book.thumbnail) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: {
                thumbnail: coverResult.url,
                thumbnail_source: 'smart_ocr',
                cover_page: coverResult.page.page_number,
                cover_selected_at: new Date(),
                'field_provenance.thumbnail': {
                  source: 'pipeline', method: 'smart-ocr-cover-selection',
                  confidence: 0.85, date: new Date(),
                  detail: `${coverResult.reason} (score: ${coverResult.score})`,
                },
              }}
            );
          }

          await setPipelineStatus(db, book.id, 'cover_selected', { cover_selected_at: new Date() });
          coversSelected++;
        } catch (err) {
          console.error(`  Cover selection failed for ${book.title}: ${err.message?.slice(0, 100)}`);
          log.errors.push(`Cover failed ${book.id}: ${err.message?.slice(0, 80)}`);
        }
      }

      console.log(`  Covers selected: ${coversSelected}, digitizer pages hidden: ${pagesHidden}`);
      log.covers_selected = coversSelected;
      log.digitizer_pages_hidden = pagesHidden;
    }

    // ── Phase 9: Finalize (cover_selected -> complete) ──
    if (shouldRun(9)) {
      console.log('\n--- Phase 9: Finalize ---');

      let readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'cover_selected' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, language: 1, content_type: 1, resource_type: 1 })
        .limit(FINALIZE_LIMIT)
        .toArray();
      if (SCOPE_ACTIVE) readyToFinalize = await applyBookOverride(db, readyToFinalize, { id: 1, title: 1, pages_count: 1, language: 1 });

      console.log(`  Books ready to finalize: ${readyToFinalize.length}`);

      for (const book of readyToFinalize) {
        const totalPages = book.pages_count || await db.collection('pages').countDocuments({ book_id: book.id });

        if (totalPages === 0) {
          // Single-object artworks legitimately have 0 pages — finalize, don't flag as a
          // failed import. (Phase 0 normally diverts these, but the dedicated `--phase 9`
          // finalize cron doesn't run Phase 0, so guard here too.)
          if (book.content_type === 'artwork') {
            if (!DRY_RUN) await setPipelineStatus(db, book.id, 'complete', { skipped: 'artwork', completed_at: new Date() });
            log.completed = (log.completed || 0) + 1;
            continue;
          }
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
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Finalize blocked: 0/${totalPages} OCR pages. Needs manual investigation.`,
            });
          }
          log.needs_attention++;
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
          // Auto-unhide: books that completed the full pipeline should be visible
          await db.collection('books').updateOne(
            { id: book.id, hidden: true },
            { $set: { hidden: false, visible: true, updated_at: new Date() }, $unset: { hidden_reason: '' } }
          );
        }
        log.finalized++;
        console.log(`  Finalized: ${book.title}`);
      }
      console.log(`  Finalized: ${log.finalized}`);
    }

    // ── Summary ──
    const duration = Date.now() - startTime;

    // Pipeline funnel + page totals — use enrichment_snapshot (fast single-doc read)
    // instead of $facet which times out on Atlas under load
    let counts = {};
    let totals = { books: 0, pages: 0, ocr: 0, translated: 0 };
    let facetTimedOut = false;
    try {
      const snapshot = await db.collection('system_config').findOne({ _id: 'enrichment_snapshot' });
      if (snapshot?.funnel && snapshot?.enrichment) {
        counts = snapshot.funnel;
        totals = {
          books: snapshot.enrichment.total || 0,
          pages: 0, // not needed for snapshot write
          ocr: snapshot.enrichment.has_ocr || 0,
          translated: snapshot.enrichment.has_translation || 0,
        };
        // Get actual page totals from cached book counters (fast indexed sum)
        const [pageSum] = await db.collection('books').aggregate([
          { $match: { pages_count: { $gt: 0 } } },
          { $group: { _id: null, pages: { $sum: '$pages_count' }, ocr: { $sum: '$pages_ocr' }, translated: { $sum: '$pages_translated' } } },
        ], { maxTimeMS: 10000 }).toArray().catch(() => [{}]);
        if (pageSum) {
          totals.pages = pageSum.pages || 0;
          totals.ocr = pageSum.ocr || 0;
          totals.translated = pageSum.translated || 0;
        }
      } else {
        console.log('  Enrichment snapshot not available — skipping funnel snapshot');
        facetTimedOut = true;
      }
    } catch (e) {
      console.log('  Snapshot/totals query failed — skipping funnel snapshot:', e.message);
      facetTimedOut = true;
    }

    console.log(`\n=== PIPELINE FUNNEL ===`);
    for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
    console.log(`\n=== PAGES ===`);
    console.log(`  Total: ${totals.pages} | OCR: ${totals.ocr} | Translated: ${totals.translated}`);

    console.log(`\n=== ACTIONS (${(duration / 1000).toFixed(0)}s) ===`);
    console.log(`  Enrolled: ${log.enrolled} | Archived: ${log.archived}`);
    console.log(`  Preview queued: ${log.preview_queued} | OCR submitted: ${log.ocr_submitted} | OCR advanced: ${log.ocr_advanced}`);
    console.log(`  Metadata: ${log.metadata_enriched} enriched`);
    console.log(`  Translate submitted: ${log.translate_submitted} | Translate advanced: ${log.translate_advanced}`);
    console.log(`  Enriched: ${log.enriched} | Chapters: ${log.chapters_extracted} (${log.chapters_skipped} skipped)`);
    console.log(`  Images submitted: ${log.images_submitted} | Images advanced: ${log.images_advanced}`);
    console.log(`  Covers: ${log.covers_selected} | Pages hidden: ${log.digitizer_pages_hidden}`);
    console.log(`  Finalized: ${log.finalized} | Needs attention: ${log.needs_attention}`);
    console.log(`  Stale retried: ${log.stale_retried} | Stale failed: ${log.stale_failed}`);
    if (log.zombie_jobs_cancelled > 0) console.log(`  Zombie jobs cancelled: ${log.zombie_jobs_cancelled}`);
    if (log.errors.length > 0) {
      console.log(`  Errors (${log.errors.length}):`);
      for (const err of log.errors.slice(0, 30)) {
        console.log(`    - ${err}`);
      }
    }

    // Write cron_runs + pipeline_snapshots (skip snapshot if facet timed out — zero counts poison charts)
    if (!DRY_RUN) {
      const activeBatch = await db.collection('batch_jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: { $ifNull: ['$page_count', 0] } } } },
      ]).toArray();
      const batchByType = Object.fromEntries(activeBatch.map(b => [b._id, { count: b.count, pages: b.pages }]));

      await Promise.allSettled([
        facetTimedOut ? Promise.resolve() : db.collection('pipeline_snapshots').insertOne({
          timestamp: new Date(),
          funnel: counts,
          pages: { total: totals.pages, ocr: totals.ocr, translated: totals.translated },
          books: totals.books,
          active_batch: batchByType,
          source: 'hetzner-worker',
        }),
        db.collection('cron_runs').insertOne({
          task: 'pipeline-orchestrator',
          cron: 'pipeline-orchestrator-worker',
          started_at: new Date(startTime),
          timestamp: new Date(),
          duration_ms: duration,
          status: log.errors.length > 0 ? 'partial' : 'success',
          failed: false,
          actions: {
            enrolled: log.enrolled,
            archived: log.archived,
            dedup_books: log.dedup_books,
            dedup_pages_hidden: log.dedup_pages_hidden,
            dedup_flagged: log.dedup_flagged,
            ocr_submitted: log.ocr_submitted,
            ocr_advanced: log.ocr_advanced,
            metadata_enriched: log.metadata_enriched,
            metadata_skipped: log.metadata_skipped,
            transliterated: log.transliterated,
            transliterate_pages: log.transliterate_pages,
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
            zombie_jobs_cancelled: log.zombie_jobs_cancelled,
          },
          errors: [..._batchBrokenKeyEvents, ...log.errors].slice(0, 50).map(msg => ({ message: msg, timestamp: new Date() })),
          error_count: _batchBrokenKeyEvents.length + log.errors.length,
          health_grade: healthGrade,
          summary: `[${healthGrade}] E:${log.enrolled} A:${log.archived} D:${log.dedup_books}/${log.dedup_pages_hidden}p P:${log.preview_queued} O:${log.ocr_submitted}/${log.ocr_advanced} M:${log.metadata_enriched} Tr:${log.transliterated}/${log.transliterate_pages}p T:${log.translate_submitted}/${log.translate_advanced} R:${log.enriched} C:${log.chapters_extracted} I:${log.images_submitted}/${log.images_advanced} F:${log.finalized}`,
        }),
      ]);
    }

    await client.close();
  } catch (error) {
    console.error('[pipeline-orchestrator] Fatal error:', error);

    // Write failure record
    try {
      await db.collection('cron_runs').insertOne({
        task: 'pipeline-orchestrator',
        cron: 'pipeline-orchestrator-worker',
        started_at: new Date(startTime),
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
