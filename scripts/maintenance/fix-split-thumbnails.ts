#!/usr/bin/env npx tsx
/**
 * Fix duplicate thumbnails on split-page books.
 *
 * The archive-images-fast.ts script generated thumbnails from the original
 * spread image instead of the cropped version, causing both halves of every
 * split to show identical thumbnails.
 *
 * This script finds all affected pages and regenerates thumbnails from
 * the correct cropped_photo source.
 *
 * See: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/55
 *
 * Usage:
 *   npx tsx scripts/maintenance/fix-split-thumbnails.ts                  # all affected
 *   npx tsx scripts/maintenance/fix-split-thumbnails.ts --dry-run        # count only
 *   npx tsx scripts/maintenance/fix-split-thumbnails.ts --limit=1000     # page limit
 *   npx tsx scripts/maintenance/fix-split-thumbnails.ts --book-id=abc    # single book
 *   npx tsx scripts/maintenance/fix-split-thumbnails.ts --concurrency=30 # parallel workers
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { put } from '@vercel/blob';

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '20', 10);
const PAGE_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];

const MONGODB_URI = process.env.MONGODB_URI;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!BLOB_TOKEN) { console.error('Missing BLOB_READ_WRITE_TOKEN'); process.exit(1); }

async function fixThumbnail(page: any, db: any): Promise<boolean> {
  try {
    const res = await fetch(page.cropped_photo);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching cropped_photo`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const thumbBuffer = await sharp(buffer)
      .resize(150, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60, progressive: true })
      .toBuffer();

    let blob;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        blob = await put(
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

    await db.collection('pages').updateOne(
      { _id: page._id },
      { $set: { thumbnail_blob: blob!.url, updated_at: new Date() } }
    );

    return true;
  } catch (err: any) {
    process.stderr.write(`  [FAIL] ${page.book_id}/${page.page_number}: ${err.message}\n`);
    return false;
  }
}

async function main() {
  console.log(`Fix split thumbnails — concurrency: ${CONCURRENCY}, limit: ${PAGE_LIMIT || 'all'}, dry run: ${DRY_RUN}`);

  const client = new MongoClient(MONGODB_URI!, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find all split pages that have both cropped_photo and thumbnail_blob
  // These are the pages where the thumbnail was likely generated from the spread
  const query: any = {
    crop: { $exists: true },
    cropped_photo: { $regex: /^https:\/\// },
    thumbnail_blob: { $exists: true, $ne: null },
  };
  if (BOOK_ID) query.book_id = BOOK_ID;

  const totalAffected = await db.collection('pages').countDocuments(query);
  console.log(`Pages to fix: ${totalAffected}`);

  if (DRY_RUN) {
    // Show breakdown by book
    const bookBreakdown = await db.collection('pages').aggregate([
      { $match: query },
      { $group: { _id: '$book_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();
    console.log(`\nTop affected books:`);
    for (const b of bookBreakdown) {
      console.log(`  ${b._id}: ${b.count} pages`);
    }
    console.log(`\nTotal affected books: ${bookBreakdown.length}+`);
    await client.close();
    return;
  }

  let totalSuccess = 0;
  let totalFailed = 0;
  let processed = 0;
  const startTime = Date.now();

  // Fetch all affected page IDs upfront (just _id + fields needed for processing)
  const limit = PAGE_LIMIT > 0 ? PAGE_LIMIT : 0;
  const cursor = db.collection('pages')
    .find(query, {
      projection: {
        _id: 1, book_id: 1, page_number: 1,
        cropped_photo: 1, crop: 1, thumbnail_blob: 1,
      }
    })
    .sort({ book_id: 1, page_number: 1 });
  if (limit > 0) cursor.limit(limit);
  const allPages = await cursor.toArray();
  console.log(`Fetched ${allPages.length} pages to process`);

  // Process in chunks
  const CHUNK_SIZE = 5000;
  for (let chunkStart = 0; chunkStart < allPages.length; chunkStart += CHUNK_SIZE) {
    const pages = allPages.slice(chunkStart, chunkStart + CHUNK_SIZE);

    console.log(`\nChunk: ${pages.length} pages (${chunkStart} done so far)`);

    // Worker pool
    let idx = 0;
    let success = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= pages.length) break;
        const ok = await fixThumbnail(pages[i], db);
        if (ok) success++; else failed++;

        const done = success + failed;
        if (done % 200 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = (totalSuccess + totalFailed + done) / elapsed;
          const remaining = (totalAffected - totalSuccess - totalFailed - done) / rate;
          process.stdout.write(
            `  ${totalSuccess + totalFailed + done}/${totalAffected} ` +
            `(${totalSuccess + success} ok, ${totalFailed + failed} fail) — ` +
            `${rate.toFixed(1)} pages/sec, ~${Math.ceil(remaining / 60)} min remaining\n`
          );
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker());
    await Promise.all(workers);

    totalSuccess += success;
    totalFailed += failed;
    processed += pages.length;

    if (PAGE_LIMIT > 0 && processed >= PAGE_LIMIT) break;
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone in ${elapsed.toFixed(0)}s — ${totalSuccess} fixed, ${totalFailed} failed, ${(totalSuccess / elapsed).toFixed(1)} pages/sec`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
