#!/usr/bin/env node
/**
 * Batch split detection + cropping for BPH imported books.
 *
 * For each book with needs_splitting=true at archive_complete (or needs_resplit=true):
 * 1. Check each page's aspect ratio (w/h > 1.2 = spread)
 * 2. For spreads: detect the binding crease, crop left+right halves with a
 *    small overlap, upload both halves to R2, create a new right-half page doc
 * 3. Renumber all pages sequentially
 * 4. Update book counts + advance pipeline
 *
 * Gutter detection:
 *   Earlier versions cut at width/2. BPH scans have gutters offset by up to
 *   19% from geometric center, which chopped ~12 characters off the right
 *   margin of every line on the left page. Current detector finds the widest
 *   run of ink-free columns inside x∈[30%, 70%] of the spread (measured over
 *   y∈[25%, 75%] to skip headers/footers, ink defined as min(R,G,B) < 120 so
 *   red rubrications register). Narrow runs (< 15% of W) → cut at run end;
 *   wide runs (blank-page scenarios) → cut at run center. Falls back to
 *   geometric center when no usable run is found. See detectGutterColumn().
 *
 * Run on Hetzner (or any machine with R2 + Mongo creds):
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/batch-split-bph.mjs --limit 10
 *   node scripts/workers/batch-split-bph.mjs --dry-run
 *   node scripts/workers/batch-split-bph.mjs --book-id 69c62f1789e1344e8dd54250
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { parseArgs } from 'util';
import { VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';

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

// --- Gutter detection ---
// Find the binding by locating the widest horizontal RUN of ink-free columns
// in the central x∈[30%, 70%] region, measured over a central y∈[25%, 75%]
// band so headers/footers don't interfere. Brightness-based methods all
// failed in earlier attempts (binding shadow is too faint to discriminate
// from text on BPH scans; the bright peak in the middle is the LEFT page's
// right margin, not the gutter). This approach measures content directly:
// the gutter is the widest column-run where no row has ink. For each column
// we count the fraction of rows in the central band where any RGB channel
// is below 120 (so red rubrications and blue notes count as ink, not just
// black). Threshold at 2% ink, then find the longest run.
//
// Narrow vs wide gap dispatch:
//   - Narrow gap (< 15% of width): the gap IS the binding region. The left
//     page text ends just before the gap and the right page text starts
//     just after. Cut at gap END so the left half captures all left-page
//     text plus the binding crease.
//   - Wide gap (≥ 15%): the spread has lots of blank space (title page,
//     blank verso, ornamental dividers). The binding sits somewhere inside
//     the wide gap; cut at gap CENTER as a safe middle ground.
//
// If no usable gap (< 10px wide), fall back to geometric center.
async function detectGutterColumn(spreadBuf, imgWidth, imgHeight) {
  try {
    const W = 800;
    const ratio = W / imgWidth;
    const H = Math.round(imgHeight * ratio);
    // Keep RGB so colored ink (red rubrications, blue annotations) registers
    // as "dark" — grayscale weights red at only 21% and lets red title text
    // appear as light gray, which made the detector treat rubricated title
    // pages as if there was no ink near the binding (e.g. Hieroglyphica's
    // red title chopped the leading letter off every line).
    const raw = await sharp(spreadBuf)
      .resize(W, H, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer();
    const bandStart = Math.round(H * 0.25);
    const bandEnd = Math.round(H * 0.75);
    const DARK = 120;
    const inkPerCol = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let d = 0;
      for (let y = bandStart; y < bandEnd; y++) {
        const i = (y * W + x) * 3;
        const m = Math.min(raw[i], raw[i + 1], raw[i + 2]);
        if (m < DARK) d++;
      }
      inkPerCol[x] = d / (bandEnd - bandStart);
    }
    // Light smoothing (±5px) so the inter-character white slivers in text
    // don't fragment what we want to detect as a single gap.
    const half = 5;
    const smoothed = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const lo = Math.max(0, x - half);
      const hi = Math.min(W - 1, x + half);
      let s = 0;
      for (let i = lo; i <= hi; i++) s += inkPerCol[i];
      smoothed[x] = s / (hi - lo + 1);
    }
    const cs = Math.round(W * 0.30);
    const ce = Math.round(W * 0.70);
    const NO_INK = 0.02;
    let bestStart = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let x = cs; x < ce; x++) {
      if (smoothed[x] < NO_INK) {
        if (curStart < 0) curStart = x;
        curLen = x - curStart + 1;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1; curLen = 0;
      }
    }
    if (bestStart < 0 || bestLen < 10) return Math.round(imgWidth / 2);
    const WIDE = Math.round(W * 0.15);
    const chosen = bestLen < WIDE
      ? bestStart + bestLen                       // narrow gap → cut at gap end
      : bestStart + Math.floor(bestLen / 2);      // wide gap → cut at gap center
    return Math.round(chosen / ratio);
  } catch {
    return Math.round(imgWidth / 2);
  }
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

  // Check first non-cover page for aspect ratio.
  // For books in the 2026-05-06 spread-translation crisis cohort
  // (`needs_resplit: true`) we KNOW some pages are spreads but the early
  // sample can be misleading — these books often have a non-spread
  // bookplate or flyleaf in the first 3 pages with content spreads
  // appearing later. Force per-page evaluation in that case.
  const samplePage = pages.length > 2 ? pages[2] : pages[0];
  const sampleBuf = await fetchImage(samplePage.photo);
  const meta = await sharp(sampleBuf).metadata();
  const ratio = (meta.width || 1) / (meta.height || 1);

  if (ratio <= ASPECT_RATIO_THRESHOLD && !book.needs_resplit) {
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
  if (book.needs_resplit && ratio <= ASPECT_RATIO_THRESHOLD) {
    console.log(`  Sample ratio ${ratio.toFixed(2)} ≤ threshold but needs_resplit=true → forcing per-page evaluation`);
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
      // Skip pages already created by a previous split run
      if (page.split_from || page.split_from_spread) {
        singleCount++;
        return;
      }

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

      // It's a spread — archive the original full-res spread to R2 before splitting
      const originalUrl = page.photo;
      const spreadKey = `archived/${book.id}/${page.page_number}-spread.jpg`;
      const spreadR2Url = await uploadToR2(r2, spreadKey, buf);

      // Split at the detected gutter (darkest vertical band near the middle).
      // Centered cuts fail on books photographed with off-center bindings —
      // observed up to 19% off in the BPH cohort, chopping ~12 chars from
      // every line on the left page. Fall back to geometric center if
      // detection finds nothing convincing.
      const imgWidth = pageMeta.width || 1000;
      const imgHeight = pageMeta.height || 1000;
      const splitX = await detectGutterColumn(buf, imgWidth, imgHeight);

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
      const [leftFullUrl, leftDisplayUrl, leftThumbUrl] = await Promise.all([
        uploadToR2(r2, leftPaths.full, leftBuf),
        uploadToR2(r2, leftPaths.display, leftDisplay),
        uploadToR2(r2, leftPaths.thumb, leftThumb),
      ]);

      // Upload right half
      const [rightFullUrl, rightDisplayUrl, rightThumbUrl] = await Promise.all([
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
              archived_photo: leftFullUrl,
              display_photo: leftDisplayUrl,
              thumbnail_blob: leftThumbUrl,
              photo_original: originalUrl,
              spread_archived: spreadR2Url,
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
            $unset: { ocr: '', translation: '', summary: '', cropped_photo: '' },
          },
        },
      });

      // Create right-half page. tenantId (camelCase UUID) is what
      // /api/[tenant]/pages/[id] filters by. Missing tenantId on a tenant
      // book causes the client API to 404 on the new right-half page,
      // which silently breaks reader navigation.
      newPages.push({
        _id: new ObjectId(rightPageId),
        id: rightPageId,
        ...(book.tenantId ? { tenantId: book.tenantId } : {}),
        book_id: book.id,
        page_number: rightPageNum, // 0.5 — renumbered later
        photo: rightFullUrl,
        thumbnail: rightThumbUrl,
        archived_photo: rightFullUrl,
        display_photo: rightDisplayUrl,
        thumbnail_blob: rightThumbUrl,
        photo_original: originalUrl,
        spread_archived: spreadR2Url,
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

  // Update book — count VISIBLE pages only (page_number > 0). Soft-hidden pages
  // never render, so counting them corrupts the visible-only read-path convention
  // (issue #3293). The renumber above reassigns every page to a positive number,
  // so allPages.length is already the visible count; the countDocuments filters
  // keep the convention correct regardless.
  const ocrCount = await pagesCol.countDocuments({
    book_id: book.id,
    ...VISIBLE_PAGE_MATCH,
    'ocr.data': { $exists: true, $ne: '' },
  });
  const translateCount = await pagesCol.countDocuments({
    book_id: book.id,
    ...VISIBLE_PAGE_MATCH,
    'translation.data': { $exists: true, $ne: '' },
  });

  // Set thumbnail to first page. Prefer R2-hosted URLs over the page's
  // original `photo` field, which for IIIF imports points at the source
  // library's image server (e.g. images.uba.uva.nl) — that violates the
  // R2-only policy. archived_photo is set during the archive phase to a
  // canonical /archived/{id}/{n}.jpg URL on R2.
  const firstPage = allPages[0];
  const isR2 = (u) => u && u.includes('images.sourcelibrary.org');
  const thumbnailUrl =
    (isR2(firstPage?.archived_photo) ? firstPage.archived_photo : null)
    || (isR2(firstPage?.photo) ? firstPage.photo : null)
    || firstPage?.archived_photo
    || firstPage?.photo
    || firstPage?.cropped_photo;

  const setDoc = {
    pages_count: allPages.length,
    pages_ocr: ocrCount,
    pages_translated: translateCount,
    needs_splitting: false,
    thumbnail: thumbnailUrl,
    'pipeline_auto.split_checked': true,
    'pipeline_auto.last_updated': new Date(),
    updated_at: new Date(),
  };
  // For the 2026-05-06 resplit cohort: roll the book back to archive_complete
  // so the orchestrator's Phase 2 (OCR-submit) and Phase 5 (translate) re-run
  // against the new half-pages. Clear the crisis flags so the book is
  // reabsorbed into normal pipeline flow.
  const updateDoc = { $set: setDoc };
  if (book.needs_resplit) {
    setDoc['pipeline_auto.status'] = 'archive_complete';
    updateDoc.$unset = {
      needs_resplit: '',
      spread_translation_crisis: '',
      translation_stale_reason: '',
    };
  }
  await booksCol.updateOne({ id: book.id }, updateDoc);

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

  // Find books to process.
  // Two cohorts:
  //   1. Fresh imports at archive_complete with needs_splitting=true
  //   2. The 2026-05-06 resplit cohort: books that finished the pipeline
  //      with OCR/translation done on combined spreads. They're at
  //      pipeline_auto.status='complete' or 'images_complete' so the
  //      first cohort filter would miss them. The needs_resplit flag
  //      identifies them precisely.
  let query;
  if (BOOK_ID) {
    query = { id: BOOK_ID };
  } else {
    query = { $or: [
      {
        needs_splitting: true,
        'pipeline_auto.status': 'archive_complete',
        'pipeline_auto.split_checked': { $ne: true },
      },
      { needs_resplit: true },
    ] };
  }

  const books = await db.collection('books')
    .find(query)
    .project({ id: 1, title: 1, pages_count: 1, needs_resplit: 1, tenantId: 1 })
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
