#!/usr/bin/env node
/**
 * Hetzner Inline Translation Worker
 *
 * Translates books directly via Gemini API — no SQS, no Lambda.
 * Runs on Hetzner cron every 5 minutes alongside the pipeline orchestrator.
 *
 * Architecture:
 * - Picks up books in 'translate_submitted' status that have a job
 * - Translates pages sequentially per book (context continuity)
 * - Runs multiple books concurrently (up to CONCURRENCY cap)
 * - Writes translations + progress directly to MongoDB
 * - Rotates Gemini API keys on rate limit errors
 *
 * The orchestrator (Phase 4) creates jobs and sets status to translate_submitted.
 * This worker picks them up and does the actual translation.
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'crypto';

// ── Config ──
const CONCURRENCY = 20;          // Max books translating simultaneously
const PAGES_PER_RUN = 8000;      // Global page cap per run (prevent runaway costs)
const MAX_CONSECUTIVE_ERRORS = 5; // Per-book error threshold before giving up
const RATE_LIMIT_BACKOFF_MS = 15000;
const MODEL_FLASH = 'gemini-3-flash-preview';
const MODEL_LITE = 'gemini-3.1-flash-lite-preview';
function getModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return MODEL_FLASH;
  return MODEL_LITE;
}
const PROMPT_VERSION = 'v6';

// ── Gemini API keys ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('[TRANSLATE] No Gemini API keys configured');
  process.exit(1);
}

let currentKeyIndex = 0;
function getClient() {
  return new GoogleGenerativeAI(API_KEYS[currentKeyIndex % API_KEYS.length]);
}
function rotateKey() {
  currentKeyIndex++;
  console.log(`[TRANSLATE] Rotated to API key ${(currentKeyIndex % API_KEYS.length) + 1}/${API_KEYS.length}`);
}

// ── Translation prompt (matches src/lib/ai.ts performTranslation) ──
const TRANSLATION_PROMPT = `You are a scholarly translator producing publication-quality English translations of historical texts.

**Your task:** Translate the following text from {source_language} to English.

**Guidelines:**
- Produce a faithful, readable English translation
- Preserve the structure and meaning of the original
- Use appropriate scholarly English for the period and genre
- Preserve any XML-like tags in the text (e.g., <margin>, <gloss>, <unclear>)
- Do NOT add commentary, notes, or explanations — just the translation
- If the text is already in English, modernize archaic spelling and grammar`;

const ENGLISH_MODERNIZATION_PROMPT = `You are a scholarly editor modernizing Early Modern English texts for contemporary readers.

**Your task:** Modernize the following Early Modern English text into clear, contemporary English.

**Guidelines:**
- Update archaic spelling, grammar, and vocabulary to modern equivalents
- Preserve the original meaning and tone
- Keep proper nouns, titles, and technical terms recognizable
- Preserve any XML-like tags in the text
- Do NOT add commentary or explanations — just the modernized text`;

// ── Skip these page types ──
const SKIP_PAGE_TYPES = ['blank'];

// ── MongoDB ──
const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: CONCURRENCY + 5,
});

// ── Sanitize translation tags (matches src/lib/sanitize-translation-tags.ts) ──
function sanitizeTranslationTags(text) {
  if (!text) return text;
  // Fix common unclosed/malformed XML tags from Gemini
  return text
    .replace(/<(margin|gloss|insert|unclear|term|heading|footnote|caption)>([^<]*?)$/gm,
      (_, tag, content) => `<${tag}>${content}</${tag}>`)
    .replace(/<\/(margin|gloss|insert|unclear|term|heading|footnote|caption)>\s*<\/\1>/g,
      (_, tag) => `</${tag}>`);
}

// ── Content hash for provenance ──
function contentHash(text) {
  return createHash('sha256').update(text || '').digest('hex').slice(0, 16);
}

// ── Cost calculation ──
const MODEL_PRICING = {
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
};
function calculateCost(inputTokens, outputTokens, model) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3-flash-preview'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ── Translate a single page ──
async function translatePage(db, page, book, prevTranslation) {
  const isEnglish = (book.language || '').toLowerCase() === 'english';
  const basePrompt = isEnglish ? ENGLISH_MODERNIZATION_PROMPT : TRANSLATION_PROMPT;
  let prompt = basePrompt.replace('{source_language}', book.language || 'Latin');

  // Book context
  const parts = [];
  if (book.display_title || book.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book.author) parts.push(`Author: ${book.author}`);
  if (book.year || book.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;

  prompt += isEnglish
    ? `\n\n**Text to modernize:**\n${page.ocr.data}`
    : `\n\n**Text to translate:**\n${page.ocr.data}`;

  if (prevTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${prevTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${prevTranslation.slice(0, 2000)}...`;
  }

  const ai = getClient();
  const selectedModel = getModelForBook(book);
  const model = ai.getGenerativeModel({ model: selectedModel });
  const start = Date.now();
  const result = await model.generateContent(prompt);
  const durationMs = Date.now() - start;

  const text = sanitizeTranslationTags(result.response.text());
  const usage = result.response.usageMetadata || {};

  return {
    text,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    durationMs,
  };
}

// ── Process one book (sequential pages for context) ──
async function processBook(db, book, job, globalCounter) {
  const label = (book.title || book.id).substring(0, 50);
  const pages = await db.collection('pages')
    .find({
      book_id: book.id,
      'ocr.data': { $exists: true, $nin: [null, ''] },
      page_type: { $nin: SKIP_PAGE_TYPES },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': null },
        { 'translation.data': '' },
        { $expr: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } },
      ],
    })
    .sort({ page_number: 1 })
    .project({ id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 })
    .limit(200) // Cap per book per run — large books don't monopolize a worker slot
    .toArray();

  if (pages.length === 0) {
    // Book is fully translated — advance pipeline
    await db.collection('jobs').updateOne(
      { id: job.id },
      { $set: { status: 'completed', updated_at: new Date(), completed_at: new Date() } },
    );
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { 'pipeline_auto.status': 'translate_complete', updated_at: new Date() }, $unset: { job: '' } },
    );
    console.log(`  [${label}] Already complete`);
    return { translated: 0, failed: 0 };
  }

  console.log(`  [${label}] ${pages.length} pages to translate`);

  // Mark job as processing
  await db.collection('jobs').updateOne(
    { id: job.id, status: { $in: ['pending', 'processing'] } },
    { $set: { status: 'processing', updated_at: new Date() } },
  );

  let translated = 0;
  let failed = 0;
  let consecutiveErrors = 0;
  let prevTranslation = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Get previous page's translation for context continuity
  if (pages[0].page_number > 1) {
    const prev = await db.collection('pages').findOne({
      book_id: book.id,
      page_number: pages[0].page_number - 1,
      'translation.data': { $exists: true },
    });
    if (prev?.translation?.data) prevTranslation = prev.translation.data;
  }

  for (const page of pages) {
    // Check global page cap
    if (globalCounter.count >= PAGES_PER_RUN) {
      console.log(`  [${label}] Hit global page cap (${PAGES_PER_RUN}), pausing`);
      break;
    }

    // Check consecutive errors
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.log(`  [${label}] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, stopping`);
      break;
    }

    // Check if job was cancelled externally
    if (translated % 50 === 0 && translated > 0) {
      const freshJob = await db.collection('jobs').findOne({ id: job.id }, { projection: { status: 1 } });
      if (freshJob?.status === 'cancelled' || freshJob?.status === 'failed') {
        console.log(`  [${label}] Job ${freshJob.status} externally, stopping`);
        return { translated, failed };
      }
    }

    try {
      const result = await translatePage(db, page, book, prevTranslation);
      prevTranslation = result.text;

      // Write translation directly to page
      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            translation: {
              data: result.text,
              content_hash: contentHash(result.text),
              language: 'English',
              model: getModelForBook(book),
              updated_at: new Date(),
              source: 'ai',
              prompt_version: PROMPT_VERSION,
            },
            updated_at: new Date(),
          },
        },
      );

      // Log usage
      const cost = calculateCost(result.inputTokens, result.outputTokens, getModelForBook(book));
      await db.collection('gemini_usage').insertOne({
        type: 'translation',
        mode: 'realtime',
        model: getModelForBook(book),
        book_id: book.id,
        page_ids: [page.id],
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: cost,
        status: 'success',
        duration_ms: result.durationMs,
        prompt_version: PROMPT_VERSION,
        endpoint: 'worker/hetzner-translate',
        timestamp: new Date(),
      });

      translated++;
      globalCounter.count++;
      consecutiveErrors = 0;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      // Update job progress every 10 pages
      if (translated % 10 === 0) {
        await db.collection('jobs').updateOne(
          { id: job.id },
          { $set: { 'progress.completed': job.progress.completed + translated, updated_at: new Date() } },
        );
      }
    } catch (err) {
      const msg = err.message || String(err);
      failed++;
      consecutiveErrors++;

      // Rate limit — rotate key and back off
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        rotateKey();
        console.log(`  [${label}] Rate limited on page ${page.page_number}, backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s`);
        await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        consecutiveErrors = Math.max(0, consecutiveErrors - 1); // Don't count rate limits as hard failures
      } else {
        console.error(`  [${label}] Page ${page.page_number} failed: ${msg.substring(0, 100)}`);

        // Log failed usage
        await db.collection('gemini_usage').insertOne({
          type: 'translation',
          mode: 'realtime',
          model: getModelForBook(book),
          book_id: book.id,
          page_ids: [page.id],
          input_tokens: 0,
          output_tokens: 0,
          status: 'failed',
          error_message: msg.substring(0, 500),
          endpoint: 'worker/hetzner-translate',
          timestamp: new Date(),
        });
      }
    }
  }

  // Final job progress update
  const newCompleted = job.progress.completed + translated;
  const newFailed = (job.progress.failed || 0) + failed;
  const isComplete = newCompleted + newFailed >= job.progress.total;

  await db.collection('jobs').updateOne(
    { id: job.id },
    {
      $set: {
        'progress.completed': newCompleted,
        'progress.failed': newFailed,
        status: isComplete ? (newFailed > 0 ? 'completed_with_errors' : 'completed') : 'processing',
        updated_at: new Date(),
        ...(isComplete && { completed_at: new Date() }),
      },
    },
  );

  // If complete, advance pipeline and sync page counts
  if (isComplete) {
    // Count actual translated + blank pages from source of truth
    const [countAgg] = await db.collection('pages').aggregate([
      { $match: { book_id: book.id } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        with_translation: { $sum: { $cond: [{ $and: [{ $ne: ['$translation.data', null] }, { $ne: ['$translation.data', ''] }, { $ifNull: ['$translation.data', false] }] }, 1, 0] } },
        with_ocr: { $sum: { $cond: [{ $and: [{ $ne: ['$ocr.data', null] }, { $ne: ['$ocr.data', ''] }, { $ifNull: ['$ocr.data', false] }] }, 1, 0] } },
        blank: { $sum: { $cond: [{ $eq: ['$page_type', 'blank'] }, 1, 0] } },
      }}
    ]).toArray();

    const bookUpdate = {
      'pipeline_auto.status': 'translate_complete',
      updated_at: new Date(),
      last_translation_at: new Date(),
    };
    if (countAgg) {
      bookUpdate.pages_count = countAgg.total;
      bookUpdate.pages_translated = countAgg.with_translation;
      bookUpdate.pages_ocr = countAgg.with_ocr;
      bookUpdate.pages_blank = countAgg.blank;
    }

    await db.collection('books').updateOne(
      { id: book.id },
      { $set: bookUpdate, $unset: { job: '' } },
    );
    console.log(`  [${label}] Complete — ${newCompleted} translated, ${newFailed} failed (synced: ${countAgg?.with_translation}/${countAgg?.total} pages)`);
  } else {
    console.log(`  [${label}] Progress — ${translated} this run (${newCompleted}/${job.progress.total} total)`);
  }

  return { translated, failed, completed: isComplete ? 1 : 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  console.log(`\n[TRANSLATE] Worker starting — ${new Date().toISOString()}`);

  await client.connect();
  const db = client.db('bookstore');

  // Check pause status
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused || control?.paused_phases?.includes('translation')) {
    console.log('[TRANSLATE] Pipeline paused, exiting');
    await client.close();
    return;
  }

  // Find books with active translation jobs
  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'translate_submitted' })
    .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, job: 1 })
    .limit(CONCURRENCY)
    .toArray();

  if (books.length === 0) {
    console.log('[TRANSLATE] No books to translate');
    await db.collection('cron_runs').insertOne({
      cron: 'hetzner-translate-worker', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'idle', failed: false,
      pages_saved: 0, actions: { books_processed: 0 }, errors: [], error_count: 0,
      summary: 'idle',
    }).catch(() => {});
    await client.close();
    return;
  }

  console.log(`[TRANSLATE] Processing ${books.length} books (concurrency: ${CONCURRENCY})`);

  // Load their jobs
  const globalCounter = { count: 0 };
  const results = await Promise.all(
    books.map(async (book) => {
      let jobId = book.job?.job_id;
      const zero = { translated: 0, failed: 0, completed: 0, inputTokens: 0, outputTokens: 0 };
      if (!jobId) {
        // Self-heal: try to find an active job for this book
        const orphanJob = await db.collection('jobs').findOne(
          { book_id: book.id, type: 'translation', status: { $in: ['pending', 'processing'] } },
          { sort: { created_at: -1 } },
        );
        if (orphanJob) {
          jobId = orphanJob.id || orphanJob._id.toString();
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { job: { job_id: jobId, type: 'translation' }, updated_at: new Date() } },
          );
          console.log(`  [${(book.title || '').substring(0, 40)}] Re-linked orphan job ${jobId}`);
        } else {
          // No active job — roll back so pipeline can re-process
          console.log(`  [${(book.title || '').substring(0, 40)}] No job found, rolling back to metadata_enriched`);
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.status': 'metadata_enriched', updated_at: new Date() }, $unset: { job: '' } },
          );
          return zero;
        }
      }

      const job = await db.collection('jobs').findOne({ id: jobId });
      if (!job || job.status === 'cancelled' || job.status === 'failed') {
        console.log(`  [${(book.title || '').substring(0, 40)}] Job ${jobId} is ${job?.status || 'missing'}, resetting`);
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { 'pipeline_auto.status': 'metadata_enriched', updated_at: new Date() }, $unset: { job: '' } },
        );
        return zero;
      }

      return processBook(db, book, job, globalCounter);
    }),
  );

  const totalTranslated = results.reduce((s, r) => s + r.translated, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalCompleted = results.reduce((s, r) => s + r.completed, 0);
  const totalInputTokens = results.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = results.reduce((s, r) => s + r.outputTokens, 0);
  const totalCost = calculateCost(totalInputTokens, totalOutputTokens);
  const durationMs = Date.now() - startTime;
  const elapsed = (durationMs / 1000).toFixed(1);
  const rate = durationMs > 0 ? Math.round(totalTranslated / (durationMs / 3600000)) : 0;

  console.log(`[TRANSLATE] Done — ${totalTranslated} translated, ${totalFailed} failed, ${totalCompleted} books completed, ${elapsed}s, ~${rate}/hr, $${totalCost.toFixed(3)}`);

  // Log to cron_runs for analytics Pipeline tab
  try {
    await db.collection('cron_runs').insertOne({
      cron: 'hetzner-translate-worker',
      timestamp: new Date(),
      duration_ms: durationMs,
      status: totalFailed > 0 ? 'completed_with_errors' : 'success',
      failed: totalFailed > 0,
      pages_saved: totalTranslated,
      actions: {
        books_processed: books.length,
        pages_translated: totalTranslated,
        pages_failed: totalFailed,
        books_completed: totalCompleted,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_usd: totalCost,
        rate_per_hour: rate,
      },
      errors: [],
      error_count: totalFailed,
      summary: `T:${totalTranslated}p ${totalCompleted}b $${totalCost.toFixed(2)} ~${rate}/hr`,
    });
  } catch (logErr) {
    console.error('[TRANSLATE] Failed to log cron_run:', logErr.message);
  }

  await client.close();
}

main().catch((err) => {
  console.error('[TRANSLATE] Fatal:', err);
  process.exit(1);
});
