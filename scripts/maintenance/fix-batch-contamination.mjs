#!/usr/bin/env node
/**
 * Fix batch OCR cross-contamination from 2026-03-24.
 *
 * The batch-collector.mjs had a bug where it fell back to index-based
 * page matching when metadata.key was missing from Batch API responses.
 * This caused OCR text from other books (Middle Dutch, Chinese) to be
 * written to pages of 4 books in the medieval-heresies collection.
 *
 * This script:
 * 1. Identifies contaminated pages (OCR language doesn't match book language)
 * 2. Creates revisions of the contaminated data (safety net)
 * 3. Clears OCR and translation on contaminated pages
 * 4. Resets book-level page counts
 *
 * After running, the pipeline will re-OCR and re-translate these pages naturally.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-batch-contamination.mjs --dry-run
 *   node scripts/maintenance/fix-batch-contamination.mjs
 */

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const DRY_RUN = process.argv.includes('--dry-run');

// The 4 confirmed contaminated books (batch-OCR'd 2026-03-24)
const CONTAMINATED_SLUGS = [
  'histoire-et-doctrine-de-la-secte-des-cathares-ou-albigeois-schmidt',
  'the-key-of-truth-a-manual-of-the-paulician-church-of-armenia-conybeare',
  'histoire-des-albigeois-les-albigeois-et-l-inquisition-peyrat',
  'les-albigeois-leurs-origines-action-de-l-eglise-au-xiie-douais',
];

// Known contamination markers
const CONTAMINATION_PATTERNS = [
  // Middle Dutch (Reynard the Fox)
  /\b(vanden|waer|sijn|dese|gheen|reynaert|uwe)\b/i,
  // Chinese characters
  /[\u4e00-\u9fff]{3,}/,
];

function isContaminated(text, expectedLang) {
  if (!text || text.length < 20) return false;
  for (const pattern of CONTAMINATION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  for (const slug of CONTAMINATED_SLUGS) {
    const book = await db.collection('books').findOne({ slug });
    if (!book) {
      console.log(`SKIP: Book not found: ${slug}`);
      continue;
    }

    console.log(`\n--- ${book.title} (${book.id}) ---`);
    console.log(`  Language: ${book.language}, Pages: ${book.pages_count}`);

    // Get all pages with OCR data
    const pages = await db.collection('pages').find(
      { book_id: book.id, 'ocr.data': { $exists: true, $ne: null } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'translation.data': 1 } }
    ).toArray();

    const contaminated = [];
    const clean = [];

    for (const page of pages) {
      if (isContaminated(page.ocr?.data, book.language)) {
        contaminated.push(page);
      } else {
        clean.push(page);
      }
    }

    console.log(`  Total pages with OCR: ${pages.length}`);
    console.log(`  Contaminated: ${contaminated.length}`);
    console.log(`  Clean: ${clean.length}`);

    if (contaminated.length === 0) {
      console.log(`  No contamination detected, skipping`);
      continue;
    }

    // Sample contaminated content
    if (contaminated.length > 0) {
      const sample = contaminated[0];
      console.log(`  Sample contaminated page ${sample.page_number}: "${sample.ocr.data.substring(0, 80)}..."`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would clear ${contaminated.length} pages and create revisions`);
      continue;
    }

    // Create revisions before wiping
    const now = new Date();
    const revisionDocs = contaminated.map(page => ({
      id: crypto.randomUUID(),
      page_id: page.id,
      field: 'ocr',
      data: page.ocr.data,
      created_at: now,
      reason: 'batch-contamination-cleanup-2026-04-06',
    }));

    // Also save translation revisions
    const translationRevisions = contaminated
      .filter(p => p.translation?.data)
      .map(page => ({
        id: crypto.randomUUID(),
        page_id: page.id,
        field: 'translation',
        data: page.translation.data,
        created_at: now,
        reason: 'batch-contamination-cleanup-2026-04-06',
      }));

    if (revisionDocs.length > 0) {
      await db.collection('page_revisions').insertMany([...revisionDocs, ...translationRevisions]);
      console.log(`  Saved ${revisionDocs.length + translationRevisions.length} revisions`);
    }

    // Clear contaminated OCR and translation data
    const pageIds = contaminated.map(p => p.id);
    const result = await db.collection('pages').updateMany(
      { id: { $in: pageIds } },
      {
        $unset: {
          'ocr.data': '',
          'ocr.model': '',
          'ocr.updated_at': '',
          'ocr.prompt_version': '',
          'ocr.prompt_id': '',
          'ocr.prompt_hash': '',
          'translation.data': '',
          'translation.model': '',
          'translation.updated_at': '',
          'translation.prompt_version': '',
          'translation.prompt_id': '',
        },
        $set: { updated_at: new Date() }
      }
    );
    console.log(`  Cleared OCR+translation on ${result.modifiedCount} pages`);

    // Reset book-level counts
    const remainingOcr = clean.length;
    const remainingTranslated = clean.filter(p => p.translation?.data).length;
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { pages_ocr: remainingOcr, pages_translated: remainingTranslated, updated_at: new Date() } }
    );
    console.log(`  Updated book counts: ocr=${remainingOcr}, translated=${remainingTranslated}`);
  }

  // Summary
  console.log('\n=== DONE ===');
  if (!DRY_RUN) {
    console.log('Contaminated pages have been cleared. The pipeline will re-OCR and re-translate them.');
    console.log('Run smart-cover-selection.mjs next for missing thumbnails.');
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
