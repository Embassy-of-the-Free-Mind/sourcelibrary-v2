#!/usr/bin/env node
/**
 * Migrate archived images from Vercel Blob → Cloudflare R2
 *
 * Run on Hetzner (not Vercel) to avoid burning Vercel bandwidth:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/migrate-blob-to-r2.mjs
 *
 * Required env vars: MONGODB_URI, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *   R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 *
 * Processes pages in batches, resumable (skips pages already on R2).
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// --- Config ---
const BATCH_SIZE = 100;
const CONCURRENCY = 10;
const DELAY_BETWEEN_BATCHES_MS = 500;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;

// --- R2 client ---
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

// --- Helpers ---

function extractR2Key(blobUrl, bookId, pageNumber, prefix) {
  // Generate a clean R2 key: archived/{bookId}/{pageNumber}.jpg
  return `${prefix}/${bookId}/${pageNumber}.jpg`;
}

async function downloadBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToR2(key, data, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: data,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function migratePage(page, db) {
  const updates = {};
  let migrated = 0;

  // Migrate archived_photo
  if (page.archived_photo?.includes('vercel-storage')) {
    const key = extractR2Key(page.archived_photo, page.book_id, page.page_number, 'archived');
    try {
      const data = await downloadBlob(page.archived_photo);
      const newUrl = await uploadToR2(key, data);
      updates.archived_photo = newUrl;
      migrated++;
    } catch (err) {
      console.error(`  FAIL archived_photo page ${page._id}: ${err.message}`);
    }
  }

  // Migrate thumbnail_blob
  if (page.thumbnail_blob?.includes('vercel-storage')) {
    const key = extractR2Key(page.thumbnail_blob, page.book_id, page.page_number, 'thumbnails');
    try {
      const data = await downloadBlob(page.thumbnail_blob);
      const newUrl = await uploadToR2(key, data);
      updates.thumbnail_blob = newUrl;
      migrated++;
    } catch (err) {
      console.error(`  FAIL thumbnail_blob page ${page._id}: ${err.message}`);
    }
  }

  // Migrate cropped_photo
  if (page.cropped_photo?.includes('vercel-storage')) {
    const key = extractR2Key(page.cropped_photo, page.book_id, page.page_number, 'cropped');
    try {
      const data = await downloadBlob(page.cropped_photo);
      const newUrl = await uploadToR2(key, data);
      updates.cropped_photo = newUrl;
      migrated++;
    } catch (err) {
      console.error(`  FAIL cropped_photo page ${page._id}: ${err.message}`);
    }
  }

  if (Object.keys(updates).length > 0 && !DRY_RUN) {
    await db.collection('pages').updateOne({ _id: page._id }, { $set: updates });
  }

  return migrated;
}

// --- Main ---

async function main() {
  console.log(`Blob → R2 migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`R2 bucket: ${BUCKET}, public URL: ${R2_PUBLIC_URL}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} pages`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Count total work
  const totalBlob = await db.collection('pages').countDocuments({
    $or: [
      { archived_photo: { $regex: 'vercel-storage' } },
      { thumbnail_blob: { $regex: 'vercel-storage' } },
      { cropped_photo: { $regex: 'vercel-storage' } },
    ]
  });
  console.log(`Found ${totalBlob} pages with Vercel Blob URLs`);

  let processed = 0;
  let migrated = 0;
  let errors = 0;

  const cursor = db.collection('pages').find({
    $or: [
      { archived_photo: { $regex: 'vercel-storage' } },
      { thumbnail_blob: { $regex: 'vercel-storage' } },
      { cropped_photo: { $regex: 'vercel-storage' } },
    ]
  }, {
    projection: {
      _id: 1, book_id: 1, page_number: 1,
      archived_photo: 1, thumbnail_blob: 1, cropped_photo: 1
    }
  }).batchSize(BATCH_SIZE);

  let batch = [];

  for await (const page of cursor) {
    batch.push(page);

    if (batch.length >= CONCURRENCY) {
      const results = await Promise.allSettled(
        batch.map(p => migratePage(p, db))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') migrated += r.value;
        else errors++;
      }
      processed += batch.length;
      batch = [];

      if (processed % BATCH_SIZE === 0) {
        const pct = totalBlob > 0 ? ((processed / totalBlob) * 100).toFixed(1) : '?';
        console.log(`  ${processed}/${totalBlob} (${pct}%) — ${migrated} URLs migrated, ${errors} errors`);
      }

      if (LIMIT && processed >= LIMIT) break;

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Drain remaining batch
  if (batch.length > 0) {
    const results = await Promise.allSettled(
      batch.map(p => migratePage(p, db))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') migrated += r.value;
      else errors++;
    }
    processed += batch.length;
  }

  console.log(`\nDone. Processed ${processed} pages, migrated ${migrated} URLs, ${errors} errors.`);
  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
