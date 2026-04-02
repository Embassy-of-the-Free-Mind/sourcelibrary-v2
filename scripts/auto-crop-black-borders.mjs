#!/usr/bin/env node
/**
 * Auto-crop black scanner borders from page images.
 *
 * Uses Sharp's trim() to detect and remove black backgrounds,
 * then uploads cropped versions to R2 as cropped_photo + display_photo.
 *
 * Usage:
 *   node scripts/auto-crop-black-borders.mjs <bookId> [--dry-run] [--threshold=30] [--min-trim=5]
 *
 * Options:
 *   --dry-run       Preview what would be cropped without uploading
 *   --threshold=N   Color distance threshold for trim (default: 30, higher = more aggressive)
 *   --min-trim=N    Minimum % of image that must be trimmed to bother (default: 5)
 *   --skip-copyright  Also trim the copyright bar at the bottom
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const args = process.argv.slice(2);
const bookId = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const threshold = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '30');
const minTrimPercent = parseInt(args.find(a => a.startsWith('--min-trim='))?.split('=')[1] || '5');
const skipCopyright = args.includes('--skip-copyright');

if (!bookId) {
  console.error('Usage: node scripts/auto-crop-black-borders.mjs <bookId> [--dry-run]');
  process.exit(1);
}

// Dynamic imports for ES module compatibility
const { storagePut, pagePaths } = await import('../src/lib/storage.ts');

const DISPLAY_WIDTH = 1200;
const DISPLAY_QUALITY = 85;

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function detectCopyrightBar(buffer, metadata) {
  // ProQuest copyright bars are typically in the bottom ~8% of the image,
  // with a dark background and light text. We detect by checking if the
  // bottom strip is predominantly dark.
  const height = metadata.height;
  const width = metadata.width;
  const barHeight = Math.round(height * 0.08);

  const bottomStrip = await sharp(buffer)
    .extract({ left: 0, top: height - barHeight, width, height: barHeight })
    .greyscale()
    .raw()
    .toBuffer();

  // Calculate average brightness of bottom strip
  let sum = 0;
  for (let i = 0; i < bottomStrip.length; i++) sum += bottomStrip[i];
  const avgBrightness = sum / bottomStrip.length;

  // If bottom strip is dark (avg brightness < 60), it's likely a copyright bar
  return avgBrightness < 60 ? barHeight : 0;
}

async function autoCropPage(buffer) {
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width;
  const origHeight = metadata.height;
  const channels = metadata.channels;

  // Step 1: Detect copyright bar at bottom
  let copyrightBarHeight = 0;
  if (!skipCopyright) {
    copyrightBarHeight = await detectCopyrightBar(buffer, metadata);
  }

  // Step 2: Find content bounds by scanning for non-background pixels
  // Background can be white (scanner padding) or black (scanner bed)
  const raw = await sharp(buffer).raw().toBuffer();

  function isBackground(x, y) {
    const idx = (y * origWidth + x) * channels;
    const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
    const bright = (r + g + b) / 3;
    return bright > 245 || bright < 15; // white or black
  }

  // Effective height (excluding copyright bar)
  const effectiveHeight = origHeight - copyrightBarHeight;

  // Scan from left
  let leftBound = 0;
  for (let x = 0; x < origWidth; x += 10) {
    let contentPixels = 0;
    for (let sy = effectiveHeight * 0.1 | 0; sy < effectiveHeight * 0.85 | 0; sy += effectiveHeight * 0.03 | 0) {
      if (!isBackground(x, sy)) contentPixels++;
    }
    if (contentPixels >= 3) { leftBound = Math.max(0, x - 10); break; }
  }

  // Scan from right
  let rightBound = origWidth;
  for (let x = origWidth - 1; x >= 0; x -= 10) {
    let contentPixels = 0;
    for (let sy = effectiveHeight * 0.1 | 0; sy < effectiveHeight * 0.85 | 0; sy += effectiveHeight * 0.03 | 0) {
      if (!isBackground(x, sy)) contentPixels++;
    }
    if (contentPixels >= 3) { rightBound = Math.min(origWidth, x + 10); break; }
  }

  // Scan from top
  let topBound = 0;
  for (let y = 0; y < effectiveHeight; y += 10) {
    let contentPixels = 0;
    for (let sx = origWidth * 0.2 | 0; sx < origWidth * 0.8 | 0; sx += origWidth * 0.03 | 0) {
      if (!isBackground(sx, y)) contentPixels++;
    }
    if (contentPixels >= 3) { topBound = Math.max(0, y - 10); break; }
  }

  // Scan from bottom (above copyright bar)
  let bottomBound = effectiveHeight;
  for (let y = effectiveHeight - 1; y >= 0; y -= 10) {
    let contentPixels = 0;
    for (let sx = origWidth * 0.2 | 0; sx < origWidth * 0.8 | 0; sx += origWidth * 0.03 | 0) {
      if (!isBackground(sx, y)) contentPixels++;
    }
    if (contentPixels >= 3) { bottomBound = Math.min(effectiveHeight, y + 10); break; }
  }

  // Add a small margin (1% of dimension) so we don't clip page edges
  const marginX = Math.round(origWidth * 0.005);
  const marginY = Math.round(origHeight * 0.005);
  leftBound = Math.max(0, leftBound - marginX);
  topBound = Math.max(0, topBound - marginY);
  rightBound = Math.min(origWidth, rightBound + marginX);
  bottomBound = Math.min(effectiveHeight, bottomBound + marginY);

  const cropWidth = rightBound - leftBound;
  const cropHeight = bottomBound - topBound;

  const origArea = origWidth * origHeight;
  const trimmedArea = cropWidth * cropHeight;
  const trimPercent = ((origArea - trimmedArea) / origArea) * 100;

  // Perform the actual crop
  const croppedBuffer = await sharp(buffer)
    .extract({ left: leftBound, top: topBound, width: cropWidth, height: cropHeight })
    .toBuffer();

  return {
    origWidth,
    origHeight,
    cropLeft: leftBound,
    cropTop: topBound,
    cropWidth,
    cropHeight,
    copyrightBarHeight,
    trimPercent: trimPercent.toFixed(1),
    croppedBuffer,
    shouldCrop: trimPercent >= minTrimPercent,
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find the book
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { _id: bookId }, { slug: bookId }] },
    { projection: { id: 1, title: 1, slug: 1 } }
  );

  if (!book) {
    console.error(`Book not found: ${bookId}`);
    process.exit(1);
  }

  console.log(`Book: ${book.title}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Trim threshold: ${threshold}, min trim: ${minTrimPercent}%\n`);

  // Get all pages
  const pages = await db.collection('pages')
    .find({ book_id: book.id })
    .sort({ page_number: 1 })
    .project({ id: 1, page_number: 1, archived_photo: 1, photo_original: 1, photo: 1, cropped_photo: 1 })
    .toArray();

  console.log(`Found ${pages.length} pages\n`);

  let cropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const page of pages) {
    const imageUrl = page.archived_photo || page.photo_original || page.photo;
    if (!imageUrl) {
      console.log(`  Page ${page.page_number}: no image URL, skipping`);
      skipped++;
      continue;
    }

    try {
      const buffer = await fetchImageBuffer(imageUrl);
      const result = await autoCropPage(buffer);

      const label = `Page ${String(page.page_number).padStart(3)}: ${result.origWidth}x${result.origHeight} → ${result.cropWidth}x${result.cropHeight} (${result.trimPercent}% trimmed${result.copyrightBarHeight > 0 ? ', copyright bar removed' : ''})`;

      if (!result.shouldCrop) {
        console.log(`  ${label} — SKIP (below ${minTrimPercent}% threshold)`);
        skipped++;
        continue;
      }

      console.log(`  ${label} — ${dryRun ? 'WOULD CROP' : 'CROPPING'}`);

      if (!dryRun) {
        const paths = pagePaths(book.id, page.page_number);

        // Upload full-res cropped version
        const fullResJpeg = await sharp(result.croppedBuffer)
          .jpeg({ quality: 92 })
          .toBuffer();

        await storagePut(paths.full, fullResJpeg, {
          contentType: 'image/jpeg',
          access: 'public',
        });

        // Upload display-size (1200px wide) version
        const displayBuffer = await sharp(result.croppedBuffer)
          .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: DISPLAY_QUALITY })
          .toBuffer();

        await storagePut(paths.display, displayBuffer, {
          contentType: 'image/jpeg',
          access: 'public',
        });

        // Upload thumbnail (300px wide)
        const thumbBuffer = await sharp(result.croppedBuffer)
          .resize({ width: 300, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        const thumbPath = `thumbnails/${book.id}/${page.id}.jpg`;
        const thumbResult = await storagePut(thumbPath, thumbBuffer, {
          contentType: 'image/jpeg',
          access: 'public',
        });

        // Update page in DB
        const r2Base = `https://images.sourcelibrary.org`;
        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              cropped_photo: `${r2Base}/${paths.full}`,
              display_photo: `${r2Base}/${paths.display}`,
              thumbnail_blob: thumbResult.url,
              auto_cropped: true,
              updated_at: new Date(),
            }
          }
        );

        cropped++;
      } else {
        cropped++;
      }
    } catch (err) {
      console.error(`  Page ${page.page_number}: ERROR — ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${cropped} cropped, ${skipped} skipped, ${errors} errors`);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
