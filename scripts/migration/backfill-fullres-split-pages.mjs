/**
 * Backfill full-res cropped halves for split pages
 *
 * Previously cropAndUploadHalf capped at 2000px. This script re-crops
 * from the source spread at full resolution and uploads all three variants:
 *   - pages/{bookId}/{num}-full.jpg  (full-res crop)
 *   - pages/{bookId}/{num}.jpg       (1200px display)
 *   - pages/{bookId}/{num}-thumb.jpg (150px thumbnail)
 *
 * All three variants MUST be written together or readers (e.g.
 * getBookThumbnailUrl in src/lib/utils.ts) get confused when the rewrite
 * `-full → bare` returns inconsistent content. The May 2026 BPH cover-fix
 * bug came from an earlier version that only wrote -full + display, leaving
 * -thumb stale and (in some cases) the bare .jpg never being overwritten —
 * see scripts/regenerate-cover-variants.mjs for the retroactive fix.
 *
 * Prioritizes pages with detected_images (gallery quality matters most).
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/migration/backfill-fullres-split-pages.mjs
 * Options:
 *   --dry-run       Preview without writing
 *   --limit N       Process at most N pages (default: all)
 *   --batch N       Concurrent pages per batch (default: 5)
 *   --detections-only  Only process pages with detected_images
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DISPLAY_WIDTH = 1200;
const THUMB_WIDTH = 150;
const DISPLAY_QUALITY = 85;
const THUMB_QUALITY = 80;
const FULL_QUALITY = 90;
const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] || '5');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const DRY_RUN = process.argv.includes('--dry-run');
const DETECTIONS_ONLY = process.argv.includes('--detections-only');

// R2 setup
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function uploadToR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));
  return `${R2_PUBLIC}/${key}`;
}

function pagePaths(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return { full: `${base}-full.jpg`, display: `${base}.jpg`, thumb: `${base}-thumb.jpg` };
}

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function processPage(db, page) {
  // Get the source spread image
  const sourceUrl = page.archived_photo || page.photo_original;
  if (!sourceUrl || sourceUrl.startsWith('failed:')) {
    return { status: 'skip', reason: 'no source' };
  }

  const buffer = await fetchImage(sourceUrl);
  const metadata = await sharp(buffer).metadata();
  const imgWidth = metadata.width || 1000;
  const imgHeight = metadata.height || 1000;

  // Crop
  const left = Math.round((page.crop.xStart / 1000) * imgWidth);
  const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * imgWidth);

  const fullResBuffer = await sharp(buffer)
    .extract({
      left,
      top: 0,
      width: Math.min(cropWidth, imgWidth - left),
      height: imgHeight,
    })
    .jpeg({ quality: FULL_QUALITY, progressive: true })
    .toBuffer();

  const displayBuffer = await sharp(fullResBuffer)
    .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
    .toBuffer();
  const thumbBuffer = await sharp(fullResBuffer)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, progressive: true })
    .toBuffer();

  const paths = pagePaths(page.book_id, page.page_number);

  if (DRY_RUN) {
    const fullMeta = await sharp(fullResBuffer).metadata();
    return { status: 'dry-run', fullRes: `${fullMeta.width}x${fullMeta.height}`, bytes: fullResBuffer.length };
  }

  const [fullUrl] = await Promise.all([
    uploadToR2(paths.full, fullResBuffer),
    uploadToR2(paths.display, displayBuffer),
    uploadToR2(paths.thumb, thumbBuffer),
  ]);

  // Update page record — cropped_photo points to full-res
  await db.collection('pages').updateOne(
    { id: page.id },
    { $set: { cropped_photo: fullUrl, updated_at: new Date() } }
  );

  return { status: 'ok', fullUrl };
}

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const query = { 'crop.xStart': { $exists: true } };
  if (DETECTIONS_ONLY) {
    query['detected_images.0'] = { $exists: true };
  }

  // Skip slow count — we know: 403K split, 33K with detections
  const totalCount = DETECTIONS_ONLY ? 33657 : 403186;
  console.log(`Estimated ${totalCount} split pages${DETECTIONS_ONLY ? ' with detections' : ''}`);
  if (DRY_RUN) console.log('DRY RUN — no writes');

  const cursor = db.collection('pages')
    .find(query, {
      projection: {
        id: 1, book_id: 1, page_number: 1, crop: 1,
        archived_photo: 1, photo_original: 1,
      },
    })
    // Process pages with detections first (sort by detected_images existence)
    .sort({ 'detected_images.0': -1 });

  if (LIMIT > 0) cursor.limit(LIMIT);

  let processed = 0, ok = 0, skipped = 0, errors = 0;
  let batch = [];

  for await (const page of cursor) {
    batch.push(page);
    if (batch.length >= BATCH_SIZE) {
      const results = await Promise.allSettled(
        batch.map(p => processPage(db, p).catch(e => ({ status: 'error', msg: e.message })))
      );
      for (const r of results) {
        processed++;
        const val = r.status === 'fulfilled' ? r.value : { status: 'error', msg: r.reason?.message };
        if (val.status === 'ok') ok++;
        else if (val.status === 'dry-run') { ok++; console.log(`  dry-run: ${val.fullRes}, ${Math.round(val.bytes/1024)}KB`); }
        else if (val.status === 'skip') { skipped++; console.log(`  skip: ${val.reason}`); }
        else { errors++; if (errors <= 10) console.error(`  Error: ${val.msg}`); }
      }
      if (processed % 100 === 0 || processed >= totalCount) {
        const pct = ((processed / totalCount) * 100).toFixed(1);
        console.log(`${processed}/${totalCount} (${pct}%) — ok:${ok} skip:${skipped} err:${errors}`);
      }
      batch = [];
    }
  }

  // Final batch
  if (batch.length > 0) {
    const results = await Promise.allSettled(
      batch.map(p => processPage(db, p).catch(e => ({ status: 'error', msg: e.message })))
    );
    for (const r of results) {
      processed++;
      const val = r.status === 'fulfilled' ? r.value : { status: 'error', msg: r.reason?.message };
      if (val.status === 'ok' || val.status === 'dry-run') ok++;
      else if (val.status === 'skip') skipped++;
      else errors++;
    }
  }

  console.log(`\nDone. Processed: ${processed}, OK: ${ok}, Skipped: ${skipped}, Errors: ${errors}`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
