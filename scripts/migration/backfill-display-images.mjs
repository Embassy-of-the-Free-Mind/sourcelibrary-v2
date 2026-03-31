#!/usr/bin/env node
/**
 * Backfill display (1200px) and thumbnail (150px) variants for pages
 * that already have archived_photo but no display_photo.
 *
 * Downloads full-res from R2, generates variants, uploads back to R2.
 * R2 egress is free, so the only cost is CPU time + write ops.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-display-images.mjs
 *   node scripts/migration/backfill-display-images.mjs --limit=1000 --concurrency=8 --dry-run
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '50000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '10', 10);
const DRY_RUN = hasFlag('dry-run');
const BOOK_ID = getArg('book');  // Optional: backfill a single book

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function downloadFromR2(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

const stats = {
  processed: 0, succeeded: 0, failed: 0, skipped: 0,
  bytesUploaded: 0, startTime: Date.now(),
};

async function processPage(page, db) {
  try {
    // Skip failed or non-URL archived photos
    if (!page.archived_photo?.startsWith('https://')) {
      stats.skipped++;
      return;
    }
    const fullResBuffer = await downloadFromR2(page.archived_photo);

    if (DRY_RUN) {
      stats.skipped++;
      return;
    }

    const { display, thumb } = await generateDisplayVariants(fullResBuffer);

    const num = String(page.page_number).padStart(4, '0');
    const displayKey = `pages/${page.book_id}/${num}.jpg`;
    const thumbKey = `pages/${page.book_id}/${num}-thumb.jpg`;

    const displayUrl = await uploadToR2(displayKey, display);
    const thumbUrl = await uploadToR2(thumbKey, thumb);

    stats.bytesUploaded += display.length + thumb.length;

    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          display_photo: displayUrl,
          thumbnail_blob: thumbUrl,
          updated_at: new Date(),
        }
      }
    );

    stats.succeeded++;
  } catch (err) {
    stats.failed++;
    if (stats.failed <= 20) {
      console.error(`  FAIL page ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 100)}`);
    }
  }
}

async function main() {
  console.log(`[backfill-display] Display image backfill — limit=${LIMIT}, concurrency=${CONCURRENCY}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db('bookstore');

  // Find pages with archived_photo but no display_photo
  // Use simple filter — avoid $regex on unindexed field (9.5M pages collection)
  const filter = {
    archived_photo: { $exists: true, $ne: null },
    display_photo: { $exists: false },
    ...(BOOK_ID ? { book_id: BOOK_ID } : {}),
  };

  console.log(`[backfill-display] Querying pages (skipping count to avoid collection scan)...`);

  const pages = await db.collection('pages')
    .find(filter, { projection: { _id: 1, book_id: 1, page_number: 1, archived_photo: 1 } })
    .limit(LIMIT)
    .maxTimeMS(60_000)
    .toArray();

  console.log(`[backfill-display] Processing ${pages.length.toLocaleString()} pages...`);

  // Process with bounded concurrency
  let idx = 0;
  async function worker() {
    while (idx < pages.length) {
      const i = idx++;
      if (i >= pages.length) break;
      await processPage(pages[i], db);
      stats.processed++;

      if (stats.processed % 500 === 0) {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rate = (stats.processed / elapsed).toFixed(1);
        const mb = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);
        console.log(`  ${stats.processed.toLocaleString()}/${pages.length.toLocaleString()} — ${stats.succeeded} ok, ${stats.failed} fail — ${rate}/s — ${mb}MB uploaded`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker()));

  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = (stats.processed / elapsed).toFixed(1);
  console.log(`\n[backfill-display] Done in ${Math.round(elapsed)}s`);
  console.log(`  Processed: ${stats.processed.toLocaleString()}`);
  console.log(`  Succeeded: ${stats.succeeded.toLocaleString()}`);
  console.log(`  Failed: ${stats.failed.toLocaleString()}`);
  console.log(`  Rate: ${rate} pages/sec`);
  console.log(`  Uploaded: ${(stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log(`  Note: run again to process more pages`);

  await client.close();
}

main().catch(err => { console.error('[backfill-display] Fatal:', err); process.exit(1); });
