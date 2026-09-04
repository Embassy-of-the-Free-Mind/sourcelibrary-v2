#!/usr/bin/env node
/**
 * Backfill OCR for near-complete books (#500 item 2)
 *
 * Finds books that are >90% translated but have 1-50 pages missing OCR.
 * Submits those specific pages to Gemini Batch API for OCR.
 * These books can't reach 100% translated until the missing pages are OCR'd.
 *
 * Uses the same Batch API pattern as the pipeline orchestrator's Phase 2.
 *
 * CLI flags:
 *   --dry-run         List books and pages, don't submit
 *   --limit=N         Max books to process (default: 50)
 *   --max-missing=N   Max missing pages per book (default: 50)
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { getOcrModelForBook } from '../lib/ocr-routing.mjs';

// ── Config ──
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const IMAGE_CONCURRENCY = 20;
const OCR_INLINE_BATCH_SIZE = 20;
const OCR_FILE_BATCH_SIZE = 150;

// ── CLI args ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');
const MAX_MISSING = parseInt(args.find(a => a.startsWith('--max-missing='))?.split('=')[1] || '50');

// ── Gemini Batch API keys ──
const GEMINI_BATCH_KEYS = [
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
].filter(k => !!k);

if (GEMINI_BATCH_KEYS.length === 0) {
  console.error('No Gemini API keys configured');
  process.exit(1);
}

function getGeminiApiKey(keyIndex = 0) {
  return GEMINI_BATCH_KEYS[keyIndex] || GEMINI_BATCH_KEYS[0];
}

// ── Image helpers ──
// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

async function fetchImageBase64(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return { data: Buffer.from(buffer).toString('base64'), mimeType: contentType.split(';')[0].trim() };
  } catch { return null; }
}

async function downloadImagesParallel(pages, concurrency) {
  const results = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (page) => {
        const url = getPageImageUrl(page);
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
        const image = await fetchImageBase64(url);
        if (!image) return null;
        return { pageId: page.id, image };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

// ── Gemini Batch API helpers ──
async function createBatchJobInline(model, requests, displayName) {
  for (let ki = 0; ki < GEMINI_BATCH_KEYS.length; ki++) {
    const apiKey = getGeminiApiKey(ki);
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: {
            display_name: displayName,
            input_config: { requests: { requests } },
          },
        }),
      }
    );
    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING', keyIndex: ki };
    }
    const errorText = await response.text();
    if (response.status === 429) { console.log(`  Key ${ki} quota exhausted, trying next...`); continue; }
    throw new Error(`Batch create failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

async function uploadBatchFile(jsonlContent, displayName, apiKey) {
  const contentLength = Buffer.byteLength(jsonlContent);
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': contentLength.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({ file: { displayName } }),
    }
  );
  if (!startResponse.ok) throw new Error(`File upload start failed: ${(await startResponse.text()).substring(0, 200)}`);
  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('No upload URL returned from File API');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    body: jsonlContent,
  });
  if (!uploadResponse.ok) throw new Error(`File upload failed: ${(await uploadResponse.text()).substring(0, 200)}`);
  const fileInfo = await uploadResponse.json();
  if (!fileInfo.file?.name) throw new Error(`Missing file.name in response`);
  return { name: fileInfo.file.name, uri: fileInfo.file.uri };
}

async function createBatchJobFromFile(model, fileName, displayName, preferredKeyIndex = 0) {
  for (let ki = preferredKeyIndex; ki < GEMINI_BATCH_KEYS.length; ki++) {
    const apiKey = getGeminiApiKey(ki);
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
      }
    );
    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING', keyIndex: ki };
    }
    const errorText = await response.text();
    if (response.status === 429) { console.log(`  Key ${ki} quota exhausted, trying next...`); continue; }
    throw new Error(`File batch create failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

// ── Main ──
async function main() {
  if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[OCR-BACKFILL] ${new Date().toISOString()} — limit=${LIMIT}, max-missing=${MAX_MISSING}, dry-run=${DRY_RUN}`);

  // Get OCR prompt
  const promptDoc = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!promptDoc?.content) { console.error('No default OCR prompt found'); process.exit(1); }

  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;
  const basePrompt = promptDoc.content
    .replace('{language_instruction}', languageInstruction)
    .replace('{language}', '');

  // Find books >90% translated with 1-MAX_MISSING pages missing OCR
  const books = await db.collection('books').aggregate([
    { $match: {
      status: { $ne: 'deleted' },
      pages_count: { $gt: 0 },
      pages_ocr: { $gt: 0 },
      pages_translated: { $gt: 0 },
      $expr: {
        $and: [
          { $gte: ['$pages_translated', { $multiply: [{ $subtract: ['$pages_ocr', { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
          { $lt: ['$pages_ocr', '$pages_count'] },
          { $lte: [{ $subtract: ['$pages_count', '$pages_ocr'] }, MAX_MISSING] },
        ],
      },
    }},
    { $addFields: { missing_ocr: { $subtract: ['$pages_count', '$pages_ocr'] } } },
    { $sort: { missing_ocr: 1 } },
    { $limit: LIMIT },
    { $project: {
      _id: 0, id: 1, title: 1, author: 1, year: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
      missing_ocr: 1, 'image_source.provider': 1,
    }},
  ]).toArray();

  console.log(`Found ${books.length} books with 1-${MAX_MISSING} missing OCR pages\n`);

  let totalSubmitted = 0;
  let totalBooks = 0;
  let errors = [];

  for (const book of books) {
    console.log(`[${book.id}] ${book.title?.slice(0, 60)} — ${book.missing_ocr} pages missing OCR`);

    // Check for active batch jobs
    const activeBatch = await db.collection('batch_jobs').countDocuments({
      book_id: book.id,
      type: 'ocr',
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });
    if (activeBatch > 0) {
      console.log(`  Skipping — ${activeBatch} active batch jobs already`);
      continue;
    }

    // Find pages missing OCR that have images
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
        $and: [{ $or: [
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } },
        ]}],
      })
      .sort({ page_number: 1 })
      .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`  No pages with images need OCR — may have pages without images`);
      continue;
    }

    console.log(`  ${pages.length} pages to OCR (pages: ${pages.map(p => p.page_number).join(', ')})`);

    if (DRY_RUN) continue;

    // Download images
    const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
    if (downloaded.length === 0) {
      console.log(`  All image downloads failed — skipping`);
      errors.push(`${book.id}: all image downloads failed`);
      continue;
    }
    console.log(`  Downloaded ${downloaded.length}/${pages.length} images`);

    // Build prompt with book context
    const ocrModel = getOcrModelForBook(book);
    const yearStr = book.year ? `Published ${book.year}.` : '';
    const copyrightNote = book.year && book.year < 1930 ? 'This work is in the public domain.' : '';
    let prompt = basePrompt;
    if (yearStr || book.title) {
      prompt += `\n\n**Document context:** "${book.title || 'Unknown'}" by ${book.author || 'Unknown'}. ${yearStr} ${copyrightNote}`.trim();
    }

    // Safety settings
    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    ];
    const generationConfig = { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } };

    // Submit to Gemini Batch API
    const useFileBased = downloaded.length > OCR_INLINE_BATCH_SIZE;
    const parentJobId = nanoid();
    let batchJob;

    try {
      if (useFileBased) {
        const jsonlLines = downloaded.map(item => JSON.stringify({
          request: {
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: item.image.mimeType, data: item.image.data } }] }],
            safetySettings, generationConfig,
          },
          metadata: { key: item.pageId },
        }));
        const jsonlContent = jsonlLines.join('\n');
        const displayName = `backfill-ocr-${book.id}-${parentJobId}`;

        let fileResult;
        let uploadKeyIndex = -1;
        for (let ki = 0; ki < GEMINI_BATCH_KEYS.length; ki++) {
          try {
            fileResult = await uploadBatchFile(jsonlContent, displayName, getGeminiApiKey(ki));
            uploadKeyIndex = ki;
            break;
          } catch (uploadErr) {
            if (uploadErr.message.includes('429') || uploadErr.message.includes('quota')) continue;
            throw uploadErr;
          }
        }
        if (!fileResult) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');

        batchJob = await createBatchJobFromFile(ocrModel, fileResult.name, displayName, uploadKeyIndex);

        // Clean up uploaded file
        try {
          await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResult.name}?key=${getGeminiApiKey(uploadKeyIndex)}`, { method: 'DELETE' });
        } catch {}
      } else {
        const inlineRequests = downloaded.map(item => ({
          request: {
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: item.image.mimeType, data: item.image.data } }] }],
            safetySettings, generationConfig,
          },
          metadata: { key: item.pageId },
        }));
        const displayName = `backfill-ocr-${book.id}-${parentJobId}`;
        batchJob = await createBatchJobInline(ocrModel, inlineRequests, displayName);
      }

      // Record in batch_jobs collection
      await db.collection('batch_jobs').insertOne({
        id: parentJobId,
        job_name: batchJob.name,
        type: 'ocr',
        book_id: book.id,
        page_ids: downloaded.map(d => d.pageId),
        page_count: downloaded.length,
        model: ocrModel,
        status: 'pending',
        api_key_index: batchJob.keyIndex ?? 0,
        created_at: new Date(),
        source: 'backfill-ocr-near-complete',
      });

      totalSubmitted += downloaded.length;
      totalBooks++;
      console.log(`  Submitted ${downloaded.length} pages — job: ${batchJob.name}`);
    } catch (err) {
      errors.push(`${book.id}: ${err.message}`);
      console.error(`  ERROR: ${err.message}`);
      if (err.message === 'ALL_KEYS_QUOTA_EXHAUSTED') {
        console.log('\nAll Gemini API keys exhausted — stopping early');
        break;
      }
    }
  }

  console.log(`\n[OCR-BACKFILL] Done — ${totalBooks} books, ${totalSubmitted} pages submitted, ${errors.length} errors`);
  if (errors.length > 0) {
    console.log('Errors:');
    for (const err of errors) console.log(`  ${err}`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
