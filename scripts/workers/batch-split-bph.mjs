#!/usr/bin/env node
/**
 * Batch split detection + cropping for BPH imported books.
 *
 * For each book with needs_splitting=true at archive_complete:
 * 1. Check each page's aspect ratio
 * 2. If spread (w/h > 1.2): crop left/right halves, upload to R2, create right-half page
 * 3. Renumber all pages sequentially
 * 4. Update book counts + advance pipeline
 *
 * Uses simple center-split heuristic (good enough for BPH scans which are
 * consistently centered spreads). No Gemini API calls needed.
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/batch-split-bph.mjs --limit 10
 *   node scripts/workers/batch-split-bph.mjs --dry-run
 *   node scripts/workers/batch-split-bph.mjs --book-id 69c62f1789e1344e8dd54250
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { parseArgs } from 'util';

// --- Config ---
const ASPECT_RATIO_THRESHOLD = 1.2; // w/h > 1.2 = spread
const OVERLAP_PX = 10; // pixels of overlap at split point (0-1000 scale)
const CROPPED_MAX_WIDTH = 2000; // max width for cropped halves
const CROPPED_QUALITY = 90;
const DISPLAY_WIDTH = 1200;
const DISPLAY_QUALITY = 85;
const THUMB_WIDTH = 150;
const THUMB_QUALITY = 60;
const PAGE_CONCURRENCY = 5; // pages processed in parallel per book

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

// --- Parse args ---
const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'limit': { type: 'string' },
    'book-id': { type: 'string' },
    'concurrency': { type: 'string' },
  },
});

const DRY_RUN = args['dry-run'];
const LIMIT = args['limit'] ? parseInt(args['limit']) : 50;
const BOOK_ID = args['book-id'];
const PARALLEL = args['concurrency'] ? parseInt(args['concurrency']) : PAGE_CONCURRENCY;

// --- R2 client ---
function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function uploadToR2(r2, key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// --- Path helpers (mirrors src/lib/storage.ts) ---
function pagePaths(bookId, pageNumber) {
  const num = 'sp' + String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return {
    full: `${base}-full.jpg`,
    display: `${base}.jpg`,
    thumb: `${base}-thumb.jpg`,
  };
}

// --- Fetch image from R2 ---
async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- Concurrency limiter ---
async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// --- Process one book ---
async function processBook(r2, db, book) {
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');

  // Get all pages sorted by page_number
  const pages = await pagesCol.find({ book_id: book.id })
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    console.log(`  No pages, skipping`);
    return { skipped: true };
  }

  // Check first non-cover page for aspect ratio
  const samplePage = pages.length > 2 ? pages[2] : pages[0];
  const sampleBuf = await fetchImage(samplePage.photo);
  const meta = await sharp(sampleBuf).metadata();
  const ratio = (meta.width || 1) / (meta.height || 1);

  if (ratio <= ASPECT_RATIO_THRESHOLD) {
    console.log(`  Portrait (ratio ${ratio.toFixed(2)}) — not a spread, marking split_checked`);
    if (!DRY_RUN) {
      await booksCol.updateOne({ id: book.id }, {
        $set: {
          needs_splitting: false,
          'pipeline_auto.split_checked': true,
          'pipeline_auto.last_updated': new Date(),
        },
      });
    }
    return { portrait: true };
  }

  console.log(`  Spread detected (ratio ${ratio.toFixed(2)}), processing ${pages.length} pages...`);

  if (DRY_RUN) {
    // Count how many pages are actually spreads
    let spreads = 0;
    for (const page of pages.slice(0, 5)) {
      const buf = await fetchImage(page.photo);
      const m = await sharp(buf).metadata();
      const r = (m.width || 1) / (m.height || 1);
      if (r > ASPECT_RATIO_THRESHOLD) spreads++;
    }
    console.log(`  DRY RUN: ${spreads}/5 sampled pages are spreads`);
    return { dryRun: true, spreads };
  }

  // Process each page
  const newPages = []; // right-half pages to insert
  const updateOps = []; // updates to existing pages
  let splitCount = 0;
  let singleCount = 0;
  let errors = 0;

  await parallelMap(pages, async (page) => {
    try {
      const buf = await fetchImage(page.photo);
      const pageMeta = await sharp(buf).metadata();
      const pageRatio = (pageMeta.width || 1) / (pageMeta.height || 1);

      if (pageRatio <= ASPECT_RATIO_THRESHOLD) {
        // Single page — no split needed, but mark as checked
        updateOps.push({
          updateOne: {
            filter: { id: page.id },
            update: {
              $set: {
                split_from_spread: true,
                split_side: 'single',
                updated_at: new Date(),
              },
            },
          },
        });
        singleCount++;
        return;
      }

      // It's a spread — split at center
      const imgWidth = pageMeta.width || 1000;
      const imgHeight = pageMeta.height || 1000;
      const splitX = Math.round(imgWidth / 2);

      // Crop left half
      const leftBuf = await sharp(buf)
        .extract({ left: 0, top: 0, width: splitX + Math.round(OVERLAP_PX * imgWidth / 1000), height: imgHeight })
        .resize(CROPPED_MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: CROPPED_QUALITY, progressive: true })
        .toBuffer();

      // Crop right half
      const rightBuf = await sharp(buf)
        .extract({ left: Math.max(0, splitX - Math.round(OVERLAP_PX * imgWidth / 1000)), top: 0, width: imgWidth - splitX + Math.round(OVERLAP_PX * imgWidth / 1000), height: imgHeight })
        .resize(CROPPED_MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: CROPPED_QUALITY, progressive: true })
        .toBuffer();

      // Generate display + thumb for both halves
      const [leftDisplay, leftThumb, rightDisplay, rightThumb] = await Promise.all([
        sharp(leftBuf).resize(DISPLAY_WIDTH).jpeg({ quality: DISPLAY_QUALITY }).toBuffer(),
        sharp(leftBuf).resize(THUMB_WIDTH).jpeg({ quality: THUMB_QUALITY }).toBuffer(),
        sharp(rightBuf).resize(DISPLAY_WIDTH).jpeg({ quality: DISPLAY_QUALITY }).toBuffer(),
        sharp(rightBuf).resize(THUMB_WIDTH).jpeg({ quality: THUMB_QUALITY }).toBuffer(),
      ]);

      // We'll assign final page numbers after all pages are processed.
      // For now, store the cropped buffers with temporary keys.
      // Use page_number + 0.5 for right half (renumbered later).
      const leftPageNum = page.page_number;
      const rightPageNum = page.page_number + 0.5;

      const leftPaths = pagePaths(book.id, leftPageNum);
      const rightPageId = new ObjectId().toHexString();
      // Use a temp path for right half — will be moved during renumber
      const rightTempKey = `pages/${book.id}/split-${rightPageId}`;

      // Upload left half (overwrite existing full-res with cropped)
      const [leftFullUrl, , leftThumbUrl] = await Promise.all([
        uploadToR2(r2, leftPaths.full, leftBuf),
        uploadToR2(r2, leftPaths.display, leftDisplay),
        uploadToR2(r2, leftPaths.thumb, leftThumb),
      ]);

      // Upload right half
      const [rightFullUrl, , rightThumbUrl] = await Promise.all([
        uploadToR2(r2, `${rightTempKey}-full.jpg`, rightBuf),
        uploadToR2(r2, `${rightTempKey}.jpg`, rightDisplay),
        uploadToR2(r2, `${rightTempKey}-thumb.jpg`, rightThumb),
      ]);

      const splitPosition = Math.round((splitX / imgWidth) * 1000);
      const leftCrop = { xStart: 0, xEnd: splitPosition + OVERLAP_PX };
      const rightCrop = { xStart: splitPosition - OVERLAP_PX, xEnd: 1000 };

      // Update existing page (becomes left half)
      updateOps.push({
        updateOne: {
          filter: { id: page.id },
          update: {
            $set: {
              photo: leftFullUrl,
              thumbnail: leftThumbUrl,
              crop: leftCrop,
              split_from_spread: true,
              split_side: 'left',
              split_detection: {
                isTwoPageSpread: true,
                confidence: 'high',
                splitPosition,
                method: 'aspect-ratio-center',
                detected_at: new Date(),
              },
              updated_at: new Date(),
            },
            $unset: { ocr: '', translation: '', summary: '', photo_original: '', archived_photo: '', cropped_photo: '', thumbnail_blob: '' },
          },
        },
      });

      // Create right-half page
      newPages.push({
        _id: new ObjectId(rightPageId),
        id: rightPageId,
        tenant_id: 'default',
        book_id: book.id,
        page_number: rightPageNum, // 0.5 — renumbered later
        photo: rightFullUrl,
        thumbnail: rightThumbUrl,
        crop: rightCrop,
        split_from: page.id,
        split_from_spread: true,
        split_side: 'right',
        split_detection: {
          isTwoPageSpread: true,
          confidence: 'high',
          splitPosition,
          method: 'aspect-ratio-center',
          detected_at: new Date(),
        },
        created_at: new Date(),
        updated_at: new Date(),
      });

      splitCount++;
    } catch (err) {
      console.error(`    FAIL page ${page.page_number}: ${err.message}`);
      errors++;
    }
  }, PARALLEL);

  // Apply all updates
  if (updateOps.length > 0) {
    await pagesCol.bulkWrite(updateOps);
  }
  if (newPages.length > 0) {
    await pagesCol.insertMany(newPages);
  }

  // Renumber all pages sequentially
  const allPages = await pagesCol.find({ book_id: book.id })
    .sort({ page_number: 1, _id: 1 }) // 0.5 pages sort between originals
    .toArray();

  const renumberOps = allPages.map((p, i) => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { page_number: i + 1 } },
    },
  }));
  if (renumberOps.length > 0) {
    await pagesCol.bulkWrite(renumberOps);
  }

  // Update book
  const ocrCount = await pagesCol.countDocuments({
    book_id: book.id,
    'ocr.data': { $exists: true, $ne: '' },
  });
  const translateCount = await pagesCol.countDocuments({
    book_id: book.id,
    'translation.data': { $exists: true, $ne: '' },
  });

  // Set thumbnail to first page
  const firstPage = allPages[0];

  await booksCol.updateOne({ id: book.id }, {
    $set: {
      pages_count: allPages.length,
      pages_ocr: ocrCount,
      pages_translated: translateCount,
      needs_splitting: false,
      thumbnail: firstPage?.photo || firstPage?.cropped_photo,
      'pipeline_auto.split_checked': true,
      'pipeline_auto.last_updated': new Date(),
      updated_at: new Date(),
    },
  });

  console.log(`  Done: ${splitCount} spreads split, ${singleCount} single pages, ${errors} errors → ${allPages.length} total pages`);
  return { splitCount, singleCount, errors, totalPages: allPages.length };
}

// --- Main ---
async function main() {
  console.log('BPH Batch Split Detection');
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT}, Concurrency: ${PARALLEL} pages/book`);

  const r2 = getR2Client();
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  // Find books to process
  let query;
  if (BOOK_ID) {
    query = { id: BOOK_ID };
  } else {
    query = {
      needs_splitting: true,
      'pipeline_auto.status': 'archive_complete',
      'pipeline_auto.split_checked': { $ne: true },
    };
  }

  const books = await db.collection('books')
    .find(query)
    .project({ id: 1, title: 1, pages_count: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} books to process\n`);

  let processed = 0, portraits = 0, splits = 0, failed = 0;
  const startTime = Date.now();

  for (const book of books) {
    console.log(`[${processed + 1}/${books.length}] ${book.title?.substring(0, 60)} (${book.pages_count} pages)`);

    try {
      const result = await processBook(r2, db, book);
      if (result.portrait) portraits++;
      else if (result.skipped) { /* skip */ }
      else if (result.dryRun) { /* dry run */ }
      else {
        splits++;
        processed++;
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDone in ${elapsed} min. Split: ${splits}, Portrait: ${portraits}, Failed: ${failed}`);
  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
