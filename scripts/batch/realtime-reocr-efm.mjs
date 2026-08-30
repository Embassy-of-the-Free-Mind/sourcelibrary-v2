#!/usr/bin/env node
/**
 * Realtime re-OCR for EFM (Embassy of the Free Mind) pages.
 *
 * Targets pages with old models or old prompt versions.
 * Uses direct Gemini API calls (not batch) with concurrency control.
 *
 * Usage:
 *   set -a && source .env.local && set +a && node scripts/realtime-reocr-efm.mjs [options]
 *
 * Options:
 *   --limit=N        Max pages to process (default: 500)
 *   --concurrency=N  Parallel API calls (default: 10)
 *   --dry-run        Show what would be processed
 *   --book-id=ID     Process a single book only
 *   --old-models     Only target old models (skip v3 prompt pages)
 */

import { MongoClient } from 'mongodb';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { extractPageType, extractColumns } from '../lib/ocr-result-parse.mjs';

// --- Config ---
const TARGET_MODEL = 'gemini-3-flash-preview';
const TARGET_PROMPT = 'v5.2026-02';
const ACCEPTABLE_PROMPTS = ['v5.2026-02', 'v4.2026-02', 'v3.2026-02']; // v3+ acceptable
const SKIP_SOURCES = ['manual', 'manual-correction'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_PAGES = parseInt(getArg('limit') || '500', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '20', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const OLD_MODELS_ONLY = hasFlag('old-models');

// --- API key rotation ---
function getAllApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY_TIER3) keys.push({ key: process.env.GEMINI_API_KEY_TIER3, name: 'TIER3' });
  if (process.env.GEMINI_API_KEY_2) keys.push({ key: process.env.GEMINI_API_KEY_2, name: 'KEY_2' });
  if (process.env.GEMINI_API_KEY) keys.push({ key: process.env.GEMINI_API_KEY, name: 'KEY' });
  if (keys.length === 0) throw new Error('No GEMINI_API_KEY found in env');
  return keys;
}

let currentKeyIndex = 0;
const apiKeys = getAllApiKeys();
console.log(`API keys available: ${apiKeys.map(k => k.name).join(', ')}`);

function getNextKey() {
  const k = apiKeys[currentKeyIndex % apiKeys.length];
  currentKeyIndex++;
  return k;
}

// --- Image helpers ---
// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

async function fetchImageBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  let mimeType = (response.headers.get('content-type') || '').split(';')[0].trim();
  // Vercel Blob often returns application/octet-stream for images — infer from URL
  if (!mimeType || mimeType === 'application/octet-stream') {
    if (url.endsWith('.jpg') || url.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (url.endsWith('.png')) mimeType = 'image/png';
    else if (url.endsWith('.webp')) mimeType = 'image/webp';
    else if (url.endsWith('.tif') || url.endsWith('.tiff')) mimeType = 'image/tiff';
    else mimeType = 'image/jpeg'; // safe default
  }
  return {
    data: Buffer.from(buffer).toString('base64'),
    mimeType,
  };
}

// --- OCR prompt ---
async function getOcrPrompt(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');
  console.log(`Using prompt: ${prompt.name} v${prompt.version}`);

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
      contents: [{
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
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
    const err = new Error(`Gemini ${response.status}: ${errorText.substring(0, 200)}`);
    err.status = response.status;
    throw err;
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = result.usageMetadata || {};
  return {
    text,
    usage: {
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    },
  };
}

// --- Extract metadata from OCR text: shared via scripts/lib/ocr-result-parse.mjs (#4443) ---

// NOTE: parses `<image>` sub-tags, which the current OCR prompt does not emit —
// a different parser from the canonical `parseDetectedImages`, not a fork of it.
// Deliberately out of scope for #4443; see #4445.
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
    // Download image
    const image = await fetchImageBuffer(imageUrl);

    // Call Gemini
    const result = await callGemini(image.data, image.mimeType, promptText, keyInfo.key);
    const durationMs = Date.now() - startTime;

    if (!result.text || result.text.length < 5) {
      return { pageId: page.id, status: 'empty', durationMs };
    }

    // Extract metadata
    const pageType = extractPageType(result.text, { validate: false });
    const columns = extractColumns(result.text);
    const detectedImages = parseDetectedImages(result.text);

    // Retain existing OCR as a revision before overwriting (#3240)
    await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'reocr_realtime' });

    // Save to MongoDB
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

    // Log to gemini_usage (non-blocking)
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
      endpoint: 'scripts/realtime-reocr-efm.mjs',
      timestamp: new Date(),
    }).catch(() => {});

    return {
      pageId: page.id,
      status: 'success',
      chars: result.text.length,
      durationMs,
      key: keyInfo.name,
      tokens: result.usage.inputTokens + result.usage.outputTokens,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log failure
    db.collection('gemini_usage').insertOne({
      type: 'ocr',
      mode: 'realtime',
      model: TARGET_MODEL,
      book_id: page.book_id,
      page_ids: [page.id],
      status: 'error',
      error_message: error.message?.substring(0, 200),
      duration_ms: durationMs,
      prompt_version: TARGET_PROMPT,
      endpoint: 'scripts/realtime-reocr-efm.mjs',
      timestamp: new Date(),
    }).catch(() => {});

    return {
      pageId: page.id,
      status: 'error',
      error: error.message?.substring(0, 100),
      httpStatus: error.status,
      durationMs,
      key: keyInfo.name,
    };
  }
}

// --- Concurrent processor ---
async function processBatch(pages, promptText, db) {
  let completed = 0, failed = 0, skipped = 0;
  let totalTokens = 0;
  let rateLimited = false;
  const startTime = Date.now();

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    if (rateLimited) break;

    const chunk = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(page => processPage(page, promptText, db))
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        failed++;
        continue;
      }
      const result = r.value;
      if (result.status === 'success') {
        completed++;
        totalTokens += result.tokens || 0;
      } else if (result.status === 'error') {
        failed++;
        if (result.httpStatus === 429) {
          console.log(`\n  Rate limited on key ${result.key}. Pausing...`);
          // Wait 60s and retry with next key
          await new Promise(r => setTimeout(r, 60000));
          // Don't set rateLimited — try next chunk with different key
        }
      } else {
        skipped++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pagesPerMin = (completed / (elapsed / 60)).toFixed(1);
    process.stdout.write(
      `\r  ${completed + failed + skipped}/${pages.length} done | ${completed} ok, ${failed} err, ${skipped} skip | ${pagesPerMin} p/min | ${elapsed}s`
    );
  }

  console.log(''); // newline after progress
  return { completed, failed, skipped, totalTokens, elapsed: Date.now() - startTime };
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Realtime Re-OCR — EFM Books ===`);
  console.log(`  limit=${MAX_PAGES}, concurrency=${CONCURRENCY}`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // Get all EFM book IDs
    const efmBooks = await db.collection('books').find({
      $or: [
        { 'image_source.provider': 'efm' },
        { 'image_source.provider_name': /ritman|embassy|free mind/i },
      ],
      ...(SINGLE_BOOK ? { id: SINGLE_BOOK } : {}),
    }).project({ id: 1, _id: 0 }).toArray();
    const efmBookIds = efmBooks.map(b => b.id);

    console.log(`EFM books: ${efmBookIds.length}`);

    // Build page filter for old OCR
    const pageFilter = {
      book_id: { $in: efmBookIds },
      'ocr.data': { $exists: true, $ne: '' },
      'ocr.source': { $nin: SKIP_SOURCES },
    };

    if (OLD_MODELS_ONLY) {
      // Only pages with models other than gemini-3-flash-preview
      pageFilter['ocr.model'] = { $ne: TARGET_MODEL, $nin: SKIP_SOURCES };
    } else {
      // Pages with old model OR old prompt (not v3 or v4)
      pageFilter.$or = [
        { 'ocr.model': { $ne: TARGET_MODEL } },
        { 'ocr.prompt_version': { $nin: ACCEPTABLE_PROMPTS } },
      ];
    }

    // Count eligible
    const totalEligible = await db.collection('pages').countDocuments(pageFilter);
    console.log(`Eligible pages for re-OCR: ${totalEligible}`);

    // Fetch pages
    const pages = await db.collection('pages').find(pageFilter, {
      projection: {
        id: 1, _id: 0, book_id: 1, page_number: 1,
        photo: 1, photo_original: 1, archived_photo: 1,
        cropped_photo: 1, crop: 1, split_from_spread: 1,
        'ocr.model': 1, 'ocr.prompt_version': 1,
      },
    }).sort({ page_number: 1 }).limit(MAX_PAGES).toArray();

    console.log(`Processing ${pages.length} of ${totalEligible} pages`);

    if (DRY_RUN) {
      // Show breakdown
      const modelCounts = {};
      for (const p of pages) {
        const key = `${p.ocr?.model || 'null'} + ${p.ocr?.prompt_version || 'null'}`;
        modelCounts[key] = (modelCounts[key] || 0) + 1;
      }
      console.log('\nModel+prompt breakdown:');
      for (const [key, count] of Object.entries(modelCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${key.padEnd(40)} ${count}`);
      }

      const bookCounts = {};
      for (const p of pages) {
        bookCounts[p.book_id] = (bookCounts[p.book_id] || 0) + 1;
      }
      console.log(`\nSpread across ${Object.keys(bookCounts).length} books`);

      const estCost = pages.length * 0.00079;
      console.log(`\nEstimated cost: $${estCost.toFixed(2)} (realtime, no batch discount)`);
      console.log(`Estimated time: ${Math.round(pages.length / (CONCURRENCY * 6) / 60)} minutes at ${CONCURRENCY} concurrent`);

      await client.close();
      return;
    }

    // Get prompt
    const promptText = await getOcrPrompt(db);

    // Process
    const result = await processBatch(pages, promptText, db);

    console.log(`\n=== Summary ===`);
    console.log(`Completed: ${result.completed}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Total tokens: ${result.totalTokens.toLocaleString()}`);
    console.log(`Elapsed: ${(result.elapsed / 1000).toFixed(0)}s`);
    console.log(`Remaining: ${totalEligible - pages.length} pages`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
