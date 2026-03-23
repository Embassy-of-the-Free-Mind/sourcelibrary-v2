/**
 * Backfill extracted_width and extracted_height for existing gallery images.
 *
 * Fetches each extracted_url, reads dimensions via sharp, and updates
 * both gallery_images and the source pages.detected_images entries.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/backfill-gallery-dimensions.mjs
 *
 * Options:
 *   --limit N    Process at most N images (default: all)
 *   --dry-run    Show what would be updated without writing
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

const client = new MongoClient(MONGODB_URI);

async function fetchImageDimensions(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  return { width: meta.width || 0, height: meta.height || 0 };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Find gallery images that have extracted_url but no extracted_width
  const query = {
    extracted_url: { $type: 'string', $gt: '' },
    $or: [
      { extracted_width: { $exists: false } },
      { extracted_width: null },
      { extracted_width: 0 },
    ],
  };

  const total = await db.collection('gallery_images').countDocuments(query);
  console.log(`Found ${total} gallery images missing dimensions`);
  if (total === 0) { await client.close(); return; }

  const cursor = db.collection('gallery_images').find(query);
  if (limit > 0) cursor.limit(limit);

  let processed = 0, failed = 0, updated = 0;
  const BATCH_SIZE = 10;
  let batch = [];

  for await (const img of cursor) {
    batch.push(img);
    if (batch.length >= BATCH_SIZE) {
      const results = await Promise.allSettled(batch.map(processImage));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) updated++;
        else if (r.status === 'rejected') failed++;
      }
      processed += batch.length;
      console.log(`Progress: ${processed}/${limit || total} (updated: ${updated}, failed: ${failed})`);
      batch = [];
    }
  }

  // Process remaining
  if (batch.length > 0) {
    const results = await Promise.allSettled(batch.map(processImage));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) updated++;
      else if (r.status === 'rejected') failed++;
    }
    processed += batch.length;
  }

  console.log(`\nDone. Processed: ${processed}, Updated: ${updated}, Failed: ${failed}`);
  await client.close();

  async function processImage(img) {
    try {
      const { width, height } = await fetchImageDimensions(img.extracted_url);
      if (width === 0) return false;

      if (dryRun) {
        console.log(`  [dry-run] ${img.id}: ${width}x${height}`);
        return true;
      }

      // Update gallery_images
      await db.collection('gallery_images').updateOne(
        { id: img.id },
        { $set: { extracted_width: width, extracted_height: height } }
      );

      // Also update pages.detected_images — but only if a real detection exists at this index
      const detIdx = img.detection_index ?? 0;
      const page = await db.collection('pages').findOne(
        { id: img.page_id },
        { projection: { [`detected_images.${detIdx}.description`]: 1 } }
      );
      if (page?.detected_images?.[detIdx]?.description) {
        await db.collection('pages').updateOne(
          { id: img.page_id },
          {
            $set: {
              [`detected_images.${detIdx}.extracted_width`]: width,
              [`detected_images.${detIdx}.extracted_height`]: height,
            }
          }
        );
      }

      return true;
    } catch (err) {
      // Don't log every failure, just count
      return false;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
