#!/usr/bin/env node
/**
 * Split a book's spread pages into individual pages (V2).
 *
 * Uses programmatic gutter detection (Otsu binarization + vertical projection
 * profile) — no AI needed, runs in milliseconds per page.
 *
 * For each page image:
 *   - If portrait (AR < 1.1), skip (already single page)
 *   - If landscape, detect gutter and split into left/right halves
 *   - Upload cropped images to R2 (full-res, display, thumbnail)
 *   - Archive old spread page, insert new split pages
 *
 * Checklist (from 22 lessons, issue #1491):
 *   - Per-page AR check (not page 1 only)
 *   - V4 gutter detection with 3% overlap
 *   - _id === id (ObjectId)
 *   - tenantId copied from book
 *   - Real 150px thumbnails
 *   - Unique R2 paths per page id
 *   - Archives old spreads (negative page_number)
 *   - Pre-split revision snapshot
 *   - Idempotency guard (checks for existing splits)
 *   - >20% failure abort
 *   - Cover update to split page
 *   - Resets pages_translated/pages_ocr/pages_blank
 *   - Sets pipeline_status for re-OCR
 *   - Source image width verification (>1000px)
 *   - Fetch timeout + retry
 *   - Full-res crop as display_photo (no lossy 1200px resize)
 *
 * Usage:
 *   node scripts/split-book-v2.mjs <bookId|slug> [--dry-run] [--rtl]
 *
 * --rtl: For Hebrew/Arabic books where right page comes first in reading order
 * --dry-run: Preview without DB changes
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

// --- Config ---
const MIN_SPREAD_AR = 1.1;
const OVERLAP_PCT = 0.03;       // 3% overlap on each side of gutter
const FETCH_TIMEOUT = 20000;    // 20s per image
const MAX_RETRIES = 3;
const FAILURE_ABORT_PCT = 0.2;  // Abort if >20% of pages fail
const MIN_SOURCE_WIDTH = 1000;  // Source images must be at least this wide

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// --- Parse args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RTL = args.includes('--rtl');
const BOOK_ID = args.find(a => !a.startsWith('--'));

if (!BOOK_ID) {
  console.error('Usage: node scripts/split-book-v2.mjs <bookId|slug> [--dry-run] [--rtl]');
  process.exit(1);
}

// --- R2 client ---
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// --- Image fetch with timeout + retry ---
async function fetchImage(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (attempt < MAX_RETRIES - 1) {
        console.log(`    Fetch retry ${attempt + 1}/${MAX_RETRIES}: ${e.message?.slice(0, 60)}`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else {
        throw e;
      }
    }
  }
}

// --- R2 upload with retry ---
async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=86400, s-maxage=86400',
      }));
      return `${R2_PUBLIC_URL}/${key}`;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(`    R2 upload retry ${attempt + 1}/3: ${e.message?.substring(0, 60)}`);
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/**
 * V4 gutter detection: Otsu binarization + vertical projection profile.
 * Finds the gap between text blocks by counting text pixels per column,
 * then locating the deepest valley (fewest text pixels) near center.
 *
 * Returns null if image is portrait (AR < 1.1).
 * Returns { left, right, gutterX, originalWidth, originalHeight } if split.
 */
async function splitPage(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const ar = meta.width / meta.height;

  if (ar < MIN_SPREAD_AR) return null; // Already single page

  const targetW = 1200;
  const scale = targetW / meta.width;
  const targetH = Math.round(meta.height * scale);

  const { data } = await sharp(imageBuffer)
    .greyscale()
    .resize(targetW, targetH)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Otsu binarization threshold
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue; wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const v = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }

  // Vertical projection: count text pixels per column (middle 70% of height)
  const yStart = Math.floor(targetH * 0.15);
  const yEnd = Math.floor(targetH * 0.85);
  const projection = new Array(targetW).fill(0);
  for (let x = 0; x < targetW; x++)
    for (let y = yStart; y < yEnd; y++)
      if (data[y * targetW + x] < threshold) projection[x]++;

  // Smooth with 15px window
  const smoothed = new Array(targetW).fill(0);
  for (let x = 0; x < targetW; x++) {
    let s = 0, c = 0;
    for (let dx = -15; dx <= 15; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < targetW) { s += projection[xx]; c++; }
    }
    smoothed[x] = s / c;
  }

  // Find deepest valley in center 30%
  const searchStart = Math.floor(targetW * 0.35);
  const searchEnd = Math.floor(targetW * 0.65);
  let minVal = Infinity, minX = Math.floor(targetW / 2);
  for (let x = searchStart; x < searchEnd; x++)
    if (smoothed[x] < minVal) { minVal = smoothed[x]; minX = x; }

  // Expand to find valley edges, then center the cut
  const valleyThreshold = minVal + (smoothed[searchStart] - minVal) * 0.2;
  let vStart = minX, vEnd = minX;
  while (vStart > searchStart && smoothed[vStart - 1] < valleyThreshold) vStart--;
  while (vEnd < searchEnd - 1 && smoothed[vEnd + 1] < valleyThreshold) vEnd++;
  const gutterX = Math.round(((vStart + vEnd) / 2) / scale);

  // 3% overlap on each side
  const overlap = Math.round(meta.width * OVERLAP_PCT);

  const leftEnd = Math.min(gutterX + overlap, meta.width);
  const leftBuf = await sharp(imageBuffer)
    .extract({ left: 0, top: 0, width: leftEnd, height: meta.height })
    .jpeg({ quality: 90 })
    .toBuffer();

  const rightStart = Math.max(gutterX - overlap, 0);
  const rightBuf = await sharp(imageBuffer)
    .extract({ left: rightStart, top: 0, width: meta.width - rightStart, height: meta.height })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    left: leftBuf,
    right: rightBuf,
    gutterX,
    originalWidth: meta.width,
    originalHeight: meta.height,
  };
}

/**
 * Process one half of a split: upload full-res, display (capped at 2000px), thumbnail (150px).
 * Full-res crop IS the display_photo — no lossy 1200px resize for manuscripts.
 */
async function processHalf(halfBuf, bookId) {
  const id = new ObjectId().toHexString();
  const meta = await sharp(halfBuf).metadata();

  // Full-res cropped image (also used as display — lesson: 1200px/q80 too lossy for manuscripts)
  const fullKey = `cropped/${bookId}/${id}.jpg`;
  const fullUrl = await uploadToR2(fullKey, halfBuf);

  // Display: cap at 2000px for reasonable load times, but keep quality high
  const needsResize = meta.width > 2000;
  const displayBuf = needsResize
    ? await sharp(halfBuf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 88, progressive: true }).toBuffer()
    : halfBuf;
  const displayKey = `pages/${bookId}/sp${id}.jpg`;
  const displayUrl = await uploadToR2(displayKey, displayBuf);

  // Thumbnail (150px wide)
  const thumbBuf = await sharp(halfBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
  const thumbKey = `pages/${bookId}/sp${id}-thumb.jpg`;
  const thumbUrl = await uploadToR2(thumbKey, thumbBuf);

  return {
    id,
    photo: displayUrl,
    display_photo: displayUrl,
    archived_photo: fullUrl,
    thumbnail: thumbUrl,
    image_width: meta.width,
    image_height: meta.height,
  };
}

// =============================================================
// MAIN
// =============================================================

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const booksCol = db.collection('books');
const pagesCol = db.collection('pages');

// --- Find book ---
const book = await booksCol.findOne({
  $or: [{ id: BOOK_ID }, { slug: BOOK_ID }],
});
if (!book) { console.error('Book not found:', BOOK_ID); await client.close(); process.exit(1); }

console.log(`\n=== ${book.display_title || book.title} ===`);
console.log(`ID: ${book.id}`);
console.log(`Pages: ${book.pages_count} | RTL: ${RTL} | Dry run: ${DRY_RUN}`);

// --- Idempotency guard ---
// Check for BOTH old pipeline (split_from, crop) and new pipeline (split_from_spread)
const existingSplitsNew = await pagesCol.countDocuments({
  book_id: book.id,
  split_from_spread: { $exists: true, $ne: null },
});
const existingSplitsOld = await pagesCol.countDocuments({
  book_id: book.id,
  split_from: { $exists: true, $ne: null },
});
const existingCrops = await pagesCol.countDocuments({
  book_id: book.id,
  crop: { $exists: true },
});
if (existingSplitsNew > 0 || existingSplitsOld > 0 || existingCrops > 0) {
  console.log(`\nABORT: Book already has split page data.`);
  console.log(`  split_from_spread (new): ${existingSplitsNew}`);
  console.log(`  split_from (old): ${existingSplitsOld}`);
  console.log(`  crop coordinates: ${existingCrops}`);
  console.log('This book was already split — it may only need a cover fix.');
  console.log('To force re-split, use --force (will archive existing pages first).');
  await client.close();
  process.exit(1);
}

// --- Get all existing pages ---
const existingPages = await pagesCol
  .find({ book_id: book.id, page_type: { $ne: 'archived-spread' } })
  .sort({ page_number: 1 })
  .toArray();

console.log(`Existing pages in DB: ${existingPages.length}`);

// --- Source image width check on first landscape page ---
let sourceVerified = false;
for (const page of existingPages.slice(0, 5)) {
  const url = page.archived_photo || page.photo_original || page.photo;
  if (!url) continue;
  try {
    const buf = await fetchImage(url);
    const meta = await sharp(buf).metadata();
    if (meta.width / meta.height >= MIN_SPREAD_AR) {
      if (meta.width < MIN_SOURCE_WIDTH) {
        console.log(`\nABORT: Source images too small (${meta.width}px). These may be previously-cropped halves, not original spreads.`);
        await client.close();
        process.exit(1);
      }
      console.log(`Source verified: ${meta.width}x${meta.height} (first landscape page)`);
      sourceVerified = true;
      break;
    }
  } catch {}
}
if (!sourceVerified) {
  console.log('WARNING: Could not verify source image width (no landscape pages in first 5). Proceeding with caution.');
}

// --- Collect image widths to detect fold-outs ---
// Sample a few pages to establish typical spread width, then skip pages much wider (fold-outs)
let medianWidth = 0;
{
  const sampleWidths = [];
  const samplePages = existingPages.filter((_, i) => i >= 1 && i <= 6); // skip cover, sample 2-7
  for (const p of samplePages) {
    const url = p.archived_photo || p.photo_original || p.photo;
    if (!url) continue;
    try {
      const buf = await fetchImage(url);
      const meta = await sharp(buf).metadata();
      if (meta.width / meta.height >= MIN_SPREAD_AR) sampleWidths.push(meta.width);
    } catch {}
  }
  if (sampleWidths.length > 0) {
    sampleWidths.sort((a, b) => a - b);
    medianWidth = sampleWidths[Math.floor(sampleWidths.length / 2)];
    console.log(`Median spread width: ${medianWidth}px (from ${sampleWidths.length} samples)`);
  }
}
const FOLDOUT_THRESHOLD = medianWidth > 0 ? medianWidth * 1.3 : Infinity; // 30% wider = fold-out

// --- Process each page ---
const newPages = [];
let splitCount = 0;
let skipCount = 0;
let failCount = 0;
let foldoutCount = 0;

for (let i = 0; i < existingPages.length; i++) {
  const page = existingPages[i];
  const imageUrl = page.archived_photo || page.photo_original || page.photo;

  if (!imageUrl) {
    console.log(`  p${page.page_number}: no image, keeping as-is`);
    newPages.push({ action: 'keep', page });
    continue;
  }

  // Download image
  let buf;
  try {
    buf = await fetchImage(imageUrl);
  } catch (e) {
    console.log(`  p${page.page_number}: download failed (${e.message?.slice(0, 60)})`);
    failCount++;
    newPages.push({ action: 'keep', page });
    continue;
  }

  // Check for fold-out: image significantly wider than typical spread = single illustration
  {
    const meta = await sharp(buf).metadata();
    if (meta.width > FOLDOUT_THRESHOLD) {
      console.log(`  p${page.page_number}: FOLD-OUT (${meta.width}px > ${FOLDOUT_THRESHOLD}px threshold), keeping as-is`);
      foldoutCount++;
      newPages.push({ action: 'keep', page });
      continue;
    }
  }

  // Try to split
  const result = await splitPage(buf);

  if (!result) {
    // Portrait page — keep as-is
    skipCount++;
    newPages.push({ action: 'keep', page });
    continue;
  }

  splitCount++;

  // Determine page order based on reading direction
  const firstHalf = RTL ? result.right : result.left;
  const secondHalf = RTL ? result.left : result.right;
  const firstLabel = RTL ? 'right (recto)' : 'left';
  const secondLabel = RTL ? 'left (verso)' : 'right';

  if (DRY_RUN) {
    console.log(`  p${page.page_number}: SPLIT at gutter=${result.gutterX}/${result.originalWidth}px → ${firstLabel} + ${secondLabel}`);
    newPages.push({ action: 'split-first', page });
    newPages.push({ action: 'split-second', page });
    continue;
  }

  // Upload both halves
  try {
    const [firstResult, secondResult] = await Promise.all([
      processHalf(firstHalf, book.id),
      processHalf(secondHalf, book.id),
    ]);

    console.log(`  p${page.page_number}: SPLIT → ${firstLabel} + ${secondLabel}`);

    const now = new Date();
    const basePage = {
      book_id: book.id,
      ...(book.tenantId ? { tenantId: book.tenantId } : {}),
      created_at: now,
      updated_at: now,
      split_from_spread: page.id,
      photo_original: page.archived_photo || page.photo_original || page.photo,
      split_position: result.gutterX,
      field_provenance: {
        photo: { source: 'r2', method: 'v4-projection-split', date: now },
      },
    };

    for (const [halfResult, side] of [[firstResult, 'first'], [secondResult, 'second']]) {
      newPages.push({
        action: `split-${side}`,
        page,
        doc: {
          ...basePage,
          ...halfResult,
          split_side: side === 'first' ? (RTL ? 'right' : 'left') : (RTL ? 'left' : 'right'),
        },
      });
    }
  } catch (e) {
    console.log(`  p${page.page_number}: UPLOAD FAILED (${e.message?.slice(0, 60)})`);
    failCount++;
    splitCount--; // Undo the count
    newPages.push({ action: 'keep', page });
  }
}

// --- Summary ---
const totalExpected = existingPages.length;
const newTotal = newPages.length;
console.log(`\nSummary: ${splitCount} spreads split, ${skipCount} singles kept, ${foldoutCount} fold-outs kept, ${failCount} failed`);
console.log(`Page count: ${totalExpected} → ${newTotal}`);

if (DRY_RUN) {
  console.log('\nDry run — no DB changes made.');
  await client.close();
  process.exit(0);
}

// --- Safety checks ---
if (newTotal === 0) {
  console.error('\nABORT: Zero pages would be created. Not modifying DB.');
  await client.close();
  process.exit(1);
}

if (splitCount === 0) {
  console.log('\nNo spreads found to split. Book appears to be single pages already.');
  await booksCol.updateOne({ id: book.id }, {
    $set: { needs_splitting: false, split_completed: true, split_note: 'No spreads found (all pages portrait)', updated_at: new Date() },
  });
  await client.close();
  process.exit(0);
}

if (failCount > 0 && failCount / totalExpected > FAILURE_ABORT_PCT) {
  console.error(`\nABORT: ${failCount}/${totalExpected} pages failed (>${Math.round(FAILURE_ABORT_PCT * 100)}% threshold). Not modifying DB.`);
  await client.close();
  process.exit(1);
}

// --- Pre-split revision snapshot ---
const pagesWithOcr = existingPages.filter(p => p.ocr?.data);
if (pagesWithOcr.length > 0) {
  await db.collection('page_revisions').insertOne({
    id: `split-v2-${book.id}-${Date.now()}`,
    book_id: book.id,
    type: 'pre-split-snapshot',
    page_count: existingPages.length,
    pages_with_ocr: pagesWithOcr.length,
    created_at: new Date(),
    note: `Pre-split snapshot (V2 gutter detection). ${existingPages.length} pages → ${newTotal} expected.`,
  });
  console.log(`Saved pre-split revision (${pagesWithOcr.length} pages with OCR)`);
}

// --- Write to DB ---
console.log('\nWriting to DB...');
const bulkOps = [];
let pageNum = 1;
let coverPage = null;

for (const entry of newPages) {
  if (entry.action === 'keep') {
    if (entry.page.page_number !== pageNum) {
      bulkOps.push({
        updateOne: {
          filter: { _id: entry.page._id },
          update: { $set: { page_number: pageNum, updated_at: new Date() } },
        },
      });
    }
    pageNum++;
  } else if (entry.action === 'split-first' || entry.action === 'split-second') {
    // Archive the original spread (only once, on split-first)
    if (entry.action === 'split-first') {
      bulkOps.push({
        updateOne: {
          filter: { _id: entry.page._id },
          update: {
            $set: {
              page_type: 'archived-spread',
              page_number: -entry.page.page_number, // negative = hidden
              updated_at: new Date(),
            },
          },
        },
      });
    }

    // Insert new split page
    const doc = {
      _id: new ObjectId(entry.doc.id),
      ...entry.doc,
      page_number: pageNum,
    };
    bulkOps.push({ insertOne: { document: doc } });

    // Track cover candidate (first non-blank split page)
    if (!coverPage) {
      coverPage = { num: pageNum, url: entry.doc.thumbnail || entry.doc.photo };
    }

    pageNum++;
  }
}

if (bulkOps.length > 0) {
  const result = await pagesCol.bulkWrite(bulkOps, { ordered: true });
  console.log(`DB: ${result.insertedCount} inserted, ${result.modifiedCount} modified`);
}

// --- Update book metadata ---
const bookUpdate = {
  pages_count: newTotal,
  pages_translated: 0,   // Old translations don't survive split
  pages_ocr: 0,           // Need fresh OCR on split pages
  pages_blank: 0,          // Will be recomputed by sync-page-counts cron
  needs_splitting: false,
  split_completed: true,
  split_completed_at: new Date(),
  split_note: `v2 gutter-split: ${splitCount} spreads → ${splitCount * 2} pages, ${skipCount} singles kept`,
  pipeline_status: 'needs_ocr',
  'pipeline_auto.status': 'archive_complete',  // Reset so orchestrator picks up for OCR
  'pipeline_auto.split_checked': true,
  'pipeline_auto.retry_count': 0,
  updated_at: new Date(),
};

// Update cover to a split page (not the old spread)
if (coverPage) {
  bookUpdate.thumbnail = coverPage.url;
  bookUpdate.cover_page = coverPage.num;
}

await booksCol.updateOne({ id: book.id }, { $set: bookUpdate });

console.log(`\nBook updated:`);
console.log(`  pages: ${existingPages.length} → ${newTotal}`);
console.log(`  cover: p${coverPage?.num || '?'}`);
console.log(`  pipeline_status: needs_ocr`);

// --- Revalidation (best-effort) ---
const slug = book.slug || book.id;
const revalidatePaths = [`/book/${slug}`];
if (book.tenantId && book.tenantId !== 'default') {
  // BPH tenant paths need separate revalidation
  revalidatePaths.push(`/bph/book/${slug}`);
}

for (const path of revalidatePaths) {
  try {
    // POST with the shared secret — the old form (GET + ?secret= query param)
    // hit a POST-only route and never revalidated anything (#4470).
    const resp = await fetch('https://sourcelibrary.org/api/admin/revalidate', {
      method: 'POST',
      headers: {
        'x-revalidate-secret': process.env.CRON_SECRET || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths: [path] }),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`  Revalidated ${path}: ${resp.status}`);
  } catch (e) {
    console.log(`  Revalidation failed for ${path}: ${e.message?.slice(0, 40)}`);
  }
}

const url = `https://sourcelibrary.org/book/${slug}`;
console.log(`\nDone: ${url}`);

await client.close();
