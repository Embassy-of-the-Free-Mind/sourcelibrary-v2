#!/usr/bin/env node
/**
 * Embed pages for semantic search using Gemini embedding-2-preview.
 *
 * Embeds BOTH ocr.data and translation.data per page into Supabase
 * page_translations table. Uses Gemini API (768 dims).
 *
 * Replaces the old e5-base backfill (embed-translations.mjs).
 * The Gemini model is much better for Latin, Greek, Arabic, Sanskrit.
 *
 * COST — THIS IS BILLED, AND AT THIS SCALE IT IS THE LARGEST SINGLE EMBEDDING
 * SPEND IN THE REPO. gemini-embedding-2 is $0.20 per 1M input tokens on
 * the paid tier, and every GEMINI_API_KEY* in the env is a paid key. At the
 * measured 4.29 chars/token (see .claude/docs/embeddings.md) a FULL 3.9M-page
 * pass is roughly **$180**. This header used to say "Cost: $0 (free tier)";
 * that line was believed and acted on in Aug 2026 and cost ~$12 on a corpus
 * 100x smaller. --incremental and --missing-only are cheap because they touch
 * few pages; --full is not. ASK BEFORE A FULL PASS.
 *
 * Since #4162 this worker RECORDS what it spends: gemini_usage rows with
 * type 'embedding', flushed every FLUSH_EVERY_TEXTS so a full pass writes ~780
 * rows rather than 78,000 (the spend guard fails closed above 40,000/day).
 * Tokens are estimated from characters — batchEmbedContents returns no
 * usageMetadata. See scripts/lib/embedding-usage.mjs.
 *
 * Time: ~5-6 days for full 3M-page backfill (~13 texts/sec sustained).
 *
 * Modes:
 *   --full        Process all pages with OCR or translation
 *   --incremental Process pages whose source changed after this worker's own
 *                 watermark (system_config 'embed_gemini_watermark', default).
 *                 The mark advances only after an unscoped, complete,
 *                 error-free run — see scripts/lib/embed-watermark.mjs (#5869).
 *   --missing-only Process only books that have pages with embedding IS NULL (~3-4h vs 85h for --full)
 *   --restale     Re-embed rows whose Mongo source is newer than the
 *                 Supabase mongo_updated_at watermark (catches re-OCR /
 *                 re-translation in Mongo without re-embed). Requires the
 *                 watermark column + backfill (see add-page-translations-
 *                 watermark.sql and backfill-page-translations-watermark.mjs).
 *   --book ID     Process a single book
 *   --books-file PATH  Embed every page with text and no row, for a JSON array
 *                 of book ids (translated or not)
 *   --pages-file PATH  RE-embed exactly these page ids (JSON array), row or no
 *                 row — the repair lane for wrong vectors (#6175). Works with --batch.
 *   --limit N     Stop after N pages
 *   --dry-run     Count pages without embedding
 *
 * Batch API (#5729) — same model, same 768 dims, same text and row, half the price:
 *   --batch       With --books-file: instead of calling batchEmbedContents, write
 *                 the pages into Gemini Batch API embedding jobs
 *                 (asyncBatchEmbedContent, --job-pages N per job, default 20000)
 *                 and exit. Each job is recorded in Mongo `embed_batch_jobs` and
 *                 priced AT SUBMIT on gemini_usage (mode 'batch', status
 *                 'submitted', endpoint worker/embed-gemini, one row per book) so
 *                 the dial and the scope envelope see committed spend (#4567).
 *                 The spend gate is re-asked before every job. Pages already in an
 *                 uncollected job are skipped, so a re-run resumes. Exit 3 = the
 *                 Batch API refused a job (quota) or --max-running was reached;
 *                 re-run later.
 *   --max-running N  With --batch: submit only while fewer than N embedding jobs
 *                 are still running at Gemini. Measured 2026-10-07 (#5729): with
 *                 ~6–10 10K-page jobs in flight, the project's jobs all ended at
 *                 the same moment and the later-submitted ones came back with
 *                 most requests "The operation was cancelled" (up to 100%);
 *                 jobs submitted on their own succeeded 100%. Cancelled requests
 *                 are not billed, but every one is a page to submit again.
 *   --collect     Collect finished jobs: stream each results file, re-read the
 *                 page from Mongo, rebuild its text with the same composer, and
 *                 upsert the row only when the text still hashes to what was
 *                 submitted (a page re-OCR'd in between is left for the next run).
 *                 Closes the submit-time usage rows with the BILLED tokens (batch
 *                 results carry usageMetadata; realtime ones do not). Free: it
 *                 runs whatever the dial says. --collect-concurrency N (default 3).
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
 *      GEMINI_API_KEY_TIER3 (preferred, no training opt-in) or GEMINI_API_KEY
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/embed-gemini.mjs --full
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { cleanPageText, pageEmbeddingInput, buildPageEmbeddingRow, PAGE_EMBEDDING_COLUMNS } from '../lib/page-embedding-text.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { newEmbedUsage, addEmbedUsage, logEmbeddingUsage, estimateUsd, estimateTextTokens, usdForTokens, FLUSH_EVERY_TEXTS } from '../lib/embedding-usage.mjs';
import { pageSourceTs, incrementalSourceFilter, nextWatermark, readWatermark, writeWatermark } from '../lib/embed-watermark.mjs';
import { createThenDeleteInput, uploadBatchInputFile, streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { logUsage, completeBatchUsage, calculateUsageCost } from './lib/supabase-usage-logger.mjs';
import { GEMINI_TEXT_MODEL, GEMINI_TEXT_MODELS } from '../lib/vector-truth.mjs';

// ── Config ──────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
// Prefer paid Tier 3 (no training opt-in) for content-bearing translations;
// fall back to default key for local/dev. Cron explicitly exports TIER3 too
// (crontab.production), so this is belt-and-suspenders for ad-hoc runs.
const GEMINI_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !SUPABASE_KEY || !GEMINI_KEY) {
  console.error('Missing env: MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY[_TIER3]');
  process.exit(1);
}

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const MISSING_ONLY = args.includes('--missing-only');
// --restale: re-embed rows where the source Mongo page is newer than the
// stored mongo_updated_at watermark. Catches OCR/translation updates that
// would otherwise leave Supabase silently stale.
const RESTALE = args.includes('--restale');
const DRY_RUN = args.includes('--dry-run');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
// --books-file PATH: embed every page that has text and no row in
// page_translations, for a fixed JSON array of book ids — translated pages and
// untranslated ones alike. --missing-only can't reach these books (it only
// scans rows that exist), and until #5869 this mode streamed only UNtranslated
// OCR pages, so it skipped exactly the translated pages the incremental
// watermark had passed over (Pepys's Diary, 2026-10-05). Untranslated pages
// still use the OCR fallback (textToEmbed = ocrText), so they get a
// work-specific vector with an EMPTY translation column (no search pollution).
const BOOKS_FILE = args.find((_, i, a) => a[i - 1] === '--books-file');
// --translated-only (with --books-file): embed only missing pages that HAVE a
// translation. For budget-capped backfills, where translated pages are the ones
// readers and the Librarian search by meaning (#5869).
const TRANSLATED_ONLY = args.includes('--translated-only');
// --pages-file PATH: RE-embed exactly these page ids (JSON array), whether or not
// they already have a row. The repair lane for rows whose vector is wrong — an
// e5 vector under a Gemini label, a vector of text the page no longer holds
// (#6175). --books-file cannot do it: it only fills pages with NO row.
const PAGES_FILE = args.find((_, i, a) => a[i - 1] === '--pages-file');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;
const WORKER_ID = parseInt(args.find((_, i, a) => a[i - 1] === '--worker-id') || '0');
const WORKER_COUNT = parseInt(args.find((_, i, a) => a[i - 1] === '--worker-count') || '1');
const BATCH_MODE = args.includes('--batch');
const COLLECT_MODE = args.includes('--collect');
const JOB_PAGES = parseInt(args.find((_, i, a) => a[i - 1] === '--job-pages') || '20000');
const COLLECT_CONCURRENCY = parseInt(args.find((_, i, a) => a[i - 1] === '--collect-concurrency') || '3');
const MAX_RUNNING = parseInt(args.find((_, i, a) => a[i - 1] === '--max-running') || '0') || 0;
if (BATCH_MODE && !BOOKS_FILE && !PAGES_FILE) {
  // A batch job is priced and attributed per book; an open-ended batch --full
  // would enqueue the whole corpus' spend in one go. Name the books.
  console.error('--batch needs --books-file or --pages-file');
  process.exit(1);
}

// Text composition and row shape are SHARED with the pipeline-side writer
// (scripts/lib/embed-book-pages.mjs, called from enrich-worker Phase 6). Two
// writers producing subtly different rows is exactly the failure that put
// `People: , , , ,` into 14,237 book_embeddings rows — see
// scripts/lib/book-embedding-text.mjs. Import, never re-type.
const EMBED_BATCH_SIZE = 50; // Gemini batchEmbedContents limit is 100, use 50 for safety
const UPSERT_BATCH_SIZE = 10; // Small batches for Supabase — HNSW index updates are expensive
const DIMS = 768;
// gemini-embedding-2 since #6170 (bit-identical to -2-preview; see GEMINI_TEXT_MODELS).
const MODEL = GEMINI_TEXT_MODEL;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_KEY}`;

// Circuit breaker: abort if too many consecutive Supabase failures
const MAX_CONSECUTIVE_FAILURES = 10;
const SUPABASE_BACKOFF_BASE = 2000; // ms

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Direct PG client for writes (bypasses REST API 8s timeout)
let pgClient = null;

async function getPgClient() {
  if (pgClient) return pgClient;
  if (!SUPABASE_DB_URL) return null;

  try {
    const { default: pg } = await import('pg');
    pgClient = new pg.Client({
      connectionString: SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    await pgClient.query('SET statement_timeout = 30000'); // PgBouncer rejects startup params — must SET after connect
    console.log('Using direct PG for writes (bypasses REST API timeout)');
    return pgClient;
  } catch (e) {
    console.warn(`Direct PG unavailable (${e.message}), falling back to REST API`);
    return null;
  }
}

// ── Gemini Embedding ────────────────────────────────────────────────

let rateLimitBackoff = 0;

// Embedding spend, accumulated and flushed periodically (#4162). This worker
// streams pages rather than walking books, so there is no per-book boundary to
// flush on; FLUSH_EVERY_TEXTS bounds the row count instead (~780 rows for a
// full 3.9M-page pass, against the spend guard's 40,000-row/day ceiling — one
// row per 50-text batch would have been 78,000 and read as over-budget).
const embedUsage = newEmbedUsage();
let usageRows = 0;         // gemini_usage rows written this run
let usageTotalChars = 0;   // characters recorded, for the closing summary

// Per-book attribution for runs over a known book set (--books-file, --book).
// A scope envelope meters spend BY book_id (spend-guard getScopeSpendUsd), so a
// book_id-less row is invisible to it: an envelope-funded backfill logged that
// way would read $0 against its budget however much it spent (#5869). The
// streaming incremental run keeps one unattributed accumulator — its pages span
// thousands of books per flush window and it is never envelope-capped by book.
const ATTRIBUTE_PER_BOOK = Boolean(BOOKS_FILE || PAGES_FILE || BOOK_ID);
const bookUsage = new Map(); // book_id → accumulator
let bookUsageTexts = 0;

function recordUsage(items) {
  if (!ATTRIBUTE_PER_BOOK) {
    addEmbedUsage(embedUsage, items.map(i => i.text));
    return;
  }
  for (const item of items) {
    const id = item.page.book_id;
    if (!bookUsage.has(id)) bookUsage.set(id, newEmbedUsage());
    addEmbedUsage(bookUsage.get(id), [item.text]);
  }
  bookUsageTexts += items.length;
}

async function flushEmbedUsage(force = false) {
  if (ATTRIBUTE_PER_BOOK) {
    if (!force && bookUsageTexts < FLUSH_EVERY_TEXTS) return;
    for (const [bookId, usage] of bookUsage) {
      const chars = usage.chars;
      if (!chars) continue;
      await logEmbeddingUsage(usage, { model: MODEL, bookId, endpoint: 'worker/embed-gemini' });
      usageRows += 1;
      usageTotalChars += chars;
    }
    bookUsage.clear();
    bookUsageTexts = 0;
    return;
  }
  if (!force && embedUsage.texts < FLUSH_EVERY_TEXTS) return;
  const chars = embedUsage.chars;
  if (!chars) return;
  await logEmbeddingUsage(embedUsage, { model: MODEL, endpoint: 'worker/embed-gemini' });
  usageRows += 1;
  usageTotalChars += chars;
}

// A stopped run (budget stop, operator Ctrl-C) still spent what it embedded
// since the last flush — up to FLUSH_EVERY_TEXTS texts per process. Record it
// before exiting, or the ledger and any envelope meter read low (#5869: a
// killed driver left 6,750 pages, ~$1, unrecorded).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    try { await flushEmbedUsage(true); } catch {}
    process.exit(128 + (sig === 'SIGTERM' ? 15 : 2));
  });
}

async function embedBatch(items) {
  const texts = items.map(i => i.text);
  const requests = texts.map(t => ({
    model: `models/${MODEL}`,
    content: { parts: [{ text: t }] },
    outputDimensionality: DIMS,
  }));

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 429) {
    rateLimitBackoff = Math.min(rateLimitBackoff + 5, 60);
    console.log(`  Rate limited — backing off ${rateLimitBackoff}s`);
    await sleep(rateLimitBackoff * 1000);
    return embedBatch(items); // Retry
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  rateLimitBackoff = Math.max(0, rateLimitBackoff - 1); // Decay backoff on success

  const data = await res.json();
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${data.embeddings?.length || 0}`);
  }
  // Counted only on success — a 429 retried above was not billed for a result.
  recordUsage(items);
  await flushEmbedUsage();
  const vectors = data.embeddings.map(e => e.values);
  vectors.model = MODEL; // the model this request called — buildPageEmbeddingRow requires it (#6175)
  return vectors;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Delegates to the shared composer so this worker and the pipeline-side writer
 * embed byte-identical text. The rationale for dropping editorial wrappers
 * content-and-all lives there.
 */
function cleanText(text) {
  return cleanPageText(text);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Fields every mode reads from a page — the stream and the batch collector alike. */
const PAGE_PROJECTION = {
  id: 1,
  book_id: 1,
  page_number: 1,
  'ocr.data': 1,
  'translation.data': 1,
  'translation.updated_at': 1,
  'ocr.updated_at': 1,
  updated_at: 1, // fallback for the mongo_updated_at watermark when sub-doc timestamps are missing
};

/**
 * The text this worker embeds for a page, or null when it has none worth
 * embedding. ONE function for the realtime stream and the batch collector,
 * which rebuilds the text to check it still matches what was submitted.
 *
 * It is the SHARED composer (`pageEmbeddingInput`), the one enrich Phase 6
 * uses. This worker used to prepend the page's `translation_summary` and
 * `translation_keywords`, and because the row's `translation` column is the
 * composed text, the AI's description of the page was stored as its quotable
 * snippet — the #2232 misquote class, alive in one writer (#6175: 58 of 148
 * summary-bearing pages sampled). The 20-character floor is this worker's own
 * and is kept: a stub translation falls back to the OCR, as before.
 */
function composeEmbedText(page) {
  const input = pageEmbeddingInput(page);
  if (input && input.text.length >= 20) return input;
  const ocrText = cleanText(page.ocr?.data);
  return ocrText.length >= 20 ? { text: ocrText, hasTranslation: false } : null;
}

// Book metadata cache
const bookCache = new Map();
async function getBook(bookId) {
  if (bookCache.has(bookId)) return bookCache.get(bookId);
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { title: 1, display_title: 1, author: 1, language: 1, year: 1 } }
  );
  const meta = book ? {
    title: book.display_title || book.title || 'Untitled',
    author: book.author || null,
    language: book.language || null,
    year: typeof book.year === 'number' ? book.year : null,
  } : { title: 'Unknown', author: null, language: null, year: null };
  bookCache.set(bookId, meta);
  return meta;
}

// ── Batch API lane (#5729) ──────────────────────────────────────────
//
// The same request the realtime path sends (model, text, outputDimensionality
// 768, no taskType), through asyncBatchEmbedContent at half the price. Positive
// control 2026-10-07: batch vs realtime vectors for the same text, cosine ≥ 0.99
// (see #5729). PRIOR ART: scripts/workers/lib/enrich-batch-lane.mjs — the REST
// batch shape and the price-at-submit / completeBatchUsage-at-collect metering.

const EMBED_JOBS = 'embed_batch_jobs';
const BATCH_API = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_MAX_JOB_BYTES = 150 * 1024 * 1024;
const BATCH_ENDPOINT = 'worker/embed-gemini'; // same lane as realtime: envelope meters count both
let embedJob = newEmbedJob();
let batchStop = null; // why submission stopped early: 'gate' | 'quota' | 'error'
const batchSubmitted = [];

function newEmbedJob() { return { lines: [], bytes: 0, pageIds: [], books: new Map() }; }
function textHash(text) { return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12); }

async function addToEmbedJob(item) {
  // Key: book|page|text-hash. The book attributes billed tokens without a
  // Mongo read; the hash lets the collector refuse a vector for changed text.
  const line = JSON.stringify({
    key: `${item.page.book_id}|${item.page.id}|${textHash(item.text)}`,
    // toWellFormed: the 8,000-char cut can split a surrogate pair, and the Batch API rejects the
    // WHOLE job on one lone surrogate (#6175). The key keeps the hash of the composed text.
    request: { content: { parts: [{ text: item.text.toWellFormed() }] }, outputDimensionality: DIMS },
  });
  embedJob.lines.push(line);
  embedJob.bytes += Buffer.byteLength(line) + 1;
  embedJob.pageIds.push(item.page.id);
  const b = embedJob.books.get(item.page.book_id) || { pages: 0, tokens: 0 };
  b.pages++;
  b.tokens += estimateTextTokens(item.text);
  embedJob.books.set(item.page.book_id, b);
  if (embedJob.lines.length >= JOB_PAGES || embedJob.bytes >= BATCH_MAX_JOB_BYTES) await submitEmbedJob();
}

/** Embedding jobs still queued or running at Gemini (submitted, not yet finished). */
async function runningEmbedJobs() {
  const open = await db.collection(EMBED_JOBS).find({ status: 'submitted', model: { $in: GEMINI_TEXT_MODELS } }, { projection: { gemini_name: 1 } }).toArray();
  let running = 0;
  for (const j of open) {
    const r = await (await fetch(`${BATCH_API}/${j.gemini_name}?key=${GEMINI_KEY}`)).json().catch(() => ({}));
    if (!/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(r.metadata?.state || r.state || '')) running++;
  }
  return running;
}

/** True (and batchStop = 'busy') when --max-running jobs are already in flight. */
async function atMaxRunning() {
  if (!MAX_RUNNING) return false;
  const running = await runningEmbedJobs();
  if (running < MAX_RUNNING) return false;
  batchStop = 'busy';
  console.log(`[embed-gemini] batch: ${running} embedding job(s) running at Gemini (--max-running ${MAX_RUNNING}) — not submitting more now.`);
  return true;
}

async function submitEmbedJob() {
  const job = embedJob;
  embedJob = newEmbedJob();
  if (!job.lines.length || batchStop) return;
  if (await atMaxRunning()) return;
  // Re-ask the gate for every job: a long run can outlive its envelope.
  const gate = await budgetAllowsDispatchScoped(db, 'embed-gemini');
  if (!gate.allowed || (gate.envelopeIds && [...job.books.keys()].some(id => !gate.envelopeIds.has(id)))) {
    batchStop = 'gate';
    console.log(`[embed-gemini] batch: spend gate closed for this job's books — no new dispatch (${job.lines.length} pages not submitted).`);
    return;
  }
  const jobId = `embed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const estUsd = [...job.books.values()].reduce((t, b) => t + usdForTokens(b.tokens, { batch: true }), 0);
  const jobs = db.collection(EMBED_JOBS);
  await jobs.insertOne({
    _id: jobId, status: 'creating', model: MODEL, dims: DIMS, books_file: BOOKS_FILE || null,
    book_ids: [...job.books.keys()], page_ids: job.pageIds, requests: job.lines.length, bytes: job.bytes,
    pages_file: PAGES_FILE || null, est_usd: +estUsd.toFixed(4), created_at: new Date(),
  });
  let created;
  try {
    const fileName = await uploadBatchInputFile(job.lines.join('\n') + '\n', jobId, GEMINI_KEY);
    created = await createThenDeleteInput({
      fileName, apiKey: GEMINI_KEY,
      create: async () => {
        for (let attempt = 0; ; attempt++) {
          const r = await fetch(`${BATCH_API}/models/${MODEL}:asyncBatchEmbedContent?key=${GEMINI_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: { display_name: jobId, input_config: { file_name: fileName } } }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.name) return body;
          if (r.status === 429 && attempt < 2) { await sleep(60000 * (attempt + 1)); continue; }
          const err = new Error(`batch create ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
          err.status = r.status;
          throw err;
        }
      },
    });
  } catch (e) {
    await jobs.updateOne({ _id: jobId }, { $set: { status: 'create_failed', error: e.message.slice(0, 500) } });
    batchStop = e.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(e.message) ? 'quota' : 'error';
    console.error(`[embed-gemini] batch: ${jobId} not submitted (${batchStop}): ${e.message}`);
    return;
  }
  await jobs.updateOne({ _id: jobId }, { $set: { status: 'submitted', gemini_name: created.name, submitted_at: new Date() } });
  // Priced at submit so the dial and the envelope see committed spend (#4567);
  // completeBatchUsage replaces each estimate with billed tokens at collect.
  for (const [bookId, b] of job.books) {
    await logUsage({
      type: 'embedding', mode: 'batch', model: MODEL, book_id: bookId, page_count: b.pages,
      batch_job_id: `${jobId}:${bookId}`, input_tokens: 0, output_tokens: 0, status: 'submitted',
      cost_usd: Math.round(usdForTokens(b.tokens, { batch: true }) * 1e6) / 1e6, endpoint: BATCH_ENDPOINT,
    }, db);
  }
  batchSubmitted.push({ jobId, name: created.name, pages: job.lines.length, books: job.books.size, estUsd });
  console.log(`[embed-gemini] batch: submitted ${jobId} → ${created.name}: ${job.lines.length.toLocaleString()} pages, ${job.books.size} books, est $${estUsd.toFixed(4)}`);
}

const UPSERT_SQL_HEAD = `INSERT INTO page_translations (${PAGE_EMBEDDING_COLUMNS.join(', ')}) VALUES `;
const UPSERT_SQL_TAIL = ` ON CONFLICT (page_id) DO UPDATE SET ${PAGE_EMBEDDING_COLUMNS.filter(c => c !== 'page_id').map(c => `${c} = EXCLUDED.${c}`).join(', ')}`;

/** Multi-row upsert, the same columns and conflict rule as upsertToSupabase. */
async function upsertManyPg(client, rows) {
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const params = [];
    const tuples = chunk.map((row) => `(${PAGE_EMBEDDING_COLUMNS.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(', ')})`);
    await client.query(UPSERT_SQL_HEAD + tuples.join(', ') + UPSERT_SQL_TAIL, params);
  }
}

async function openPg() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 60000');
  return client;
}

async function collectEmbedJobs() {
  if (!SUPABASE_DB_URL) { console.error('--collect needs SUPABASE_DB_URL'); process.exit(1); }
  const jobs = db.collection(EMBED_JOBS);
  const staleClaim = new Date(Date.now() - 2 * 3600e3);
  const todo = await jobs.find(
    { $or: [{ status: 'submitted' }, { status: 'collecting', collecting_at: { $lt: staleClaim } }] },
    { projection: { page_ids: 0 } },
  ).sort({ created_at: 1 }).toArray();
  console.log(`[collect] ${todo.length} job(s) to check`);
  const report = { pending: 0, collected: 0, failed: 0, written: 0, changed: 0, failedRequests: 0, errored: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, COLLECT_CONCURRENCY) }, async () => {
    while (next < todo.length) {
      const job = todo[next++];
      try { await collectEmbedJob(job, report); } catch (e) { report.errored++; console.error(`[collect] ${job._id}: ${e.message}`); }
    }
  }));
  const open = await jobs.countDocuments({ status: { $in: ['submitted', 'collecting'] } });
  console.log(`[collect] ${JSON.stringify(report)} — ${open} job(s) still open`);
}

async function collectEmbedJob(job, report) {
  const jobs = db.collection(EMBED_JOBS);
  const r = await (await fetch(`${BATCH_API}/${job.gemini_name}?key=${GEMINI_KEY}`)).json();
  const state = r.metadata?.state || r.state || 'UNKNOWN';
  if (/FAILED|CANCELLED|EXPIRED/.test(state)) {
    await jobs.updateOne({ _id: job._id }, { $set: { status: 'failed', state, collected_at: new Date() } });
    for (const id of job.book_ids) {
      await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: job.model, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: state, insertIfMissing: false }, db);
    }
    report.failed++;
    console.log(`  ${job._id}: ${state} — its pages go back to the pool`);
    return;
  }
  if (!/SUCCEEDED/.test(state)) {
    report.pending++;
    console.log(`  ${job._id}: ${state} ${JSON.stringify(r.metadata?.batchStats || {})}`);
    return;
  }
  const responsesFile = r.response?.responsesFile || r.metadata?.output?.responsesFile;
  if (!responsesFile) throw new Error(`${state} with no responsesFile`);
  const claim = await jobs.updateOne(
    { _id: job._id, status: job.status, collecting_at: job.collecting_at ?? { $exists: false } },
    { $set: { status: 'collecting', collecting_at: new Date(), state } },
  );
  if (!claim.modifiedCount) return; // another collector took it

  const client = await openPg();
  const perBook = new Map(); // bookId → { tokens, pages }
  const counts = { responses: 0, written: 0, changed: 0, failedRequests: 0, missing: 0 };
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const lines = buf;
    buf = [];
    const parsed = lines.map((line) => {
      const [bookId, pageId, hash] = String(line.key ?? line.metadata?.key ?? '').split('|');
      return { bookId, pageId, hash, line };
    });
    const pages = await db.collection('pages').find({ id: { $in: parsed.map(p => p.pageId) } }).project(PAGE_PROJECTION).toArray();
    const byId = new Map(pages.map(p => [p.id, p]));
    const rows = new Map();
    for (const { bookId, pageId, hash, line } of parsed) {
      const b = perBook.get(bookId) || { tokens: 0, pages: 0 };
      perBook.set(bookId, b);
      b.tokens += line.response?.usageMetadata?.promptTokenCount || 0; // billed whatever we keep
      const values = line.response?.embedding?.values;
      if (line.error || !values) { counts.failedRequests++; continue; }
      if (values.length !== DIMS) throw new Error(`${pageId}: ${values.length}-dim vector, expected ${DIMS}`);
      const page = byId.get(pageId);
      if (!page) { counts.missing++; continue; }
      const composed = composeEmbedText(page);
      if (!composed || textHash(composed.text) !== hash) { counts.changed++; continue; }
      const book = await getBook(page.book_id);
      rows.set(pageId, buildPageEmbeddingRow({ page, book, text: composed.text, hasTranslation: composed.hasTranslation, embedding: values, model: job.model }));
      b.pages++;
    }
    for (let attempt = 1; ; attempt++) {
      try { await upsertManyPg(client, [...rows.values()]); break; } catch (e) {
        if (attempt >= 4) throw new Error(`upsert failed 4×: ${e.message}`);
        console.warn(`  ${job._id}: upsert error (${e.message}) — retry ${attempt} in ${attempt * 15}s`);
        await sleep(attempt * 15000);
      }
    }
    counts.written += rows.size;
  };
  try {
    for await (const line of streamBatchResponses(responsesFile, GEMINI_KEY)) {
      counts.responses++;
      buf.push(line);
      if (buf.length >= 200) await flush();
      if (counts.responses % 5000 === 0) console.log(`  ${job._id}: ${counts.responses.toLocaleString()} responses, ${counts.written.toLocaleString()} rows written`);
    }
    await flush();
  } finally {
    await client.end().catch(() => {});
  }

  let billedTokens = 0;
  for (const id of job.book_ids) {
    const b = perBook.get(id) || { tokens: 0, pages: 0 };
    billedTokens += b.tokens;
    await completeBatchUsage({
      batch_job_id: `${job._id}:${id}`, model: job.model, input_tokens: b.tokens, output_tokens: 0,
      status: b.tokens ? 'success' : 'failed', type: 'embedding', mode: 'batch', book_id: id,
      page_count: b.pages, endpoint: BATCH_ENDPOINT,
    }, db);
  }
  const actualUsd = calculateUsageCost(job.model, billedTokens, 0, true);
  await jobs.updateOne({ _id: job._id }, { $set: { status: 'collected', collected_at: new Date(), counts, billed_tokens: billedTokens, actual_usd: +actualUsd.toFixed(4) } });
  report.collected++;
  report.written += counts.written;
  report.changed += counts.changed;
  report.failedRequests += counts.failedRequests;
  console.log(`  ${job._id}: collected — ${counts.written.toLocaleString()} rows, ${counts.changed} changed since submit, ${counts.failedRequests} failed requests, ${counts.missing} pages gone; ${billedTokens.toLocaleString()} tokens ≈ $${actualUsd.toFixed(4)} (est $${(job.est_usd || 0).toFixed(4)})`);
}

// Legacy mark: max(updated_at) over every writer's rows. Used ONCE, to seed the
// worker-owned watermark when none exists yet; never as the selection rule
// (#5869 — other writers advance it past pages this worker never read).
async function getLegacySyncTime() {
  const { data } = await supabase
    .from('page_translations')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  return data?.[0]?.updated_at ? new Date(data[0].updated_at) : null;
}

// ── Main ─────────────────────────────────────────────────────────────

const start = Date.now();
console.log(`Embedding model: ${MODEL} (${DIMS} dims)`);
console.log(`Mode: ${FULL_MODE ? 'full' : RESTALE ? 'restale' : MISSING_ONLY ? 'missing-only' : PAGES_FILE ? 'pages-file ' + PAGES_FILE : BOOKS_FILE ? 'books-file ' + BOOKS_FILE : BOOK_ID ? 'book ' + BOOK_ID : 'incremental'}${WORKER_COUNT > 1 ? ` (worker ${WORKER_ID}/${WORKER_COUNT})` : ''}`);

/** Books the open scope envelope allows, when the global dial is closed (#4865). */
let ENVELOPE_IDS = null;
/** The worker-owned incremental watermark this run selected from (#5869). */
let incrementalMark = null;
const RUN_STARTED_AT = new Date();

const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

// Collecting finished Batch jobs is free — it runs whatever the dial says.
if (COLLECT_MODE) {
  await collectEmbedJobs();
  await mongoClient.close();
  process.exit(0);
}

// Pause + dial gate (#3826). This worker had NEITHER check — the reason its
// cron line is hard-disabled (#PAUSED-3826#). Unattended runs (no explicit
// --book) must honor the pause flag and the daily budget; an explicit
// operator --book run bypasses, matching the spend-guard convention.
{
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!BOOK_ID) {
    if (control?.paused) {
      console.log('[embed-gemini] Pipeline paused — exiting.');
      await mongoClient.close();
      process.exit(0);
    }
    // Scoped guard (#4540/#4865). With the unscoped one this worker could only
    // see the global daily dial, so every 4-hourly run was refused once OCR and
    // translation had spent it — which is daily. Measured 2026-09-15: four
    // consecutive runs logged "CEILING REACHED" ($11.75, $25.23, $29.60,
    // $36.67 against $5) while 23,200 live books held OCR text and no vector.
    // An embeddings envelope could not fund it because the envelope lane was
    // unreachable from here.
    const gate = await budgetAllowsDispatchScoped(db, 'embed-gemini', { control });
    if (!gate.allowed) {
      await mongoClient.close();
      process.exit(0);
    }
    if (gate.envelopeIds) {
      // Confine the run to the envelope's books, as enrich-worker does. Applied
      // after the mode branches below have chosen their book set, so it narrows
      // whatever they picked rather than replacing it.
      ENVELOPE_IDS = gate.envelopeIds;
      console.log(`[embed-gemini] Global dial closed, scope envelope open — confining to ${ENVELOPE_IDS.size} envelope book(s).`);
    }
  }
}

// Nothing to submit into: skip the stream (and the skip-set load) entirely.
if (BATCH_MODE && !DRY_RUN && await atMaxRunning()) {
  await mongoClient.close();
  process.exit(3);
}

// Build query — need pages with OCR or translation.
// page_number > 0 skips hidden/deduped trailing pages (page_number ≤ 0).
const pageQuery = {
  page_number: { $gt: 0 },
  $or: [
    { 'ocr.data': { $exists: true, $type: 'string' } },
    { 'translation.data': { $exists: true, $type: 'string' } },
  ],
};

if (BOOK_ID) {
  pageQuery.book_id = BOOK_ID;
  console.log(`Processing book: ${BOOK_ID}`);
} else if (MISSING_ONLY) {
  // Fetch (book_id, page_id) pairs where embedding IS NULL via direct PG.
  // We limit MongoDB by book_id ($in) to keep the stream small, then filter
  // in JS by page_id so we ONLY embed pages that actually need it — not all
  // pages of any book that has at least one missing embedding.
  console.log('Fetching page_ids with missing embeddings via direct PG...');
  const pg = await getPgClient();
  if (!pg) {
    console.error('SUPABASE_DB_URL required for --missing-only (REST pagination is too slow on 4M rows)');
    process.exit(1);
  }
  const { rows } = await pg.query(
    'SELECT book_id, page_id FROM page_translations WHERE embedding IS NULL'
  );
  if (rows.length === 0) {
    console.log('No pages with missing embeddings found. All caught up.');
    await mongoClient.close();
    process.exit(0);
  }
  // Partition books across workers when parallelizing. Each worker owns a
  // disjoint slice of book_ids — no coordination needed at runtime.
  const allBookIds = [...new Set(rows.map(r => r.book_id))].sort();
  let myBookIds = allBookIds;
  if (WORKER_COUNT > 1) {
    myBookIds = allBookIds.filter((_, i) => i % WORKER_COUNT === WORKER_ID);
    console.log(`Worker ${WORKER_ID}/${WORKER_COUNT}: ${myBookIds.length.toLocaleString()}/${allBookIds.length.toLocaleString()} books`);
  }
  const myBookSet = new Set(myBookIds);
  const myRows = rows.filter(r => myBookSet.has(r.book_id));
  globalThis.MISSING_PAGE_IDS = new Set(myRows.map(r => r.page_id));
  pageQuery.book_id = { $in: myBookIds };
  console.log(`Processing ${myRows.length.toLocaleString()} missing pages across ${myBookIds.length.toLocaleString()} books`);
} else if (PAGES_FILE) {
  const ids = JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8')).map(String);
  if (!ids.length) { console.error(`--pages-file ${PAGES_FILE} is empty`); process.exit(1); }
  const owners = await db.collection('pages').find({ id: { $in: ids } }, { projection: { book_id: 1 } }).toArray();
  const bookIds = [...new Set(owners.map(p => String(p.book_id)))];
  // Every listed page is re-embedded, row or no row. Only pages already in an
  // uncollected Batch job are skipped, so a re-run resumes rather than pays twice.
  const skip = new Set();
  if (BATCH_MODE) {
    const inflight = db.collection(EMBED_JOBS).find(
      { page_ids: { $in: ids }, $or: [{ status: { $in: ['submitted', 'collecting'] } }, { status: 'creating', created_at: { $gt: new Date(Date.now() - 3600e3) } }] },
      { projection: { page_ids: 1 } },
    );
    for await (const j of inflight) for (const id of j.page_ids || []) skip.add(id);
  }
  globalThis.SKIP_PAGE_IDS = skip;
  pageQuery.id = { $in: ids };
  pageQuery.book_id = { $in: bookIds };
  console.log(`${ids.length.toLocaleString()} listed pages across ${bookIds.length.toLocaleString()} books; ${skip.size} already in an uncollected Batch job.`);
} else if (BOOKS_FILE) {
  let targetIds = JSON.parse(fs.readFileSync(BOOKS_FILE, 'utf8'));
  if (!Array.isArray(targetIds) || !targetIds.length) {
    console.error(`--books-file ${BOOKS_FILE} is empty or not a JSON array`);
    process.exit(1);
  }
  // Partition across workers, exactly as --missing-only does above.
  //
  // This branch accepted --worker-id/--worker-count and IGNORED them: it printed
  // "(worker 3/8)" in the mode line and then loaded the whole list anyway. Eight
  // shards launched against one books-file on 2026-08-07 each embedded the same
  // ~900k pages — the upserts are idempotent so no data was harmed, but it was
  // 8x the API calls and it started drawing 429s. The tell was that all eight
  // logs reported byte-identical progress counters, which independent shards
  // cannot do.
  if (WORKER_COUNT > 1) {
    const all = [...targetIds].sort();
    targetIds = all.filter((_, i) => i % WORKER_COUNT === WORKER_ID);
    console.log(`Worker ${WORKER_ID}/${WORKER_COUNT}: ${targetIds.length.toLocaleString()}/${all.length.toLocaleString()} books`);
  }
  // Fetch page_ids already embedded for these books (REST, chunked) so we skip
  // them in the loop and only embed the not-yet-present pages.
  console.log(`Loading ${targetIds.length.toLocaleString()} target books; finding already-embedded pages...`);
  const existing = new Set();
  for (let i = 0; i < targetIds.length; i += 200) {
    const chunk = targetIds.slice(i, i + 200);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('page_translations').select('page_id')
        .in('book_id', chunk).range(from, from + 999);
      if (error) { console.error('Supabase select error:', error.message); process.exit(1); }
      for (const r of (data || [])) existing.add(r.page_id);
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  if (BATCH_MODE) {
    // Pages already in a Batch job that has not been collected yet: skip them,
    // so a re-run resumes instead of paying twice. A job stuck in 'creating'
    // for over an hour never reached Gemini; its pages are fair game again.
    const inflight = db.collection(EMBED_JOBS).find(
      { book_ids: { $in: targetIds }, $or: [{ status: { $in: ['submitted', 'collecting'] } }, { status: 'creating', created_at: { $gt: new Date(Date.now() - 3600e3) } }] },
      { projection: { page_ids: 1 } },
    );
    let n = 0;
    for await (const j of inflight) for (const id of j.page_ids || []) { existing.add(id); n++; }
    console.log(`${n.toLocaleString()} pages are in uncollected Batch jobs — skipping those too.`);
  }
  globalThis.SKIP_PAGE_IDS = existing;
  pageQuery.book_id = { $in: targetIds };
  // Keep the base $or (OCR OR translation text). This used to narrow the stream
  // to `translation.data: {$exists: false}`, which made a translated page with
  // no row unreachable from every mode (#5869). The skip-set does the
  // "no row yet" filtering; the cost is streaming already-embedded pages over
  // the wire to discard them, which is Mongo egress, not Gemini spend.
  if (TRANSLATED_ONLY) {
    delete pageQuery.$or;
    pageQuery['translation.data'] = { $exists: true, $type: 'string' };
  }
  console.log(`${existing.size.toLocaleString()} pages already embedded — streaming every ${TRANSLATED_ONLY ? 'translated ' : ''}page with text, skipping those.`);
} else if (RESTALE) {
  // Find rows whose Mongo source has moved past the Supabase mongo_updated_at
  // watermark — re-OCR or re-translation in Mongo without a re-embed. The
  // scan is per-book to keep the working set small.
  const pg = await getPgClient();
  if (!pg) {
    console.error('SUPABASE_DB_URL required for --restale (per-book scans need many round-trips)');
    process.exit(1);
  }

  console.log('Scanning for stale rows (Mongo updated_at > Supabase mongo_updated_at)...');
  const { rows: bookRows } = await pg.query(`SELECT DISTINCT book_id FROM page_translations ORDER BY book_id`);
  let allBookIds = bookRows.map(r => r.book_id);
  if (WORKER_COUNT > 1) {
    allBookIds = allBookIds.filter((_, i) => i % WORKER_COUNT === WORKER_ID);
    console.log(`Worker ${WORKER_ID}/${WORKER_COUNT}: scanning ${allBookIds.length.toLocaleString()} books`);
  }

  const stalePageIds = new Set();
  const staleBookIds = new Set();
  let scannedBooks = 0;
  for (const bookId of allBookIds) {
    const { rows: ptRows } = await pg.query(
      `SELECT page_id, mongo_updated_at FROM page_translations WHERE book_id = $1`,
      [bookId],
    );
    if (ptRows.length === 0) continue;

    const watermarks = new Map(ptRows.map(r => [r.page_id, r.mongo_updated_at]));

    const mongoPages = await db.collection('pages')
      .find({ book_id: bookId })
      .project({ _id: 1, 'translation.updated_at': 1, 'ocr.updated_at': 1, updated_at: 1 })
      .toArray();

    for (const p of mongoPages) {
      const pageId = String(p._id);
      if (!watermarks.has(pageId)) continue; // not in Supabase yet (--missing-only's job)
      const mongoTs = p.translation?.updated_at || p.ocr?.updated_at || p.updated_at;
      if (!mongoTs) continue;
      const watermark = watermarks.get(pageId);
      if (!watermark || new Date(mongoTs).getTime() > new Date(watermark).getTime()) {
        stalePageIds.add(pageId);
        staleBookIds.add(bookId);
      }
    }

    scannedBooks++;
    if (scannedBooks % 100 === 0) {
      console.log(`  scanned ${scannedBooks}/${allBookIds.length} books — ${stalePageIds.size} stale pages found`);
    }
  }

  if (stalePageIds.size === 0) {
    console.log('No stale rows found. All caught up.');
    await mongoClient.close();
    process.exit(0);
  }

  console.log(`Found ${stalePageIds.size.toLocaleString()} stale pages across ${staleBookIds.size.toLocaleString()} books`);
  globalThis.MISSING_PAGE_IDS = stalePageIds; // reuse the same per-page gate as --missing-only
  pageQuery.book_id = { $in: [...staleBookIds] };
} else if (!FULL_MODE) {
  incrementalMark = await readWatermark(db);
  if (!incrementalMark) {
    // First run under the worker-owned mark: seed it from the legacy value so
    // the cron does not fall through to a ~$180 full pass. Pages already behind
    // the legacy mark are the #5869 backfill's job, not this run's.
    incrementalMark = await getLegacySyncTime();
    if (!incrementalMark) {
      console.error('No watermark and no legacy mark — refusing an implicit full pass. Run --full deliberately.');
      await mongoClient.close();
      process.exit(1);
    }
    await writeWatermark(db, incrementalMark, 'embed-gemini: seed worker-owned watermark from legacy max(updated_at) (#5869)');
    console.log(`Seeded watermark from legacy mark: ${incrementalMark.toISOString()}`);
  }
  pageQuery.$and = [
    pageQuery.$or ? { $or: pageQuery.$or } : {},
    incrementalSourceFilter(incrementalMark),
  ];
  delete pageQuery.$or;
  console.log(`Incremental from worker watermark: ${incrementalMark.toISOString()}`);
}

// Narrow whatever the mode branch selected to the envelope's books (#4865).
// Runs AFTER the branches so it intersects their choice instead of replacing
// it: an envelope is a confinement, never a widening.
if (ENVELOPE_IDS) {
  const existing = pageQuery.book_id;
  if (existing && typeof existing === 'string') {
    if (!ENVELOPE_IDS.has(existing)) {
      console.log(`[embed-gemini] Book ${existing} is not in an open envelope — nothing to do.`);
      await mongoClient.close();
      process.exit(0);
    }
  } else if (existing && Array.isArray(existing.$in)) {
    const narrowed = existing.$in.filter((id) => ENVELOPE_IDS.has(id));
    console.log(`[embed-gemini] Envelope narrows ${existing.$in.length.toLocaleString()} → ${narrowed.length.toLocaleString()} books.`);
    if (narrowed.length === 0) {
      await mongoClient.close();
      process.exit(0);
    }
    pageQuery.book_id = { $in: narrowed };
  } else {
    pageQuery.book_id = { $in: [...ENVELOPE_IDS] };
    console.log(`[embed-gemini] Envelope scope applied: ${ENVELOPE_IDS.size.toLocaleString()} books.`);
  }
}

if (DRY_RUN) {
  if (BOOK_ID) {
    const count = await db.collection('pages').countDocuments(pageQuery);
    console.log(`Would process ${count.toLocaleString()} pages`);
  } else {
    console.log('Counting skipped (too slow on full collection). Use --book ID to count.');
  }
  await mongoClient.close();
  process.exit(0);
}


// Watermark bookkeeping (#5869). Anything that confines the book set makes the
// run "scoped": it may read new pages, but it cannot vouch for the pages it
// did not look at, so it must not move the mark.
const INCREMENTAL = !FULL_MODE && !RESTALE && !MISSING_ONLY && !BOOKS_FILE && !PAGES_FILE && !BOOK_ID;
const RUN_SCOPED = Boolean(ENVELOPE_IDS) || WORKER_COUNT > 1;
let maxReadTs = null;

// Stream pages
const cursor = db.collection('pages')
  .find(pageQuery)
  .project(PAGE_PROJECTION)
  .batchSize(EMBED_BATCH_SIZE * 2);

let processed = 0;
let embedded = 0;
let skipped = 0;
let errors = 0;
let batch = [];
let consecutiveFailures = 0;
let supabaseBackoff = 0;

let hitLimit = false;
for await (const page of cursor) {
  if (LIMIT && processed >= LIMIT) { hitLimit = true; break; }
  const ts = pageSourceTs(page);
  if (ts && (!maxReadTs || ts > maxReadTs)) maxReadTs = ts;

  // In --missing-only / --restale modes, only embed pages identified by the
  // pre-scan (missing embedding, or Mongo newer than Supabase watermark).
  // The MongoDB query is scoped to candidate books but most of their pages
  // are fine — skip the ones not in the set.
  if ((MISSING_ONLY || RESTALE) && !globalThis.MISSING_PAGE_IDS.has(page.id)) {
    skipped++;
    processed++;
    continue;
  }
  // --books-file: skip pages already in page_translations; embed only the rest.
  if ((BOOKS_FILE || PAGES_FILE) && globalThis.SKIP_PAGE_IDS.has(page.id)) {
    skipped++;
    processed++;
    continue;
  }

  // Skip pages with no usable text
  const composed = composeEmbedText(page);
  if (!composed) {
    skipped++;
    processed++;
    continue;
  }

  const book = await getBook(page.book_id);
  const item = { page, book, ...composed };

  if (BATCH_MODE) {
    await addToEmbedJob(item);
    if (batchStop) break;
  } else {
    batch.push(item);
    if (batch.length >= EMBED_BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
    }
  }

  processed++;
  if (processed % 500 === 0) {
    const elapsed = (Date.now() - start) / 1000;
    const rate = (embedded / elapsed).toFixed(1);
    console.log(`  ${processed.toLocaleString()} processed — ${embedded.toLocaleString()} embedded — ${skipped} skipped — ${rate}/sec — ${errors} errors`);
  }
}

if (batch.length > 0) await processBatch(batch);
if (BATCH_MODE) await submitEmbedJob();

// Record the tail. Without this, everything since the last flush is spend that
// happened and was never written down — the exact hole #4162 is about.
await flushEmbedUsage(true);

if (INCREMENTAL && !DRY_RUN) {
  const next = nextWatermark({
    prior: incrementalMark,
    maxReadTs,
    startedAt: RUN_STARTED_AT,
    scoped: RUN_SCOPED,
    limited: hitLimit,
    errors,
  });
  if (next) {
    await writeWatermark(db, next, `embed-gemini --incremental: unscoped clean run, ${embedded} embedded (#5869)`);
    console.log(`Watermark advanced: ${incrementalMark?.toISOString() ?? '(none)'} → ${next.toISOString()}`);
  } else {
    console.log(`Watermark held at ${incrementalMark?.toISOString() ?? '(none)'} (scoped=${RUN_SCOPED} limited=${hitLimit} errors=${errors}).`);
  }
}

await mongoClient.close();
if (pgClient) await pgClient.end();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nDone: ${embedded.toLocaleString()} embedded, ${skipped} skipped, ${errors} errors, ${elapsed}s`);
console.log(`Embedding spend recorded: ~$${estimateUsd(usageTotalChars).toFixed(2)} across ${usageRows} gemini_usage row(s) (estimated from characters — see scripts/lib/embedding-usage.mjs)`);
if (BATCH_MODE) {
  const pages = batchSubmitted.reduce((t, j) => t + j.pages, 0);
  const usd = batchSubmitted.reduce((t, j) => t + j.estUsd, 0);
  console.log(`Batch: ${batchSubmitted.length} job(s) submitted, ${pages.toLocaleString()} pages, est $${usd.toFixed(4)}${batchStop ? ` — stopped early: ${batchStop}` : ''}. Collect with --collect.`);
  if (batchStop === 'quota' || batchStop === 'busy') process.exit(3);
  if (batchStop === 'error') process.exit(1);
}

// After a large full backfill, rebuild the HNSW index if it's missing
if (FULL_MODE && embedded > 10000) {
  await rebuildHnswIndex();
}

// ── HNSW index rebuild ──────────────────────────────────────────────

async function rebuildHnswIndex() {
  const pgUrl = SUPABASE_DB_URL;
  if (!pgUrl) {
    console.log('\nSUPABASE_DB_URL not set — skipping HNSW index rebuild.');
    console.log('Run manually: CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);');
    return;
  }

  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();

    // Check if index already exists
    const { rows } = await client.query(
      "SELECT 1 FROM pg_indexes WHERE tablename = 'page_translations' AND indexname = 'idx_pt_embedding'"
    );

    if (rows.length > 0) {
      console.log('\nHNSW index already exists — skipping rebuild.');
      await client.end();
      return;
    }

    console.log('\nRebuilding HNSW index (this may take hours for millions of vectors)...');
    // Set a long statement timeout for index creation
    await client.query('SET statement_timeout = 0');
    await client.query(
      'CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)'
    );
    console.log('HNSW index rebuilt successfully.');
    await client.end();
  } catch (e) {
    console.error('HNSW index rebuild failed:', e.message);
    console.log('Run manually: CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);');
  }
}

// ── Supabase write (PG direct or REST fallback) ─────────────────────

async function upsertToSupabase(rows) {
  const client = await getPgClient();

  if (client) {
    // Direct PG: upsert with parameterized query, one row at a time
    // (pg doesn't support multi-row upsert with vector columns easily)
    for (const row of rows) {
      await client.query(
        `INSERT INTO page_translations (page_id, book_id, page_number, translation, embedding, book_title, book_author, book_language, book_year, updated_at, embedding_model, mongo_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (page_id) DO UPDATE SET
           book_id = EXCLUDED.book_id,
           page_number = EXCLUDED.page_number,
           translation = EXCLUDED.translation,
           embedding = EXCLUDED.embedding,
           book_title = EXCLUDED.book_title,
           book_author = EXCLUDED.book_author,
           book_language = EXCLUDED.book_language,
           book_year = EXCLUDED.book_year,
           updated_at = EXCLUDED.updated_at,
           embedding_model = EXCLUDED.embedding_model,
           mongo_updated_at = EXCLUDED.mongo_updated_at`,
        [
          row.page_id, row.book_id, row.page_number,
          row.translation, row.embedding,
          row.book_title, row.book_author, row.book_language, row.book_year,
          row.updated_at,
          row.embedding_model, row.mongo_updated_at,
        ]
      );
    }
    return;
  }

  // REST API fallback: small batches to avoid timeout
  const { error } = await supabase
    .from('page_translations')
    .upsert(rows, { onConflict: 'page_id' });

  if (error) throw new Error(error.message);
}

// ── Batch processor ──────────────────────────────────────────────────

async function processBatch(items) {
  try {
    const embeddings = await embedBatch(items);

    // Shared row builder — see the import note above.
    const rows = items.map((item, i) => buildPageEmbeddingRow({
      page: item.page,
      book: item.book,
      text: item.text,
      hasTranslation: item.hasTranslation,
      embedding: embeddings[i],
      model: embeddings.model,
    }));

    // Upsert in small sub-batches to avoid overwhelming Supabase
    let batchErrors = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
      try {
        await upsertToSupabase(chunk);
        consecutiveFailures = 0;
        supabaseBackoff = 0;
      } catch (e) {
        consecutiveFailures++;
        batchErrors += chunk.length;
        console.error(`  Supabase upsert error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);

        // Exponential backoff on Supabase errors
        supabaseBackoff = Math.min(SUPABASE_BACKOFF_BASE * Math.pow(2, consecutiveFailures - 1), 120000);
        console.log(`  Backing off ${(supabaseBackoff / 1000).toFixed(0)}s...`);
        await sleep(supabaseBackoff);

        // Circuit breaker: abort if Supabase is consistently failing
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`\nABORTING: ${MAX_CONSECUTIVE_FAILURES} consecutive Supabase failures — Supabase is overloaded.`);
          console.error('Fix the issue and re-run. Remaining pages will be picked up on next incremental run.');
          await mongoClient.close();
          if (pgClient) await pgClient.end();
          process.exit(1);
        }

        // Reconnect PG client on failure (connection may have dropped)
        if (pgClient) {
          try { await pgClient.end(); } catch {}
          pgClient = null;
        }
        continue;
      }
    }

    errors += batchErrors;
    embedded += items.length - batchErrors;
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED')) {
      console.log('  Gemini rate limited — waiting 10s...');
      await sleep(10000);
      return processBatch(items); // Retry
    }
    errors += items.length;
  }
}
