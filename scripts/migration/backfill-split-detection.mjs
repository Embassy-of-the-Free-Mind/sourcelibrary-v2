#!/usr/bin/env node
/**
 * Backfill split detection for archive_complete books.
 *
 * Downloads one sample image per book, checks aspect ratio.
 * - Portrait (ratio ≤ 1.2): marks split_checked=true, OCR can proceed
 * - Landscape (ratio > 1.2): marks split_checked=true with split_detection metadata,
 *   but does NOT actually split pages (deferred to orchestrator or manual)
 *
 * This unblocks OCR for ~22K books stuck behind the split detection gate.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-split-detection.mjs
 *   node scripts/migration/backfill-split-detection.mjs --limit 500 --concurrency 20 --dry-run
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 1000;
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 15;
const ASPECT_RATIO_THRESHOLD = 1.2;

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function checkOneBook(db, book) {
  const label = (book.title || '').substring(0, 60);

  // Get one sample page with an image
  const samplePage = await db.collection('pages')
    .findOne(
      { book_id: book.id, crop: { $exists: false } },
      { sort: { page_number: 1 }, projection: { id: 1, photo: 1, photo_original: 1, archived_photo: 1 } }
    );

  if (!samplePage) {
    // No uncropped pages — already split or single-page
    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
      );
    }
    return { status: 'no_pages', label };
  }

  const imageUrl = samplePage.archived_photo || samplePage.photo_original || samplePage.photo;
  if (!imageUrl) {
    // No image URL — can't check, mark as checked (OCR will skip anyway)
    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
      );
    }
    return { status: 'no_image', label };
  }

  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const meta = await sharp(buffer).metadata();

    if (!meta.width || !meta.height) throw new Error('No dimensions');
    const ratio = meta.width / meta.height;
    const isSpread = ratio > ASPECT_RATIO_THRESHOLD;

    if (!DRY_RUN) {
      const update = {
        'pipeline_auto.split_checked': true,
        'pipeline_auto.last_updated': new Date(),
      };
      if (isSpread) {
        // Mark as needing split but DON'T split yet
        update['pipeline_auto.needs_splitting'] = true;
        update['pipeline_auto.split_detection'] = {
          isTwoPageSpread: true,
          sampleRatio: parseFloat(ratio.toFixed(3)),
          samplePageId: samplePage.id,
          method: 'backfill-aspect-check',
          detected_at: new Date(),
        };
      }
      await db.collection('books').updateOne({ id: book.id }, { $set: update });
    }

    return { status: isSpread ? 'spread' : 'portrait', ratio: ratio.toFixed(2), label };
  } catch (err) {
    // Image download failed — mark as checked so it's not stuck forever
    // OCR will handle individual pages correctly
    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          'pipeline_auto.split_checked': true,
          'pipeline_auto.last_updated': new Date(),
          'pipeline_auto.split_detection': { error: err.message, detected_at: new Date() },
        } }
      );
    }
    return { status: 'error', error: err.message?.slice(0, 60), label };
  }
}

async function run() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find({
      'pipeline_auto.status': 'archive_complete',
      'pipeline_auto.split_checked': { $ne: true },
    })
    .sort({ hidden: 1 })
    .project({ id: 1, title: 1, pages_count: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`[split-detection] ${books.length} books to check | Concurrency: ${CONCURRENCY} | Dry run: ${DRY_RUN}`);

  let portrait = 0, spread = 0, noPages = 0, noImage = 0, errors = 0;
  const startTime = Date.now();

  await parallelMap(books, async (book, i) => {
    const result = await checkOneBook(db, book);
    if (result.status === 'portrait') portrait++;
    else if (result.status === 'spread') { spread++; console.log(`  SPREAD: ${result.label} (ratio ${result.ratio})`); }
    else if (result.status === 'no_pages') noPages++;
    else if (result.status === 'no_image') noImage++;
    else if (result.status === 'error') { errors++; }

    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  Progress: ${i + 1}/${books.length} (${elapsed}s) — portrait: ${portrait}, spread: ${spread}, errors: ${errors}`);
    }
  }, CONCURRENCY);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n[split-detection] Done in ${elapsed}s`);
  console.log(`  Portrait (OCR unblocked): ${portrait}`);
  console.log(`  Spread (needs splitting): ${spread}`);
  console.log(`  No pages: ${noPages}`);
  console.log(`  No image: ${noImage}`);
  console.log(`  Errors: ${errors}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
