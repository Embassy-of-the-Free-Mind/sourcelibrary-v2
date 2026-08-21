#!/usr/bin/env node
/**
 * Backfill book_events + reocr_candidate for books upgraded by
 * rearchive-iiif-fullres.mjs BEFORE it learned to write them itself
 * (the #3186 sweep lanes launched on the earlier script version).
 *
 * Idempotent: skips books that already have an image_resolution_upgrade
 * event. Safe to re-run any time — run it once at the end of each sweep
 * phase to catch stragglers.
 *
 * The OCR-input-width fact this preserves: OCR always predates the
 * upgrade, so existing OCR was read from images at the OLD import cap,
 * recovered here from the page's original IIIF URL (photo_original).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-resolution-upgrade-events.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getIiifSizeCap, isIiifUrl } from '../lib/iiif-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.production.local') });

const DRY_RUN = process.argv.includes('--dry-run');

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const books = await db.collection('books').find(
  { image_resolution_upgraded_at: { $exists: true } },
  { projection: { id: 1, title: 1, pages_ocr: 1, image_resolution_upgraded_at: 1, image_resolution_upgrade_source: 1, 'image_source.provider': 1, reocr_candidate: 1 } },
).toArray();

console.log(`${books.length} upgraded books found${DRY_RUN ? ' (DRY RUN)' : ''}`);
let created = 0, existing = 0, noCap = 0;

for (const b of books) {
  const already = await db.collection('book_events').findOne(
    { book_id: b.id, type: 'image_resolution_upgrade' },
    { projection: { _id: 1 } },
  );
  if (already) { existing++; continue; }

  // Recover the pre-upgrade import cap from the original IIIF URL.
  const page = await db.collection('pages').findOne(
    { book_id: b.id, photo_original: { $regex: '/full/' } },
    { projection: { photo_original: 1 } },
  );
  const srcUrl = page?.photo_original;
  const cap = srcUrl && isIiifUrl(srcUrl) ? getIiifSizeCap(srcUrl) : null;
  if (!cap) { noCap++; console.log(`  no derivable cap: ${b.id} ${(b.title || '').slice(0, 50)}`); continue; }

  const toWidth = b.image_resolution_upgrade_source ?? null;
  const pagesUpdated = await db.collection('pages').countDocuments(
    { book_id: b.id, 'image_metadata.upgraded_at': { $exists: true } },
  );
  const ocrPage = await db.collection('pages').findOne(
    { book_id: b.id, 'ocr.updated_at': { $exists: true } },
    { projection: { 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1 } },
  );
  const hasOcr = (b.pages_ocr ?? 0) > 0;

  if (DRY_RUN) {
    console.log(`  would create: ${b.id} ${cap}→${toWidth}px ocr=${b.pages_ocr ?? 0} ${(b.title || '').slice(0, 45)}`);
    created++;
    continue;
  }

  await db.collection('book_events').insertOne({
    book_id: b.id,
    type: 'image_resolution_upgrade',
    at: b.image_resolution_upgraded_at,
    source: 'rearchive-iiif-fullres',
    backfilled_at: new Date(),
    details: {
      from_width_cap: cap,
      to_master_width: toWidth,
      pages_updated: pagesUpdated,
      provider: b.image_source?.provider ?? null,
      ocr_pages: b.pages_ocr ?? 0,
      ocr_input_width: hasOcr ? cap : null,
      ocr_model: ocrPage?.ocr?.model ?? null,
      ocr_prompt_version: ocrPage?.ocr?.prompt_version ?? null,
      ocr_updated_at: ocrPage?.ocr?.updated_at ?? null,
    },
  });
  if (hasOcr && !b.reocr_candidate) {
    await db.collection('books').updateOne(
      { id: b.id },
      { $set: {
        reocr_candidate: {
          reason: 'resolution_upgrade',
          flagged_at: b.image_resolution_upgraded_at,
          ocr_input_width: cap,
          new_width: toWidth,
          upgrade_ratio: toWidth ? Math.round((toWidth / cap) * 10) / 10 : null,
        },
      } },
    );
  }
  created++;
}

console.log(`\nDone. events created: ${created}, already existed: ${existing}, no derivable cap: ${noCap}`);
await mongo.close();
