#!/usr/bin/env node
/**
 * Migrate book-level thumbnail_blob from Vercel Blob → Cloudflare R2
 *
 * Also generates R2 thumbnails for books that only have external IIIF URLs.
 *
 * Run:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/migrate-book-thumbnails-to-r2.mjs
 *
 * Flags:
 *   --dry-run     Show what would be done without changing anything
 *   --limit=N     Process at most N books
 *   --external    Also archive books with external-only thumbnails (slower)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// --- Config ---
const CONCURRENCY = 10;
const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_EXTERNAL = process.argv.includes('--external');
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

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error(`Suspiciously small image (${buf.length}b): ${url}`);
  return buf;
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

async function migrateBook(book, db) {
  const bookId = book.id || book._id.toString();
  const key = `book-thumbnails/${bookId}.jpg`;

  // Determine source URL
  let sourceUrl = null;
  if (book.thumbnail_blob?.includes('vercel-storage')) {
    sourceUrl = book.thumbnail_blob;
  } else if (INCLUDE_EXTERNAL && book.thumbnail && !book.thumbnail.includes('sourcelibrary')) {
    sourceUrl = book.thumbnail;
  }

  if (!sourceUrl) return { status: 'skip' };

  try {
    const data = await downloadImage(sourceUrl);
    if (DRY_RUN) {
      return { status: 'dry-run', size: data.length };
    }
    const newUrl = await uploadToR2(key, data);
    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: { thumbnail_blob: newUrl } }
    );
    return { status: 'migrated', size: data.length };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// --- Main ---

async function main() {
  console.log(`Book thumbnail → R2 migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`R2 bucket: ${BUCKET}, public URL: ${R2_PUBLIC_URL}`);
  console.log(`Include external thumbnails: ${INCLUDE_EXTERNAL}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} books`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Build query
  const conditions = [
    { thumbnail_blob: { $regex: 'vercel-storage' } },
  ];
  if (INCLUDE_EXTERNAL) {
    conditions.push({
      $and: [
        { thumbnail: { $exists: true, $ne: '' } },
        { thumbnail: { $not: { $regex: 'sourcelibrary' } } },
        { $or: [
          { thumbnail_blob: { $exists: false } },
          { thumbnail_blob: '' },
          { thumbnail_blob: null },
          { thumbnail_blob: { $not: { $regex: 'sourcelibrary' } } },
        ]},
      ]
    });
  }

  const query = { hidden: { $ne: true }, $or: conditions };
  const totalBooks = await db.collection('books').countDocuments(query);
  console.log(`Found ${totalBooks} books to process`);

  const cursor = db.collection('books').find(query, {
    projection: { _id: 1, id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1 },
  });
  if (LIMIT) cursor.limit(LIMIT);

  let processed = 0;
  let migrated = 0;
  let errors = 0;
  let skipped = 0;
  let totalBytes = 0;
  let batch = [];

  for await (const book of cursor) {
    batch.push(book);

    if (batch.length >= CONCURRENCY) {
      const results = await Promise.allSettled(
        batch.map(b => migrateBook(b, db))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const v = r.value;
          if (v.status === 'migrated' || v.status === 'dry-run') {
            migrated++;
            totalBytes += v.size || 0;
          } else if (v.status === 'error') {
            errors++;
            console.error(`  ERROR: ${v.message}`);
          } else {
            skipped++;
          }
        } else {
          errors++;
          console.error(`  FATAL: ${r.reason}`);
        }
      }
      processed += batch.length;
      batch = [];

      const pct = totalBooks > 0 ? ((processed / totalBooks) * 100).toFixed(1) : '?';
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      console.log(`  ${processed}/${totalBooks} (${pct}%) — ${migrated} migrated, ${errors} errors, ${mb} MB uploaded`);
    }
  }

  // Drain remaining
  if (batch.length > 0) {
    const results = await Promise.allSettled(
      batch.map(b => migrateBook(b, db))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        if (v.status === 'migrated' || v.status === 'dry-run') {
          migrated++;
          totalBytes += v.size || 0;
        } else if (v.status === 'error') {
          errors++;
        } else {
          skipped++;
        }
      } else {
        errors++;
      }
    }
    processed += batch.length;
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`\nDone. ${processed} books processed, ${migrated} migrated (${mb} MB), ${skipped} skipped, ${errors} errors.`);
  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
