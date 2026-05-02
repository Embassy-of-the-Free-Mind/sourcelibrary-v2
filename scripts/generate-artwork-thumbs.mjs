#!/usr/bin/env node
/**
 * Generate missing artwork thumbnails on R2.
 *
 * Generates two sizes from the display image:
 * - {slug}-thumb.jpg  (600px, quality 80) — artwork detail page
 * - {slug}-grid.jpg   (300px, quality 75) — collection grid view
 *
 * Updates DB: thumbnail_blob → -thumb.jpg
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/generate-artwork-thumbs.mjs [--dry-run] [--limit 100]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const CONCURRENCY = 5;

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function processOne(db, art) {
  // Prefer the largest available R2 image as source for best crop quality
  // thumbnail often points to -full.jpg (confusing naming), thumbnail_blob to -thumb.jpg
  const candidates = [art.thumbnail, art.thumbnail_blob].filter(u => u?.includes('images.sourcelibrary.org'));
  if (!candidates.length) return 'skip';
  // Pick the one that looks largest (prefer no -thumb suffix)
  const displayUrl = candidates.find(u => !u.includes('-thumb.')) || candidates[0];

  // Derive base key (strip -thumb, -full, -grid suffixes)
  const baseUrl = displayUrl
    .replace(/-thumb\.jpg$/, '.jpg')
    .replace(/-full\.jpg$/, '.jpg')
    .replace(/-grid\.jpg$/, '.jpg');

  const thumbUrl = baseUrl.replace(/\.jpg$/, '-thumb.jpg');
  const gridUrl = baseUrl.replace(/\.jpg$/, '-grid.jpg');
  const thumbKey = thumbUrl.replace('https://images.sourcelibrary.org/', '');
  const gridKey = gridUrl.replace('https://images.sourcelibrary.org/', '');

  try {
    // Download source image
    const res = await fetch(displayUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return 'http-' + res.status;

    const buf = Buffer.from(await res.arrayBuffer());

    // Grid: center-crop to square at the image's natural short dimension — no resize
    const meta = await sharp(buf).metadata();
    const w = meta.width || 300;
    const h = meta.height || 300;
    const side = Math.min(w, h);
    const left = Math.round((w - side) / 2);
    const top = Math.round((h - side) / 2);
    const [thumbBuf, gridBuf] = await Promise.all([
      sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
      sharp(buf).extract({ left, top, width: side, height: side }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    ]);

    // Upload both
    await Promise.all([
      s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME, Key: thumbKey, Body: thumbBuf,
        ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
      })),
      s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME, Key: gridKey, Body: gridBuf,
        ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
      })),
    ]);

    // Update DB
    await db.collection('books').updateOne({ _id: art._id }, {
      $set: {
        thumbnail_blob: thumbUrl,
        grid_thumbnail: gridUrl,
      },
    });

    return 'ok';
  } catch (err) {
    return 'err:' + (err.message || '').substring(0, 40);
  }
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // Find artworks needing grid thumbnails (regenerate all with --regen flag)
  const REGEN = process.argv.includes('--regen');
  const gridFilter = REGEN ? {} : { grid_thumbnail: { $exists: false } };
  const arts = await db.collection('books').find(
    {
      resource_type: { $exists: true },
      ...gridFilter,
      $or: [
        { thumbnail_blob: { $regex: /images\.sourcelibrary\.org/ } },
        { thumbnail: { $regex: /images\.sourcelibrary\.org/ } },
      ],
    },
    { projection: { _id: 1, slug: 1, thumbnail_blob: 1, thumbnail: 1 } }
  ).limit(LIMIT).toArray();

  console.log(`Artworks needing grid thumbnails: ${arts.length}`);

  if (DRY_RUN) {
    for (const a of arts.slice(0, 10)) console.log('  ', a.slug?.substring(0, 50));
    console.log(`\nWould generate ${arts.length * 2} images (thumb + grid)`);
    await client.close();
    return;
  }

  let ok = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  // Process in batches for concurrency
  for (let i = 0; i < arts.length; i += CONCURRENCY) {
    const batch = arts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(a => processOne(db, a)));

    for (const r of results) {
      if (r === 'ok') ok++;
      else if (r === 'skip') skipped++;
      else errors++;
    }

    if ((ok + errors) % 100 === 0 && ok > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = ok / elapsed;
      const remaining = (arts.length - i) / rate;
      console.log(`  ${ok} done, ${errors} errors, ${rate.toFixed(1)}/s, ~${Math.round(remaining / 60)}m remaining`);
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Generated: ${ok} (${ok * 2} images)`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
