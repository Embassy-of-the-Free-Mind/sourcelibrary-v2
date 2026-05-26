#!/usr/bin/env node
/**
 * Experiment A: Large Batch Size Test
 *
 * Tests submitting 1,000+ pages in a single batch job instead of 250.
 * Google recommends 1,000-5,000 requests per job for optimal throughput.
 *
 * What we're measuring:
 *   - Does the File API accept a 1GB+ JSONL upload?
 *   - Completion time vs 250-page batches
 *   - Error rate / RECITATION rate
 *   - Whether a single large job avoids the batch-creation rate limit
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/experiments/batch-size-experiment.mjs [--size=1000] [--dry-run]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TARGET_SIZE = parseInt(args.find(a => a.startsWith('--size='))?.split('=')[1] || '1000');

const IMAGE_CONCURRENCY = 20;

const OCR_PROMPT = `You are an expert OCR system. Transcribe the text from this historical document page.
Output ONLY the transcribed text. Preserve paragraph breaks. If text is unclear, use [unclear] markers.
Detect the language automatically.`;

async function downloadImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) return null;
  const buf = Buffer.from(await resp.arrayBuffer());
  const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { data: buf.toString('base64'), mimeType: mime };
}

async function downloadBatch(pages) {
  const results = [];
  for (let i = 0; i < pages.length; i += IMAGE_CONCURRENCY) {
    const chunk = pages.slice(i, i + IMAGE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (p) => {
        const url = p.image_url || `https://sourcelibrary.org/api/image?id=${p._id}`;
        const img = await downloadImage(url);
        return img ? { pageId: String(p._id), image: img } : null;
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
    if ((i + IMAGE_CONCURRENCY) % 100 === 0) {
      console.log(`  Downloaded ${Math.min(i + IMAGE_CONCURRENCY, pages.length)}/${pages.length}...`);
    }
  }
  return results;
}

function buildJsonlFile(items) {
  const tmpFile = path.join(os.tmpdir(), `sl-experiment-${nanoid()}.jsonl`);
  const fd = fs.openSync(tmpFile, 'w');
  let totalBytes = 0;
  for (let i = 0; i < items.length; i++) {
    const line = JSON.stringify({
      request: {
        contents: [{
          parts: [
            { text: OCR_PROMPT },
            { inlineData: { mimeType: items[i].image.mimeType, data: items[i].image.data } },
          ],
        }],
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
      },
      metadata: { key: items[i].pageId },
    });
    const buf = Buffer.from(line + (i < items.length - 1 ? '\n' : ''));
    fs.writeSync(fd, buf);
    totalBytes += buf.byteLength;
    // Free image data
    items[i].image.data = null;
  }
  fs.closeSync(fd);
  return { filePath: tmpFile, fileSize: totalBytes };
}

async function uploadFile(filePath, displayName) {
  const fileSize = fs.statSync(filePath).size;
  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({ file: { displayName } }),
    }
  );
  if (!startResp.ok) throw new Error(`Upload start failed: ${await startResp.text()}`);
  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');

  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  if (!uploadResp.ok) throw new Error(`Upload failed: ${await uploadResp.text()}`);
  const info = await uploadResp.json();
  return info.file;
}

async function run() {
  console.log(`\n=== Batch Size Experiment ===`);
  console.log(`Target: ${TARGET_SIZE} pages in a single batch job`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Gather pages from multiple books to hit the target size
  const books = await db.collection('books').find(
    { pages_count: { $gte: 50 }, pages_ocr: 0, pipeline_status: { $in: ['archive_complete', 'ocr_submitted'] } },
    { projection: { id: 1, title: 1, pages_count: 1 } }
  ).sort({ pages_count: -1 }).limit(20).toArray();

  let allPages = [];
  for (const book of books) {
    if (allPages.length >= TARGET_SIZE) break;
    const pages = await db.collection('pages').find(
      { book_id: book.id, 'ocr.data': { $exists: false } },
      { projection: { _id: 1, book_id: 1, image_url: 1, page_number: 1 } }
    ).limit(TARGET_SIZE - allPages.length).toArray();
    console.log(`  ${book.title?.substring(0, 50)}: ${pages.length} pages`);
    allPages.push(...pages);
  }

  console.log(`\nTotal pages gathered: ${allPages.length}`);
  if (allPages.length < 100) {
    console.log('Not enough pages for experiment. Need at least 100.');
    await client.close();
    return;
  }

  // Download images
  console.log(`\nDownloading ${allPages.length} images...`);
  const startDl = Date.now();
  const downloaded = await downloadBatch(allPages);
  const dlTime = ((Date.now() - startDl) / 1000).toFixed(0);
  console.log(`Downloaded ${downloaded.length}/${allPages.length} in ${dlTime}s`);

  // Build JSONL
  console.log(`\nBuilding JSONL...`);
  const { filePath, fileSize } = buildJsonlFile(downloaded);
  const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
  const sizeGB = (fileSize / 1024 / 1024 / 1024).toFixed(2);
  console.log(`JSONL: ${sizeMB} MB (${sizeGB} GB) for ${downloaded.length} pages`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would upload and submit. Stopping here.');
    fs.unlinkSync(filePath);
    await client.close();
    return;
  }

  // Upload
  console.log(`\nUploading to Gemini File API...`);
  const startUp = Date.now();
  const file = await uploadFile(filePath, `experiment-large-batch-${downloaded.length}pages`);
  const upTime = ((Date.now() - startUp) / 1000).toFixed(0);
  console.log(`Uploaded: ${file.name} in ${upTime}s`);
  fs.unlinkSync(filePath);

  // Create batch job
  console.log(`\nCreating batch job...`);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const batchJob = await ai.batches.create({
    model: MODEL,
    src: { fileName: file.name },
    config: { displayName: `experiment-${downloaded.length}pages-${nanoid(6)}` },
  });
  console.log(`Batch created: ${batchJob.name}`);
  console.log(`State: ${batchJob.state}`);

  // Record in DB for the collector to pick up
  await db.collection('batch_jobs').insertOne({
    id: nanoid(),
    job_name: batchJob.name,
    type: 'ocr',
    book_id: 'experiment',
    book_ids: [...new Set(allPages.map(p => p.book_id))],
    page_ids: downloaded.map(d => d.pageId),
    page_count: downloaded.length,
    status: 'pending',
    model: MODEL,
    prompt_version: 'v10',
    submission_method: 'file',
    experiment: 'large-batch-size',
    experiment_target: TARGET_SIZE,
    created_at: new Date(),
    updated_at: new Date(),
  });

  console.log(`\n=== Experiment submitted ===`);
  console.log(`Pages: ${downloaded.length}`);
  console.log(`JSONL size: ${sizeMB} MB`);
  console.log(`Job: ${batchJob.name}`);
  console.log(`\nMonitor with: node -e "..." or check batch_jobs collection for experiment='large-batch-size'`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
