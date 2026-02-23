#!/usr/bin/env node
/**
 * Batch Gallery Thumbnail Generator
 *
 * Generates pre-cropped gallery images + 300px thumbnails, uploads to Vercel Blob.
 * Eliminates on-the-fly /api/crop-image calls for 20k+ gallery images.
 *
 * Designed for Hetzner (no timeout limits, high bandwidth).
 * Also runs locally — just needs MONGODB_URI and BLOB_READ_WRITE_TOKEN.
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
import { put } from '@vercel/blob';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!BLOB_TOKEN) { console.error('BLOB_READ_WRITE_TOKEN not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ARCHIVED_ONLY = args.includes('--archived-only');

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

  // Upload to Vercel Blob
  const blobPrefix = `gallery/${bookId}/${pageId}-${detectionIndex}`;
  const [extractedBlob, thumbnailBlob] = await Promise.all([
    put(`${blobPrefix}.jpg`, extractedBuffer, {
      access: 'public', contentType: 'image/jpeg', addRandomSuffix: false,
      token: BLOB_TOKEN,
    }),
    put(`${blobPrefix}-thumb.jpg`, thumbnailBuffer, {
      access: 'public', contentType: 'image/jpeg', addRandomSuffix: false,
      token: BLOB_TOKEN,
    }),
  ]);

  const cacheBust = `?v=${Date.now()}`;
  return {
    extractedUrl: extractedBlob.url + cacheBust,
    thumbnailUrl: thumbnailBlob.url + cacheBust,
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

  if (ARCHIVED_ONLY) {
    matchFilter.archived_photo = { $exists: true, $ne: '' };
  }
  if (BOOK_ID) {
    matchFilter.book_id = BOOK_ID;
  }

  const totalNeeding = await pagesCol.countDocuments(matchFilter);
  console.log(`\nPages needing thumbnail generation: ${totalNeeding}`);

  if (DRY_RUN) {
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
    })
    .toArray();

  console.log(`Fetched ${pages.length} pages to process\n`);

  // Flatten to individual work items
  const workItems = [];
  for (const page of pages) {
    const sourceUrl = page.archived_photo || page.cropped_photo || page.photo_original || page.photo;
    if (!sourceUrl) continue;

    for (let idx = 0; idx < (page.detected_images || []).length; idx++) {
      const det = page.detected_images[idx];
      if (!det.bbox) continue;
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
