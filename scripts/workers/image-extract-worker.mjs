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
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { nanoid } from 'nanoid';
import { logUsage } from './lib/supabase-usage-logger.mjs';

// ── Config ──
const CONCURRENCY = 10;           // Books processed simultaneously
const PAGE_CONCURRENCY = 5;       // Pages per book processed simultaneously
const IMAGE_DOWNLOAD_CONCURRENCY = 20;
const BOOKS_PER_RUN = 100;
const RUN_DEADLINE_MS = 25 * 60 * 1000; // 25 min deadline (scheduler runs every 2 min)
const MODEL = 'gemini-3-flash-preview'; // Vision task needs accuracy
const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed'];

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

// ── Prompt (same as orchestrator) ──
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

For each significant illustration return:
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|map",
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
  "museum_description": "A compelling allegorical scene depicting... This exemplifies early modern alchemical imagery..."
}

GALLERY QUALITY (0.0-1.0):
- 0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
- 0.8-0.9: Illustrations with people/figures
- 0.6-0.8: Good illustrations without people
- 0.4-0.6: Musical scores, alchemical symbols

MUSEUM DESCRIPTION: Write 2-3 sentences for a museum label - what the viewer sees and its significance.

Return ONLY a valid JSON array. If no significant illustrations, return: []`;

// ── Helpers ──
function getPageImageUrl(page) {
  if (page.crop && page.cropped_photo) return page.cropped_photo;
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) return page.archived_photo;
  return page.photo_original || page.photo || null;
}

async function fetchImageBase64(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      data: Buffer.from(buffer).toString('base64'),
      mimeType: contentType.split(';')[0].trim(),
    };
  } catch {
    return null;
  }
}

function parseImageExtractionResponse(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeBbox(raw) {
  const x = parseFloat(raw.x) || 0;
  const y = parseFloat(raw.y) || 0;
  const width = parseFloat(raw.width) || 0;
  const height = parseFloat(raw.height) || 0;
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    const scale = Math.max(x + width, y + height, 1000);
    return {
      x: Math.min(x / scale, 0.95),
      y: Math.min(y / scale, 0.95),
      width: Math.min(width / scale, 1),
      height: Math.min(height / scale, 1),
    };
  }
  return { x, y, width, height };
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
async function extractImagesFromPage(page, prompt, db, bookId) {
  const url = getPageImageUrl(page);
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;

  const image = await fetchImageBase64(url);
  if (!image) return null;

  const model = getClient().getGenerativeModel({
    model: MODEL,
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
    },
  });

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: image.mimeType, data: image.data } },
  ]);

  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata || {};

  return {
    pageId: page.id,
    text,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

// ── Process one book ──
async function processBook(db, book) {
  // Find candidate pages
  const candidatePages = await db.collection('pages')
    .find({
      book_id: book.id,
      $or: [
        { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
        { page_type: { $exists: false }, 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
      ],
    }, { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 } })
    .toArray();

  if (candidatePages.length === 0) {
    await setPipelineStatus(db, book.id, 'images_complete');
    return { title: book.title, pages: 0, images: 0, skipped: true };
  }

  // Build prompt with book context
  const contextParts = [];
  if (book.title) contextParts.push(`Book: "${book.title}"`);
  if (book.author) contextParts.push(`Author: ${book.author}`);
  if (book.year) contextParts.push(`Year: ${book.year}`);
  if (book.language) contextParts.push(`Language: ${book.language}`);
  if (book.subjects?.length) contextParts.push(`Subjects: ${book.subjects.join(', ')}`);
  const contextPrefix = contextParts.length > 0
    ? `BOOK CONTEXT:\n${contextParts.join(' | ')}\n\n`
    : '';
  const prompt = contextPrefix + IMAGE_EXTRACTION_PROMPT;

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
      chunk.map(page => extractImagesFromPage(page, prompt, db, book.id))
    );

    for (const settled of results) {
      if (settled.status !== 'fulfilled' || !settled.value) {
        if (settled.reason?.message?.includes('429') || settled.reason?.message?.includes('RESOURCE_EXHAUSTED')) {
          rotateKey();
        }
        continue;
      }

      const { pageId, text, inputTokens, outputTokens } = settled.value;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      pagesProcessed++;

      const parsed = parseImageExtractionResponse(text);
      if (parsed.length > 0) {
        const detectedImages = parsed.map(img => ({
          description: img.description || '',
          type: img.type || 'unknown',
          bbox: img.bbox ? normalizeBbox(img.bbox) : undefined,
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

        bulkOps.push({
          updateOne: {
            filter: { id: pageId },
            update: { $set: { detected_images: detectedImages, image_extraction_updated_at: now, updated_at: now } },
          },
        });

        for (let di = 0; di < detectedImages.length; di++) {
          const img = detectedImages[di];
          galleryDocs.push({
            id: `${pageId}-${di}`,
            page_id: pageId,
            book_id: book.id,
            detection_index: di,
            description: img.description,
            type: img.type,
            bbox: img.bbox,
            gallery_quality: img.gallery_quality,
            gallery_rationale: img.gallery_rationale,
            museum_description: img.museum_description,
            metadata: img.metadata,
            detected_at: now,
            detection_source: 'vision_model',
            model: MODEL,
            updated_at: now,
          });
        }
      } else {
        bulkOps.push({
          updateOne: {
            filter: { id: pageId },
            update: { $set: { image_extraction_updated_at: now, updated_at: now } },
          },
        });
      }
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
  await db.collection('books').updateOne(
    { id: book.id },
    { $set: { detected_images_count: imgCount, updated_at: now } },
  );

  // Advance pipeline
  await setPipelineStatus(db, book.id, 'images_complete');
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

  // Check processing control
  const ctrl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (ctrl?.paused) {
    console.log('[IMAGE-EXTRACT] Pipeline paused, exiting');
    await client.close();
    return;
  }

  // Find books ready for image extraction
  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'chapters_complete' })
    .sort({ processing_priority: -1, hidden: 1 })
    .project({ id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1 })
    .limit(BOOKS_PER_RUN)
    .toArray();

  // Catch-up: books outside pipeline with OCR but no image extraction
  if (books.length < BOOKS_PER_RUN) {
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
      .limit(BOOKS_PER_RUN - books.length)
      .toArray();
    if (catchUp.length > 0) {
      books.push(...catchUp);
      console.log(`[IMAGE-EXTRACT] Catch-up: ${catchUp.length} pre-pipeline books`);
    }
  }

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
