#!/usr/bin/env node
/**
 * Batch Gallery Thumbnail Generator
 *
 * Generates pre-cropped gallery images + 300px thumbnails, uploads to Cloudflare R2.
 * Eliminates on-the-fly /api/crop-image calls for 20k+ gallery images.
 *
 * Designed for Hetzner (no timeout limits, high bandwidth).
 * Also runs locally — just needs MONGODB_URI and R2 env vars.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/generate-thumbnails.mjs
 *   node scripts/workers/generate-thumbnails.mjs --dry-run
 *   node scripts/workers/generate-thumbnails.mjs --limit=500
 *   node scripts/workers/generate-thumbnails.mjs --book-id=BOOK_ID
 *   node scripts/workers/generate-thumbnails.mjs --min-quality=0.9
 *   node scripts/workers/generate-thumbnails.mjs --archived-only     # Only pages with fast Blob source URLs
 *   node scripts/workers/generate-thumbnails.mjs --concurrency=10    # Parallel image processing
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { computeDHash } from '../lib/dhash.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set'); process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function storagePut(key, body, contentType = 'application/octet-stream') {
  const k = key.replace(/^\//, '');
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: k, Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return { url: `${R2_PUBLIC_URL}/${k}`, pathname: k };
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ARCHIVED_ONLY = args.includes('--archived-only');
const INCLUDE_SENSITIVE = args.includes('--include-sensitive');

function getArg(name, defaultVal) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
}

const LIMIT = parseInt(getArg('limit', '5000'));
const BOOK_ID = getArg('book-id', null);
const MIN_QUALITY = parseFloat(getArg('min-quality', '0'));
const CONCURRENCY = parseInt(getArg('concurrency', '8'));

console.log(`[generate-thumbnails] Config:`);
console.log(`  Limit: ${LIMIT}, Concurrency: ${CONCURRENCY}, Min quality: ${MIN_QUALITY}`);
console.log(`  Archived only: ${ARCHIVED_ONLY}, Dry run: ${DRY_RUN}`);
if (BOOK_ID) console.log(`  Book: ${BOOK_ID}`);

// ── Image processing ──

const MAX_DIM = 3000;

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url.substring(0, 80)}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function generateThumbnails(sourceUrl, bbox, rotation, bookId, pageId, detectionIndex) {
  // Fetch source
  const rawBuffer = await fetchImage(sourceUrl);
  const rawMeta = await sharp(rawBuffer).metadata();
  const origWidth = rawMeta.width || 1;
  const origHeight = rawMeta.height || 1;

  // Normalize bbox (should already be 0-1, but handle edge cases)
  let normX = bbox.x, normY = bbox.y, normW = bbox.width, normH = bbox.height;
  if (normX > 1 || normY > 1 || normW > 1 || normH > 1) {
    const scale = Math.max(normX + normW, normY + normH, 1000);
    normX = Math.min(normX / scale, 0.95);
    normY = Math.min(normY / scale, 0.95);
    normW = Math.min(normW / scale, 1);
    normH = Math.min(normH / scale, 1);
  }

  // Downscale oversized images
  let imageBuffer = rawBuffer;
  let imgWidth = origWidth;
  let imgHeight = origHeight;

  if (origWidth > MAX_DIM || origHeight > MAX_DIM) {
    imageBuffer = await sharp(rawBuffer)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const resizedMeta = await sharp(imageBuffer).metadata();
    imgWidth = resizedMeta.width || 1;
    imgHeight = resizedMeta.height || 1;
  }

  // Crop with padding
  const padding = 0.02;
  const padX = padding * imgWidth;
  const padY = padding * imgHeight;
  const left = Math.max(0, Math.floor(normX * imgWidth - padX));
  const top = Math.max(0, Math.floor(normY * imgHeight - padY));
  const width = Math.min(imgWidth - left, Math.ceil(normW * imgWidth + padX * 2));
  const height = Math.min(imgHeight - top, Math.ceil(normH * imgHeight + padY * 2));

  if (width <= 0 || height <= 0) throw new Error(`Invalid crop dimensions: ${width}x${height}`);

  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });
  if (rotation && [90, 180, 270].includes(rotation)) {
    pipeline = pipeline.rotate(rotation);
  }

  // Generate full-size + thumbnail
  const extractedBuffer = await pipeline.jpeg({ quality: 85, progressive: true }).toBuffer();
  const thumbnailBuffer = await sharp(extractedBuffer)
    .resize(300, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();

  // Compute dhash on the cropped image — same buffer the dedup logic will
  // see at render time (src/lib/dhash.ts). Cheap; runs alongside the upload.
  const dhash = await computeDHash(extractedBuffer);

  // Upload to R2
  const blobPrefix = `gallery/${bookId}/${pageId}-${detectionIndex}`;
  const [extractedBlob, thumbnailBlob] = await Promise.all([
    storagePut(`${blobPrefix}.jpg`, extractedBuffer, 'image/jpeg'),
    storagePut(`${blobPrefix}-thumb.jpg`, thumbnailBuffer, 'image/jpeg'),
  ]);

  const cacheBust = `?v=${Date.now()}`;
  return {
    extractedUrl: extractedBlob.url + cacheBust,
    thumbnailUrl: thumbnailBlob.url + cacheBust,
    dhash,
  };
}

// ── Concurrency helper ──

async function processPool(items, concurrency, fn) {
  let idx = 0;
  let processed = 0;
  let failed = 0;
  const errors = [];

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        await fn(items[i]);
        processed++;
      } catch (err) {
        failed++;
        errors.push({ item: items[i], error: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return { processed, failed, errors };
}

// ── Main ──

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pagesCol = db.collection('pages');
  const galleryCol = db.collection('gallery_images');

  // Find pages with detections that need thumbnails
  const matchFilter = {
    detected_images: {
      $elemMatch: {
        bbox: { $exists: true },
        $or: [
          { extracted_url: { $exists: false } },
          { extracted_url: null },
        ],
        detection_source: { $in: ['vision_model', 'manual', 'ocr_tag'] },
        ...(MIN_QUALITY > 0 ? { gallery_quality: { $gte: MIN_QUALITY } } : {}),
      },
    },
  };

  // Require a source image to crop from. Pages with no archived/cropped/photo
  // can't be thumbnailed — the work-item loop skips them — but without this
  // they still match the filter and re-appear in every `--limit` batch, so a
  // front cluster of source-less pages stalls the batch loop before it reaches
  // processable pages further back (and the loop never terminates).
  matchFilter.$or = [
    { archived_photo: { $ne: null } },
    { cropped_photo: { $ne: null } },
    { photo_original: { $ne: null } },
    { photo: { $ne: null } },
  ];

  if (ARCHIVED_ONLY) {
    matchFilter.archived_photo = { $exists: true, $ne: '' };
  }
  if (BOOK_ID) {
    matchFilter.book_id = BOOK_ID;
  } else if (!INCLUDE_SENSITIVE) {
    // Sensitive-content hold (issue #2431): the global gallery/feed/search
    // currently have NO sensitive gate — erotic books' images stay out of
    // those surfaces only because their crops were never materialized.
    // Until the read-path gate ships, do not materialize crops for books
    // flagged `sensitive: true` (set from erotic-collection membership by
    // scripts/maintenance/flag-sensitive-books.mjs). Explicit --book-id or
    // --include-sensitive overrides for deliberate, scoped runs.
    const sensitiveIds = await db.collection('books').distinct('id', { sensitive: true });
    if (sensitiveIds.length > 0) {
      matchFilter.book_id = { $nin: sensitiveIds };
      console.log(`Skipping ${sensitiveIds.length} sensitive books (#2431; --include-sensitive to override)`);
    }
  }

  // countDocuments(matchFilter) is a full COLLSCAN over the pages collection
  // (the $elemMatch on detected_images isn't indexed) and at backlog scale
  // (tens of thousands matching) it can take many minutes — pointless to pay
  // in apply mode where it's only an informational log. The limited find below
  // stops early once it hits LIMIT matches, so skip the count unless dry-run.
  if (DRY_RUN) {
    const totalNeeding = await pagesCol.countDocuments(matchFilter);
    console.log(`\nPages needing thumbnail generation: ${totalNeeding}`);
    // Count individual detections
    const detectionCount = await pagesCol.aggregate([
      { $match: matchFilter },
      { $unwind: '$detected_images' },
      { $match: {
        'detected_images.bbox': { $exists: true },
        'detected_images.detection_source': { $in: ['vision_model', 'manual', 'ocr_tag'] },
        $or: [
          { 'detected_images.extracted_url': { $exists: false } },
          { 'detected_images.extracted_url': null },
        ],
      }},
      { $count: 'total' },
    ]).toArray();
    console.log(`Individual detections needing thumbnails: ${detectionCount[0]?.total ?? 0}`);
    await client.close();
    return;
  }

  // Fetch pages
  const pages = await pagesCol.find(matchFilter)
    .limit(LIMIT)
    .project({
      id: 1, book_id: 1,
      detected_images: 1,
      archived_photo: 1, cropped_photo: 1, photo_original: 1, photo: 1,
      enhanced_photo: 1, split_from_spread: 1,
    })
    .toArray();

  console.log(`Fetched ${pages.length} pages to process\n`);

  // Flatten to individual work items
  const workItems = [];
  for (const page of pages) {
    // MUST match the source the detection bboxes were computed against
    // (image-extract-worker resolves it via getPageSource). On split pages
    // archived_photo is the full two-page spread — cropping it with a
    // cropped_photo-space bbox produces a gutter-spanning junk crop.
    const sourceUrl = getPageSource(page);
    if (!sourceUrl) continue;

    for (let idx = 0; idx < (page.detected_images || []).length; idx++) {
      const det = page.detected_images[idx];
      if (!det || !det.bbox) continue;
      if (det.extracted_url) continue; // already has thumbnail
      if (!['vision_model', 'manual', 'ocr_tag'].includes(det.detection_source)) continue;
      if (MIN_QUALITY > 0 && (det.gallery_quality || 0) < MIN_QUALITY) continue;

      workItems.push({
        pageId: page.id,
        bookId: page.book_id,
        detectionIndex: idx,
        sourceUrl,
        bbox: det.bbox,
        rotation: det.rotation || 0,
      });
    }
  }

  console.log(`Work items: ${workItems.length} detections across ${pages.length} pages`);
  console.log(`Processing with concurrency=${CONCURRENCY}...\n`);

  const startTime = Date.now();
  let completed = 0;

  const result = await processPool(workItems, CONCURRENCY, async (item) => {
    const { sourceUrl, bbox, rotation, bookId, pageId, detectionIndex } = item;

    const urls = await generateThumbnails(sourceUrl, bbox, rotation, bookId, pageId, detectionIndex);

    // Update page record
    await pagesCol.updateOne(
      { id: pageId },
      {
        $set: {
          [`detected_images.${detectionIndex}.extracted_url`]: urls.extractedUrl,
          [`detected_images.${detectionIndex}.thumbnail_url`]: urls.thumbnailUrl,
          [`detected_images.${detectionIndex}.dhash`]: urls.dhash,
        },
      }
    );

    // Update gallery_images if it exists
    const galleryId = `${pageId}-${detectionIndex}`;
    await galleryCol.updateOne(
      { id: galleryId },
      {
        $set: {
          extracted_url: urls.extractedUrl,
          thumbnail_url: urls.thumbnailUrl,
          dhash: urls.dhash,
          updated_at: new Date(),
        },
      }
    );

    completed++;
    if (completed % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (completed / elapsed).toFixed(1);
      console.log(`  [${completed}/${workItems.length}] ${rate}/s — ${pageId}-${detectionIndex}`);
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n--- Summary ---`);
  console.log(`Processed: ${result.processed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`Duration: ${elapsed}s (${(result.processed / (elapsed / 1)).toFixed(1)}/s)`);

  if (result.errors.length > 0) {
    console.log(`\nFirst 20 errors:`);
    result.errors.slice(0, 20).forEach(e =>
      console.log(`  ${e.item.pageId}-${e.item.detectionIndex}: ${e.error}`)
    );
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
