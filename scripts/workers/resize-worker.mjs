#!/usr/bin/env node
/**
 * Resize worker — generates display-size (1200px) images from full-res originals.
 *
 * Runs on Hetzner cron. Finds pages where the display-size image doesn't exist
 * yet on R2, downloads the full-res, resizes, and uploads.
 *
 * Only processes pages using the new path convention (pages/{bookId}/...).
 * Old-convention pages already have reasonably-sized cropped images.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/resize-worker.mjs
 *   node scripts/workers/resize-worker.mjs --limit 500 --concurrency 10
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DISPLAY_WIDTH = 1200;
const DISPLAY_QUALITY = 85;
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '10');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '200');
const DRY_RUN = process.argv.includes('--dry-run');

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function pagePaths(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return {
    full: `${base}-full.jpg`,
    display: `${base}.jpg`,
    thumb: `${base}-thumb.jpg`,
  };
}

async function r2Exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function resizePage(page) {
  const paths = pagePaths(page.book_id, page.page_number);

  // Check if display size already exists
  if (await r2Exists(paths.display)) return { skipped: true };

  // Download full-res
  const buffer = await download(page.photo);

  // Resize to display width
  const displayBuffer = await sharp(buffer)
    .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
    .toBuffer();

  // Upload display size
  const displayUrl = await uploadR2(paths.display, displayBuffer);

  return { displayUrl, savedBytes: buffer.length - displayBuffer.length };
}

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx]); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`Resize worker — display size (${DISPLAY_WIDTH}px)`);
  console.log(`Concurrency: ${CONCURRENCY}, Limit: ${LIMIT}, Dry run: ${DRY_RUN}`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Find pages using new path convention (pages/{bookId}/...)
  const pages = await db.collection('pages').find({
    photo: { $regex: '^https://images\\.sourcelibrary\\.org/pages/' },
  }).project({
    _id: 0, book_id: 1, page_number: 1, photo: 1,
  }).limit(LIMIT).toArray();

  console.log(`Found ${pages.length} pages with new path convention`);

  if (DRY_RUN || pages.length === 0) {
    await client.close();
    return;
  }

  const results = await parallelMap(pages, resizePage, CONCURRENCY);
  const resized = results.filter(r => r?.displayUrl).length;
  const skipped = results.filter(r => r?.skipped).length;
  const errors = results.filter(r => r?.error).length;
  const savedMB = results.reduce((sum, r) => sum + (r?.savedBytes || 0), 0) / 1024 / 1024;

  console.log(`Done. Resized: ${resized}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log(`Saved ~${savedMB.toFixed(1)} MB in bandwidth per full page load cycle`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
