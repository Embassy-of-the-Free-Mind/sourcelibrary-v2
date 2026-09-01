#!/usr/bin/env node
/**
 * Hetzner Inline Enrichment Worker
 *
 * Generates summary+index and extracts chapters directly via Gemini API.
 * No Vercel route dependency — eliminates Cloudflare blocking issue.
 *
 * Architecture:
 * - Phase 6: Summary + Index (translate_complete -> summary_indexed)
 *   Batch-extracts themes/quotes/people/places/concepts per page batch,
 *   then synthesizes into a book summary. Writes book.index, book.summary,
 *   book.reading_summary.
 *
 * - Phase 7: Chapter Extraction (summary_indexed -> chapters_complete)
 *   Detects chapter headings from OCR+translation text, calls Gemini
 *   to structure them. Writes book.chapters.
 *
 * - Phase 7.5: Quality Scoring (any book with summary but no quality_score)
 *   AI-powered 4-dimension scoring (historical significance, visual appeal,
 *   accessibility, scholarly value) plus mechanical adjustments. Writes
 *   book.quality_score and book.quality_assessment.
 *
 * - Phase 7.6: Collection Assignment (books with summary/description but no collection_scores)
 *   Classifies books into thematic collections using Gemini Flash Lite. Additive writes
 *   only — never removes existing collection assignments. Writes book.collections,
 *   book.collection_relevance, and book.collection_scores marker.
 *
 * Runs standalone via cron or called from the orchestrator.
 *
 * CLI flags:
 *   --phase=6|7|all    Which phase to run (default: all)
 *   --limit=N          Max books per phase (default: 30 for phase 6, 50 for phase 7)
 *   --dry-run          Print what would be done, don't modify
 *   --book=ID          Process a single book (for debugging)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logUsage as logUsageToSupabase } from './lib/supabase-usage-logger.mjs';
import { createBookRevisions } from './lib/book-revisions.mjs';
import { buildSummaryPrompt, SUMMARY_GEN_CONFIG } from './lib/summary-prompt.mjs';
import { createClient } from '@supabase/supabase-js';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { buildPageTexts, attributeEntityPages, entityCounters } from '../lib/entity-page-match.mjs';
import { composeBookEmbeddingText } from '../lib/book-embedding-text.mjs';
import { embedBookPages } from '../lib/embed-book-pages.mjs';
import { computeEndPages } from '../lib/chapter-endpages.mjs';
import pg from 'pg';

// Selective-unpause scope confinement, set in main() after the pause check.
// Empty {} in normal operation so the full enrich queue is unaffected.
let SCOPE_FILTER = {};

/** Trigger on-demand revalidation for a book page after enrichment completes. */
async function revalidateBookPage(bookId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.REVALIDATE_SECRET) headers['x-revalidate-secret'] = process.env.REVALIDATE_SECRET;
    await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers });
  } catch { /* best-effort */ }
}

// ── Config ──
const MONGODB_URI = process.env.MONGODB_URI;
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const LITE_MODEL = 'gemini-3.1-flash-lite';
const TARGET_BATCH_CHARS = 50000;
const MAX_RETRIES = 3;

// Model pricing per 1M tokens (USD)
const MODEL_PRICING = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.30 },
  'default': { input: 0.10, output: 0.40 },
};

// ── CLI args ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] || 'all';
const RUN_PHASE_6 = phaseArg === 'all' || phaseArg === '6';
const RUN_PHASE_7 = phaseArg === 'all' || phaseArg === '7';
const RUN_PHASE_7_5 = phaseArg === 'all' || phaseArg === '7.5';
const RUN_PHASE_7_6 = phaseArg === 'all' || phaseArg === '7.6';
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const PHASE_6_LIMIT = limitArg ? parseInt(limitArg) : 30;
const PHASE_7_LIMIT = limitArg ? parseInt(limitArg) : 30;
const BOOK_CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY || '8');
const MAX_BATCH_CONCURRENCY = 20; // Cap parallel Gemini calls per book (prevents 100+ simultaneous calls for huge books)
const SINGLE_BOOK = args.find(a => a.startsWith('--book='))?.split('=')[1];
const MAX_RUNTIME_MS = 90 * 60 * 1000; // 90 min hard cap — prevents 12h runs blocking the scheduler
const PHASE_7_BOOK_TIMEOUT_MS = 5 * 60 * 1000;  // 5 min per book for chapter extraction
const PHASE_7_5_BOOK_TIMEOUT_MS = 2 * 60 * 1000; // 2 min per book for quality scoring (one Gemini call)
const PHASE_7_6_BATCH_TIMEOUT_MS = 3 * 60 * 1000; // 3 min per collection-assignment batch
const PROCESS_START = Date.now();
const PER_BOOK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per book max

// ── Gemini API keys ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('[ENRICH] No Gemini API keys configured');
  process.exit(1);
}

let currentKeyIndex = 0;
function getClient() {
  return new GoogleGenerativeAI(API_KEYS[currentKeyIndex % API_KEYS.length]);
}
function rotateKey() {
  currentKeyIndex++;
  console.log(`[ENRICH] Rotated to API key ${(currentKeyIndex % API_KEYS.length) + 1}/${API_KEYS.length}`);
}

// ── Utility ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Per-call timeouts for Gemini. The Google SDK has no built-in request
// timeout, so a stuck `generateContent()` would otherwise hang until the
// whole-book 20-minute Promise.race finally trips — which used to cause
// large books (900+ pages) to time out on a single bad call and waste the
// remaining ~19 minutes of budget. Wrapping each call here means a single
// slow call costs at most `ms` (one retry doubles the worst case).
async function withTimeout(promise, ms, label) {
  let to;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        to = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(to);
  }
}

const PER_BATCH_CALL_MS = 90 * 1000;        // 90s per processBatch Gemini call
const PER_SUMMARY_CALL_MS = 3 * 60 * 1000;  // 3 min for the final book-summary call

function computeCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

async function logUsage(db, params) {
  await logUsageToSupabase({
    ...params,
    cost_usd: computeCost(params.model, params.input_tokens, params.output_tokens),
  }, db);
}

// ── Pipeline status helpers ──
async function setPipelineStatus(db, bookId, status, extra = {}) {
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { 'pipeline_auto.status': status, 'pipeline_auto.updated_at': new Date(), updated_at: new Date(), ...extra } },
  );
}

async function markFailed(db, bookId, reason, retries) {
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        'pipeline_auto.status': 'failed',
        'pipeline_auto.failure_reason': reason,
        'pipeline_auto.retry_count': retries,
        'pipeline_auto.updated_at': new Date(),
        updated_at: new Date(),
      },
    },
  );
}

// ── Book embedding upsert (issue #1158) ──
// After generating book_indexes, compose + embed + upsert to Supabase book_embeddings.
// Non-blocking: failures are logged but don't fail enrichment.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseClient = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;

const EMBED_MODEL = 'gemini-embedding-2-preview';
const EMBED_DIMS = 768;

/**
 * Page-level vectors, written as part of enrichment.
 *
 * These used to come ONLY from the `embed-gemini.mjs` cron. On 2026-08-07 that
 * cron was found commented out behind a `#PAUSED-GEMINI` marker with an empty
 * log dated June 9 — and the measured consequence was 2,462 live books with
 * zero page vectors plus 4,420 under 90%, i.e. semantic search blind on roughly
 * 45% of the corpus. Nothing alerted, because an unembedded book and a book
 * with no match return the same empty list.
 *
 * A step outside the pipeline can be switched off without anything noticing.
 * Inside it, a book that finishes enrichment is searchable by meaning. The cron
 * still exists for bulk backfill and for books enriched before this landed.
 *
 * Non-blocking, exactly like upsertBookEmbedding: a Supabase or Gemini hiccup
 * must not fail an enrichment run that has already done the expensive work.
 */
let pagePgPool = null;
function getPagePgPool() {
  const url = (process.env.SUPABASE_DB_URL || '').trim();
  if (!url) return null;
  if (!pagePgPool) pagePgPool = new pg.Pool({ connectionString: url, max: 2 });
  return pagePgPool;
}

async function upsertPageEmbeddings(db, book) {
  const pool = getPagePgPool();
  if (!pool) return;  // no direct PG configured — the cron still covers this book
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || API_KEYS[0];
  if (!apiKey) return;

  const client = await pool.connect();
  try {
    const res = await embedBookPages({ db, pg: client, book, apiKey });
    if (res.embedded > 0) {
      console.log(`    [embed] ${res.embedded} page vectors written (${res.alreadyPresent} already present, ${res.skipped} blank)`);
    }
  } finally {
    client.release();
  }
}


async function upsertBookEmbedding(book, indexData) {
  if (!supabaseClient) return;

  // Prefer paid Tier 3 for content-bearing embeddings (no training opt-in);
  // fall back to first available key. Cron explicitly exports TIER3 too —
  // this is belt-and-suspenders for ad-hoc / single-book runs.
  const geminiKey = process.env.GEMINI_API_KEY_TIER3 || API_KEYS[0];
  if (!geminiKey) return;

  const text = composeBookEmbeddingText(book, indexData);
  if (text.length < 10) return;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: EMBED_DIMS,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      console.warn(`    [embed] Gemini ${res.status} — skipping book embedding`);
      return;
    }

    const data = await res.json();
    const embedding = data?.embeddings?.[0]?.values;
    if (!embedding) return;

    const yearMatch = (book.published || '').match(/\d{3,4}/);
    const { error } = await supabaseClient.from('book_embeddings').upsert({
      book_id: book.id,
      title: book.display_title || book.title || '',
      author: book.author || '',
      year: yearMatch ? parseInt(yearMatch[0]) : null,
      language: book.language || null,
      summary_text: text,
      embedding: JSON.stringify(embedding),
      embedding_model: EMBED_MODEL,
      metadata: {
        has_index: true,
        categories: book.categories || [],
        quality_score: book.quality_score || null,
        entity_counts: {
          people: indexData?.people?.length || 0,
          places: indexData?.places?.length || 0,
          concepts: indexData?.concepts?.length || 0,
          terms: indexData?.entries?.length || 0,
        },
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'book_id' });

    if (error) {
      console.warn(`    [embed] Supabase upsert failed: ${error.message}`);
    } else {
      console.log(`    [embed] Book embedding upserted`);
    }
  } catch (err) {
    console.warn(`    [embed] Failed: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// Phase 6: Summary + Index
// Faithful port of src/app/api/books/[id]/index/route.ts
// ══════════════════════════════════════════════════════════════════════

// ── Wikipedia research ──
async function researchBook(title, author) {
  const searchResults = [];

  try {
    const authorQuery = encodeURIComponent(author);
    const authorRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${authorQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (authorRes.ok) {
      const data = await authorRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About the author (${author}):\n${data.extract}`);
      }
    }
  } catch (e) {
    // Wikipedia lookup failure is non-critical
  }

  try {
    const titleQuery = encodeURIComponent(title.replace(/[^\w\s]/g, ''));
    const titleRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${titleQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (titleRes.ok) {
      const data = await titleRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About "${title}":\n${data.extract}`);
      }
    }
  } catch (e) {
    // Wikipedia lookup failure is non-critical
  }

  return searchResults.join('\n\n');
}

// ── Batch extraction ──
async function processBatch(pages, bookTitle, bookAuthor, bookLanguage) {
  const model = getClient().getGenerativeModel({
    model: LITE_MODEL,
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
  });

  const pageRange = {
    start: pages[0].page_number,
    end: pages[pages.length - 1].page_number,
  };

  const batchContent = pages
    .filter(p => p.translation?.data)
    .map(p => {
      const cleanText = (p.translation?.data || '')
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      return `[Page ${p.page_number}]\n${cleanText}`;
    })
    .join('\n\n---\n\n');

  if (!batchContent.trim()) {
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage: null };
  }

  const prompt = `You are analyzing pages ${pageRange.start}-${pageRange.end} of "${bookTitle}" by ${bookAuthor}${bookLanguage ? ` (translated from ${bookLanguage})` : ''}.

## Pages to analyze:
${batchContent}

## Task
Extract structured information from these pages.

Output as JSON:
{
  "themes": ["Main theme 1", "Main theme 2"],
  "quotes": [
    {"text": "Copy the EXACT words from the text - a striking, memorable, or important sentence or passage", "page": 5, "context": "Brief note on why this quote matters"},
    {"text": "Another VERBATIM quote copied directly from the pages above", "page": 7, "context": "Its significance"}
  ],
  "people": ["Person Name 1", "Person Name 2"],
  "places": ["Place Name 1", "Place Name 2"],
  "concepts": ["Key concept 1", "Technical term 2"],
  "summary": "2-3 sentence summary of what these pages cover and their key arguments. No em-dashes. No filler like 'delves into' or 'rich tapestry'. Short, direct sentences."
}

CRITICAL for quotes:
- Copy EXACT text from the pages - do not paraphrase or summarize
- Find memorable, striking, or important passages readers would want to highlight
- Look for: bold claims, definitions, vivid descriptions, key arguments
- Include the page number where each quote appears
- 3-5 quotes per batch`;

  // One retry on timeout/transient error — the second call may rotate to a
  // healthier key after a 429. Without the per-call timeout, a hung call
  // would burn the entire 20-min per-book budget; with it, the worst case
  // for this batch is ~2 × PER_BATCH_CALL_MS.
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(
        model.generateContent(prompt),
        PER_BATCH_CALL_MS,
        `processBatch pages ${pageRange.start}-${pageRange.end}`,
      );
      const responseText = result.response.text();
      const usageMetadata = result.response.usageMetadata;
      const usage = {
        input_tokens: usageMetadata?.promptTokenCount || 0,
        output_tokens: usageMetadata?.candidatesTokenCount || 0,
      };

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        pageRange,
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
        people: Array.isArray(parsed.people) ? parsed.people : [],
        places: Array.isArray(parsed.places) ? parsed.places : [],
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        usage,
      };
    } catch (e) {
      lastErr = e;
      if (e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
        rotateKey();
      }
      if (attempt === 0) continue; // retry once
    }
  }
  console.error(`  Batch processing error (pages ${pageRange.start}-${pageRange.end}):`, lastErr?.message);
  return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '', usage: null };
}

// ── Batch creation ──
function createBatches(pages) {
  const translatedPages = pages.filter(p => p.translation?.data);
  if (translatedPages.length === 0) return [];

  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const page of translatedPages) {
    const pageSize = (page.translation?.data || '').length;
    if (currentSize + pageSize > TARGET_BATCH_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(page);
    currentSize += pageSize;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

function createBatchesFromChapters(chapterTexts, pages) {
  const pageMap = new Map();
  for (const p of pages) pageMap.set(p.page_number, p);

  const batches = [];
  for (const ct of chapterTexts) {
    const batch = [];
    for (let pn = ct.pageStart; pn <= ct.pageEnd; pn++) {
      const page = pageMap.get(pn);
      if (page && page.translation?.data) batch.push(page);
    }
    if (batch.length > 0) batches.push(batch);
  }
  return batches;
}

async function processAllBatches(pages, bookTitle, bookAuthor, bookLanguage, chapterTexts) {
  const pageBatches = chapterTexts && chapterTexts.length > 1
    ? createBatchesFromChapters(chapterTexts, pages)
    : createBatches(pages);
  if (pageBatches.length === 0) return [];

  const batchSource = chapterTexts && chapterTexts.length > 1 ? 'chapters' : 'char-count';
  console.log(`    Processing ${pageBatches.length} batches (${batchSource}), concurrency ${Math.min(pageBatches.length, MAX_BATCH_CONCURRENCY)}...`);

  // Process with capped concurrency to avoid 100+ simultaneous Gemini calls on huge books
  const results = [];
  for (let i = 0; i < pageBatches.length; i += MAX_BATCH_CONCURRENCY) {
    const chunk = pageBatches.slice(i, i + MAX_BATCH_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(batchPages => processBatch(batchPages, bookTitle, bookAuthor, bookLanguage))
    );
    results.push(...chunkResults);
  }
  return results;
}

// ── Concept index building ──
function extractTerms(text, tag) {
  const terms = [];
  const xmlTag = tag === 'vocabulary' ? 'vocab' : tag;
  const xmlPattern = new RegExp(`<${xmlTag}>([\\s\\S]*?)</${xmlTag}>`, 'gi');
  let match;
  while ((match = xmlPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }
  const bracketPattern = new RegExp(`\\[\\[${tag}:\\s*(.*?)\\]\\]`, 'gi');
  while ((match = bracketPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }
  return terms;
}

function buildConceptIndexFromBatches(batches, pages) {
  const peopleMap = new Map();
  const placesMap = new Map();
  const conceptsMap = new Map();

  // Gemini returns bare name lists per batch — it is never asked WHERE in the
  // batch each name occurs (only `quotes` carry a page). So the batch tells us
  // which entities are in a section, and the page text tells us where. Crediting
  // the whole batch range to every entity — the old behavior — fabricated page
  // citations on /encyclopedia/[name] (#3361). Attribute per verified page, and
  // fall back to a section range with NO page numbers when nothing matches.
  const pagesByNumber = new Map(pages.map(p => [p.page_number, p]));

  const accumulate = (map, term, batchPageTexts) => {
    if (!term) return;
    const attribution = attributeEntityPages(term, batchPageTexts);
    const prev = map.get(term);
    if (!prev) {
      map.set(term, attribution);
      return;
    }
    // Same entity in more than one batch: union verified pages; a section-only
    // batch never contributes page numbers, but widens the fallback range.
    const pages_ = [...new Set([...prev.pages, ...attribution.pages])].sort((a, b) => a - b);
    const ranges = [prev.page_range, attribution.page_range].filter(Boolean);
    const merged = { pages: pages_, page_precision: pages_.length > 0 ? 'page' : 'section' };
    if (merged.page_precision === 'section' && ranges.length > 0) {
      merged.page_range = {
        start: Math.min(...ranges.map(r => r.start)),
        end: Math.max(...ranges.map(r => r.end)),
      };
    }
    map.set(term, merged);
  };

  for (const batch of batches) {
    const batchPages = [];
    for (let n = batch.pageRange.start; n <= batch.pageRange.end; n++) {
      const p = pagesByNumber.get(n);
      if (p) batchPages.push(p);
    }
    const batchPageTexts = buildPageTexts(batchPages);

    for (const person of batch.people) accumulate(peopleMap, person, batchPageTexts);
    for (const place of batch.places) accumulate(placesMap, place, batchPageTexts);
    for (const concept of batch.concepts) accumulate(conceptsMap, concept, batchPageTexts);
  }

  // Vocabulary + keywords from page tags
  const vocabMap = new Map();
  const keywordMap = new Map();
  for (const page of pages) {
    const pageNum = page.page_number;
    if (page.ocr?.data) {
      for (const term of extractTerms(page.ocr.data, 'vocabulary')) {
        if (!vocabMap.has(term)) vocabMap.set(term, []);
        vocabMap.get(term).push(pageNum);
      }
    }
    if (page.translation?.data) {
      for (const term of extractTerms(page.translation.data, 'keywords')) {
        if (!keywordMap.has(term)) keywordMap.set(term, []);
        keywordMap.get(term).push(pageNum);
      }
    }
  }

  // vocabulary/keywords come straight from per-page tags, so their page numbers
  // were always page-exact — no verification needed.
  const mapToEntries = (map) =>
    Array.from(map.entries())
      .map(([term, pgs]) => ({ term, pages: [...new Set(pgs)].sort((a, b) => a - b), page_precision: 'page' }))
      .sort((a, b) => b.pages.length - a.pages.length);

  // people/places/concepts carry a verified attribution object.
  const attributionToEntries = (map) =>
    Array.from(map.entries())
      .map(([term, attribution]) => ({ term, ...attribution }))
      .sort((a, b) => b.pages.length - a.pages.length);

  return {
    vocabulary: mapToEntries(vocabMap),
    keywords: mapToEntries(keywordMap),
    people: attributionToEntries(peopleMap),
    places: attributionToEntries(placesMap),
    concepts: attributionToEntries(conceptsMap),
  };
}

// ── Page summaries ──
function extractSummary(text) {
  const xmlMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (xmlMatch) return xmlMatch[1].trim();
  const bracketMatch = text.match(/\[\[summary:\s*(.*?)\]\]/i);
  return bracketMatch ? bracketMatch[1].trim() : undefined;
}

function extractPageSummaries(pages) {
  const summaries = [];
  for (const page of pages) {
    const text = page.translation?.data || '';
    let summary = extractSummary(text) || page.summary?.data;
    if (!summary && text.length > 50) {
      let cleanText = text
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      const paragraphs = cleanText.split(/\n\n+/).filter(p => p.trim().length > 30);
      if (paragraphs.length > 0) {
        summary = paragraphs[0].trim();
        if (summary.length > 300) {
          summary = summary.substring(0, 300).replace(/\s+\S*$/, '') + '...';
        }
      }
    }
    if (summary) summaries.push({ page: page.page_number, summary });
  }
  return summaries;
}

// ── Book summary generation ──
async function generateBookSummary(batchExtractions, bookTitle, bookAuthor, bookLanguage, researchContext, chapters, englishTitle) {
  const model = getClient().getGenerativeModel({
    model: LITE_MODEL,
    generationConfig: SUMMARY_GEN_CONFIG,
  });

  if (batchExtractions.length === 0) {
    return {
      brief: researchContext ? `A text by ${bookAuthor}. ${researchContext.substring(0, 200)}...` : `A text by ${bookAuthor}. Process page translations to generate a detailed summary.`,
      abstract: researchContext || 'No page content available yet. Process translations to generate a summary based on the actual text.',
      detailed: researchContext || 'This book has not been processed yet. Generate OCR and translations for the pages, then regenerate this summary to see content-based analysis.',
      sections: [],
      usage: null,
    };
  }

  const allThemes = [...new Set(batchExtractions.flatMap(b => b.themes))];
  const allQuotes = batchExtractions.flatMap(b => b.quotes);
  const allPeople = [...new Set(batchExtractions.flatMap(b => b.people))];
  const allPlaces = [...new Set(batchExtractions.flatMap(b => b.places))];
  const allConcepts = [...new Set(batchExtractions.flatMap(b => b.concepts))];

  const batchSummariesText = batchExtractions
    .map(b => `Pages ${b.pageRange.start}-${b.pageRange.end}: ${b.summary}`)
    .join('\n');

  const quotesText = allQuotes.slice(0, 15)
    .map(q => `- "${q.text}" (p. ${q.page})${q.context ? ` — ${q.context}` : ''}`)
    .join('\n');

  const languageContext = bookLanguage ? ` The original text is in ${bookLanguage}.` : '';
  // Summaries are synthesized from the book's own content (section summaries,
  // themes, quotes, chapter structure) — NOT from a Wikipedia blob. Injecting
  // Wikipedia here caused mis-attributions framed as fact (e.g. a De Mysteriis
  // edition summarized as a "correspondence between Porphyry and Abammon", a
  // detail absent from the page text). This matches resynthesize-summaries.mjs,
  // which already passes researchSection:'' for the corpus rollout. researchContext
  // is still used as a placeholder for books with zero extractable content (below).
  const researchSection = '';
  const hasChapters = chapters && chapters.length > 0;
  const chapterSection = hasChapters ? `\n## Detected Chapter Structure\n${chapters.map(c => `- Page ${c.pageNumber}: ${c.title}`).join('\n')}\n` : '';

  const prompt = buildSummaryPrompt({
    bookTitle, englishTitle, bookAuthor, languageContext, researchSection, chapterSection,
    themes: allThemes, people: allPeople, places: allPlaces, concepts: allConcepts,
    sectionSummariesText: batchSummariesText, quotesText, hasChapters,
  });

  const result = await withTimeout(
    model.generateContent(prompt),
    PER_SUMMARY_CALL_MS,
    `generateBookSummary "${bookTitle.slice(0, 40)}"`,
  );
  const responseText = result.response.text();
  const usageMetadata = result.response.usageMetadata;
  const usage = {
    input_tokens: usageMetadata?.promptTokenCount || 0,
    output_tokens: usageMetadata?.candidatesTokenCount || 0,
  };

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse book summary JSON');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    // Try to fix common Gemini JSON issues: trailing commas, unescaped newlines
    const cleaned = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')           // trailing commas
      .replace(/[\x00-\x1f]/g, ' ');            // control characters
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`JSON parse failed: ${parseErr.message} — raw: ${jsonMatch[0].substring(0, 200)}`);
    }
  }

  const ensureString = (val) => {
    if (typeof val === 'string') return val;
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join('\n\n');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return {
    brief: ensureString(parsed.brief),
    abstract: ensureString(parsed.abstract),
    detailed: ensureString(parsed.detailed),
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    usage,
  };
}

// ── Quote grounding ──
function cleanTranslationText(text) {
  return text
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function cleanExtractedQuote(text) {
  return text
    .replace(/^>\s*/gm, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\*/g, '')
    .replace(/^\d{1,3}\s+/g, '')
    .replace(/\s+\d{1,3}\s*\*?\s*\*/g, '')
    .replace(/<\/?[a-z-]+\/?>/gi, '')
    .replace(/->/g, '')
    .replace(/<-/g, '')
    .replace(/^[IVX]+\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function snapToSentenceBoundaries(words, start, end) {
  const sentenceEnd = /[.!?]["'\u201d\u2019)]*$/;
  const maxExtend = 12;

  let newStart = start;
  let foundStart = false;
  for (let i = start - 1; i >= Math.max(0, start - maxExtend); i--) {
    if (sentenceEnd.test(words[i])) { newStart = i + 1; foundStart = true; break; }
  }
  if (!foundStart) {
    for (let i = start; i < Math.min(words.length, start + maxExtend); i++) {
      if (/^[A-Z\u201c\u201e"'(]/.test(words[i])) { newStart = i; break; }
    }
  }

  let newEnd = end;
  for (let i = end - 1; i < Math.min(words.length, end + maxExtend); i++) {
    if (sentenceEnd.test(words[i])) { newEnd = i + 1; break; }
  }

  return { start: newStart, end: newEnd };
}

function findBestMatch(quoteText, sourceText) {
  const quoteWords = quoteText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (quoteWords.length === 0) return null;

  const sourceWords = sourceText.split(/\s+/);
  if (sourceWords.length === 0) return null;

  const windowSize = Math.max(quoteWords.length, 5);
  const maxWindow = Math.min(windowSize + Math.ceil(windowSize * 0.5), sourceWords.length);

  let bestScore = 0, bestStart = 0, bestEnd = 0;

  for (let start = 0; start <= sourceWords.length - windowSize; start++) {
    for (let winSize = windowSize; winSize <= maxWindow && start + winSize <= sourceWords.length; winSize++) {
      const windowText = sourceWords.slice(start, start + winSize).join(' ').toLowerCase();
      const matchCount = quoteWords.filter(w => windowText.includes(w)).length;
      const score = matchCount / quoteWords.length;
      if (score > bestScore) { bestScore = score; bestStart = start; bestEnd = start + winSize; }
    }
  }

  if (bestScore < 0.8) return null;

  const snapped = snapToSentenceBoundaries(sourceWords, bestStart, bestEnd);
  let extractedText = sourceWords.slice(snapped.start, snapped.end).join(' ');
  extractedText = cleanExtractedQuote(extractedText);

  if (extractedText.length > 60 && !/[.!?]["'\u201d\u2019)]*$/.test(extractedText)) {
    const lastSentenceEnd = Math.max(extractedText.lastIndexOf('.'), extractedText.lastIndexOf('!'), extractedText.lastIndexOf('?'));
    if (lastSentenceEnd > extractedText.length * 0.4) {
      extractedText = extractedText.substring(0, lastSentenceEnd + 1);
    }
  }

  if (/^[a-z]/.test(extractedText)) {
    const firstSentenceStart = extractedText.search(/[.!?]\s+[A-Z]/);
    if (firstSentenceStart > 0 && firstSentenceStart < extractedText.length * 0.4) {
      extractedText = extractedText.substring(firstSentenceStart + 2).trim();
    }
  }

  if (extractedText.length < 30) return null;

  return { score: bestScore, extractedText };
}

const NON_CONTENT_PAGE_TYPES = new Set([
  'index', 'table_of_contents', 'title_page', 'blank_page', 'colophon', 'errata',
]);

function groundQuotes(quotes, pages) {
  const pageIndex = new Map();
  for (const page of pages) {
    if (page.translation?.data && !NON_CONTENT_PAGE_TYPES.has(page.page_type || '')) {
      pageIndex.set(page.page_number, {
        text: cleanTranslationText(page.translation.data),
        page_id: page.id,
      });
    }
  }

  const grounded = [];
  for (const quote of quotes) {
    if (!quote.text || quote.text.length < 30) continue;

    const specifiedPage = pageIndex.get(quote.page);
    if (specifiedPage) {
      const match = findBestMatch(quote.text, specifiedPage.text);
      if (match) {
        grounded.push({ text: match.extractedText, page: quote.page, page_id: specifiedPage.page_id, context: quote.context, significance: quote.significance });
        continue;
      }
    }

    let bestOverall = null;
    for (const [pageNum, pageData] of pageIndex) {
      if (pageNum === quote.page) continue;
      const match = findBestMatch(quote.text, pageData.text);
      if (match && (!bestOverall || match.score > bestOverall.score)) {
        bestOverall = { score: match.score, extractedText: match.extractedText, pageNum, pageId: pageData.page_id };
      }
    }

    if (bestOverall) {
      grounded.push({ text: bestOverall.extractedText, page: bestOverall.pageNum, page_id: bestOverall.pageId, context: quote.context, significance: quote.significance });
    }
  }

  return grounded;
}

// ── Entity sync ──
async function syncBookEntities(db, bookId, bookTitle, bookAuthor, conceptIndex, bookYear) {
  // Load alias resolver from entity_aliases collection
  const aliasDocs = await db.collection('entity_aliases')
    .find({})
    .project({ alias_lower: 1, canonical_name: 1, type: 1 })
    .toArray();

  const aliasMap = new Map();
  for (const doc of aliasDocs) {
    aliasMap.set(`${doc.type}:${doc.alias_lower}`, doc.canonical_name);
  }

  function resolve(name, type) {
    return aliasMap.get(`${type}:${name.toLowerCase()}`) || name;
  }

  const now = new Date();

  async function syncEntity(term, type, entry) {
    const canonicalName = resolve(term, type);
    const bookEntry = {
      book_id: bookId,
      book_title: bookTitle,
      book_author: bookAuthor,
      ...(bookYear ? { book_year: bookYear } : {}),
      pages: entry.pages || [],
      page_precision: entry.page_precision || 'section',
      ...(entry.page_range ? { page_range: entry.page_range } : {}),
    };

    // Replace this book's entry rather than adding one. `$addToSet` compares
    // whole subdocuments, so re-running the index with a different page list
    // appended a SECOND entry for the same book — Matthiolus accumulated 162
    // entries for 117 distinct books, and the page's hero count (books.length)
    // disagreed with its own deduped "Appears in N Books" heading (#3361).
    await db.collection('entities').updateOne(
      { name: canonicalName, type },
      {
        $set: { updated_at: now },
        $setOnInsert: { name: canonicalName, type, created_at: now },
        ...(term !== canonicalName ? { $addToSet: { aliases: term } } : {}),
      },
      { upsert: true }
    );
    await db.collection('entities').updateOne(
      { name: canonicalName, type },
      { $pull: { books: { book_id: bookId } } }
    );
    await db.collection('entities').updateOne(
      { name: canonicalName, type },
      { $push: { books: bookEntry } }
    );
  }

  const promises = [];
  for (const person of conceptIndex.people) {
    if (!person.term) continue;
    promises.push(syncEntity(person.term, 'person', person));
  }
  for (const place of conceptIndex.places) {
    if (!place.term) continue;
    promises.push(syncEntity(place.term, 'place', place));
  }
  for (const concept of conceptIndex.concepts) {
    if (!concept.term) continue;
    promises.push(syncEntity(concept.term, 'concept', concept));
  }
  await Promise.all(promises);

  // Update book_count + total_mentions
  const allTerms = [
    ...conceptIndex.people.filter(p => p.term).map(p => ({ name: resolve(p.term, 'person'), type: 'person' })),
    ...conceptIndex.places.filter(p => p.term).map(p => ({ name: resolve(p.term, 'place'), type: 'place' })),
    ...conceptIndex.concepts.filter(p => p.term).map(p => ({ name: resolve(p.term, 'concept'), type: 'concept' })),
  ];
  const uniqueTerms = [...new Map(allTerms.map(t => [`${t.type}:${t.name}`, t])).values()];

  for (const { name, type } of uniqueTerms) {
    const entity = await db.collection('entities').findOne({ name, type }, { projection: { books: 1 } });
    if (entity) {
      // book_count counts DISTINCT books and total_mentions counts VERIFIED page
      // references. Summing raw page-array lengths is how Matthiolus came to
      // advertise "10,700 total mentions" of smeared page slots (#3361).
      await db.collection('entities').updateOne(
        { name, type },
        { $set: entityCounters(entity.books) }
      );
    }
  }

  console.log(`    Synced ${promises.length} entities`);
}

// ── Main Phase 6 function ──
async function enrichBook(db, book) {
  const bookTitle = book.display_title || book.title;
  const bookAuthor = book.author || 'Unknown';
  const bookId = book.id;

  console.log(`  [Phase 6] ${bookTitle}`);

  // Get all pages
  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray();

  const translatedCount = pages.filter(p => p.translation?.data).length;
  console.log(`    ${translatedCount}/${pages.length} pages translated`);

  // Get chapters for section structure
  const chapters = (book.chapters || []).map(c => ({
    title: c.title,
    pageNumber: c.pageNumber,
    level: c.level || 1,
  }));

  // Fetch chapter texts for chapter-aligned batching
  const chapterTexts = await db.collection('chapter_texts')
    .find({ book_id: bookId })
    .sort({ chapter_index: 1, part: 1 })
    .toArray();
  const useChapters = chapterTexts.length > 1;

  // Research in parallel with batch processing
  const researchPromise = researchBook(bookTitle, bookAuthor).catch(() => '');

  // Process batches
  const batchExtractions = await processAllBatches(
    pages, bookTitle, bookAuthor, book.language || undefined,
    useChapters ? chapterTexts : undefined
  );

  const researchContext = await researchPromise;

  // Build concept index
  const conceptIndex = buildConceptIndexFromBatches(batchExtractions, pages);

  // Page summaries
  const pageSummaries = batchExtractions.flatMap(batch =>
    batch.summary ? [{ page: batch.pageRange.start, summary: batch.summary }] : []
  );

  // Generate final summary
  let bookSummary = { brief: '', abstract: '', detailed: '' };
  let sectionSummaries = [];
  let summaryUsage = null;

  if (batchExtractions.length > 0 || researchContext) {
    try {
      const generated = await generateBookSummary(
        batchExtractions, book.title || bookTitle, bookAuthor,
        book.language || undefined,
        researchContext || undefined,
        chapters.length > 0 ? chapters : undefined,
        book.display_title || undefined
      );
      bookSummary = { brief: generated.brief, abstract: generated.abstract, detailed: generated.detailed };
      sectionSummaries = generated.sections || [];
      summaryUsage = generated.usage;
    } catch (e) {
      console.error(`    Summary generation failed:`, e.message);
    }
  }

  // Ground quotes
  const allBatchQuotes = batchExtractions.flatMap(b => b.quotes);
  const groundedBatchQuotes = groundQuotes(allBatchQuotes, pages);
  const droppedBatch = allBatchQuotes.length - groundedBatchQuotes.length;
  if (droppedBatch > 0) {
    console.log(`    Quote grounding: dropped ${droppedBatch}/${allBatchQuotes.length} batch quotes`);
  }

  for (const section of sectionSummaries) {
    if (section.quotes && section.quotes.length > 0) {
      section.quotes = groundQuotes(section.quotes, pages);
    }
  }

  // Build index
  const index = {
    ...conceptIndex,
    pageSummaries,
    sectionSummaries,
    bookSummary,
    generatedAt: new Date(),
    pagesCovered: pageSummaries.length,
    totalPages: pages.length,
  };

  // Save to DB — write index to dedicated collection (keeps book docs small)
  await db.collection('book_indexes').replaceOne(
    { book_id: bookId },
    { book_id: bookId, ...index },
    { upsert: true }
  );

  // Write a lightweight marker to the book doc (generatedAt only, not the full index)
  const updateData = {
    'index.generatedAt': index.generatedAt,
    'index.pagesCovered': index.pagesCovered,
    'index.totalPages': index.totalPages,
    updated_at: new Date(),
  };

  const unsetFields = { enrichment_stale: '' };

  if (bookSummary.brief) {
    updateData.summary = {
      data: bookSummary.brief,
      generated_at: new Date(),
      page_coverage: Math.round((pageSummaries.length / pages.length) * 100),
      model: LITE_MODEL,
      source: 'ai',
    };
    updateData.reading_summary = {
      overview: bookSummary.abstract || bookSummary.brief,
      detailed: bookSummary.detailed || '',
      themes: batchExtractions.flatMap(b => b.themes).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20),
      quotes: groundedBatchQuotes.slice(0, 15),
      generated_at: new Date(),
      model: LITE_MODEL,
      source: 'ai',
      // Derivation provenance (Vaughan/Sammelband lesson #3584): record WHICH
      // pages this summary was derived from, so a wrong description can be
      // traced to its input instead of trusted as catalog fact.
      pages_sampled: batchExtractions.map((b) => b.pageRange).filter(Boolean),
    };
  }

  // Snapshot prior summary/reading_summary/index before overwriting so
  // regenerations are recoverable. (See src/lib/book-revisions.ts.)
  await createBookRevisions(db, bookId, ['summary', 'reading_summary', 'index']);

  await db.collection('books').updateOne(
    { id: bookId },
    { $set: updateData, $unset: unsetFields }
  );

  // Log Gemini usage for batch extractions
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const batch of batchExtractions) {
    if (batch.usage) {
      totalInputTokens += batch.usage.input_tokens;
      totalOutputTokens += batch.usage.output_tokens;
    }
  }

  if (totalInputTokens > 0) {
    await logUsage(db, {
      type: 'index', mode: 'realtime', model: LITE_MODEL,
      book_id: bookId, book_title: bookTitle,
      page_count: translatedCount,
      input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
      status: 'success', endpoint: 'worker/hetzner-enrich',
    });
  }

  if (summaryUsage) {
    await logUsage(db, {
      type: 'summary', mode: 'realtime', model: LITE_MODEL,
      book_id: bookId, book_title: bookTitle,
      page_count: batchExtractions.length,
      input_tokens: summaryUsage.input_tokens, output_tokens: summaryUsage.output_tokens,
      status: 'success', endpoint: 'worker/hetzner-enrich',
    });
  }

  // Sync entities (non-blocking)
  syncBookEntities(db, bookId, bookTitle, bookAuthor, conceptIndex, book.year || null).catch(err => {
    console.error(`    Entity sync failed:`, err.message);
  });

  // Upsert book embedding to Supabase (non-blocking, issue #1158)
  upsertBookEmbedding(book, index).catch(err => {
    console.warn(`    [embed] Book embedding failed: ${err.message}`);
  });

  // Page-level vectors, so this book is searchable BY MEANING the moment it
  // finishes enrichment rather than whenever a separate cron next runs — see
  // the note on upsertPageEmbeddings for what that separation cost.
  upsertPageEmbeddings(db, book).catch(err => {
    console.warn(`    [embed] Page embeddings failed: ${err.message}`);
  });

  console.log(`    Done — ${batchExtractions.length} batches, ${groundedBatchQuotes.length} quotes, ${sectionSummaries.length} sections`);
}


// ══════════════════════════════════════════════════════════════════════
// Phase 7: Chapter Extraction
// Faithful port of src/lib/chapter-extraction.ts
// ══════════════════════════════════════════════════════════════════════

function extractRawHeadings(text, pageNumber, source) {
  const headings = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^<(margin|meta|header|sig|page-num|language|page-type|columns|warning|summary|keywords)>/.test(trimmed)) continue;

    let title = null;
    let level = 2;

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      level = headingMatch[1].length;
      title = headingMatch[2].trim().replace(/^->/, '').replace(/<-$/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
    }

    if (!title) {
      const centeredMatch = trimmed.match(/^->\*(.+)\*<-$/);
      if (centeredMatch) { title = centeredMatch[1].trim(); level = 2; }
    }

    if (!title) {
      const boldMatch = trimmed.match(/^\*\*([A-Z][^*]{3,80})\*\*$/);
      if (boldMatch) { title = boldMatch[1].trim(); level = 1; }
    }

    if (!title || title.length < 3) continue;

    const contextLines = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cl = lines[j].trim();
      if (cl && !cl.startsWith('<') && cl.length > 10) contextLines.push(cl.slice(0, 100));
    }

    headings.push({
      title, level, pageNumber, source,
      context: contextLines.join(' | ').slice(0, 200) || undefined,
    });
  }

  return headings;
}

function buildExtractionPrompt(bookTitle, author, language, pageCount, rawHeadings, tocPages, sectionHints) {
  let prompt = `You are analyzing the structure of a digitized historical book to extract its table of contents.

**Book:** ${bookTitle}
**Author:** ${author}
**Language:** ${language}
**Total pages:** ${pageCount}

`;

  if (sectionHints.length > 0) {
    prompt += `## Prior Section Analysis\n\nA previous AI analysis identified these broad sections (use as hints, not gospel — page numbers may be approximate):\n\n`;
    for (const s of sectionHints) prompt += `- "${s.title}" (pp. ${s.startPage}–${s.endPage})\n`;
    prompt += '\n';
  }

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages\n\nThe following pages appear to contain a printed table of contents:\n\n`;
    for (const toc of tocPages) prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 3000)}\n\`\`\`\n\n`;
  }

  const ocrHeadings = rawHeadings.filter(h => h.source === 'ocr');
  const translationHeadings = rawHeadings.filter(h => h.source === 'translation');
  const tocPageNumbers = new Set(tocPages.map(t => t.pageNumber));

  prompt += `## Headings Found in the Text

Below are headings from the OCR and translation, with context lines after each.
- If context shows body text (prose, arguments), the heading likely starts a real chapter.
- If context shows more chapter titles or page numbers, the heading is inside a table of contents.
- If a heading appears in the TOC AND later in the body, use the BODY page number.

`;

  const allByPage = new Map();
  for (const h of [...ocrHeadings, ...translationHeadings]) {
    const arr = allByPage.get(h.pageNumber) || [];
    arr.push(h);
    allByPage.set(h.pageNumber, arr);
  }

  const sortedPages = [...allByPage.keys()].sort((a, b) => a - b);
  for (const pageNum of sortedPages) {
    const pageHeadings = allByPage.get(pageNum);
    const isTocPage = tocPageNumbers.has(pageNum);
    const prefix = isTocPage ? '[TOC] ' : '';
    for (const h of pageHeadings) {
      prompt += `${prefix}p.${pageNum}: ${'#'.repeat(h.level)} ${h.title}\n`;
      if (h.context) prompt += `  → ${h.context}\n`;
    }
  }

  prompt += `

## Instructions

Return the real structural chapters as a JSON array. CRITICAL rules:
- "pageNumber" must be where chapter TEXT BEGINS in the body, NOT where it appears in a table of contents
- Headings marked [TOC] are from table of contents pages — use them to understand structure, but find the BODY page where each chapter actually starts
- Verify each chapter by checking context: does body text follow, or more chapter listings?

Each entry:
- "title": Clean chapter title in the original language (fix obvious OCR errors)
- "titleEn": English translation (concise — e.g., "Tractatus I: De Macrocosmi Historia" → "Treatise I: On the History of the Macrocosm"). Omit if already English.
- "pageNumber": Page where this chapter's TEXT begins (not TOC reference)
- "level": 1 = top-level (Tractatus/Part/Book/Tomus/Volume), 2 = chapter (Liber/Section/Caput), 3 = sub-chapter
- "confidence": "high"/"medium"/"low"

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, Tomus, Volumen, Band, etc.)
- For multi-volume works: use level 1 for volumes, level 2 for chapters within. Chapter numbering restarts per volume.
- SKIP: title pages, dedications, indices, running headers, image captions, colophons
- INCLUDE: prefaces/prologues if they are labeled sections
- A typical book has 5-50 chapters. Over 80 usually means noise.
- Cross-reference OCR and translation headings — prefer the cleaner version for "title"

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N, "confidence": "high|medium|low"}, ...]

Empty array [] if no discernible structure.`;

  return prompt;
}

async function extractChaptersForBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) throw new Error('Book not found');

  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) throw new Error('No pages with OCR found');

  // Extract raw headings
  const rawHeadings = [];
  for (const page of pages) {
    rawHeadings.push(...extractRawHeadings(page.ocr?.data || '', page.page_number, 'ocr'));
    if (page.translation?.data) {
      rawHeadings.push(...extractRawHeadings(page.translation.data, page.page_number, 'translation'));
    }
  }

  // Identify TOC pages
  const tocPages = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const isTocByType = page.page_type === 'table_of_contents' || page.page_type === 'index';
    const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
      && page.page_number <= Math.min(30, pages.length * 0.1);
    if (isTocByType || isTocByContent) {
      tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
    }
  }

  // Section hints from book index (check dedicated collection first, then inline fallback)
  const bookIndexDoc = await db.collection('book_indexes').findOne({ book_id: bookId }).catch(() => null);
  const indexData = bookIndexDoc || book.index || {};
  const sectionHints = [];
  if (indexData.sectionSummaries) {
    for (const section of indexData.sectionSummaries) {
      if (section.title && section.startPage) {
        sectionHints.push({ title: section.title, startPage: section.startPage, endPage: section.endPage || section.startPage });
      }
    }
  }

  // Call Gemini — flash-lite is sufficient for structured chapter extraction
  const modelId = LITE_MODEL;
  const model = getClient().getGenerativeModel({ model: modelId });
  const prompt = buildExtractionPrompt(
    book.display_title || book.title,
    book.author || 'Unknown',
    book.language || book.original_language || 'Unknown',
    pages.length,
    rawHeadings,
    tocPages.slice(0, 5),
    sectionHints,
  );

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.text();
  const usageMetadata = response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  // Parse AI response
  let aiChapters;
  try {
    let cleaned = responseText.trim();
    const jsonBlockMatch = cleaned.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    aiChapters = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned unparseable response: ${responseText.slice(0, 500)}`);
  }

  // Validate and map chapters
  const pageByNumber = new Map();
  for (const page of pages) pageByNumber.set(page.page_number, page.id);

  const chapters = [];
  for (const ch of aiChapters) {
    if (!ch.title || !ch.pageNumber) continue;
    let pageId = pageByNumber.get(ch.pageNumber);
    if (!pageId) {
      for (let offset = 1; offset <= 2; offset++) {
        pageId = pageByNumber.get(ch.pageNumber + offset) || pageByNumber.get(ch.pageNumber - offset);
        if (pageId) break;
      }
    }
    if (!pageId) continue;

    const chapter = {
      title: ch.title,
      pageId,
      pageNumber: ch.pageNumber,
      level: Math.min(Math.max(ch.level || 1, 1), 3),
    };
    if (ch.titleEn) chapter.titleEn = ch.titleEn;
    if (ch.confidence === 'high' || ch.confidence === 'medium' || ch.confidence === 'low') {
      chapter.confidence = ch.confidence;
    }
    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.pageNumber - b.pageNumber);
  computeEndPages(chapters, pages.length);

  // Snapshot prior chapters before overwriting (revisable history)
  await createBookRevisions(db, bookId, ['chapters']);

  // Save
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { chapters, chapters_extracted_at: new Date() } }
  );

  // Log usage
  await logUsage(db, {
    type: 'extract_chapters', mode: 'realtime', model: modelId,
    book_id: bookId, page_count: pages.length,
    input_tokens: inputTokens, output_tokens: outputTokens,
    status: 'success', endpoint: 'worker/hetzner-enrich',
  });

  const translationHeadingsCount = rawHeadings.filter(h => h.source === 'translation').length;
  console.log(`    ${chapters.length} chapters extracted (${rawHeadings.filter(h => h.source === 'ocr').length} OCR headings, ${translationHeadingsCount} translation headings, ${tocPages.length} TOC pages)`);

  return { chapters, inputTokens, outputTokens };
}


// ══════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════

async function main() {
  if (!MONGODB_URI) { console.error('[ENRICH] MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const startTime = Date.now();
  console.log(`[ENRICH] ${new Date().toISOString()} — phase=${phaseArg}, dry-run=${DRY_RUN}`);

  // Check pause status
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  // Selective unpause: scoped books enrich while globally paused; the explicit
  // enrichment-phase pause still hard-stops regardless of scope.
  if (control?.paused_phases?.includes('enrichment') || !shouldBypassPause(control)) {
    const reason = control?.paused_phases?.includes('enrichment') ? 'enrichment phase paused' : 'pipeline paused';
    console.log(`[ENRICH] ${reason}, exiting`);
    await db.collection('cron_runs').insertOne({
      cron: 'hetzner-enrich-worker', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'skipped', failed: false,
      actions: { skip_reason: reason }, errors: [], error_count: 0,
      summary: `skipped: ${reason}`,
    }).catch(() => {});
    await client.close();
    return;
  }
  // When globally paused with a scope, confine every candidate query to it.
  if (control?.paused && hasScope(control)) {
    const scopeIds = [...await resolveScopeBookIds(db, control)];
    SCOPE_FILTER = { id: { $in: scopeIds } };
    console.log(`[ENRICH] PAUSED globally, scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  // The dial caps money regardless of pause/scope state (#3826): a scope
  // confines WHICH books, the budget caps HOW MUCH. Every Gemini call below
  // is paid work. A scope ENVELOPE (#4540) can open a confined lane when the
  // global dial is closed — the gate then returns the book ids the lane is
  // limited to, and the candidate queries below are confined to them.
  const _gate = DRY_RUN ? { allowed: true, envelopeIds: null } : await budgetAllowsDispatchScoped(db, 'enrich-worker', { control });
  if (_gate.envelopeIds) {
    SCOPE_FILTER = { id: { $in: [..._gate.envelopeIds] } };
    console.log(`[ENRICH] Global dial closed, scope envelope open — confining to ${_gate.envelopeIds.size} envelope book(s).`);
  }
  if (!DRY_RUN && !_gate.allowed) {
    await db.collection('cron_runs').insertOne({
      cron: 'hetzner-enrich-worker', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'skipped', failed: false,
      actions: { skip_reason: 'budget ceiling' }, errors: [], error_count: 0,
      summary: 'skipped: daily budget ceiling reached',
    }).catch(() => {});
    await client.close();
    return;
  }

  let enriched = 0;
  let chaptersExtracted = 0;
  let errors = [];

  // ── Phase 6: Summary + Index ──
  if (RUN_PHASE_6) {
    console.log('\n=== Phase 6: Summary + Index ===');

    let books;
    if (SINGLE_BOOK) {
      const book = await db.collection('books').findOne({ id: SINGLE_BOOK });
      books = book ? [book] : [];
    } else {
      // Recover orphaned books stuck in 'summarizing' for >30min (crashed workers)
      const orphanCutoff = new Date(Date.now() - 30 * 60 * 1000);
      const orphans = await db.collection('books')
        .find({
          'pipeline_auto.status': 'summarizing',
          'pipeline_auto.last_updated': { $lt: orphanCutoff },
        })
        .project({ id: 1 })
        .toArray();
      if (orphans.length > 0) {
        const orphanIds = orphans.map(b => b.id);
        await db.collection('books').updateMany(
          { id: { $in: orphanIds } },
          { $set: { 'pipeline_auto.status': 'translate_complete', 'pipeline_auto.last_updated': new Date() } }
        );
        console.log(`  Recovered ${orphans.length} orphaned summarizing books`);
      }

      // Priority: first translations first, then by retry count (fewer retries first)
      books = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete', ...SCOPE_FILTER })
        .sort({ is_first_translation: -1, pages_count: 1, 'pipeline_auto.retry_count': 1 })  // First translations first, then small books
        .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, chapters: 1, 'pipeline_auto.retry_count': 1, 'image_source.provider': 1, pages_count: 1 })
        .limit(PHASE_6_LIMIT)
        .toArray();
    }

    console.log(`  Books ready: ${books.length}`);

    if (DRY_RUN) {
      for (const book of books) console.log(`  Would enrich: ${book.title}`);
    } else {
      const queue = [...books];
      const workers = Array.from({ length: Math.min(BOOK_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          // Hard cap: stop accepting new books after MAX_RUNTIME_MS
          if (Date.now() - PROCESS_START > MAX_RUNTIME_MS) {
            console.log(`  Runtime limit reached (${Math.round(MAX_RUNTIME_MS / 60000)}min) — stopping Phase 6`);
            queue.length = 0;
            break;
          }
          const book = queue.shift();
          try {
            await setPipelineStatus(db, book.id, 'summarizing');
            // Per-book timeout: scale with page count (min 5 min, max 20 min)
            const bookTimeout = Math.max(5 * 60000, Math.min(20 * 60000, (book.pages_count || 200) * 3000));
            const result = await Promise.race([
              enrichBook(db, book),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${Math.round(bookTimeout / 60000)}min (${book.pages_count || '?'} pages)`)), bookTimeout)),
            ]);
            await setPipelineStatus(db, book.id, 'summary_indexed', { 'pipeline_auto.retry_count': 0 });
            revalidateBookPage(book.id).catch(() => {});
            enriched++;
          } catch (err) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Summary+Index: ${err.message}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { 'pipeline_auto.retry_count': retries + 1 });
            }
            errors.push(`Summary+Index ${book.id}: ${err.message}`);
            console.error(`  ERROR [${book.title}]:`, err.message);
          }
        }
      });
      await Promise.all(workers);
    }
    console.log(`  Enriched: ${enriched}`);
  }

  // ── Phase 7: Chapter Extraction ──
  if (RUN_PHASE_7) {
    console.log('\n=== Phase 7: Chapter Extraction ===');

    let books;
    if (SINGLE_BOOK) {
      const book = await db.collection('books').findOne({ id: SINGLE_BOOK });
      books = book ? [book] : [];
    } else {
      books = await db.collection('books')
        .find({ 'pipeline_auto.status': 'summary_indexed', ...SCOPE_FILTER })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(PHASE_7_LIMIT)
        .toArray();
    }

    console.log(`  Books ready: ${books.length}`);

    if (DRY_RUN) {
      for (const book of books) console.log(`  Would extract chapters: ${book.title}`);
    } else {
      const chQueue = [...books];
      const chWorkers = Array.from({ length: Math.min(BOOK_CONCURRENCY, chQueue.length) }, async () => {
        while (chQueue.length > 0) {
          if (Date.now() - PROCESS_START > MAX_RUNTIME_MS) {
            console.log(`  Runtime limit reached (${Math.round(MAX_RUNTIME_MS / 60000)}min) — stopping Phase 7`);
            chQueue.length = 0;
            break;
          }
          const book = chQueue.shift();
          try {
            if ((book.pages_count || 0) < 10) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
              console.log(`  Skipped (< 10 pages): ${book.title}`);
              continue;
            }

            await setPipelineStatus(db, book.id, 'chapters');
            await Promise.race([
              extractChaptersForBook(db, book.id),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Phase 7 timeout after ${Math.round(PHASE_7_BOOK_TIMEOUT_MS / 60000)}min`)), PHASE_7_BOOK_TIMEOUT_MS)),
            ]);
            await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
            revalidateBookPage(book.id).catch(() => {});
            chaptersExtracted++;
          } catch (err) {
            if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) rotateKey();

            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { 'pipeline_auto.retry_count': 0 });
            } else {
              await setPipelineStatus(db, book.id, 'summary_indexed', { 'pipeline_auto.retry_count': retries + 1 });
            }
            errors.push(`Chapters ${book.id}: ${err.message}`);
            console.error(`  ERROR [${book.title}]:`, err.message);
          }
        }
      });
      await Promise.all(chWorkers);
    }
    console.log(`  Chapters extracted: ${chaptersExtracted}`);
  }

  // ── Phase 7.5: Quality Scoring ──
  // Score books that have summaries but no quality_score. Runs on chapters_complete
  // books and also catches older books that were never scored.
  let qualityScored = 0;
  const QUALITY_LIMIT = 100;
  if (RUN_PHASE_7_5) {
    console.log('\n=== Phase 7.5: Quality Scoring ===');

    // AI-upgrade books with provisional mechanical scores, or score unscored books.
    // Mechanical scores are computed instantly for all books; AI curation upgrades them later.
    const unscoredBooks = await db.collection('books')
      .find({
        $and: [
          { $or: [
            { quality_score: { $exists: false } },
            { 'quality_assessment.method': 'mechanical-provisional' },
          ]},
          { $or: [
            { 'reading_summary.overview': { $exists: true, $ne: '' } },
            { 'index.generatedAt': { $exists: true } },
            { description: { $exists: true, $ne: '' } },
          ]},
        ],
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
        ...SCOPE_FILTER,
      })
      .sort({ read_count: -1 })
      .project({
        id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1,
        categories: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        reading_summary: 1, index: 1, description: 1, doi: 1, chapters: 1,
      })
      .limit(QUALITY_LIMIT)
      .toArray();

    console.log(`  Unscored books found: ${unscoredBooks.length}`);

    for (const book of unscoredBooks) {
      if (Date.now() - PROCESS_START > MAX_RUNTIME_MS) {
        console.log(`  Runtime limit reached (${Math.round(MAX_RUNTIME_MS / 60000)}min) — stopping Phase 7.5`);
        break;
      }
      const title = book.display_title || book.title;
      try {
        const galleryCount = await db.collection('gallery_images').countDocuments({ book_id: book.id });
        const overview = (book.reading_summary?.overview || '').substring(0, 500);
        const themes = (book.reading_summary?.themes || []).join(', ');
        const description = (book.description || '').substring(0, 200);

        const prompt = `You are a rare books curator rating books for Source Library, a digital library of Western esotericism, alchemy, Hermeticism, and related traditions.

Rate this book on four dimensions (0-25 each). Be discriminating — 15 is average. Reserve 20+ for genuinely outstanding books.

Book: "${title}" by ${book.author || 'Unknown'}
Language: ${book.language || 'Unknown'}, Year: ${book.year || 'Unknown'}
Categories: ${(book.categories || []).join(', ') || 'none'}
Pages: ${book.pages_count || 0}
Summary: ${overview || '(none)'}
Themes: ${themes || '(none)'}
Description: ${description || '(none)'}
Illustrations: ${galleryCount} detected
Has DOI: ${book.doi ? 'yes' : 'no'}

Respond with JSON only — no markdown fences, no explanation.

{
  "historical_significance": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "visual_appeal": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "accessibility": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "scholarly_value": { "score": <0-25>, "reasoning": "<1 sentence>" }
}

Guidelines:
- Historical significance: author fame, text's role in intellectual history, rarity
- Visual appeal: LOW (0-5) for pure text. Higher for illustrations, emblems, diagrams, frontispieces
- Accessibility: broad appeal (alchemy, magic, Hermetica) > narrow (obscure theology, legal texts)
- Scholarly value: primary sources > derivative compilations, major authors > anonymous fragments`;

        const model = getClient().getGenerativeModel({
          model: LITE_MODEL,
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        });

        const result = await Promise.race([
          model.generateContent(prompt),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Phase 7.5 Gemini timeout after ${Math.round(PHASE_7_5_BOOK_TIMEOUT_MS / 60000)}min`)), PHASE_7_5_BOOK_TIMEOUT_MS)),
        ]);
        const text = result.response.text().trim();
        const usageMeta = result.response.usageMetadata;

        let aiScores;
        try { aiScores = JSON.parse(text); }
        catch { const m = text.match(/\{[\s\S]*\}/); aiScores = m ? JSON.parse(m[0]) : null; }

        if (!aiScores) {
          console.log(`  SKIP (parse fail): ${title}`);
          continue;
        }

        const aiTotal = (aiScores.historical_significance?.score || 0)
          + (aiScores.visual_appeal?.score || 0)
          + (aiScores.accessibility?.score || 0)
          + (aiScores.scholarly_value?.score || 0);

        // Mechanical adjustments (0-10 range, adds to AI score)
        const adjustments = {};
        const ocrPct = book.pages_count > 0 ? (book.pages_ocr || 0) / book.pages_count : 0;
        const trPct = book.pages_count > 0 ? (book.pages_translated || 0) / book.pages_count : 0;
        adjustments.completeness = Math.round((ocrPct * 0.3 + trPct * 0.7) * 5);
        adjustments.chapters = book.chapters?.length > 0 ? 2 : 0;
        adjustments.gallery = galleryCount > 10 ? 3 : galleryCount > 0 ? 1 : 0;
        const mechTotal = Object.values(adjustments).reduce((a, b) => a + b, 0);

        const finalScore = Math.min(100, aiTotal + mechTotal);

        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: {
              quality_score: finalScore,
              quality_assessment: {
                ai_scores: aiScores, ai_total: aiTotal,
                mechanical_adjustments: adjustments, mechanical_total: mechTotal,
                final_score: finalScore, model: LITE_MODEL,
                scored_at: new Date(),
              },
              updated_at: new Date(),
            }}
          );
          await logUsage(db, {
            type: 'quality-scoring', mode: 'realtime', model: LITE_MODEL,
            book_id: book.id, book_title: title,
            input_tokens: usageMeta?.promptTokenCount || 0,
            output_tokens: usageMeta?.candidatesTokenCount || 0,
            status: 'success', endpoint: 'worker/hetzner-enrich',
          });
        }
        qualityScored++;
        console.log(`  [${qualityScored}] ${title} — score: ${finalScore} (AI: ${aiTotal} + mech: ${mechTotal})`);
      } catch (err) {
        console.error(`  ERROR scoring "${title}": ${err.message}`);
        errors.push(`quality-score ${book.id}: ${err.message}`);
      }
    }
    console.log(`  Quality scores: ${qualityScored}`);
  }

  // ── Phase 7.6: Collection Assignment ──
  // Classify books that have a summary or description but no collection_scores marker yet.
  // Additive writes only: $addToSet for collections, dot-notation for relevance scores.
  let collectionAssigned = 0;
  const COLLECTION_MODEL = LITE_MODEL;
  const COLLECTION_BATCH_SIZE = 25;
  const COLLECTION_LIMIT = 50;

  if (RUN_PHASE_7_6) {
    console.log('\n=== Phase 7.6: Collection Assignment ===');

    // Load collection definitions from DB. Exclude retired collections —
    // merged docs (merged_into set) and slugs in the redirect map (e.g. the
    // retired `philosophy` umbrella). Offering them as assignment targets
    // silently re-tags books with slugs the #3002 merges already cleaned.
    let retiredSlugs = [];
    try {
      const { readFileSync } = await import('fs');
      retiredSlugs = Object.keys(JSON.parse(
        readFileSync(new URL('../../src/lib/collection-redirects.json', import.meta.url), 'utf8')
      ));
    } catch { /* map absent on an old checkout — merged_into filter still applies */ }
    let collections = await db.collection('collections')
      .find({ merged_into: { $exists: false }, slug: { $nin: retiredSlugs } })
      .toArray();
    if (collections.length === 0) {
      console.log('  No collections in DB — skipping phase 7.6');
    } else {
      // Normalize collection objects to what the prompt needs
      collections = collections
        .map(c => ({
          slug: c.slug,
          name: c.name || c.slug,
          description: c.description || '',
        }))
        .filter(c => c.slug && c.name);

      const collectionSummary = collections
        .map(c => `- ${c.slug}: ${c.name} — ${c.description}`)
        .join('\n');

      const collectionSystemPrompt = `You are a specialist librarian classifying rare books into thematic collections. For each book, assign 1-3 collections that BEST fit, with a relevance score.

COLLECTIONS:
${collectionSummary}

RULES:
1. Assign 1-3 collections per book. Most books should get 1-2.
2. Only assign a collection if the book genuinely belongs. Don't pad with marginal matches.
3. The MOST relevant collection should score 80-100. Secondary fits: 50-79. Don't assign below 50.
4. Consider title, author, year, language, and existing categories together.
5. A book about Paracelsian medicine could be "alchemy" (80) + "medicine" (70). Use judgment.
6. For non-Western books (Chinese, Sanskrit, etc.), prefer the regional collection (chinese-classics, indic-traditions) over Western categories.

Respond with a JSON array, one entry per book, in the same order as input. Each entry:
{"i": <index>, "c": [{"s": "<slug>", "r": <score>}]}

NO explanation, just the JSON array.`;

      const validSlugs = new Set(collections.map(c => c.slug));

      // Find books that have content but haven't been classified yet.
      // CANNOT use collection_scores: { $exists: false } in the DB query — Atlas times out
      // even with pipeline_auto.status index. Fetch by status (indexed), filter client-side.
      const CANDIDATE_STATUSES = [
        'visual_complete', 'translate_complete', 'enriched', 'chapters',
        'chapters_complete', 'summary_indexed', 'complete',
      ];
      let unclassifiedBooks = [];

      for (const status of CANDIDATE_STATUSES) {
        if (unclassifiedBooks.length >= COLLECTION_LIMIT) break;
        const batch = await db.collection('books')
          .find({
            'pipeline_auto.status': status,
            pages_count: { $gt: 0 },
            hidden: { $ne: true },
            ...SCOPE_FILTER,
          })
          .project({
            id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1,
            collection_scores: 1,
          })
          .limit(500)
          .maxTimeMS(15_000)
          .toArray()
          .catch(() => []);
        const unclassified = batch
          .filter(b => !b.collection_scores)
          .map(({ collection_scores, ...rest }) => rest);
        unclassifiedBooks.push(...unclassified);
      }
      unclassifiedBooks = unclassifiedBooks.slice(0, COLLECTION_LIMIT);

      console.log(`  Unclassified books found: ${unclassifiedBooks.length}`);

      if (unclassifiedBooks.length > 0 && !DRY_RUN) {
        // Process in batches of COLLECTION_BATCH_SIZE
        for (let i = 0; i < unclassifiedBooks.length; i += COLLECTION_BATCH_SIZE) {
          if (Date.now() - PROCESS_START > MAX_RUNTIME_MS) {
            console.log(`  Runtime limit reached (${Math.round(MAX_RUNTIME_MS / 60000)}min) — stopping Phase 7.6`);
            break;
          }
          const batch = unclassifiedBooks.slice(i, i + COLLECTION_BATCH_SIZE);

          const booksText = batch.map((b, idx) => {
            const cats = (b.categories || []).slice(0, 8).join(', ');
            return `[${idx}] "${(b.display_title || b.title || 'Untitled').substring(0, 120)}" by ${(b.author || 'Unknown').substring(0, 60)} (${b.year || '?'}, ${b.language || '?'}) [${cats}]`;
          }).join('\n');

          const prompt = `Classify these ${batch.length} books:\n\n${booksText}`;

          let results;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const model = getClient().getGenerativeModel({
                model: COLLECTION_MODEL,
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                },
                systemInstruction: collectionSystemPrompt,
              });

              const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Phase 7.6 Gemini timeout after ${Math.round(PHASE_7_6_BATCH_TIMEOUT_MS / 60000)}min`)), PHASE_7_6_BATCH_TIMEOUT_MS)),
              ]);
              const text = result.response.text().trim();
              const usageMeta = result.response.usageMetadata;

              results = JSON.parse(text);
              if (!Array.isArray(results)) throw new Error('Not an array');

              await logUsage(db, {
                type: 'collection-assignment', mode: 'realtime', model: COLLECTION_MODEL,
                input_tokens: usageMeta?.promptTokenCount || 0,
                output_tokens: usageMeta?.candidatesTokenCount || 0,
                status: 'success', endpoint: 'worker/hetzner-enrich',
              });
              break;
            } catch (err) {
              if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) rotateKey();
              console.error(`  Collection batch ${Math.floor(i / COLLECTION_BATCH_SIZE)} attempt ${attempt + 1} failed: ${err.message}`);
              if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              else results = batch.map((_, idx) => ({ i: idx, c: [] }));
            }
          }

          // Write results for this batch
          const bulkOps = [];
          for (const res of results) {
            const book = batch[res.i];
            if (!book) continue;

            const assignments = (res.c || [])
              .filter(a => a.s && validSlugs.has(a.s) && a.r >= 50)
              .sort((a, b) => b.r - a.r)
              .slice(0, 3);

            const slugs = assignments.map(a => a.s);

            // Build dot-notation relevance updates
            const relevanceSets = {};
            for (const a of assignments) {
              relevanceSets[`collection_relevance.${a.s}`] = a.r;
            }

            if (slugs.length > 0) {
              bulkOps.push({
                updateOne: {
                  filter: { id: book.id },
                  update: {
                    $addToSet: { collections: { $each: slugs } },
                    $set: {
                      ...relevanceSets,
                      collection_scores: {
                        assigned_at: new Date(),
                        model: COLLECTION_MODEL,
                      },
                      updated_at: new Date(),
                    },
                  },
                },
              });
              collectionAssigned++;
            } else {
              // Mark as processed even with no match, so we don't re-attempt
              bulkOps.push({
                updateOne: {
                  filter: { id: book.id },
                  update: {
                    $set: {
                      collection_scores: {
                        assigned_at: new Date(),
                        model: COLLECTION_MODEL,
                        result: 'no_match',
                      },
                    },
                  },
                },
              });
            }
          }

          if (bulkOps.length > 0) {
            await db.collection('books').bulkWrite(bulkOps);
          }

          process.stdout.write(`  Processed: ${Math.min(i + COLLECTION_BATCH_SIZE, unclassifiedBooks.length)}/${unclassifiedBooks.length}\r`);
        }
        console.log(`\n  Collection assignments: ${collectionAssigned}`);
      } else if (DRY_RUN) {
        console.log(`  Would classify ${unclassifiedBooks.length} books`);
      }
    }
    console.log(`  Collections assigned: ${collectionAssigned}`);
  }

  // Summary
  const durationMs = Date.now() - startTime;
  console.log(`\n[ENRICH] Done — enriched=${enriched}, chapters=${chaptersExtracted}, quality=${qualityScored}, collections=${collectionAssigned}, errors=${errors.length}, ${(durationMs/1000).toFixed(0)}s`);
  if (errors.length > 0) {
    console.log('  Errors:');
    for (const err of errors.slice(0, 10)) console.log(`    ${err}`);
  }

  await db.collection('cron_runs').insertOne({
    cron: 'hetzner-enrich-worker', timestamp: new Date(),
    duration_ms: durationMs,
    status: errors.length > 0 ? 'completed_with_errors' : 'success',
    failed: false,
    actions: { enriched, chapters_extracted: chaptersExtracted, quality_scored: qualityScored, collections_assigned: collectionAssigned },
    errors: errors.slice(0, 20).map(msg => ({ message: msg, timestamp: new Date() })),
    error_count: errors.length,
    summary: `E:${enriched} C:${chaptersExtracted} Q:${qualityScored} COL:${collectionAssigned} err:${errors.length}`,
  }).catch(() => {});

  await client.close();
}

main().catch(err => {
  console.error('[ENRICH] Fatal:', err);
  process.exit(1);
});
