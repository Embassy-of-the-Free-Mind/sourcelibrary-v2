#!/usr/bin/env node
/**
 * Backfill split_checked flag for books that already passed through the pipeline
 * without split detection.
 *
 * For books past archive_complete that never had split_checked set:
 * - If pages already have crop data → mark split_checked (already split)
 * - If no spreads detected (portrait aspect ratio) → mark split_checked
 * - If spreads detected → flag for re-processing
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-split-check.mjs
 *   node scripts/maintenance/backfill-split-check.mjs --dry-run
 *
 * --campaign=ID (#8049): the books an acquisition campaign imported (`acquisition_campaign: ID`), whatever their
 * status (they are held, not past archive_complete), not yet checked. They have no OCR, so a spread is flagged
 * `needs_splitting: true` (the flag the OCR lanes wait on and the splitter takes), not `needs_resplit` (which means
 * "OCR'd on unsplit pages"). The ratio is the MEDIAN of three interior pages (25/50/75%), not the first page: a first
 * frame is often a cover, a colour card or a fold-out. The image is the page's served source (R2 archive first).
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const ASPECT_RATIO_THRESHOLD = 1.2;
const CAMPAIGN = process.argv.find(a => a.startsWith('--campaign='))?.split('=')[1] || null;

async function main() {
  console.log(`Backfill split_checked (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Find books past archive_complete that were never split-checked
  const pastArchive = [
    'ocr_submitted', 'ocr_complete', 'metadata_enriched',
    'ft_verifying', 'ft_verified', 'translate_submitted', 'translate_complete',
    'enriching', 'enriched', 'chapters', 'chapters_complete',
    'images_submitted', 'images_complete', 'complete'
  ];

  const books = await db.collection('books').find(CAMPAIGN ? {
    acquisition_campaign: CAMPAIGN, pages_count: { $gt: 0 },
    'pipeline_auto.split_checked': { $ne: true }, needs_splitting: { $ne: true },
  } : {
    'pipeline_auto.status': { $in: pastArchive },
    'pipeline_auto.split_checked': { $ne: true },
  }).project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.status': 1 }).toArray();

  console.log(`Found ${books.length} books past archive_complete without split_checked`);

  // Also find archive_complete books without the flag (these are gated now)
  const gated = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'archive_complete',
    'pipeline_auto.split_checked': { $ne: true },
  });
  console.log(`Additionally ${gated} books at archive_complete waiting for Phase 1.25`);

  let alreadySplit = 0;
  let portrait = 0;
  let spreadDetected = 0;
  let errors = 0;

  const toProcess = books.slice(0, LIMIT);
  for (const book of toProcess) {
    try {
      const label = `${book.title?.substring(0, 50)} [${book.pipeline_auto?.status}]`;

      // Check if pages already have crop data (already split)
      const croppedCount = await db.collection('pages').countDocuments({
        book_id: book.id,
        crop: { $exists: true },
      });

      if (croppedCount > 0) {
        // Already has split pages — just mark the flag
        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
          );
        }
        alreadySplit++;
        continue;
      }

      if (CAMPAIGN) {
        const ratio = await medianInteriorRatio(db, book);
        if (ratio == null) { console.log(`  ${label}: no interior image fetched`); errors++; continue; }
        const spread = ratio > ASPECT_RATIO_THRESHOLD;
        if (spread) { console.log(`  SPREAD: ${label} (median ratio ${ratio.toFixed(2)}, ${book.pages_count} pages) — needs_splitting`); spreadDetected++; }
        else portrait++;
        if (!DRY_RUN) await db.collection('books').updateOne({ id: book.id },
          { $set: spread ? { needs_splitting: true, 'pipeline_auto.last_updated': new Date() } : { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } });
        continue;
      }

      // Sample a page to check aspect ratio
      const samplePage = await db.collection('pages').findOne(
        { book_id: book.id },
        { projection: { photo: 1, archived_photo: 1, photo_original: 1 }, sort: { page_number: 1 } }
      );

      if (!samplePage) {
        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
          );
        }
        portrait++;
        continue;
      }

      const imageUrl = samplePage.archived_photo || samplePage.photo_original || samplePage.photo;
      if (!imageUrl) {
        portrait++;
        continue;
      }

      // Download and check aspect ratio
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.log(`  ${label}: failed to fetch image (${res.status})`);
        errors++;
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buffer).metadata();
      const ratio = (meta.width || 1) / (meta.height || 1);

      if (ratio <= ASPECT_RATIO_THRESHOLD) {
        // Portrait — not a spread, safe to mark
        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
          );
        }
        portrait++;
      } else {
        // Spread detected! This book was OCR'd on unsplit pages.
        // Need to: split pages, clear stale OCR, re-queue
        console.log(`  SPREAD: ${label} (ratio ${ratio.toFixed(2)}, ${book.pages_count} pages) — needs re-processing`);
        spreadDetected++;

        if (!DRY_RUN) {
          // Tag for manual review or auto-split re-processing
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: {
              'pipeline_auto.needs_resplit': true,
              'pipeline_auto.last_updated': new Date(),
            }}
          );
        }
      }
    } catch (err) {
      console.log(`  ERROR ${book.title?.substring(0, 40)}: ${err.message?.substring(0, 80)}`);
      errors++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Already split (marked ok): ${alreadySplit}`);
  console.log(`  Portrait pages (marked ok): ${portrait}`);
  console.log(`  SPREAD detected (needs re-processing): ${spreadDetected}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total processed: ${alreadySplit + portrait + spreadDetected + errors}`);

  if (spreadDetected > 0) {
    console.log(`\nBooks with needs_resplit=true need manual attention or auto-split + OCR re-run.`);
    console.log(`Query: db.books.find({'pipeline_auto.needs_resplit': true})`);
  }

  await client.close();
}

/** The median width/height of the pages at 25%, 50% and 75% of the book (served image), or null if none fetched. */
async function medianInteriorRatio(db, book) {
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  const pages = await db.collection('pages').find({ book_id: book.id }, { projection: { _id: 0, id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).sort({ page_number: 1 }).toArray();
  const ratios = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const p = pages[Math.floor(f * (pages.length - 1))], url = p && getPageSource(p);
    if (!url) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      if (meta.width && meta.height) ratios.push(meta.width / meta.height);
    } catch { /* one page missing is not a verdict */ }
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
