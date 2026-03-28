#!/usr/bin/env node
/**
 * Hetzner Inline Translation Worker
 *
 * Translates books directly via Gemini API — no SQS, no Lambda.
 * Runs on Hetzner cron every 2 minutes alongside the pipeline orchestrator.
 *
 * Architecture:
 * - Picks up books in 'translate_submitted' status that have a job
 * - Translates pages in batches of BATCH_SIZE (default 5) for throughput
 * - Falls back to single-page on batch parse failures or errors
 * - Runs multiple books concurrently (up to CONCURRENCY cap)
 * - Writes translations + progress directly to MongoDB
 * - Rotates Gemini API keys on rate limit errors
 *
 * CLI flags:
 *   --batch-size=N   Pages per API call (default 5, set to 1 for single-page)
 *   --single-page    Force single-page mode (equivalent to --batch-size=1)
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
const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '5', 10);
const SINGLE_PAGE = process.argv.includes('--single-page');
const MAX_BATCH_OCR_CHARS = 15000; // If total OCR text exceeds this, reduce batch size
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

// ── Skip these page types (no translatable content) ──
const SKIP_PAGE_TYPES = ['blank'];
// Pages with very short OCR get excluded from batches (translated single-page instead).
// Short pages in batches cause the model to produce minimal responses without XML tags.
const MIN_OCR_CHARS_FOR_BATCH = 200;

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

// ── Build prompt header (shared between single and batch) ──
function buildPromptHeader(book) {
  const isEnglish = (book.language || '').toLowerCase() === 'english';
  const basePrompt = isEnglish ? ENGLISH_MODERNIZATION_PROMPT : TRANSLATION_PROMPT;
  let prompt = basePrompt.replace('{source_language}', book.language || 'Latin');

  const parts = [];
  if (book.display_title || book.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book.author) parts.push(`Author: ${book.author}`);
  if (book.year || book.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;

  return { prompt, isEnglish };
}

// ── Translate a single page ──
async function translatePage(db, page, book, prevTranslation) {
  const { prompt: headerPrompt, isEnglish } = buildPromptHeader(book);
  let prompt = headerPrompt;

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

// ── Translate a batch of pages in one API call ──
async function translateBatch(db, pages, book, prevTranslation) {
  const { prompt: headerPrompt, isEnglish } = buildPromptHeader(book);
  let prompt = headerPrompt;

  if (prevTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${prevTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${prevTranslation.slice(0, 2000)}...`;
  }

  const verb = isEnglish ? 'modernize' : 'translate';
  prompt += `\n\n**IMPORTANT: You will receive ${pages.length} consecutive pages. ${isEnglish ? 'Modernize' : 'Translate'} each one separately. Wrap each translation in XML tags with the page number:**\n`;
  prompt += `\`\`\`\n${pages.map(p => `<translation page="${p.page_number}">...${verb}d text...</translation>`).join('\n')}\n\`\`\`\n`;
  prompt += `\n**Pages to ${verb}:**\n`;
  for (const page of pages) {
    prompt += `\n--- Page ${page.page_number} ---\n${page.ocr.data}\n`;
  }

  const ai = getClient();
  const selectedModel = getModelForBook(book);
  const model = ai.getGenerativeModel({ model: selectedModel });
  const start = Date.now();
  const result = await model.generateContent(prompt);
  const durationMs = Date.now() - start;
  const responseText = result.response.text();
  const usage = result.response.usageMetadata || {};

  // Parse individual translations from response
  const translations = new Map();
  const regex = /<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g;
  let match;
  const parsedEntries = []; // preserve order for positional fallback
  while ((match = regex.exec(responseText)) !== null) {
    const pageNum = parseInt(match[1], 10);
    const text = sanitizeTranslationTags(match[2].trim());

    // Validate: reject suspiciously short translations (could indicate misparsing
    // from OCR text containing </translation> tags or truncated output)
    const sourcePage = pages.find(p => p.page_number === pageNum);
    if (sourcePage) {
      const ocrLen = (sourcePage.ocr?.data || '').length;
      // Translation should be at least 15% of OCR length (translations are usually
      // similar length or longer). Very short = likely truncated by a stray closing tag.
      if (ocrLen > 100 && text.length < ocrLen * 0.15) {
        continue; // Skip — will fall back to single-page
      }
    }

    translations.set(pageNum, text);
    parsedEntries.push(text);
  }

  // Positional fallback: if model renumbered pages (e.g. 1-5 instead of 491-495),
  // map translations to batch pages by position when count matches exactly.
  if (parsedEntries.length === pages.length && parsedEntries.length > 0) {
    const matchedByNum = pages.filter(p => translations.has(p.page_number)).length;
    if (matchedByNum < pages.length) {
      // Remap by position — validate lengths against actual source pages
      translations.clear();
      for (let i = 0; i < pages.length; i++) {
        const ocrLen = (pages[i].ocr?.data || '').length;
        if (ocrLen > 100 && parsedEntries[i].length < ocrLen * 0.15) continue;
        translations.set(pages[i].page_number, parsedEntries[i]);
      }
    }
  }

  return {
    translations, // Map<pageNumber, translatedText>
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    durationMs,
  };
}

// ── Determine effective batch size for a set of pages ──
function effectiveBatchSize(pages, maxBatchSize) {
  if (SINGLE_PAGE || maxBatchSize <= 1) return 1;
  // If the first page has very short OCR, force single-page (short pages in
  // batches cause the model to skip XML tags and produce garbage responses)
  if ((pages[0].ocr?.data || '').length < MIN_OCR_CHARS_FOR_BATCH) return 1;
  // Count how many consecutive pages have enough OCR for batching
  let size = 0;
  let totalChars = 0;
  for (let i = 0; i < Math.min(pages.length, maxBatchSize); i++) {
    const ocrLen = (pages[i].ocr?.data || '').length;
    if (ocrLen < MIN_OCR_CHARS_FOR_BATCH) break; // Stop batch at first short page
    totalChars += ocrLen;
    if (totalChars > MAX_BATCH_OCR_CHARS) break; // Too much text for one batch
    size++;
  }
  return Math.max(1, size);
}

// ── Write a single page translation to DB ──
async function writePageTranslation(db, page, text, book) {
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        translation: {
          data: text,
          content_hash: contentHash(text),
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
}

// ── Process one book (sequential batches for context) ──
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

  const batchMode = effectiveBatchSize(pages, BATCH_SIZE) > 1 ? `batch-${BATCH_SIZE}` : 'single';
  console.log(`  [${label}] ${pages.length} pages to translate (${batchMode})`);

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

  let pageIdx = 0;
  while (pageIdx < pages.length) {
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

    // Determine batch size for remaining pages
    const remaining = pages.slice(pageIdx);
    const batchSize = effectiveBatchSize(remaining, BATCH_SIZE);
    const batch = remaining.slice(0, batchSize);

    if (batchSize === 1) {
      // ── Single-page path ──
      const page = batch[0];
      try {
        const result = await translatePage(db, page, book, prevTranslation);
        prevTranslation = result.text;
        await writePageTranslation(db, page, result.text, book);

        const cost = calculateCost(result.inputTokens, result.outputTokens, getModelForBook(book));
        await db.collection('gemini_usage').insertOne({
          type: 'translation', mode: 'realtime', model: getModelForBook(book),
          book_id: book.id, page_ids: [page.id],
          input_tokens: result.inputTokens, output_tokens: result.outputTokens,
          cost_usd: cost, status: 'success', duration_ms: result.durationMs,
          prompt_version: PROMPT_VERSION, endpoint: 'worker/hetzner-translate',
          batch_size: 1, timestamp: new Date(),
        });

        translated++;
        globalCounter.count++;
        consecutiveErrors = 0;
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        pageIdx++;
      } catch (err) {
        const msg = err.message || String(err);
        failed++;
        consecutiveErrors++;
        pageIdx++;

        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          rotateKey();
          console.log(`  [${label}] Rate limited on page ${page.page_number}, backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s`);
          await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
          consecutiveErrors = Math.max(0, consecutiveErrors - 1);
        } else {
          console.error(`  [${label}] Page ${page.page_number} failed: ${msg.substring(0, 100)}`);
          await db.collection('gemini_usage').insertOne({
            type: 'translation', mode: 'realtime', model: getModelForBook(book),
            book_id: book.id, page_ids: [page.id],
            input_tokens: 0, output_tokens: 0, status: 'failed',
            error_message: msg.substring(0, 500), endpoint: 'worker/hetzner-translate',
            batch_size: 1, timestamp: new Date(),
          });
        }
      }
    } else {
      // ── Multi-page batch path ──
      try {
        const result = await translateBatch(db, batch, book, prevTranslation);
        const missing = batch.filter(p => !result.translations.has(p.page_number));

        if (missing.length > 0) {
          console.log(`  [${label}] Batch ${batch[0].page_number}-${batch[batch.length - 1].page_number}: parsed ${result.translations.size}/${batch.length}, falling back for ${missing.length}`);
        }

        let batchTranslated = 0;
        for (const page of batch) {
          const translatedText = result.translations.get(page.page_number);
          if (translatedText) {
            await writePageTranslation(db, page, translatedText, book);
            prevTranslation = translatedText;
            batchTranslated++;
            translated++;
            globalCounter.count++;
          } else {
            // Missing from batch — fall back to single page
            try {
              const singleResult = await translatePage(db, page, book, prevTranslation);
              prevTranslation = singleResult.text;
              await writePageTranslation(db, page, singleResult.text, book);
              batchTranslated++;
              translated++;
              globalCounter.count++;
              totalInputTokens += singleResult.inputTokens;
              totalOutputTokens += singleResult.outputTokens;
            } catch (fallbackErr) {
              console.error(`  [${label}] Fallback page ${page.page_number} failed: ${(fallbackErr.message || '').substring(0, 80)}`);
              failed++;
            }
          }
        }

        // Log batch usage
        const cost = calculateCost(result.inputTokens, result.outputTokens, getModelForBook(book));
        await db.collection('gemini_usage').insertOne({
          type: 'translation', mode: 'realtime', model: getModelForBook(book),
          book_id: book.id, page_ids: batch.map(p => p.id),
          input_tokens: result.inputTokens, output_tokens: result.outputTokens,
          cost_usd: cost, status: missing.length > 0 ? 'partial' : 'success',
          duration_ms: result.durationMs, prompt_version: PROMPT_VERSION,
          endpoint: 'worker/hetzner-translate-batch',
          batch_size: batch.length, pages_parsed: result.translations.size,
          timestamp: new Date(),
        });

        consecutiveErrors = 0;
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        pageIdx += batch.length;
      } catch (err) {
        const msg = err.message || String(err);

        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          rotateKey();
          console.log(`  [${label}] Rate limited on batch ${batch[0].page_number}-${batch[batch.length - 1].page_number}, backing off`);
          await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
          // Don't advance pageIdx — retry this batch
        } else {
          // Non-rate-limit error — fall back to single-page for entire batch
          console.log(`  [${label}] Batch failed (${msg.substring(0, 80)}), retrying as single pages`);
          consecutiveErrors++;
          for (const page of batch) {
            try {
              const singleResult = await translatePage(db, page, book, prevTranslation);
              prevTranslation = singleResult.text;
              await writePageTranslation(db, page, singleResult.text, book);
              translated++;
              globalCounter.count++;
              totalInputTokens += singleResult.inputTokens;
              totalOutputTokens += singleResult.outputTokens;
            } catch (fallbackErr) {
              failed++;
              console.error(`  [${label}] Fallback page ${page.page_number} failed: ${(fallbackErr.message || '').substring(0, 80)}`);
            }
          }
          pageIdx += batch.length;
        }
      }
    }

    // Update job progress every 10 pages
    if (translated % 10 === 0 && translated > 0) {
      await db.collection('jobs').updateOne(
        { id: job.id },
        { $set: { 'progress.completed': job.progress.completed + translated, updated_at: new Date() } },
      );
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
  const batchLabel = SINGLE_PAGE ? 'single-page' : `batch-${BATCH_SIZE}`;
  console.log(`\n[TRANSLATE] Worker starting (${batchLabel}) — ${new Date().toISOString()}`);

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
    .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, job: 1, image_source: 1 })
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

  console.log(`[TRANSLATE] Processing ${books.length} books (concurrency: ${CONCURRENCY}, ${batchLabel})`);

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

  console.log(`[TRANSLATE] Done (${batchLabel}) — ${totalTranslated} translated, ${totalFailed} failed, ${totalCompleted} books completed, ${elapsed}s, ~${rate}/hr, $${totalCost.toFixed(3)}`);

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
      batch_size: SINGLE_PAGE ? 1 : BATCH_SIZE,
      summary: `T:${totalTranslated}p ${totalCompleted}b $${totalCost.toFixed(2)} ~${rate}/hr (${batchLabel})`,
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
