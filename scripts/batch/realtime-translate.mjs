#!/usr/bin/env node
/**
 * Realtime Translation — direct Gemini API calls, sequential per book.
 * Processes pages in order within each book so previous-page context
 * can be passed for translation continuity.
 *
 * Multiple books are processed in parallel (--book-concurrency),
 * but pages within each book are strictly sequential.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch/realtime-translate.mjs [options]
 *
 * Targeting options:
 *   --book-id=ID          Single book only
 *   --status=STATUS       Filter by pipeline_auto.status (e.g. ocr_complete)
 *   --provider=NAME       Filter by image_source.provider
 *   --stale               Re-translate pages where OCR is newer than translation
 *   --offset=N            Skip first N eligible books (for splitting across machines)
 *
 * Control options:
 *   --limit=N             Max pages total (default: 5000)
 *   --book-limit=N        Max books to process (default: 100)
 *   --book-concurrency=N  Parallel books (default: 5)
 *   --dry-run             Show what would be processed
 */

import { MongoClient } from 'mongodb';

// --- Config ---
const TARGET_MODEL = 'gemini-3-flash-preview';
const TARGET_PROMPT = 'v5.2026-02';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SKIP_PAGE_TYPES = ['blank'];

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_PAGES = parseInt(getArg('limit') || '5000', 10);
const BOOK_LIMIT = parseInt(getArg('book-limit') || '100', 10);
const BOOK_CONCURRENCY = parseInt(getArg('book-concurrency') || '5', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const OFFSET = parseInt(getArg('offset') || '0', 10);
const PIPELINE_STATUS = getArg('status');
const PROVIDER = getArg('provider');
const AUTHOR = getArg('author');
const STALE_MODE = hasFlag('stale');

// --- API key rotation ---
function getAllApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY_TIER3) keys.push({ key: process.env.GEMINI_API_KEY_TIER3, name: 'TIER3' });
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push({ key: k, name: `KEY_${i}` });
  }
  if (process.env.GEMINI_API_KEY) keys.push({ key: process.env.GEMINI_API_KEY, name: 'PRIMARY' });
  if (keys.length === 0) throw new Error('No GEMINI_API_KEY found in env');
  return keys;
}

let currentKeyIndex = 0;
const apiKeys = getAllApiKeys();
console.log(`API keys: ${apiKeys.map(k => k.name).join(', ')}`);

function getNextKey() {
  const k = apiKeys[currentKeyIndex % apiKeys.length];
  currentKeyIndex++;
  return k;
}

// --- Gemini API call ---
async function callGemini(promptText, apiKey) {
  const url = `${GEMINI_API_BASE}/models/${TARGET_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Gemini ${response.status}: ${errorText.substring(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = result.usageMetadata || {};
  return {
    text,
    usage: { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 },
  };
}

// --- Translation prompt ---
async function getTranslationPrompt(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'translation', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default translation prompt found in DB');
  console.log(`Translation prompt: ${prompt.name} v${prompt.version}`);
  return prompt.content;
}

// English modernization prompt (hardcoded, same as in code)
const ENGLISH_MODERNIZATION_PROMPT = `You are a specialist in Early Modern English (pre-1700). Your task is to modernize the following text into clear, contemporary English while preserving the author's meaning, tone, and intent.

**Rules:**
- Update archaic spelling, grammar, and vocabulary to modern equivalents
- Preserve proper nouns, titles, and technical terms
- Keep the paragraph structure intact
- Do NOT summarize or abridge — modernize every sentence
- If a passage is ambiguous, choose the most likely modern reading
- Output ONLY the modernized text, no commentary`;

function buildTranslationPrompt(basePrompt, ocrText, language, previousTranslation) {
  const isEnglish = language.toLowerCase() === 'english';

  let prompt;
  if (isEnglish) {
    prompt = ENGLISH_MODERNIZATION_PROMPT;
    prompt += `\n\n**Text to modernize:**\n${ocrText}`;
    if (previousTranslation) {
      prompt += `\n\n**Previous page (modernized) for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
    }
  } else {
    prompt = basePrompt
      .replace('{language}', language)
      .replace('{sourceLanguage}', language)
      .replace('{targetLanguage}', 'English');
    prompt += `\n\n**Text to translate:**\n${ocrText}`;
    if (previousTranslation) {
      prompt += `\n\n**Previous page translation for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
    }
  }

  return prompt;
}

// --- Extract translation metadata (simplified) ---
function extractTranslationMetadata(text) {
  const meta = {};
  // Extract any <term> tags for vocabulary
  const terms = [];
  const termMatches = text.matchAll(/<term>(.*?)<\/term>/gi);
  for (const m of termMatches) terms.push(m[1].trim());
  if (terms.length > 0) meta.detected_terms = terms;
  return meta;
}

// --- Process one book sequentially ---
async function processBook(book, pages, basePrompt, db, globalStats) {
  const language = book.language || book.original_language || 'Latin';
  let previousTranslation = null;
  let bookCompleted = 0, bookFailed = 0, bookSkipped = 0;

  // Get the last translated page before our range for context seeding
  if (pages.length > 0 && pages[0].page_number > 1) {
    const prevPage = await db.collection('pages').findOne({
      book_id: book.id,
      page_number: pages[0].page_number - 1,
      'translation.data': { $exists: true, $ne: '' },
    });
    if (prevPage?.translation?.data) {
      previousTranslation = prevPage.translation.data;
    }
  }

  for (const page of pages) {
    // Check global limit
    if (globalStats.completed + globalStats.failed >= MAX_PAGES) break;

    // Skip pages without meaningful OCR
    if (!page.ocr?.data || page.ocr.data.length < 10) {
      bookSkipped++;
      globalStats.skipped++;
      continue;
    }

    // Skip blank/illustration pages
    if (page.page_type && SKIP_PAGE_TYPES.includes(page.page_type)) {
      bookSkipped++;
      globalStats.skipped++;
      previousTranslation = null; // reset context
      continue;
    }

    const keyInfo = getNextKey();
    const startTime = Date.now();

    try {
      const prompt = buildTranslationPrompt(basePrompt, page.ocr.data, language, previousTranslation);
      const result = await callGemini(prompt, keyInfo.key);
      const durationMs = Date.now() - startTime;

      if (!result.text || result.text.length < 5) {
        bookSkipped++;
        globalStats.skipped++;
        previousTranslation = null;
        continue;
      }

      // Garbage guard
      if (result.text.startsWith('Please provide') || result.text.startsWith('Already in English')) {
        bookSkipped++;
        globalStats.skipped++;
        previousTranslation = null;
        continue;
      }

      const translationMeta = extractTranslationMetadata(result.text);

      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            translation: {
              data: result.text,
              language: 'English',
              model: TARGET_MODEL,
              updated_at: new Date(),
              source: 'ai',
              prompt_version: TARGET_PROMPT,
            },
            ...translationMeta,
            updated_at: new Date(),
          },
        }
      );

      // Non-blocking usage log
      db.collection('gemini_usage').insertOne({
        type: 'translate', mode: 'realtime', model: TARGET_MODEL,
        book_id: book.id, page_ids: [page.id],
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        status: 'success', duration_ms: durationMs,
        prompt_version: TARGET_PROMPT,
        endpoint: 'scripts/realtime-translate.mjs',
        timestamp: new Date(),
      }).catch(() => {});

      previousTranslation = result.text;
      bookCompleted++;
      globalStats.completed++;
      globalStats.totalTokens += (result.usage.inputTokens + result.usage.outputTokens);

    } catch (error) {
      const durationMs = Date.now() - startTime;

      db.collection('gemini_usage').insertOne({
        type: 'translate', mode: 'realtime', model: TARGET_MODEL,
        book_id: book.id, page_ids: [page.id],
        status: 'error', error_message: error.message?.substring(0, 200),
        duration_ms: durationMs, prompt_version: TARGET_PROMPT,
        endpoint: 'scripts/realtime-translate.mjs', timestamp: new Date(),
      }).catch(() => {});

      bookFailed++;
      globalStats.failed++;
      previousTranslation = null; // don't chain from a failed page

      if (error.status === 429) {
        console.log(`\n  Rate limited (${keyInfo.name}). Waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
      }

      // If 5+ consecutive failures for this book, skip the rest
      if (bookFailed >= 5 && bookCompleted === 0) {
        console.log(`\n  5 failures for book ${book.id}, skipping rest`);
        break;
      }
    }

    // Progress
    const elapsed = ((Date.now() - globalStats.startTime) / 1000).toFixed(0);
    const total = globalStats.completed + globalStats.failed + globalStats.skipped;
    const ppm = elapsed > 0 ? (globalStats.completed / (elapsed / 60)).toFixed(1) : '0';
    process.stdout.write(
      `\r  ${total}/${globalStats.totalPages} | ${globalStats.completed} ok ${globalStats.failed} err | ${ppm} p/min | ${elapsed}s`
    );
  }

  // Update book translation count
  if (bookCompleted > 0) {
    try {
      const translatedCount = await db.collection('pages').countDocuments({
        book_id: book.id, 'translation.data': { $exists: true, $ne: '' }
      });
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { pages_translated: translatedCount, last_translation_at: new Date(), updated_at: new Date() } }
      );
    } catch (e) { /* non-critical */ }
  }

  return { completed: bookCompleted, failed: bookFailed, skipped: bookSkipped };
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Realtime Translation ===`);
  console.log(`  limit=${MAX_PAGES} book_limit=${BOOK_LIMIT} book_concurrency=${BOOK_CONCURRENCY} offset=${OFFSET}`);
  if (SINGLE_BOOK) console.log(`  book=${SINGLE_BOOK}`);
  if (AUTHOR) console.log(`  author=${AUTHOR}`);
  if (PIPELINE_STATUS) console.log(`  status=${PIPELINE_STATUS}`);
  if (PROVIDER) console.log(`  provider=${PROVIDER}`);
  if (STALE_MODE) console.log(`  mode=stale (OCR newer than translation)`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // --- Find eligible books ---
    const bookFilter = {};
    if (SINGLE_BOOK) {
      bookFilter.id = SINGLE_BOOK;
    } else {
      if (PIPELINE_STATUS) bookFilter['pipeline_auto.status'] = PIPELINE_STATUS;
      if (PROVIDER) bookFilter['image_source.provider'] = PROVIDER;
      if (AUTHOR) bookFilter.author = { $regex: AUTHOR, $options: 'i' };
      // Only books with some OCR done
      bookFilter.pages_ocr = { $gt: 0 };
    }

    const books = await db.collection('books')
      .find(bookFilter)
      .project({ id: 1, _id: 0, title: 1, language: 1, original_language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 })
      .sort({ read_count: -1 }) // popular books first
      .skip(OFFSET)
      .limit(BOOK_LIMIT)
      .toArray();

    console.log(`Books matched: ${books.length}`);

    // --- Find untranslated pages per book ---
    // Query by book_id (indexed) and filter translation status in JS
    // This avoids slow unindexed queries on translation.data
    const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
    const bookPages = [];
    let totalPages = 0;

    console.log(`Querying pages for ${books.length} books...`);
    for (const book of books) {
      if (totalPages >= MAX_PAGES) break;

      const pages = await db.collection('pages')
        .find(
          { book_id: book.id },
          {
            projection: {
              id: 1, _id: 0, book_id: 1, page_number: 1,
              'ocr.data': 1, 'ocr.updated_at': 1,
              'translation.data': 1, 'translation.updated_at': 1,
              page_type: 1,
            },
          }
        )
        .sort({ page_number: 1 })
        .toArray();

      // Filter in JS — much faster than unindexed MongoDB queries
      const eligible = pages.filter(p => {
        const hasOcr = p.ocr?.data && p.ocr.data.length > 0;
        if (!hasOcr) return false;
        if (STALE_MODE) {
          return p.ocr?.updated_at && p.translation?.updated_at &&
            new Date(p.ocr.updated_at) > new Date(p.translation.updated_at);
        }
        return !p.translation?.data;
      });

      if (eligible.length > 0) {
        const take = eligible.slice(0, MAX_PAGES - totalPages);
        bookPages.push({ book, pages: take });
        totalPages += take.length;
      }
      process.stdout.write(`\r  Scanned ${bookPages.length} books, ${totalPages} pages...`);
    }
    console.log('');

    console.log(`Total pages to translate: ${totalPages} across ${bookPages.length} books\n`);

    if (totalPages === 0) {
      console.log('Nothing to translate.');
      await client.close();
      return;
    }

    if (DRY_RUN) {
      const langCounts = {};
      for (const { book, pages } of bookPages) {
        const lang = book.language || book.original_language || 'Unknown';
        langCounts[lang] = (langCounts[lang] || 0) + pages.length;
        const pct = book.pages_count > 0 ? Math.round((book.pages_translated || 0) / book.pages_count * 100) : 0;
        console.log(`  ${(book.title || book.id).substring(0, 50).padEnd(52)} ${pages.length.toString().padStart(5)} pages  ${lang.padEnd(10)} ${pct}% done`);
      }

      console.log('\nBy language:');
      for (const [lang, count] of Object.entries(langCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${lang.padEnd(15)} ${count}`);
      }

      const estCost = totalPages * 0.0022;
      console.log(`\nEstimated cost: $${estCost.toFixed(2)} (realtime pricing)`);
      // Sequential per book but parallel across books
      const estMinutes = Math.round(totalPages / (BOOK_CONCURRENCY * 10) / 60);
      console.log(`Estimated time: ~${estMinutes} minutes at ${BOOK_CONCURRENCY} books parallel`);

      await client.close();
      return;
    }

    // Get translation prompt
    const basePrompt = await getTranslationPrompt(db);

    // Process books in parallel batches
    const globalStats = {
      completed: 0, failed: 0, skipped: 0,
      totalTokens: 0, totalPages: totalPages,
      startTime: Date.now(),
    };

    for (let i = 0; i < bookPages.length; i += BOOK_CONCURRENCY) {
      if (globalStats.completed + globalStats.failed >= MAX_PAGES) break;

      const batch = bookPages.slice(i, i + BOOK_CONCURRENCY);
      const bookNames = batch.map(b => (b.book.title || b.book.id).substring(0, 30));
      console.log(`\nBatch ${Math.floor(i / BOOK_CONCURRENCY) + 1}: ${bookNames.join(', ')}`);

      await Promise.allSettled(
        batch.map(({ book, pages }) => processBook(book, pages, basePrompt, db, globalStats))
      );
    }

    const elapsed = ((Date.now() - globalStats.startTime) / 1000).toFixed(0);
    console.log(`\n\n=== Summary ===`);
    console.log(`Completed: ${globalStats.completed}`);
    console.log(`Failed: ${globalStats.failed}`);
    console.log(`Skipped: ${globalStats.skipped}`);
    console.log(`Tokens: ${globalStats.totalTokens.toLocaleString()}`);
    console.log(`Books: ${bookPages.length}`);
    console.log(`Elapsed: ${elapsed}s`);
    console.log(`Rate: ${(globalStats.completed / (elapsed / 60)).toFixed(1)} pages/min`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
