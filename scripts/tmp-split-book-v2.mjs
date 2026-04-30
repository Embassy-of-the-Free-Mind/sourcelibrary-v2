#!/usr/bin/env node
/**
 * Split a book's spread pages into individual pages.
 *
 * For each page image:
 *   - If portrait (AR < 1.1), skip (already single page)
 *   - If landscape, detect gutter and split into left/right halves
 *   - Upload cropped images to R2
 *   - Create new page records in MongoDB
 *
 * Usage:
 *   node scripts/tmp-split-book-v2.mjs <bookId> [--dry-run] [--rtl]
 *
 * --rtl: For Hebrew/Arabic books where right page comes first in reading order
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const BOOK_ID = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const RTL = process.argv.includes('--rtl');

if (!BOOK_ID) { console.error('Usage: node split-book-v2.mjs <bookId> [--dry-run] [--rtl]'); process.exit(1); }

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

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
 */
async function splitPage(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const ar = meta.width / meta.height;

  if (ar < 1.1) return null; // Already single page

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

  // 3% overlap on each side — both halves include a bit past the gutter
  const overlap = Math.round(meta.width * 0.03);

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

function newId() {
  const oid = new ObjectId();
  return oid.toHexString();
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');

  const book = await booksCol.findOne({ id: BOOK_ID });
  if (!book) { console.error('Book not found:', BOOK_ID); process.exit(1); }

  console.log(`Book: ${book.display_title || book.title}`);
  console.log(`Pages: ${book.pages_count}`);
  console.log(`RTL: ${RTL}`);
  console.log(`Dry run: ${DRY_RUN}`);

  // Get all existing pages sorted by page_number
  const existingPages = await pagesCol
    .find({ book_id: BOOK_ID })
    .sort({ page_number: 1 })
    .toArray();

  console.log(`\nExisting pages in DB: ${existingPages.length}`);

  // Process each page
  const newPages = []; // Will hold the reordered final page list
  let splitCount = 0;
  let skipCount = 0;

  for (const page of existingPages) {
    const imageUrl = page.archived_photo || page.photo_original || page.photo;
    if (!imageUrl) {
      console.log(`  p${page.page_number}: no image, keeping as-is`);
      newPages.push({ ...page, action: 'keep' });
      continue;
    }

    // Download image
    let buf;
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      console.log(`  p${page.page_number}: download failed (${e.message}), keeping as-is`);
      newPages.push({ ...page, action: 'keep' });
      continue;
    }

    // Try to split
    const result = await splitPage(buf);

    if (!result) {
      // Portrait page — keep as-is
      skipCount++;
      newPages.push({ ...page, action: 'keep' });
      continue;
    }

    splitCount++;

    // Determine page order based on reading direction
    const firstHalf = RTL ? result.right : result.left;
    const secondHalf = RTL ? result.left : result.right;
    const firstLabel = RTL ? 'right (recto)' : 'left';
    const secondLabel = RTL ? 'left (verso)' : 'right';

    if (DRY_RUN) {
      console.log(`  p${page.page_number}: SPLIT at gutter=${result.gutterX} (${result.originalWidth}px) → ${firstLabel} + ${secondLabel}`);
      newPages.push({ action: 'split-first', originalPage: page });
      newPages.push({ action: 'split-second', originalPage: page });
      continue;
    }

    // Generate all image variants for both halves
    async function processHalf(halfBuf, label) {
      const id = newId();
      const meta = await sharp(halfBuf).metadata();

      // Full-res cropped image
      const fullKey = `cropped/${BOOK_ID}/${id}.jpg`;
      const fullUrl = await uploadToR2(fullKey, halfBuf);

      // Display size (1200px wide)
      const displayBuf = await sharp(halfBuf).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const displayKey = `pages/${BOOK_ID}/sp${id}.jpg`;
      const displayUrl = await uploadToR2(displayKey, displayBuf);

      // Thumbnail (150px wide)
      const thumbBuf = await sharp(halfBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
      const thumbKey = `pages/${BOOK_ID}/sp${id}-thumb.jpg`;
      const thumbUrl = await uploadToR2(thumbKey, thumbBuf);

      return {
        id,
        photo: fullUrl,
        display_photo: displayUrl,
        archived_photo: fullUrl,
        thumbnail: thumbUrl,
        image_width: meta.width,
        image_height: meta.height,
      };
    }

    const [firstResult, secondResult] = await Promise.all([
      processHalf(firstHalf, firstLabel),
      processHalf(secondHalf, secondLabel),
    ]);

    console.log(`  p${page.page_number}: SPLIT → ${firstLabel} + ${secondLabel}`);

    // Create page records with all required fields
    const now = new Date();
    const basePage = {
      book_id: BOOK_ID,
      tenant_id: book.tenant_id || 'default',
      tenantId: book.tenantId || 'default',
      created_at: now,
      updated_at: now,
      split_from_spread: page.id,
      photo_original: page.archived_photo || page.photo_original || page.photo,
      split_side: null,
      split_position: result.gutterX,
      field_provenance: {
        photo: { source: 'r2', method: 'v4-projection-split', date: now },
      },
    };

    for (const [halfResult, side] of [[firstResult, 'first'], [secondResult, 'second']]) {
      newPages.push({
        action: `split-${side}`,
        doc: {
          ...basePage,
          ...halfResult,
          split_side: side === 'first' ? (RTL ? 'right' : 'left') : (RTL ? 'left' : 'right'),
        },
        originalPage: page,
      });
    }
  }

  console.log(`\nSummary: ${splitCount} spreads split, ${skipCount} single pages kept`);
  console.log(`New total: ${newPages.length} pages (was ${existingPages.length})`);

  if (DRY_RUN) {
    console.log('\nDry run — no DB changes made.');
    await client.close();
    return;
  }

  // Renumber all pages sequentially
  console.log('\nRenumbering and inserting...');
  const bulkOps = [];
  let pageNum = 1;

  for (const entry of newPages) {
    if (entry.action === 'keep') {
      // Update page_number if it changed
      if (entry.page_number !== pageNum) {
        bulkOps.push({
          updateOne: {
            filter: { _id: entry._id },
            update: { $set: { page_number: pageNum, updated_at: new Date() } },
          },
        });
      }
      pageNum++;
    } else if (entry.action === 'split-first' || entry.action === 'split-second') {
      // Mark the original spread page as archived (don't delete it — data preservation)
      if (entry.action === 'split-first') {
        bulkOps.push({
          updateOne: {
            filter: { _id: entry.originalPage._id },
            update: {
              $set: {
                page_type: 'archived-spread',
                page_number: -entry.originalPage.page_number, // negative = hidden
                updated_at: new Date(),
              },
            },
          },
        });
      }

      // Insert new split page with _id matching id
      bulkOps.push({
        insertOne: {
          document: {
            _id: new ObjectId(entry.doc.id),
            ...entry.doc,
            page_number: pageNum,
          },
        },
      });
      pageNum++;
    }
  }

  if (bulkOps.length > 0) {
    const result = await pagesCol.bulkWrite(bulkOps, { ordered: true });
    console.log(`DB: ${result.insertedCount} inserted, ${result.modifiedCount} modified`);
  }

  // Update book metadata
  const newPageCount = newPages.length;
  await booksCol.updateOne({ id: BOOK_ID }, {
    $set: {
      pages_count: newPageCount,
      needs_splitting: false,
      split_completed: true,
      split_note: `v2 gutter-split: ${splitCount} spreads → ${splitCount * 2} pages, ${skipCount} singles kept`,
      updated_at: new Date(),
    },
  });

  console.log(`\nDone. Book now has ${newPageCount} pages.`);
  console.log('NOTE: Pages need re-OCR and re-translation for the split content.');

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
