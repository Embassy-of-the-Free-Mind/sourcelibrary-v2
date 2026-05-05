/**
 * Backfill cover selection for complete books missing cover_page.
 * Runs the same scoring logic as Phase 8.9 in the pipeline orchestrator.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-cover-selection.mjs
 *   node scripts/maintenance/backfill-cover-selection.mjs --dry-run
 *   node scripts/maintenance/backfill-cover-selection.mjs --limit 100
 */

import { MongoClient } from 'mongodb';
import { scorePageForCover } from '../lib/cover-scoring.mjs';
import { buildCoverUpdate } from '../lib/cover-write.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 120000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Backfill Cover Selection ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Find complete books without cover_page
const filter = { 'pipeline_auto.status': 'complete', cover_page: { $exists: false } };
const books = await db.collection('books')
  .find(filter, { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 } })
  .limit(LIMIT || 0)
  .maxTimeMS(60000)
  .toArray();

console.log(`Found ${books.length} complete books without cover_page\n`);

let updated = 0, skipped = 0, failed = 0;

for (let i = 0; i < books.length; i++) {
  const book = books[i];

  try {
    // Load first 20 pages with cover-relevant fields
    const pages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $lte: 20 } },
      { projection: {
        page_number: 1, page_type: 1, hidden: 1,
        cropped_photo: 1, archived_photo: 1, photo: 1, enhanced_photo: 1,
        photo_original: 1, split_from_spread: 1, crop: 1,
        image_thumb: 1, thumbnail_blob: 1,
        'ocr.data': 1,
      }}
    ).sort({ page_number: 1 }).maxTimeMS(10000).toArray();

    if (!pages.length) { skipped++; continue; }

    // Score each page using the shared scorer (same logic as pipeline + smart-cover-selection)
    const scored = pages.map(p => ({ page: p, ...scorePageForCover(p, { bookTitle: book.title }) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < 30) { skipped++; continue; }

    const update = buildCoverUpdate(best.page, {
      source: 'smart_ocr',
      actor: 'script',
      method: 'backfill-cover-selection',
      confidence: Math.min(best.score / 100, 1),
      detail: `${best.reason} (score: ${best.score})`,
    });
    if (!update) { skipped++; continue; }

    if (!DRY_RUN) {
      // If the book already has an R2-hosted thumbnail and the new one would
      // come from a different host, leave the URL fields alone but still
      // record cover_page + provenance.
      if (book.thumbnail?.startsWith('https://images.sourcelibrary.org')
          && !update.image_display.startsWith('https://images.sourcelibrary.org')) {
        const partial = {
          cover_page: update.cover_page,
          cover_selected_at: update.cover_selected_at,
          field_provenance: update.field_provenance,
          updated_at: new Date(),
        };
        await db.collection('books').updateOne({ id: book.id }, { $set: partial });
      } else {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { ...update, updated_at: new Date() } },
        );
      }
    }

    updated++;
  } catch (err) {
    failed++;
    if (failed <= 5) console.log(`  [ERR] ${book.title?.slice(0, 40)}: ${err.message?.slice(0, 60)}`);
  }

  if ((i + 1) % 100 === 0) {
    console.log(`  ${i + 1}/${books.length}: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  }
}

console.log(`\n=== Results ===`);
console.log(`Total: ${books.length}`);
console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
console.log(`Skipped (no good cover): ${skipped}`);
console.log(`Failed: ${failed}`);

await client.close();
