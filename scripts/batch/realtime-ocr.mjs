#!/usr/bin/env node
/**
 * Realtime OCR — direct Gemini API calls with concurrency control.
 * Generalized version that can target any books in the library.
 * Designed for Tier 3 API keys with high rate limits.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch/realtime-ocr.mjs [options]
 *
 * Targeting options (combine as needed):
 *   --no-ocr           Pages with NO OCR at all (default)
 *   --old-ocr          Pages with old models or old prompt versions
 *   --all              All pages (re-OCR everything, requires --book-id)
 *   --book-id=ID       Single book only
 *   --status=STATUS    Filter by pipeline_auto.status (e.g. archive_complete, ocr_complete)
 *   --provider=NAME    Filter by image_source.provider (e.g. ia, gallica, efm)
 *   --offset=N         Skip first N eligible pages (for splitting across machines)
 *
 * Control options:
 *   --limit=N          Max pages to process (default: 2000)
 *   --concurrency=N    Parallel API calls (default: 30)
 *   --dry-run          Show what would be processed, don't call Gemini
 */

import { MongoClient } from 'mongodb';

// --- Config ---
const TARGET_MODEL = 'gemini-3-flash-preview';
const TARGET_PROMPT = 'v5.2026-02';
const ACCEPTABLE_PROMPTS = ['v5.2026-02', 'v4.2026-02', 'v3.2026-02'];
const SKIP_SOURCES = ['manual', 'manual-correction'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_PAGES = parseInt(getArg('limit') || '2000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '30', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const OFFSET = parseInt(getArg('offset') || '0', 10);
const PIPELINE_STATUS = getArg('status');
const PROVIDER = getArg('provider');

// Targeting mode
const MODE_NO_OCR = hasFlag('no-ocr');
const MODE_OLD_OCR = hasFlag('old-ocr');
const MODE_ALL = hasFlag('all');
// Default to no-ocr if nothing specified
const targetMode = MODE_ALL ? 'all' : MODE_OLD_OCR ? 'old-ocr' : 'no-ocr';

if (MODE_ALL && !SINGLE_BOOK) {
  console.error('--all requires --book-id to prevent accidental full re-OCR');
  process.exit(1);
}

// --- API key rotation ---
function getAllApiKeys() {
  const keys = [];
  // Tier 3 first — highest limits
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
const rateLimitedKeys = new Map(); // keyName -> unblock timestamp
const RATE_LIMIT_COOLDOWN = 5 * 60 * 1000; // 5 min cooldown for rate-limited keys
console.log(`API keys: ${apiKeys.map(k => k.name).join(', ')}`);

function getNextKey() {
  const now = Date.now();
  // Try up to apiKeys.length times to find a non-rate-limited key
  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const k = apiKeys[currentKeyIndex % apiKeys.length];
    currentKeyIndex++;
    const blockedUntil = rateLimitedKeys.get(k.name);
    if (!blockedUntil || now >= blockedUntil) {
      rateLimitedKeys.delete(k.name);
      return k;
    }
  }
  // All keys rate-limited — return the one that unblocks soonest
  let soonest = apiKeys[0];
  let soonestTime = Infinity;
  for (const k of apiKeys) {
    const t = rateLimitedKeys.get(k.name) || 0;
    if (t < soonestTime) { soonestTime = t; soonest = k; }
  }
  return soonest;
}

function markKeyRateLimited(keyName) {
  rateLimitedKeys.set(keyName, Date.now() + RATE_LIMIT_COOLDOWN);
  const active = apiKeys.filter(k => !rateLimitedKeys.has(k.name)).map(k => k.name);
  console.log(`\n  Key ${keyName} rate-limited (5min cooldown). Active keys: ${active.join(', ') || 'NONE — will wait'}`);
}

// --- Image helpers ---
function getPageImageUrl(page) {
  if (page.crop && page.cropped_photo) return page.cropped_photo;
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) return page.archived_photo;
  return page.photo_original || page.photo || null;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  let mimeType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!mimeType || mimeType === 'application/octet-stream') {
    if (url.endsWith('.jpg') || url.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (url.endsWith('.png')) mimeType = 'image/png';
    else if (url.endsWith('.webp')) mimeType = 'image/webp';
    else if (url.endsWith('.tif') || url.endsWith('.tiff')) mimeType = 'image/tiff';
    else mimeType = 'image/jpeg';
  }
  return { data: Buffer.from(buffer).toString('base64'), mimeType };
}

// --- OCR prompt ---
async function getOcrPrompt(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');
  console.log(`Prompt: ${prompt.name} v${prompt.version}`);
  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;
  return prompt.content
    .replace('{language_instruction}', languageInstruction)
    .replace('{language}', '');
}

// --- Gemini API call ---
async function callGemini(imageBase64, mimeType, promptText, apiKey) {
  const url = `${GEMINI_API_BASE}/models/${TARGET_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: promptText },
        { inlineData: { mimeType, data: imageBase64 } },
      ]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(180000),
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

// --- Extract metadata from OCR text ---
function extractPageType(text) {
  const match = text.match(/<page-type>\s*(.*?)\s*<\/page-type>/i);
  return match ? match[1].toLowerCase().trim() : null;
}

function extractColumns(text) {
  const match = text.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= 2 ? n : null;
}

function parseDetectedImages(text) {
  const imageBlocks = text.match(/<detected-images>[\s\S]*?<\/detected-images>/gi);
  if (!imageBlocks) return [];
  const images = [];
  for (const block of imageBlocks) {
    const imageMatches = block.match(/<image>[\s\S]*?<\/image>/gi);
    if (!imageMatches) continue;
    for (const imgBlock of imageMatches) {
      const desc = imgBlock.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.trim();
      const type = imgBlock.match(/<type>([\s\S]*?)<\/type>/i)?.[1]?.trim();
      const bbox = imgBlock.match(/<bounding-box>([\s\S]*?)<\/bounding-box>/i)?.[1]?.trim();
      if (desc || type) {
        const img = { description: desc || '', type: type || 'illustration' };
        if (bbox) {
          const coords = bbox.split(',').map(s => parseInt(s.trim(), 10));
          if (coords.length === 4 && coords.every(c => !isNaN(c))) {
            img.bbox = { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
          }
        }
        images.push(img);
      }
    }
  }
  return images;
}

// --- Process one page ---
async function processPage(page, promptText, db) {
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl) return { pageId: page.id, status: 'skip', reason: 'no image' };

  const startTime = Date.now();
  const keyInfo = getNextKey();

  try {
    const image = await fetchImageBuffer(imageUrl);
    const result = await callGemini(image.data, image.mimeType, promptText, keyInfo.key);
    const durationMs = Date.now() - startTime;

    if (!result.text || result.text.length < 5) {
      return { pageId: page.id, status: 'empty', durationMs };
    }

    // Hallucination guard
    if (result.text.length > 25000) {
      return { pageId: page.id, status: 'skip', reason: 'hallucination (>25k chars)', durationMs };
    }

    const pageType = extractPageType(result.text);
    const columns = extractColumns(result.text);
    const detectedImages = parseDetectedImages(result.text);

    await db.collection('pages').updateOne(
      { id: page.id },
      {
        $set: {
          ocr: {
            data: result.text,
            language: 'auto-detect',
            model: TARGET_MODEL,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: TARGET_PROMPT,
          },
          ...(pageType && { page_type: pageType }),
          ...(columns && { columns }),
          ...(detectedImages.length > 0 && { detected_images: detectedImages }),
          updated_at: new Date(),
        },
      }
    );

    // Non-blocking usage log
    db.collection('gemini_usage').insertOne({
      type: 'ocr',
      mode: 'realtime',
      model: TARGET_MODEL,
      book_id: page.book_id,
      page_ids: [page.id],
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      status: 'success',
      duration_ms: durationMs,
      prompt_version: TARGET_PROMPT,
      endpoint: 'scripts/realtime-ocr.mjs',
      timestamp: new Date(),
    }).catch(() => {});

    return {
      pageId: page.id, status: 'success',
      chars: result.text.length, durationMs,
      key: keyInfo.name,
      tokens: result.usage.inputTokens + result.usage.outputTokens,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    db.collection('gemini_usage').insertOne({
      type: 'ocr', mode: 'realtime', model: TARGET_MODEL,
      book_id: page.book_id, page_ids: [page.id],
      status: 'error', error_message: error.message?.substring(0, 200),
      duration_ms: durationMs, prompt_version: TARGET_PROMPT,
      endpoint: 'scripts/realtime-ocr.mjs', timestamp: new Date(),
    }).catch(() => {});

    return {
      pageId: page.id, status: 'error',
      error: error.message?.substring(0, 100),
      httpStatus: error.status, durationMs, key: keyInfo.name,
    };
  }
}

// --- Concurrent processor ---
async function processBatch(pages, promptText, db, runId) {
  let completed = 0, failed = 0, skipped = 0;
  let totalTokens = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();
  const bookPages = {}; // bookId -> { success: N, failed: N }

  // Build page-to-book mapping for accurate tracking
  const pageBookMap = {};
  for (const p of pages) pageBookMap[p.id] = p.book_id;

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    if (consecutiveErrors >= 20) {
      console.log(`\n  20 consecutive errors — stopping early`);
      break;
    }

    const chunk = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(page => processPage(page, promptText, db))
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const pageId = chunk[j]?.id;
      const bid = pageBookMap[pageId];

      if (r.status === 'rejected') { failed++; consecutiveErrors++; continue; }
      const result = r.value;
      if (result.status === 'success') {
        completed++; consecutiveErrors = 0;
        totalTokens += result.tokens || 0;
        if (bid) {
          if (!bookPages[bid]) bookPages[bid] = { success: 0, failed: 0 };
          bookPages[bid].success++;
        }
      } else if (result.status === 'error') {
        failed++;
        if (bid) {
          if (!bookPages[bid]) bookPages[bid] = { success: 0, failed: 0 };
          bookPages[bid].failed++;
        }
        if (result.httpStatus === 429) {
          markKeyRateLimited(result.key);
          const activeKeys = apiKeys.filter(k => !rateLimitedKeys.has(k.name));
          if (activeKeys.length === 0) {
            consecutiveErrors++;
            console.log(`\n  All keys rate-limited. Waiting 60s...`);
            await new Promise(r => setTimeout(r, 60000));
          }
        } else {
          consecutiveErrors++;
        }
      } else {
        skipped++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pagesPerMin = elapsed > 0 ? (completed / (elapsed / 60)).toFixed(1) : '0';
    const remaining = pages.length - (completed + failed + skipped);
    const eta = pagesPerMin > 0 ? Math.round(remaining / pagesPerMin) : '?';
    process.stdout.write(
      `\r  ${completed + failed + skipped}/${pages.length} | ${completed} ok ${failed} err ${skipped} skip | ${pagesPerMin} p/min | ETA ${eta}min`
    );

    // Periodic run record update (every 500 pages)
    if (runId && (completed + failed + skipped) % 500 < CONCURRENCY) {
      db.collection('jobs').updateOne(
        { id: runId },
        { $set: { progress: { completed, failed, skipped, total: pages.length }, updated_at: new Date() } }
      ).catch(() => {});
    }
  }

  console.log('');

  // Update book page counts and advance pipeline status
  let booksCompleted = 0;
  for (const [bookId, counts] of Object.entries(bookPages)) {
    try {
      const ocrCount = await db.collection('pages').countDocuments({
        book_id: bookId, 'ocr.data': { $exists: true, $ne: '' }
      });
      const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
      const ocrPercent = totalPages > 0 ? Math.round(ocrCount / totalPages * 100) : 0;

      const bookUpdate = { pages_ocr: ocrCount, updated_at: new Date() };

      // If book is fully OCR'd (>= 95%), advance pipeline to ocr_complete
      if (ocrPercent >= 95) {
        bookUpdate['pipeline_auto.status'] = 'ocr_complete';
        bookUpdate['pipeline_auto.last_updated'] = new Date();
        booksCompleted++;
      }

      await db.collection('books').updateOne({ id: bookId }, { $set: bookUpdate });
    } catch (e) {
      console.error(`  Failed to update book ${bookId}:`, e.message);
    }
  }

  if (booksCompleted > 0) {
    console.log(`  Advanced ${booksCompleted} books to ocr_complete`);
  }

  return { completed, failed, skipped, totalTokens, elapsed: Date.now() - startTime, booksUpdated: Object.keys(bookPages).length, booksCompleted };
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Realtime OCR ===`);
  console.log(`  mode=${targetMode} limit=${MAX_PAGES} concurrency=${CONCURRENCY} offset=${OFFSET}`);
  if (SINGLE_BOOK) console.log(`  book=${SINGLE_BOOK}`);
  if (PIPELINE_STATUS) console.log(`  pipeline_status=${PIPELINE_STATUS}`);
  if (PROVIDER) console.log(`  provider=${PROVIDER}`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // --- Build book filter ---
    let bookIds = null;
    if (SINGLE_BOOK) {
      bookIds = [SINGLE_BOOK];
    } else {
      const bookFilter = { hidden: { $ne: true } }; // Only visible (launch set) books
      if (PIPELINE_STATUS) bookFilter['pipeline_auto.status'] = PIPELINE_STATUS;
      if (PROVIDER) bookFilter['image_source.provider'] = PROVIDER;

      if (Object.keys(bookFilter).length > 0) {
        const books = await db.collection('books')
          .find(bookFilter).project({ id: 1, _id: 0 }).toArray();
        bookIds = books.map(b => b.id);
        console.log(`Matched ${bookIds.length} books`);
      }
    }

    // --- Build page filter ---
    const pageFilter = {};
    if (bookIds) pageFilter.book_id = { $in: bookIds };

    if (targetMode === 'no-ocr') {
      pageFilter.$or = [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': '' },
        { 'ocr.data': null },
      ];
    } else if (targetMode === 'old-ocr') {
      pageFilter['ocr.data'] = { $exists: true, $ne: '' };
      pageFilter['ocr.source'] = { $nin: SKIP_SOURCES };
      pageFilter.$or = [
        { 'ocr.model': { $ne: TARGET_MODEL } },
        { 'ocr.prompt_version': { $nin: ACCEPTABLE_PROMPTS } },
      ];
    }
    // 'all' mode: no OCR filter — re-OCR everything

    // Always need an image
    pageFilter.$and = [
      { $or: [
        { cropped_photo: { $exists: true, $ne: null } },
        { archived_photo: { $exists: true, $ne: null, $not: /^failed:/ } },
        { photo_original: { $exists: true, $ne: null } },
        { photo: { $exists: true, $ne: null } },
      ]}
    ];

    const totalEligible = await db.collection('pages').countDocuments(pageFilter);
    console.log(`Eligible pages: ${totalEligible.toLocaleString()}`);

    if (totalEligible === 0) {
      console.log('Nothing to process.');
      await client.close();
      return;
    }

    const pages = await db.collection('pages').find(pageFilter, {
      projection: {
        id: 1, _id: 0, book_id: 1, page_number: 1,
        photo: 1, photo_original: 1, archived_photo: 1,
        cropped_photo: 1, crop: 1,
        'ocr.model': 1, 'ocr.prompt_version': 1,
      },
    }).sort({ book_id: 1, page_number: 1 }).skip(OFFSET).limit(MAX_PAGES).toArray();

    console.log(`Processing ${pages.length} of ${totalEligible} (offset ${OFFSET})\n`);

    if (DRY_RUN) {
      // Breakdown
      const bookCounts = {};
      const modelCounts = {};
      for (const p of pages) {
        bookCounts[p.book_id] = (bookCounts[p.book_id] || 0) + 1;
        const key = targetMode === 'no-ocr' ? 'no-ocr'
          : `${p.ocr?.model || 'none'} + ${p.ocr?.prompt_version || 'none'}`;
        modelCounts[key] = (modelCounts[key] || 0) + 1;
      }

      if (targetMode !== 'no-ocr') {
        console.log('Model+prompt breakdown:');
        for (const [key, count] of Object.entries(modelCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${key.padEnd(45)} ${count}`);
        }
      }

      console.log(`\nBooks: ${Object.keys(bookCounts).length}`);
      // Top 10 books by page count
      const topBooks = Object.entries(bookCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [bid, count] of topBooks) {
        console.log(`  ${bid.substring(0, 24).padEnd(26)} ${count} pages`);
      }

      const estCost = pages.length * 0.0023; // realtime rate
      console.log(`\nEstimated cost: $${estCost.toFixed(2)} (realtime pricing)`);
      const estMinutes = Math.round(pages.length / (CONCURRENCY * 4) / 60);
      console.log(`Estimated time: ~${estMinutes} minutes at ${CONCURRENCY} concurrent`);

      await client.close();
      return;
    }

    // --- Create run tracking record ---
    const { nanoid } = await import('nanoid');
    const runId = nanoid();
    const uniqueBookIds = [...new Set(pages.map(p => p.book_id))];
    await db.collection('jobs').insertOne({
      id: runId,
      type: 'realtime_ocr',
      status: 'processing',
      source: 'scripts/realtime-ocr.mjs',
      config: {
        mode: targetMode,
        concurrency: CONCURRENCY,
        pipeline_status: PIPELINE_STATUS,
        provider: PROVIDER,
        total_eligible: totalEligible,
      },
      book_ids: uniqueBookIds,
      progress: { completed: 0, failed: 0, skipped: 0, total: pages.length },
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`Run ID: ${runId}\n`);

    const promptText = await getOcrPrompt(db);
    const result = await processBatch(pages, promptText, db, runId);

    // --- Finalize run record ---
    await db.collection('jobs').updateOne(
      { id: runId },
      {
        $set: {
          status: result.failed > result.completed ? 'completed_with_errors' : 'completed',
          progress: { completed: result.completed, failed: result.failed, skipped: result.skipped, total: pages.length },
          total_tokens: result.totalTokens,
          books_updated: result.booksUpdated,
          books_completed: result.booksCompleted,
          elapsed_ms: result.elapsed,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      }
    );

    console.log(`\n=== Summary ===`);
    console.log(`Run ID: ${runId}`);
    console.log(`Completed: ${result.completed}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Tokens: ${result.totalTokens.toLocaleString()}`);
    console.log(`Books updated: ${result.booksUpdated}`);
    console.log(`Books advanced to ocr_complete: ${result.booksCompleted}`);
    console.log(`Elapsed: ${(result.elapsed / 1000).toFixed(0)}s`);
    console.log(`Remaining: ${totalEligible - OFFSET - pages.length} pages`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
