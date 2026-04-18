#!/usr/bin/env node
/**
 * Backfill dhash for existing gallery_images.
 * Fetches thumbnails, computes dhash, writes to both gallery_images and pages.detected_images.
 *
 * Usage: node scripts/tmp-backfill-dhash.mjs [--limit N] [--dry-run] [--book-id ID]
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const MONGO_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1]) : 500;
const bookArg = process.argv.indexOf('--book-id');
const BOOK_ID = bookArg >= 0 ? process.argv[bookArg + 1] : null;
const BATCH = 20; // concurrent fetches

async function computeDHash(imageBuffer) {
  const pixels = await sharp(imageBuffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();

  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      if (left > right) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash.toString(16).padStart(16, '0');
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  const filter = { dhash: { $exists: false }, thumbnail_url: { $ne: null } };
  if (BOOK_ID) filter.book_id = BOOK_ID;

  const total = await db.collection('gallery_images').countDocuments(filter);
  console.log(`${total} gallery images need dhash. Processing up to ${LIMIT}.`);

  const cursor = db.collection('gallery_images')
    .find(filter)
    .project({ _id: 1, id: 1, page_id: 1, detection_index: 1, thumbnail_url: 1, extracted_url: 1 })
    .limit(LIMIT);

  let processed = 0, failed = 0;
  let batch = [];

  for await (const img of cursor) {
    batch.push(img);
    if (batch.length >= BATCH) {
      const results = await processBatch(db, batch);
      processed += results.ok;
      failed += results.fail;
      process.stdout.write(`\r  ${processed} hashed, ${failed} failed`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    const results = await processBatch(db, batch);
    processed += results.ok;
    failed += results.fail;
  }

  console.log(`\nDone: ${processed} hashed, ${failed} failed`);
  await client.close();
}

async function processBatch(db, images) {
  let ok = 0, fail = 0;

  await Promise.all(images.map(async (img) => {
    const url = img.thumbnail_url || img.extracted_url;
    if (!url) { fail++; return; }

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { fail++; return; }

      const buf = Buffer.from(await resp.arrayBuffer());
      const dhash = await computeDHash(buf);

      if (DRY_RUN) {
        ok++;
        return;
      }

      // Write to gallery_images
      await db.collection('gallery_images').updateOne(
        { _id: img._id },
        { $set: { dhash } }
      );

      // Write to pages.detected_images
      if (img.page_id && typeof img.detection_index === 'number') {
        await db.collection('pages').updateOne(
          { id: img.page_id },
          { $set: { [`detected_images.${img.detection_index}.dhash`]: dhash } }
        );
      }

      ok++;
    } catch {
      fail++;
    }
  }));

  return { ok, fail };
}

main().catch(err => { console.error(err); process.exit(1); });
