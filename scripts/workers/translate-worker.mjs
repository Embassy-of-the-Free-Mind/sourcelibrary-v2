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
import { nanoid } from 'nanoid';

// ── Config ──
const CONCURRENCY = 15;          // Max books translating simultaneously (tuned for 60-connection budget)
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
const PROMPT_VERSION = 'v10';

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

// ── Translation prompt — loaded from DB prompts collection (single source of truth) ──
let _cachedTranslationPrompt = null;
async function getTranslationPromptFromDb(db) {
  if (_cachedTranslationPrompt) return _cachedTranslationPrompt;
  const prompt = await db.collection('prompts').findOne(
    { type: 'translation', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default translation prompt found in DB');
  console.log(`[TRANSLATE] Loaded translation prompt v${prompt.version} from DB`);
  _cachedTranslationPrompt = prompt.content;
  return _cachedTranslationPrompt;
}

// English modernization prompt loaded from DB (single source of truth)
let _cachedEnglishPrompt = null;
async function getEnglishModernizationPromptFromDb(db) {
  if (_cachedEnglishPrompt) return _cachedEnglishPrompt;
  const prompt = await db.collection('prompts').findOne(
    { type: 'english_modernization', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default english_modernization prompt found in DB');
  console.log(`[TRANSLATE] Loaded english modernization prompt v${prompt.version} from DB`);
  _cachedEnglishPrompt = prompt.content;
  return _cachedEnglishPrompt;
}

// ── Skip these page types (no translatable content) ──
const SKIP_PAGE_TYPES = ['blank', 'digitizer-notice', 'illustration', 'map', 'diagram'];
// Pages with very short OCR get excluded from batches (translated single-page instead).
// Short pages in batches cause the model to produce minimal responses without XML tags.
const MIN_OCR_CHARS_FOR_BATCH = 200;

// ── MongoDB ──
const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 20,
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

// ── Safety settings (BLOCK_NONE prevents RECITATION on public domain texts) ──
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

// ── Build prompt header (shared between single and batch) ──
async function buildPromptHeader(db, book) {
  const isEnglish = (book.language || '').toLowerCase() === 'english';
  const translationPrompt = await getTranslationPromptFromDb(db);
  const englishPrompt = await getEnglishModernizationPromptFromDb(db);
  const basePrompt = isEnglish ? englishPrompt : translationPrompt;
  let prompt = basePrompt.replace('{source_language}', book.language || 'Latin');

  const parts = [];
  if (book.display_title || book.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book.author) parts.push(`Author: ${book.author}`);
  if (book.year || book.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;

  // Copyright note — prevents RECITATION filter on public domain texts
  const year = parseInt(book.year || book.published, 10);
  if (year && year < 1930) {
    prompt += `\n\n**Note:** This is a public domain work published in ${year}. It is not under copyright.`;
  }

  return { prompt, isEnglish };
}

// ── Translate a single page ──
async function translatePage(db, page, book, prevTranslation) {
  const { prompt: headerPrompt, isEnglish } = await buildPromptHeader(db, book);
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
  const model = ai.getGenerativeModel({ model: selectedModel, safetySettings: SAFETY_SETTINGS });
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
  const { prompt: headerPrompt, isEnglish } = await buildPromptHeader(db, book);
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
  const model = ai.getGenerativeModel({ model: selectedModel, safetySettings: SAFETY_SETTINGS });
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
async function processBook(db, book, job, globalCounter, deadline) {
  const label = (book.title || book.id).substring(0, 50);
  const pages = await db.collection('pages')
    .find({
      book_id: book.id,
      'ocr.data': { $exists: true, $nin: [null, ''] },
      page_type: { $nin: SKIP_PAGE_TYPES },
      'translation.recitation_blocked': { $ne: true },
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
    return { translated: 0, failed: 0, completed: 1, inputTokens: 0, outputTokens: 0 };
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
  let consecutiveBatchFailures = 0; // Batches where 0 pages parsed — signals broken book
  const MAX_BATCH_FAILURES = 3; // Park book after 3 consecutive total-parse-failure batches

  while (pageIdx < pages.length) {
    // Check global page cap
    if (globalCounter.count >= PAGES_PER_RUN) {
      console.log(`  [${label}] Hit global page cap (${PAGES_PER_RUN}), pausing`);
      break;
    }

    // Check run deadline
    if (deadline && Date.now() > deadline) {
      console.log(`  [${label}] Hit run deadline, parking`);
      break;
    }

    // Check consecutive errors
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.log(`  [${label}] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, stopping`);
      break;
    }

    // Check consecutive batch parse failures — park early instead of grinding through single-page fallbacks
    if (consecutiveBatchFailures >= MAX_BATCH_FAILURES) {
      console.log(`  [${label}] ${consecutiveBatchFailures} consecutive batch parse failures, parking early`);
      break;
    }

    // Heartbeat — keeps zombie reaper from killing live work (every 10 pages)
    if (translated % 10 === 0 && translated > 0) {
      await db.collection('jobs').updateOne(
        { id: job.id },
        { $set: { updated_at: new Date(), pages_processed: translated } },
      );
    }

    // Check if job was cancelled externally (every 50 pages, includes a read)
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

        // Track batch parse failure rate
        if (result.translations.size === 0) {
          consecutiveBatchFailures++;
        } else {
          consecutiveBatchFailures = 0;
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
              const errMsg = fallbackErr.message || '';
              console.error(`  [${label}] Fallback page ${page.page_number} failed: ${errMsg.substring(0, 80)}`);
              if (errMsg.includes('RECITATION')) {
                await db.collection('pages').updateOne(
                  { _id: page._id },
                  { $set: { 'translation.recitation_blocked': true, 'translation.recitation_at': new Date() } }
                );
                console.log(`  [${label}] Page ${page.page_number} marked as RECITATION-blocked (will skip on future runs)`);
              }
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
          consecutiveBatchFailures++;
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
              const errMsg = fallbackErr.message || '';
              console.error(`  [${label}] Fallback page ${page.page_number} failed: ${errMsg.substring(0, 80)}`);
              if (errMsg.includes('RECITATION')) {
                await db.collection('pages').updateOne(
                  { _id: page._id },
                  { $set: { 'translation.recitation_blocked': true, 'translation.recitation_at': new Date() } }
                );
                console.log(`  [${label}] Page ${page.page_number} marked as RECITATION-blocked (will skip on future runs)`);
              }
              failed++;
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

    // Inline milestone counter updates on the enrichment snapshot
    await updateMilestoneCounters(db, {
      oldTranslated: book.pages_translated || 0,
      newTranslated: countAgg?.with_translation || 0,
      pagesOcr: countAgg?.with_ocr || book.pages_ocr || 0,
      pagesBlank: countAgg?.blank || book.pages_blank || 0,
      label,
      bookId: book.id,
    });
  } else {
    // Park this book — it got its 200-page chunk, let other books go first.
    // Status moves to translate_partial so it's no longer picked up as translate_submitted.
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        'pipeline_auto.status': 'translate_partial',
        pages_translated: newCompleted,
        updated_at: new Date(),
        last_translation_at: new Date(),
      }},
    );
    console.log(`  [${label}] Parked — ${translated} this run (${newCompleted}/${job.progress.total} total), moving to translate_partial`);
  }

  return { translated, failed, completed: isComplete ? 1 : 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ── Milestone counter updates ──
// Inline-update the enrichment snapshot's milestone counters when a book
// crosses the 90% or 100% translation threshold.
// The 2-hourly snapshot recompute resets these to ground truth.
async function updateMilestoneCounters(db, { oldTranslated, newTranslated, pagesOcr, pagesBlank, label, bookId }) {
  const denominator = pagesOcr - pagesBlank;
  if (denominator <= 0) return;

  const threshold90 = Math.floor(denominator * 0.9);
  const threshold100 = denominator;
  const inc = {};

  if (oldTranslated < threshold90 && newTranslated >= threshold90) inc['milestones.over_90_pct'] = 1;
  if (oldTranslated < threshold100 && newTranslated >= threshold100) inc['milestones.fully_translated'] = 1;

  if (Object.keys(inc).length === 0) return;

  try {
    await db.collection('system_config').updateOne({ _id: 'enrichment_snapshot' }, { $inc: inc });
    const crossed = Object.keys(inc).map(k => k.split('.')[1]).join(', ');
    console.log(`  [${label}] Milestone crossed for ${bookId}: ${crossed}`);
  } catch (err) {
    console.error(`  [${label}] Failed to update milestone counters:`, err.message);
  }
}

// ── Language speed tiers ──
// Group languages by translation speed so each batch is homogeneous.
// CJK is ~3x slower per page than Latin-script languages.
// Sorting by tier ensures all 40 slots finish at roughly the same time.
function langSpeedTier(lang) {
  if (!lang) return 1; // unknown → treat as Latin-speed
  const l = lang.toLowerCase();
  // Tier 0: Latin-script (fastest) — Latin, German, French, Italian, Dutch, Spanish, etc.
  if (['latin', 'german', 'french', 'italian', 'dutch', 'spanish', 'portuguese', 'english', 'czech', 'polish', 'swedish', 'danish'].includes(l)) return 0;
  // Tier 1: Greek, Hebrew, Arabic, Syriac, Armenian (medium)
  if (['greek', 'hebrew', 'arabic', 'syriac', 'armenian', 'coptic', 'ethiopic', 'persian'].includes(l)) return 1;
  // Tier 2: CJK (slowest — dense content, more tokens)
  if (['chinese', 'japanese', 'korean', 'tibetan', 'sanskrit', 'tamil', 'thai'].includes(l)) return 2;
  return 1; // default to medium
}

// ── Self-dispatch: create jobs for books that need translation ──
// Eliminates the gap between translate-worker finishing and Phase 4 dispatching new books.
async function selfDispatch(db, limit) {
  // Find fresh books (metadata_enriched/ft_verified) — sorted by language speed tier
  // so each batch is homogeneous (all fast or all slow books together).
  const fresh = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $in: ['metadata_enriched', 'ft_verified'] }, 'image_source.provider': { $ne: 'bph' } } },
    { $addFields: { _speedTier: { $switch: {
      branches: [
        { case: { $in: ['$language', ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Spanish', 'Portuguese', 'English', 'Czech', 'Polish', 'Swedish', 'Danish']] }, then: 0 },
        { case: { $in: ['$language', ['Chinese', 'Japanese', 'Korean', 'Tibetan', 'Sanskrit', 'Tamil', 'Thai']] }, then: 2 },
      ],
      default: 1,
    }}}},
    // Books with ≥200 pages fill the full 200-page cap and finish together.
    // Small books finish early, leaving idle slots. Dispatch big books first.
    { $addFields: { _bigBook: { $cond: [{ $gte: ['$pages_count', 200] }, 0, 1] } } },
    // First translations prioritized above speed tier — clear untranslated backlog first
    { $sort: { is_first_translation: -1, _speedTier: 1, _bigBook: 1, hidden: 1 } },
    { $project: { id: 1, title: 1, pages_count: 1, language: 1, 'image_source.provider': 1 } },
    { $limit: limit },
  ]).toArray();

  // If no fresh books, only pull >90% translated partials (near-complete cleanup)
  let candidates = fresh;
  if (fresh.length === 0) {
    candidates = await db.collection('books').aggregate([
      { $match: { 'pipeline_auto.status': 'translate_partial', 'image_source.provider': { $ne: 'bph' } } },
      { $addFields: { _denominator: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] } } },
      { $match: { _denominator: { $gt: 0 }, $expr: { $gte: [{ $divide: ['$pages_translated', '$_denominator'] }, 0.9] } } },
      { $project: { id: 1, title: 1, pages_count: 1, language: 1, 'image_source.provider': 1 } },
      { $sort: { pages_translated: -1 } }, // most-translated first — finish fastest
      { $limit: limit },
    ]).toArray();
    if (candidates.length > 0) {
      console.log(`[TRANSLATE] Self-dispatch: no fresh books, re-queuing ${candidates.length} near-complete (>90%) partials`);
    }
  }

  if (candidates.length === 0) return [];

  const dispatched = [];
  for (const book of candidates) {
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_PAGE_TYPES },
      'translation.recitation_blocked': { $ne: true },
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
      // Already fully translated — advance
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { 'pipeline_auto.status': 'translate_complete', updated_at: new Date() }, $unset: { job: '' } },
      );
      continue;
    }

    const jobId = nanoid(12);
    const label = (book.title || '').substring(0, 50);
    const pageIds = pages.map(p => p.id);

    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: book.id,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: getModelForBook(book),
        language: book.language || 'auto-detect',
      },
      initiated_by: 'translate-worker-self-dispatch',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        'pipeline_auto.status': 'translate_submitted',
        'pipeline_auto.last_updated': new Date(),
        'pipeline_auto.translate_job_id': jobId,
        job: { type: 'hetzner-inline', job_id: jobId },
        updated_at: new Date(),
      }},
    );

    dispatched.push({ ...book, job: { job_id: jobId } });
    console.log(`[TRANSLATE] Self-dispatched: ${label} — ${pageIds.length} pages (job ${jobId})`);
  }

  return dispatched;
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  const batchLabel = SINGLE_PAGE ? 'single-page' : `batch-${BATCH_SIZE}`;
  console.log(`\n[TRANSLATE] Worker starting (${batchLabel}) — ${new Date().toISOString()}`);

  await client.connect();
  const db = client.db('bookstore');

  // Check pause status — no auto-resume (scheduler owns resume decisions)
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const translationPhasePaused = control?.paused_phases?.includes('translation');
  if (control?.paused || translationPhasePaused) {
    const reason = translationPhasePaused ? 'translation phase paused' : 'pipeline paused';
    const pauseAgeMs = control.paused_at ? Date.now() - new Date(control.paused_at).getTime() : Infinity;
    console.log(`[TRANSLATE] ${reason} (${Math.round(pauseAgeMs / 60000)}min ago), exiting`);
    await db.collection('cron_runs').insertOne({
      cron: 'hetzner-translate-worker', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'skipped', failed: false,
      pages_saved: 0, actions: { books_processed: 0, skip_reason: reason },
      errors: [], error_count: 0, summary: `skipped: ${reason}`,
    }).catch(() => {});
    await client.close();
    return;
  }

  // Find books — fresh (0 translated) first, then partials sorted by most remaining pages.
  // Grouping similar workloads per batch minimizes convoy tail waste.
  // Books with <10 pages remaining are auto-completed (overhead not worth it).
  const MIN_REMAINING = 10;
  const proj = { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, job: 1, image_source: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 };

  // Auto-complete near-zero books — job setup overhead exceeds the work
  const nearZero = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $in: ['translate_submitted', 'translate_partial'] } } },
    { $addFields: { _remaining: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $add: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_blank', 0] }] }] } } },
    { $match: { _remaining: { $lt: MIN_REMAINING } } },
    { $limit: 100 },
    { $project: { id: 1, _remaining: 1 } },
  ], { maxTimeMS: 10000 }).toArray();

  if (nearZero.length > 0) {
    const ids = nearZero.map(b => b.id);
    await db.collection('books').updateMany(
      { id: { $in: ids } },
      { $set: { 'pipeline_auto.status': 'translate_complete', updated_at: new Date() }, $unset: { job: '' } },
    );
    await db.collection('jobs').updateMany(
      { book_id: { $in: ids }, type: 'translation', status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'completed', completed_at: new Date(), updated_at: new Date() } },
    );
    console.log(`[TRANSLATE] Auto-completed ${nearZero.length} near-zero books (<${MIN_REMAINING} pages remaining)`);
  }

  // Priority: fresh (untranslated) books first, then only >90% partials to finish them off.
  // All other partials are paused until untranslated backlog clears.
  let books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'translate_submitted', $or: [{ pages_translated: 0 }, { pages_translated: { $exists: false } }] })
    .project(proj).limit(CONCURRENCY).toArray();

  // Only allow >90% translated partials to fill remaining slots (near-complete cleanup)
  if (books.length < CONCURRENCY) {
    const needed = CONCURRENCY - books.length;
    const freshIds = new Set(books.map(b => b.id));
    const nearComplete = await db.collection('books').aggregate([
      { $match: { 'pipeline_auto.status': { $in: ['translate_submitted', 'translate_partial'] }, pages_translated: { $gt: 0 } } },
      { $addFields: {
        _denominator: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] },
        _remaining: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $add: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_blank', 0] }] }] },
      }},
      // Only >90% translated books
      { $match: { _denominator: { $gt: 0 }, $expr: { $gte: [{ $divide: ['$pages_translated', '$_denominator'] }, 0.9] }, _remaining: { $gte: MIN_REMAINING } } },
      { $sort: { _remaining: 1 } }, // least remaining first — finish them fast
      { $limit: needed },
      { $project: proj },
    ]).toArray();
    books = [...books, ...nearComplete.filter(b => !freshIds.has(b.id))];
    if (nearComplete.length > 0) {
      console.log(`[TRANSLATE] Added ${nearComplete.length} near-complete (>90%) partials to fill slots`);
    }
  }

  // Self-dispatch: aggressively fill all remaining slots with fresh books.
  // Partials are limited to >90% only — fresh books get maximum throughput.
  if (books.length < CONCURRENCY) {
    const needed = CONCURRENCY - books.length;
    const dispatched = await selfDispatch(db, needed);
    if (dispatched.length > 0) {
      console.log(`[TRANSLATE] Self-dispatched ${dispatched.length} fresh books (had ${books.length} slots used)`);
      const newBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted', id: { $in: dispatched.map(b => b.id) } })
        .project(proj).toArray();
      books = [...books, ...newBooks].slice(0, CONCURRENCY);
    }
  }

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

  // ── Time-boxed work queue with slot backfill ──
  // Instead of Promise.all(15 books) that waits for the slowest, run a pool
  // that refills slots as books finish. Deadline prevents runaway runs.
  const RUN_DEADLINE_MS = 15 * 60 * 1000; // 15 minutes
  const deadline = startTime + RUN_DEADLINE_MS;
  const globalCounter = { count: 0 };
  const results = [];
  const processedIds = new Set();
  let booksProcessed = 0;

  // Resolve a book's job, then process it. Returns result object.
  async function processWithJob(book) {
    const zero = { translated: 0, failed: 0, completed: 0, inputTokens: 0, outputTokens: 0 };
    let jobId = book.job?.job_id;
    if (!jobId) {
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
    return processBook(db, book, job, globalCounter, deadline);
  }

  // Fetch more books for the queue (excluding already processed)
  async function fetchMoreBooks(limit) {
    const excludeIds = [...processedIds];
    const fresh = await db.collection('books')
      .find({ 'pipeline_auto.status': 'translate_submitted', id: { $nin: excludeIds } })
      .project(proj).limit(limit).toArray();
    // Only backfill with >90% translated partials (near-complete cleanup)
    if (fresh.length < limit) {
      const partial = await db.collection('books').aggregate([
        { $match: { 'pipeline_auto.status': { $in: ['translate_submitted', 'translate_partial'] }, pages_translated: { $gt: 0 }, id: { $nin: [...excludeIds, ...fresh.map(b => b.id)] } } },
        { $addFields: {
          _denominator: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] },
          _remaining: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $add: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_blank', 0] }] }] },
        }},
        { $match: { _denominator: { $gt: 0 }, $expr: { $gte: [{ $divide: ['$pages_translated', '$_denominator'] }, 0.9] }, _remaining: { $gte: MIN_REMAINING } } },
        { $sort: { _remaining: 1 } },
        { $limit: limit - fresh.length },
        { $project: proj },
      ], { maxTimeMS: 10000 }).toArray();
      fresh.push(...partial);
    }
    // Also try self-dispatch if we still have room
    if (fresh.length < limit) {
      const dispatched = await selfDispatch(db, limit - fresh.length);
      if (dispatched.length > 0) {
        const newBooks = await db.collection('books')
          .find({ 'pipeline_auto.status': 'translate_submitted', id: { $in: dispatched.map(b => b.id) } })
          .project(proj).toArray();
        fresh.push(...newBooks);
        if (newBooks.length > 0) console.log(`[TRANSLATE] Self-dispatched ${newBooks.length} fresh books mid-run`);
      }
    }
    return fresh;
  }

  console.log(`[TRANSLATE] Starting pool (concurrency: ${CONCURRENCY}, deadline: ${Math.round(RUN_DEADLINE_MS/60000)}min, ${batchLabel})`);

  // Seed the queue with initial books, sorted by speed tier (fast/batch-able first)
  // This ensures Latin-script books (batch-5, ~5x faster) fill slots before manuscripts
  const queue = [...books].sort((a, b) => langSpeedTier(a.language) - langSpeedTier(b.language));
  books.forEach(b => processedIds.add(b.id));
  let activeSlots = 0;

  // Process books through a concurrency-limited pool with backfill
  await new Promise((resolvePool) => {
    function tryStartNext() {
      // Check deadline and page cap
      if (Date.now() > deadline || globalCounter.count >= PAGES_PER_RUN) {
        if (activeSlots === 0) resolvePool();
        return;
      }

      while (activeSlots < CONCURRENCY && queue.length > 0) {
        const book = queue.shift();
        activeSlots++;
        booksProcessed++;

        processWithJob(book).then(result => {
          activeSlots--;
          results.push(result);

          // If queue is getting low, fetch more
          if (queue.length < 3 && Date.now() < deadline && globalCounter.count < PAGES_PER_RUN) {
            fetchMoreBooks(CONCURRENCY).then(more => {
              const newBooks = more.filter(b => !processedIds.has(b.id));
              // Sort fast books first so they fill freed slots before slow manuscripts
              newBooks.sort((a, b) => langSpeedTier(a.language) - langSpeedTier(b.language));
              newBooks.forEach(b => { processedIds.add(b.id); queue.push(b); });
              if (newBooks.length > 0) console.log(`[TRANSLATE] Backfilled ${newBooks.length} books (queue: ${queue.length})`);
              tryStartNext();
            }).catch(() => tryStartNext());
          } else {
            tryStartNext();
          }
        }).catch(err => {
          activeSlots--;
          console.error(`[TRANSLATE] processWithJob error: ${err.message}`);
          results.push({ translated: 0, failed: 0, completed: 0, inputTokens: 0, outputTokens: 0 });
          tryStartNext();
        });
      }

      // No more books and nothing active — done
      if (activeSlots === 0 && queue.length === 0) {
        // Try one more fetch before giving up
        if (Date.now() < deadline && globalCounter.count < PAGES_PER_RUN) {
          fetchMoreBooks(CONCURRENCY).then(more => {
            const newBooks = more.filter(b => !processedIds.has(b.id));
            newBooks.forEach(b => { processedIds.add(b.id); queue.push(b); });
            if (newBooks.length > 0) {
              console.log(`[TRANSLATE] Refilled ${newBooks.length} books after queue empty`);
              tryStartNext();
            } else {
              resolvePool(); // truly done
            }
          }).catch(() => resolvePool());
        } else {
          resolvePool();
        }
      }
    }

    tryStartNext();
  });

  const totalTranslated = results.reduce((s, r) => s + r.translated, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalCompleted = results.reduce((s, r) => s + r.completed, 0);
  const totalInputTokens = results.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = results.reduce((s, r) => s + r.outputTokens, 0);
  const totalCost = calculateCost(totalInputTokens, totalOutputTokens);
  const durationMs = Date.now() - startTime;
  const elapsed = (durationMs / 1000).toFixed(1);
  const rate = durationMs > 0 ? Math.round(totalTranslated / (durationMs / 3600000)) : 0;

  const hitDeadline = Date.now() >= deadline;
  const pagesPerMin = durationMs > 0 ? (totalTranslated / (durationMs / 60000)).toFixed(1) : 0;
  console.log(`[TRANSLATE] Done (${batchLabel}) — ${totalTranslated}p ${booksProcessed}b ${totalCompleted} completed, ${elapsed}s, ${pagesPerMin}p/min ~${rate}/hr, $${totalCost.toFixed(3)}${hitDeadline ? ' [deadline]' : ''}`);

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
        books_processed: booksProcessed,
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
      summary: `T:${totalTranslated}p ${booksProcessed}b(${totalCompleted}done) ${pagesPerMin}p/min $${totalCost.toFixed(2)} ~${rate}/hr${hitDeadline ? ' [deadline]' : ''}`,
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
