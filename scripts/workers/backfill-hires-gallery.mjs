#!/usr/bin/env node
/**
 * Backfill high-res gallery crops from archived R2 originals.
 *
 * Reads archived_photo (full-res scans already on R2), crops using bbox,
 * uploads hires crop back to R2. No external API calls — pure R2→R2.
 *
 * Run on Hetzner:
 *   cd /root/sourcelibrary && set -a && source .env.production.local && set +a
 *   node scripts/workers/backfill-hires-gallery.mjs [--batch=500] [--concurrency=5] [--dry-run]
 *
 * Designed to run as a background job, resumable (skips images that already have hires_url).
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.production.local') });

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BATCH_SIZE = parseInt(getArg('batch') || '500', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '5', 10);
const DRY_RUN = hasFlag('dry-run');
const MAX_DIM = 5000;       // Safety cap before cropping
const JPEG_QUALITY = 92;    // High quality for hires
const PADDING = 0.02;       // 2% padding around bbox

async function fetchBuffer(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${url.slice(-40)}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function storagePutR2(key, buffer, contentType) {
  const { storagePut } = await import('../../src/lib/storage.ts');
  return storagePut(key, buffer, { contentType, allowOverwrite: true });
}

function normalizeBbox(bbox) {
  const isPixels = bbox.x > 1 || bbox.y > 1 || bbox.width > 1 || bbox.height > 1;
  if (isPixels) {
    const scale = Math.max(bbox.x + bbox.width, bbox.y + bbox.height, 1000);
    return {
      x: Math.min(bbox.x / scale, 0.95),
      y: Math.min(bbox.y / scale, 0.95),
      w: Math.min(bbox.width / scale, 1),
      h: Math.min(bbox.height / scale, 1),
    };
  }
  return { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
}

async function processOne(db, gi, pageMap) {
  const page = pageMap.get(gi.page_id);
  if (!page) return 'skip-no-page';

  // Use archived_photo (R2) or cropped_photo (R2 split pages) — both are already on our CDN
  const sourceUrl = page.cropped_photo || page.archived_photo;
  if (!sourceUrl) return 'skip-no-source';
  if (!sourceUrl.includes('images.sourcelibrary.org')) return 'skip-not-r2';

  const bbox = gi.bbox;
  if (!bbox) return 'skip-no-bbox';

  const { x, y, w, h } = normalizeBbox(bbox);
  const rotation = gi.rotation || 0;

  // Fetch the full-res archived image from R2
  let imageBuffer;
  try {
    imageBuffer = await fetchBuffer(sourceUrl);
  } catch (err) {
    return `error-fetch: ${err.message.slice(0, 60)}`;
  }

  const rawMeta = await sharp(imageBuffer).metadata();
  let imgWidth = rawMeta.width || 1;
  let imgHeight = rawMeta.height || 1;

  // Safety downscale if extremely large (>5000px)
  if (imgWidth > MAX_DIM || imgHeight > MAX_DIM) {
    imageBuffer = await sharp(imageBuffer)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const m = await sharp(imageBuffer).metadata();
    imgWidth = m.width || 1;
    imgHeight = m.height || 1;
  }

  // Crop with padding
  const padX = PADDING * imgWidth;
  const padY = PADDING * imgHeight;
  const left = Math.max(0, Math.floor(x * imgWidth - padX));
  const top = Math.max(0, Math.floor(y * imgHeight - padY));
  const width = Math.min(imgWidth - left, Math.ceil(w * imgWidth + padX * 2));
  const height = Math.min(imgHeight - top, Math.ceil(h * imgHeight + padY * 2));

  if (width < 10 || height < 10) return 'skip-tiny-crop';

  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });
  if (rotation) pipeline = pipeline.rotate(rotation);

  const hiresBuffer = await pipeline
    .jpeg({ quality: JPEG_QUALITY, progressive: true })
    .toBuffer();

  // Upload to R2
  const key = `gallery/${gi.book_id}/${gi.page_id}-${gi.detection_index}-hires.jpg`;
  const uploaded = await storagePutR2(key, hiresBuffer, 'image/jpeg');

  // Write hires_url to both pages.detected_images and gallery_images
  const hiresUrl = uploaded.url;
  await Promise.all([
    db.collection('pages').updateOne(
      { id: gi.page_id },
      { $set: { [`detected_images.${gi.detection_index}.hires_url`]: hiresUrl } }
    ),
    db.collection('gallery_images').updateOne(
      { id: gi.id },
      { $set: { hires_url: hiresUrl, updated_at: new Date() } }
    ),
  ]);

  return hiresUrl;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Count total work
  const totalMissing = await db.collection('gallery_images').countDocuments({
    $or: [{ hires_url: { $exists: false } }, { hires_url: null }],
    bbox: { $exists: true },
  });
  console.log(`Total gallery images missing hires_url: ${totalMissing}`);
  console.log(`Processing batch of ${BATCH_SIZE} at concurrency ${CONCURRENCY}`);
  if (DRY_RUN) console.log('DRY RUN — no writes');

  // Strategy: find pages that have R2 archived images AND detected_images,
  // then match against gallery_images that need hires. This avoids fetching
  // gallery_images for pages without R2 sources (which would just skip).
  const pages = await db.collection('pages')
    .find({
      'detected_images.0': { $exists: true },
      $or: [
        { archived_photo: { $regex: '^https://images\\.sourcelibrary\\.org/' } },
        { cropped_photo: { $regex: '^https://images\\.sourcelibrary\\.org/' } },
      ],
    })
    .project({ id: 1, archived_photo: 1, cropped_photo: 1 })
    .limit(BATCH_SIZE * 2)  // Overfetch since not all will need hires
    .toArray();

  const pageMap = new Map(pages.map(p => [p.id, p]));
  const pageIds = pages.map(p => p.id);

  // Now find gallery_images for these pages that still need hires
  const batch = await db.collection('gallery_images')
    .find({
      page_id: { $in: pageIds },
      $or: [{ hires_url: { $exists: false } }, { hires_url: null }],
      bbox: { $exists: true },
    })
    .sort({ gallery_quality: -1 })
    .limit(BATCH_SIZE)
    .toArray();

  if (batch.length === 0) {
    console.log('Nothing to do — all images with R2 sources have hires!');
    await client.close();
    return;
  }

  console.log(`Batch: ${batch.length} images, ${pageIds.length} unique pages, ${pages.length} pages found`);

  if (DRY_RUN) {
    const withSource = batch.filter(gi => {
      const p = pageMap.get(gi.page_id);
      return p && (p.cropped_photo || p.archived_photo)?.includes('images.sourcelibrary.org');
    });
    console.log(`Would process ${withSource.length}/${batch.length} (have R2 source)`);
    await client.close();
    return;
  }

  let ok = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  // Process in concurrent chunks
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (gi) => {
      try {
        const result = await processOne(db, gi, pageMap);
        if (typeof result === 'string' && result.startsWith('skip')) {
          skipped++;
          return result;
        } else if (typeof result === 'string' && result.startsWith('error')) {
          errors++;
          return result;
        } else {
          ok++;
          return 'ok';
        }
      } catch (err) {
        errors++;
        return `error: ${err.message.slice(0, 60)}`;
      }
    }));

    // Progress every 50 images
    if ((i + CONCURRENCY) % 50 < CONCURRENCY) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = ok > 0 ? (ok / (elapsed / 60)).toFixed(1) : '0';
      console.log(`[${i + CONCURRENCY}/${batch.length}] ${ok} ok, ${skipped} skip, ${errors} err | ${elapsed}s | ${rate}/min`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone: ${ok} hires generated, ${skipped} skipped, ${errors} errors in ${elapsed}s`);
  console.log(`Remaining: ~${totalMissing - ok}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
