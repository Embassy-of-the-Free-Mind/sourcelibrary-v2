/**
 * Cleanup malformed detected_images entries
 *
 * Problem: backfill-gallery-dimensions.mjs writes extracted_width/extracted_height
 * to pages.detected_images[idx] by index. When the page has no detected_images array
 * (or fewer entries than the target index), MongoDB creates sparse arrays padded with
 * null, and skeleton objects with only {extracted_width, extracted_height}.
 *
 * This script:
 * 1. Finds pages with null or skeleton entries in detected_images
 * 2. Removes those entries (keeps only entries with a description)
 * 3. Dry-run by default — pass --apply to actually write
 *
 * Usage:
 *   node scripts/cleanup-malformed-detections.mjs                    # dry run, all books
 *   node scripts/cleanup-malformed-detections.mjs --book <book_id>   # dry run, one book
 *   node scripts/cleanup-malformed-detections.mjs --apply            # write changes
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const bookIdx = args.indexOf('--book');
const bookFilter = bookIdx >= 0 ? args[bookIdx + 1] : null;

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  const query = { 'detected_images.0': { $exists: true } };
  if (bookFilter) query.book_id = bookFilter;

  const pages = await db.collection('pages').find(query, {
    projection: { id: 1, book_id: 1, page_number: 1, detected_images: 1 }
  }).toArray();

  let pagesScanned = 0, pagesFixed = 0, entriesRemoved = 0;
  const affectedBooks = new Set();

  for (const page of pages) {
    pagesScanned++;
    const imgs = page.detected_images || [];
    const clean = [];
    let hadBad = false;

    for (const d of imgs) {
      if (d === null) {
        hadBad = true;
        entriesRemoved++;
      } else if (!d.description && !d.bbox && !d.detection_source) {
        // Skeleton: only has extracted_width/extracted_height or similar partial data
        hadBad = true;
        entriesRemoved++;
      } else {
        clean.push(d);
      }
    }

    if (hadBad) {
      pagesFixed++;
      affectedBooks.add(page.book_id);
      console.log(`  pg ${page.page_number} (${page.book_id}): ${imgs.length} → ${clean.length} entries`);

      if (apply) {
        if (clean.length === 0) {
          await db.collection('pages').updateOne(
            { id: page.id },
            { $unset: { detected_images: '' } }
          );
        } else {
          await db.collection('pages').updateOne(
            { id: page.id },
            { $set: { detected_images: clean } }
          );
        }
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Pages scanned: ${pagesScanned}`);
  console.log(`  Pages with malformed entries: ${pagesFixed}`);
  console.log(`  Entries removed: ${entriesRemoved}`);
  console.log(`  Books affected: ${affectedBooks.size}`);
  if (!apply) console.log(`\n  DRY RUN — pass --apply to write changes`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
