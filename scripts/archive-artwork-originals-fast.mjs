#!/usr/bin/env node
/**
 * Archive full-resolution artwork originals to R2 — PARALLEL version.
 * Downloads from commons_full_url and uploads as artwork/{slug}-full.jpg
 *
 * Same as archive-artwork-originals.mjs but with configurable concurrency.
 * Default 8 workers — cuts 13h → ~1.5h.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/archive-artwork-originals-fast.mjs [--limit 5000] [--concurrency 8] [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '0') || 8;

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';
const R2_PREFIX = 'artwork';

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

let success = 0, errors = 0, skipped = 0, totalBytes = 0;

async function archiveOne(doc) {
  const url = doc.commons_full_url;
  if (!url || url.includes('commons.wikimedia.org/wiki/')) {
    skipped++;
    return;
  }

  const label = `${doc.author} — ${doc.title?.substring(0, 45)}`;

  try {
    const t0 = Date.now();

    // Download original
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Fetch ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(buffer).metadata();

    // Convert to optimized JPEG at original resolution
    const jpegBuffer = await sharp(buffer)
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    const key = `${R2_PREFIX}/${doc.slug}-full.jpg`;

    if (!DRY_RUN) {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: jpegBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));

      await db.collection('books').updateOne({ _id: doc._id }, {
        $set: {
          archived_full_url: `https://images.sourcelibrary.org/${key}`,
          image_full: `https://images.sourcelibrary.org/${key}`,
          image_source_url: doc.commons_full_url,
          full_width: metadata.width,
          full_height: metadata.height,
          updated_at: new Date(),
        }
      });
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const mb = (jpegBuffer.length / 1024 / 1024).toFixed(1);
    totalBytes += jpegBuffer.length;
    success++;
    console.log(`  ✓ ${label} | ${metadata.width}x${metadata.height} | ${mb}MB | ${elapsed}s`);
  } catch (err) {
    errors++;
    const msg = err.message?.substring(0, 60) || 'unknown';
    console.log(`  ✗ ${label} | ${msg}`);
    if (msg.includes('429') || msg.includes('Too Many')) {
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

let db;

async function main() {
  await client.connect();
  db = client.db('bookstore');
  const books = db.collection('books');

  const query = {
    resource_type: { $exists: true },
    commons_full_url: { $exists: true, $ne: '' },
    archived_full_url: { $exists: false },
  };

  const items = await books.find(query, {
    projection: { _id: 1, slug: 1, author: 1, title: 1, commons_full_url: 1 },
  }).limit(LIMIT).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Archiving ${items.length} artworks to R2 (concurrency: ${CONCURRENCY})`);

  // Worker pool
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      if ((i + 1) % 50 === 0) {
        console.log(`\n[${i + 1}/${items.length}] success: ${success}, errors: ${errors}, skipped: ${skipped}`);
      }
      await archiveOne(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Archived: ${success}`);
  console.log(`Errors: ${errors}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
