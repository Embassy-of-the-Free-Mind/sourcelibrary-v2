#!/usr/bin/env node
/**
 * Reset books with partial OCR back to 'archiving' status.
 *
 * These books had incomplete image archiving (not all pages have R2 URLs)
 * but advanced through the pipeline anyway, getting OCR'd and translated
 * on only a fraction of their pages (typically the first 25).
 *
 * This script:
 * 1. Queries Supabase books_catalog for books with partial OCR (ocr_pct < 100)
 * 2. Verifies against MongoDB that pages lack archived_photo
 * 3. Resets pipeline_auto.status to 'archiving' so archiving workers pick them up
 * 4. Clears stale job locks
 *
 * Usage:
 *   DRY_RUN=true node scripts/migration/reset-partial-ocr-books.mjs   # preview
 *   node scripts/migration/reset-partial-ocr-books.mjs                 # execute
 *
 * Options:
 *   MIN_GAP=50       — only reset books missing at least this many pages of OCR (default: 10)
 *   MAX_OCR_PCT=95   — only reset books below this OCR percentage (default: 95)
 *   LIMIT=100        — process at most this many books (default: all)
 *   PROVIDER=bph     — only reset books from this provider (default: all)
 */

import { MongoClient } from 'mongodb';
import pkg from 'pg';
const { Client: PgClient } = pkg;

const DRY_RUN = process.env.DRY_RUN === 'true';
const MIN_GAP = parseInt(process.env.MIN_GAP || '10', 10);
const MAX_OCR_PCT = parseInt(process.env.MAX_OCR_PCT || '95', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;
const PROVIDER = process.env.PROVIDER || null;

console.log(`Reset partial-OCR books — DRY_RUN=${DRY_RUN} MIN_GAP=${MIN_GAP} MAX_OCR_PCT=${MAX_OCR_PCT} LIMIT=${LIMIT || 'all'} PROVIDER=${PROVIDER || 'all'}`);

const mongoClient = new MongoClient(process.env.MONGODB_URI);
const pgClient = new PgClient({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await mongoClient.connect();
  await pgClient.connect();
  const db = mongoClient.db('bookstore');

  // Step 1: Find partial-OCR books from Supabase (fast)
  let query = `
    SELECT id, title, pages_count, pages_ocr, ocr_pct, pipeline_status, image_source_provider
    FROM books_catalog
    WHERE pages_count > 0
      AND pages_ocr > 0
      AND ocr_pct < $1
      AND (pages_count - pages_ocr) >= $2
  `;
  const params = [MAX_OCR_PCT, MIN_GAP];

  if (PROVIDER) {
    query += ` AND image_source_provider = $${params.length + 1}`;
    params.push(PROVIDER);
  }

  query += ` ORDER BY (pages_count - pages_ocr) DESC`;

  if (LIMIT) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(LIMIT);
  }

  const { rows: candidates } = await pgClient.query(query, params);
  console.log(`Found ${candidates.length} candidates in Supabase\n`);

  // Step 2: For each book, verify in MongoDB and reset
  let rearchive = 0;
  let reocr = 0;
  let skipped = 0;
  let alreadyArchiving = 0;
  const statusCounts = {};

  for (const book of candidates) {
    const bookId = book.id; // This is the MongoDB id stored in Supabase
    const gap = book.pages_count - book.pages_ocr;
    const label = `${(book.title || '').substring(0, 50)} (${book.pages_ocr}/${book.pages_count}, ${book.ocr_pct}%)`;

    // Check current MongoDB state
    const mongoBook = await db.collection('books').findOne(
      { id: bookId },
      { projection: { 'pipeline_auto.status': 1, job: 1, pages_count: 1, pages_ocr: 1 } },
    );

    if (!mongoBook) {
      console.log(`  SKIP (not in MongoDB): ${label}`);
      skipped++;
      continue;
    }

    const status = mongoBook.pipeline_auto?.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (status === 'archiving') {
      alreadyArchiving++;
      continue;
    }

    // Verify: count pages missing R2 URLs
    const pagesWithoutR2 = await db.collection('pages').countDocuments({
      book_id: bookId,
      $and: [
        { $or: [
          { archived_photo: { $exists: false } },
          { archived_photo: null },
          { archived_photo: '' },
          { archived_photo: { $regex: /^failed:/ } },
        ]},
        { $or: [
          { cropped_photo: { $exists: false } },
          { cropped_photo: null },
          { cropped_photo: '' },
        ]},
      ],
    });

    if (pagesWithoutR2 < MIN_GAP) {
      // Pages have R2 URLs but OCR is incomplete — reset to archive_complete for re-OCR
      const targetStatus = 'archive_complete';
      console.log(`  RE-OCR [${status}] → ${targetStatus}: ${label}`);

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { id: bookId },
          {
            $set: {
              'pipeline_auto.status': targetStatus,
              'pipeline_auto.last_updated': new Date(),
              'pipeline_auto.error': null,
              'pipeline_auto.retry_count': 0,
              'pipeline_auto.split_checked': true,
            },
            $unset: {
              'pipeline_auto.ocr_job_name': '',
              'pipeline_auto.ocr_job_id': '',
              'pipeline_auto.translate_job_id': '',
              'pipeline_auto.preview_batch_at': '',
              'pipeline_auto.ocr_loop_count': '',
              job: '',
            },
          },
        );
      }
      reocr++;
      continue;
    }

    console.log(`  REARCHIVE [${status}] ${pagesWithoutR2} pages without R2: ${label}`);

    if (!DRY_RUN) {
      // Reset to archiving — images need to be fetched to R2 first
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            'pipeline_auto.status': 'archiving',
            'pipeline_auto.last_updated': new Date(),
            'pipeline_auto.error': null,
            'pipeline_auto.retry_count': 0,
          },
          $unset: {
            'pipeline_auto.ocr_job_name': '',
            'pipeline_auto.ocr_job_id': '',
            'pipeline_auto.translate_job_id': '',
            'pipeline_auto.preview_batch_at': '',
            'pipeline_auto.ocr_loop_count': '',
            job: '',
          },
        },
      );
    }
    rearchive++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Reset to archiving (need R2): ${rearchive}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Reset to archive_complete (need OCR): ${reocr}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Already archiving: ${alreadyArchiving}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`\nStatus distribution of candidates:`);
  for (const [s, c] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }
} finally {
  await mongoClient.close();
  await pgClient.end();
}
