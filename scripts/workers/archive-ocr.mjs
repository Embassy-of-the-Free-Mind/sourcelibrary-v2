#!/usr/bin/env node
// Hetzner standalone archive-ocr worker
// Replaces the Vercel cron /api/cron/archive-ocr
//
// Finds pages with OCR data but no archived_photo, downloads the source image,
// uploads to R2, and updates MongoDB.
//
// Run: set -a; source .env.production.local; set +a; node scripts/workers/archive-ocr.mjs

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const BATCH_SIZE = 10;
const CONCURRENCY = 10;
const DELAY_MS = 200;
const MAX_PAGES = 500; // Cap per run to avoid runaway

// R2 client
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function archivePage(page, db) {
  const sourceUrl = page.photo;
  try {
    const { buffer, mimeType } = await downloadImage(sourceUrl);
    const key = `archived/${page.book_id}/${page.page_number}.jpg`;
    const url = await uploadToR2(key, buffer, mimeType);

    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          archived_photo: url,
          'archive_metadata.archived_at': new Date(),
          'archive_metadata.source_url': sourceUrl,
          'archive_metadata.bytes': buffer.byteLength,
          updated_at: new Date(),
        }
      }
    );
    return { ok: true, bytes: buffer.byteLength };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const start = Date.now();
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const query = {
    'ocr.data': { $exists: true, $nin: [null, ''] },
    photo: { $exists: true, $nin: [null, ''] },
    $or: [
      { archived_photo: { $exists: false } },
      { archived_photo: null },
      { archived_photo: '' },
    ],
  };

  const totalNeeding = await db.collection('pages').countDocuments(query);
  if (totalNeeding === 0) {
    console.log(`[archive-ocr] No pages need archiving`);
    await client.close();
    return;
  }

  console.log(`[archive-ocr] ${totalNeeding} pages need archiving (processing up to ${MAX_PAGES})`);

  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let processed = 0;

  while (processed < MAX_PAGES) {
    const pages = await db.collection('pages')
      .find(query, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } })
      .limit(CONCURRENCY)
      .toArray();

    if (pages.length === 0) break;

    const results = await Promise.allSettled(
      pages.map(p => archivePage(p, db))
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        archived++;
        totalBytes += r.value.bytes;
      } else {
        failed++;
        const err = r.status === 'fulfilled' ? r.value.error : r.reason?.message;
        if (failed <= 10) console.error(`  FAIL: ${err}`);
      }
    }

    processed += pages.length;

    if (processed % 50 === 0) {
      const mb = (totalBytes / (1024 * 1024)).toFixed(1);
      console.log(`  ${processed} processed, ${archived} archived (${mb} MB), ${failed} failed`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[archive-ocr] Done in ${duration}s: ${archived} archived (${mb} MB), ${failed} failed, ${totalNeeding - processed} remaining`);

  // Log to cron_runs for monitoring
  await db.collection('cron_runs').insertOne({
    cron: 'archive-ocr',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, remaining: totalNeeding - processed },
  });

  await client.close();
}

main().catch(err => {
  console.error('[archive-ocr] Fatal:', err);
  process.exit(1);
});
