#!/usr/bin/env node
/**
 * Backfill book covers using detected_images quality scores.
 *
 * For each non-manual book, finds the page (within first 30) with the
 * highest-quality detected image and uses it as the cover. Falls back
 * to a title-page type if no good images exist.
 *
 * Dry run by default — pass --apply to commit changes.
 */
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI;
const DRY_RUN = !process.argv.includes('--apply');

const EX_LIBRIS_RE = /ex[\s\-.]?libris|bookplate|ownership\s+(mark|stamp|inscription)|library\s+stamp|philosophia\s+hermetica/i;

function isExLibrisPage(ocrData) {
  if (!ocrData) return false;
  const first500 = ocrData.slice(0, 500).toLowerCase();
  return EX_LIBRIS_RE.test(first500);
}

function isExLibrisImage(img) {
  if (!img) return false;
  const desc = (img.museum_description || '') + ' ' + (img.description || '');
  if (EX_LIBRIS_RE.test(desc)) return true;
  const subjects = img.metadata?.subjects || [];
  return subjects.some(s => EX_LIBRIS_RE.test(s));
}

function computeCoverScore(img, pageNumber) {
  const quality = img.gallery_quality || 0;
  let score = quality * 0.4;

  const type = img.type || '';
  const typeBonus = {
    frontispiece: 0.20, emblem: 0.15, portrait: 0.12,
    engraving: 0.10, woodcut: 0.10, map: 0.05,
    diagram: -0.05, decorative: -0.10, symbol: -0.05,
  };
  score += typeBonus[type] || 0;

  if (pageNumber <= 5) score += 0.30;
  else if (pageNumber <= 10) score += 0.25;
  else if (pageNumber <= 20) score += 0.20;
  else if (pageNumber <= 40) score += 0.12;
  else if (pageNumber <= 80) score += 0.05;

  const metadata = img.metadata;
  if (metadata?.figures?.length) score += 0.05;
  if (metadata?.symbols?.length) score += 0.03;

  return Math.max(0, Math.min(1, score));
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING CHANGES ===');

  // Find all non-manual books
  const books = await db.collection('books').find(
    { thumbnail_source: { $ne: 'manual' }, hidden: { $ne: true } },
    { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 } }
  ).toArray();

  console.log(`Found ${books.length} non-manual visible books`);

  let upgraded = 0;
  let alreadyGood = 0;
  let noCandidates = 0;

  for (const book of books) {
    // Get pages with detected images in first 30 pages
    const pagesWithImages = await db.collection('pages').find(
      { book_id: book.id, 'detected_images.0': { $exists: true }, page_number: { $lte: 30 } },
      { projection: { page_number: 1, detected_images: 1, cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 } }
    ).toArray();

    let bestScore = 0;
    let bestPage = null;

    for (const page of pagesWithImages) {
      // Skip ex-libris check without OCR data — rely on image-level detection
      for (const img of (page.detected_images || [])) {
        if (!img || isExLibrisImage(img)) continue;
        const score = computeCoverScore(img, page.page_number);
        if (score > bestScore) {
          bestScore = score;
          bestPage = page;
        }
      }
    }

    // Fallback: title-page type
    if (!bestPage || bestScore < 0.4) {
      const titlePage = await db.collection('pages').findOne(
        { book_id: book.id, page_type: 'title-page', page_number: { $lte: 30 } },
        { projection: { page_number: 1, cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 } }
      );
      if (titlePage) {
        bestPage = titlePage;
        bestScore = 0.75;
      }
    }

    if (!bestPage || bestScore < 0.4) {
      noCandidates++;
      continue;
    }

    const newUrl = bestPage.cropped_photo || bestPage.archived_photo || bestPage.photo || bestPage.photo_original;
    if (!newUrl) { noCandidates++; continue; }

    // Skip if already using this URL
    if (newUrl === book.thumbnail) {
      alreadyGood++;
      continue;
    }

    upgraded++;
    const shortTitle = (book.title || '').slice(0, 50);
    console.log(`  ${shortTitle} — page ${bestPage.page_number} (score: ${bestScore.toFixed(2)}) ${book.thumbnail_source || 'import'} → auto`);

    if (!DRY_RUN) {
      const update = { thumbnail: newUrl, thumbnail_source: 'auto' };
      if (bestPage.thumbnail_blob) update.thumbnail_blob = bestPage.thumbnail_blob;
      await db.collection('books').updateOne({ id: book.id }, { $set: update });
    }
  }

  console.log(`\nResults:`);
  console.log(`  Upgraded: ${upgraded}`);
  console.log(`  Already good: ${alreadyGood}`);
  console.log(`  No candidates: ${noCandidates}`);
  console.log(`  Total: ${books.length}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
