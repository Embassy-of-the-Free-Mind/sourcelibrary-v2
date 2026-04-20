#!/usr/bin/env node
/**
 * Archive artwork thumbnails from external URLs (Wikimedia, Met, etc.) to R2.
 * Downloads image, generates display (2000px) + thumb (600px), uploads to R2,
 * updates book.thumbnail to R2 URL.
 *
 * Respects Wikimedia rate limits (2 req/s max, User-Agent required).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/archive-artwork-thumbnails-to-r2.mjs [--dry-run] [--limit=100]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) artwork-archive';
const DELAY_MS = 600; // ~1.5 req/s to stay under Wikimedia limits

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function r2Exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function archiveArtwork(book) {
  const id = book.id || book._id.toString();
  const key = `artwork/${id}.jpg`;
  const thumbKey = `artwork/${id}-thumb.jpg`;

  // Skip if already on R2
  if (book.thumbnail?.includes('images.sourcelibrary.org')) return 'skip-already-r2';

  // Skip if no thumbnail
  if (!book.thumbnail) return 'skip-no-thumbnail';

  // Check if already archived
  if (await r2Exists(key)) return 'skip-exists';

  // Download original
  let buffer;
  try {
    const res = await fetch(book.thumbnail, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return `fail-http-${res.status}`;
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return `fail-download-${e.message?.substring(0, 40)}`;
  }

  // Generate display version (2000px max) + thumbnail (600px)
  try {
    const displayBuffer = await sharp(buffer)
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    const thumbBuffer = await sharp(buffer)
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    if (!DRY_RUN) {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: displayBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
      }));
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: thumbKey, Body: thumbBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
      }));
    }

    return { displaySize: displayBuffer.length, thumbSize: thumbBuffer.length };
  } catch (e) {
    return `fail-sharp-${e.message?.substring(0, 40)}`;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find artworks with external thumbnails (not on R2)
  const query = {
    content_type: 'artwork',
    visible: true,
    thumbnail: { $exists: true, $not: /images\.sourcelibrary\.org/ },
  };
  const total = await db.collection('books').countDocuments(query);
  const limit = LIMIT || total;

  console.log(`Artwork thumbnail → R2 archival${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Found ${total} artworks with external thumbnails, processing ${Math.min(limit, total)}`);

  const cursor = db.collection('books').find(query, {
    projection: { title: 1, id: 1, thumbnail: 1, slug: 1 },
  }).limit(limit);

  let processed = 0, archived = 0, skipped = 0, failed = 0, bytes = 0;

  for await (const book of cursor) {
    processed++;
    const result = await archiveArtwork(book);

    if (typeof result === 'object') {
      // Success
      archived++;
      bytes += result.displaySize + result.thumbSize;
      const id = book.id || book._id.toString();
      const r2Url = `${R2_URL}/artwork/${id}.jpg`;

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: book._id },
          { $set: {
            thumbnail: r2Url,
            thumbnail_blob: `${R2_URL}/artwork/${id}-thumb.jpg`,
            archived_photo: r2Url,
          }}
        );
      }
    } else if (result.startsWith('skip')) {
      skipped++;
    } else {
      failed++;
      if (failed <= 10) console.log(`  FAIL: ${book.title?.substring(0, 50)} — ${result}`);
    }

    if (processed % 100 === 0 || processed === Math.min(limit, total)) {
      const mb = (bytes / 1024 / 1024).toFixed(1);
      console.log(`  ${processed}/${Math.min(limit, total)} — ${archived} archived (${mb} MB), ${skipped} skipped, ${failed} failed`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${archived} archived (${(bytes / 1024 / 1024).toFixed(1)} MB), ${skipped} skipped, ${failed} failed.`);
  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
