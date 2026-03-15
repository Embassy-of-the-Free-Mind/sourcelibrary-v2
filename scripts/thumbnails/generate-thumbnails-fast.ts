#!/usr/bin/env npx tsx
/**
 * Fast standalone thumbnail generator.
 *
 * Connects directly to MongoDB + Vercel Blob, bypassing the Vercel API.
 * Runs 20 pages in parallel by default — much faster than the API-based script.
 *
 * Requires env vars: MONGODB_URI, BLOB_READ_WRITE_TOKEN
 * Use `secret-lover run -- npx tsx scripts/generate-thumbnails-fast.ts`
 *
 * Usage:
 *   npx tsx scripts/generate-thumbnails-fast.ts                     # all books
 *   npx tsx scripts/generate-thumbnails-fast.ts --concurrency=50    # more parallel
 *   npx tsx scripts/generate-thumbnails-fast.ts --limit=10000       # page limit
 *   npx tsx scripts/generate-thumbnails-fast.ts --book-id=abc123    # single book
 *   npx tsx scripts/generate-thumbnails-fast.ts --split-only       # regenerate split page thumbnails
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { storagePut } from '../../src/lib/storage';

const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '20', 10);
const PAGE_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];
const SPLIT_ONLY = process.argv.includes('--split-only');

const MONGODB_URI = process.env.MONGODB_URI;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!BLOB_TOKEN) { console.error('Missing BLOB_READ_WRITE_TOKEN'); process.exit(1); }

function getImageUrl(page: any): string | null {
  if (page.crop && page.cropped_photo) return page.cropped_photo;
  if (page.archived_photo && page.archived_photo.startsWith('https://')) return page.archived_photo;
  const url = page.photo_original || page.photo;
  return url || null;
}

async function generateThumbnail(page: any, db: any): Promise<boolean> {
  try {
    const imageUrl = getImageUrl(page);
    if (!imageUrl || imageUrl.startsWith('/')) return false; // skip local paths

    // Fetch source image
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let buffer = Buffer.from(await res.arrayBuffer());

    // Apply crop if needed
    if (page.crop && !page.cropped_photo) {
      const metadata = await sharp(buffer).metadata();
      const w = metadata.width || 1000;
      const h = metadata.height || 1000;
      const left = Math.round((page.crop.xStart / 1000) * w);
      const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * w);
      buffer = await sharp(buffer)
        .extract({ left, top: 0, width: Math.min(cropWidth, w - left), height: h })
        .toBuffer();
    }

    // Resize to 150px JPEG thumbnail
    const thumbBuffer = await sharp(buffer)
      .resize(150, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60, progressive: true })
      .toBuffer();

    // Upload to Vercel Blob with retry for rate limits
    let blob;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        blob = await storagePut(
          `thumbnails/${page.book_id}/${page.page_number}.jpg`,
          thumbBuffer,
          { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true }
        );
        break;
      } catch (blobErr: any) {
        if (blobErr.message?.includes('Too many requests') && attempt < 2) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
        throw blobErr;
      }
    }

    // Update MongoDB
    await db.collection('pages').updateOne(
      { _id: page._id },
      { $set: { thumbnail_blob: blob!.url, updated_at: new Date() } }
    );

    return true;
  } catch (err: any) {
    const msg = err.message || '';
    // Don't permanently mark rate limit errors — they'll succeed on retry
    if (msg.includes('Too many requests')) {
      process.stderr.write(`  [RATE] page ${page.book_id}/${page.page_number}\n`);
      return false;
    }
    // Mark other failures as permanent
    await db.collection('pages').updateOne(
      { _id: page._id },
      { $set: { thumbnail_blob: `failed:${msg.slice(0, 50)}` } }
    ).catch(() => {});
    process.stderr.write(`  [FAIL] page ${page.book_id}/${page.page_number}: ${msg}\n`);
    return false;
  }
}

async function runPool(pages: any[], db: any) {
  let idx = 0;
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= pages.length) break;
      const ok = await generateThumbnail(pages[i], db);
      if (ok) success++; else failed++;

      // Progress every 100 pages
      const done = success + failed;
      if (done % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = done / elapsed;
        const remaining = (pages.length - done) / rate;
        process.stdout.write(
          `  ${done}/${pages.length} (${success} ok, ${failed} fail) — ` +
          `${rate.toFixed(1)} pages/sec, ~${Math.ceil(remaining / 60)} min remaining\n`
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker());
  await Promise.all(workers);

  return { success, failed };
}

async function main() {
  const archivedOnly = !process.argv.includes('--include-remote');
  console.log(`Thumbnail generator — concurrency: ${CONCURRENCY}, limit: ${PAGE_LIMIT || 'all'}, archived only: ${archivedOnly}, split only: ${SPLIT_ONLY}`);

  const client = new MongoClient(MONGODB_URI!, { maxPoolSize: 5, serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  // --split-only: regenerate thumbnail_blob for split pages that have wrong (unsplit) thumbnails
  // Normal mode: generate thumbnail_blob for pages that don't have one yet
  const ARCHIVED_ONLY = !process.argv.includes('--include-remote');
  const query: any = SPLIT_ONLY
    ? {
        crop: { $exists: true },
        cropped_photo: { $regex: /^https:\/\// },
        thumbnail_blob: { $regex: /^https:\/\// },
      }
    : {
        thumbnail_blob: { $exists: false },
        photo: { $exists: true, $nin: [null, ''] },
      };
  if (!SPLIT_ONLY && ARCHIVED_ONLY) {
    query.archived_photo = { $regex: /^https:\/\// };
  }
  if (BOOK_ID) query.book_id = BOOK_ID;

  if (!SPLIT_ONLY) {
    const totalNeeding = await db.collection('pages').countDocuments(query);
    console.log(`Pages needing thumbnails: ${totalNeeding}`);
  } else {
    console.log('Split-only mode — skipping count, processing in chunks...');
  }

  const CHUNK_SIZE = 5000;
  let totalSuccess = 0;
  let totalFailed = 0;
  let processed = 0;
  const startTime = Date.now();

  if (SPLIT_ONLY) {
    // In split-only mode, the query matches pages even after regeneration
    // (thumbnail_blob still exists), so paginate by _id to avoid loading all into memory
    let lastId: any = null;
    while (true) {
      const chunkQuery = lastId ? { ...query, _id: { $gt: lastId } } : query;
      const pages = await db.collection('pages')
        .find(chunkQuery, {
          projection: {
            _id: 1, book_id: 1, page_number: 1,
            photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
          }
        })
        .sort({ _id: 1 })
        .limit(CHUNK_SIZE)
        .toArray();

      if (pages.length === 0) break;
      lastId = pages[pages.length - 1]._id;

      console.log(`\nChunk: ${pages.length} pages (${processed} done so far)`);
      const { success, failed } = await runPool(pages, db);
      totalSuccess += success;
      totalFailed += failed;
      processed += pages.length;

      if (PAGE_LIMIT > 0 && processed >= PAGE_LIMIT) break;
    }
  } else {
    while (true) {
      // Re-query each chunk to skip pages completed by other workers
      const pages = await db.collection('pages')
        .find(query, {
          projection: {
            _id: 1, book_id: 1, page_number: 1,
            photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
          }
        })
        .sort({ book_id: 1, page_number: 1 })
        .limit(CHUNK_SIZE)
        .toArray();

      if (pages.length === 0) break;

      console.log(`\nChunk: ${pages.length} pages (${processed} done so far)`);
      const { success, failed } = await runPool(pages, db);
      totalSuccess += success;
      totalFailed += failed;
      processed += pages.length;

      if (PAGE_LIMIT > 0 && processed >= PAGE_LIMIT) break;
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone in ${elapsed.toFixed(0)}s — ${totalSuccess} generated, ${totalFailed} failed, ${(totalSuccess / elapsed).toFixed(1)} pages/sec`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
