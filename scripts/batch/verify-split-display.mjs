#!/usr/bin/env node
/**
 * Integration test: verify split pages display as portrait images end-to-end.
 *
 * Checks the ACTUAL served images (not just DB fields) to catch:
 * - CDN cache serving old spread images
 * - Frontend priority chain serving wrong URL
 * - Missing sp prefix on R2 paths
 * - Stale photo_original/archived_photo/cropped_photo/thumbnail_blob
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/batch/verify-split-display.mjs                    # all split books
 *   node scripts/batch/verify-split-display.mjs --book-id=69c...   # one book
 *   node scripts/batch/verify-split-display.mjs --fix              # also fix issues found
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const args = process.argv.slice(2);
const BOOK_ID = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
const FIX = args.includes('--fix');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const query = BOOK_ID
  ? { id: BOOK_ID }
  : { split_completed: true };

const books = await db.collection('books').find(query, { projection: { id: 1, title: 1, slug: 1, pages_count: 1 } }).toArray();

console.log(`Verifying ${books.length} split book(s)...\n`);

let totalIssues = 0;

for (const book of books) {
  const pages = await db.collection('pages').find(
    { book_id: book.id },
    { projection: { id: 1, page_number: 1, photo: 1, thumbnail: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, thumbnail_blob: 1, split_from_spread: 1, split_side: 1, page_type: 1 } }
  ).sort({ page_number: 1 }).toArray();

  const issues = [];

  for (const page of pages) {
    const pageIssues = [];

    // Check 1: split_from_spread flag
    if (!page.split_from_spread) {
      pageIssues.push('NO_SPLIT_FLAG');
    }

    // Check 2: stale fields
    if (page.photo_original) pageIssues.push('STALE:photo_original');
    if (page.archived_photo) pageIssues.push('STALE:archived_photo');
    if (page.cropped_photo) pageIssues.push('STALE:cropped_photo');
    if (page.thumbnail_blob) pageIssues.push('STALE:thumbnail_blob');

    // Check 3: sp prefix
    if (page.photo && !page.photo.includes('/sp') && page.photo.includes('sourcelibrary.org/pages')) {
      pageIssues.push('NO_SP_PREFIX');
    }

    // Check 4: actual image dimensions (sample 3 pages per book)
    if (page.photo && (page.page_number <= 3 || page.page_number === Math.round(pages.length / 2))) {
      try {
        const resp = await fetch(page.photo, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const meta = await sharp(buf).metadata();
          const ar = (meta.width || 1) / (meta.height || 1);
          if (ar > 1.1 && page.page_type !== 'blank') {
            pageIssues.push(`LANDSCAPE(${meta.width}x${meta.height} AR=${ar.toFixed(2)})`);
          }
        } else {
          pageIssues.push(`HTTP_${resp.status}`);
        }
      } catch (e) {
        pageIssues.push('FETCH_FAIL');
      }
    }

    if (pageIssues.length > 0) {
      issues.push({ page: page.page_number, issues: pageIssues, pageId: page.id });
    }

    // Fix mode
    if (FIX && pageIssues.some(i => i.startsWith('STALE:'))) {
      await db.collection('pages').updateOne({ id: page.id }, {
        $unset: { photo_original: 1, archived_photo: 1, cropped_photo: 1, thumbnail_blob: 1 }
      });
    }
    if (FIX && !page.split_from_spread) {
      await db.collection('pages').updateOne({ id: page.id }, {
        $set: { split_from_spread: true }
      });
    }
  }

  const status = issues.length === 0 ? 'PASS' : `${issues.length} ISSUES`;
  const url = book.slug ? `https://sourcelibrary.org/book/${book.slug}` : book.id;
  console.log(`${status.padEnd(12)} ${book.title?.slice(0, 50).padEnd(50)} ${pages.length}pp  ${url}`);

  if (issues.length > 0) {
    for (const i of issues.slice(0, 5)) {
      console.log(`  p.${i.page}: ${i.issues.join(', ')}`);
    }
    if (issues.length > 5) console.log(`  ... and ${issues.length - 5} more`);
    totalIssues += issues.length;
  }
}

console.log(`\n${totalIssues === 0 ? 'ALL PASS' : totalIssues + ' total issues'}${FIX ? ' (fix mode applied)' : ''}`);
await client.close();
