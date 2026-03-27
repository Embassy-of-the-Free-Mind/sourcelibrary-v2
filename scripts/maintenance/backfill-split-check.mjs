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
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const ASPECT_RATIO_THRESHOLD = 1.2;

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

  const books = await db.collection('books').find({
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

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
