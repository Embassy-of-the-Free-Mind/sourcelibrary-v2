#!/usr/bin/env node
/**
 * Local Gallica archive worker (runs on Mac, not Hetzner)
 *
 * Gallica rate-limits Hetzner IPs (429 on every request). This worker runs
 * locally from a residential IP, same pattern as archive-erara.mjs.
 *
 * Downloads IIIF pages at full resolution, uploads to R2, updates MongoDB.
 * Rate: 1 req/s to be polite (Gallica has no published crawl-delay but is aggressive).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-gallica.mjs
 *   node scripts/workers/archive-gallica.mjs --limit=500 --concurrency=2 --dry-run
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '2000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '2', 10);
const RATE_PER_SEC = parseFloat(getArg('rate') || '1');
const DRY_RUN = hasFlag('dry-run');

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Token bucket rate limiter
let tokens = RATE_PER_SEC;
let lastRefill = Date.now();

async function waitForToken() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  tokens = Math.min(RATE_PER_SEC, tokens + elapsed * RATE_PER_SEC);
  lastRefill = now;

  if (tokens < 1) {
    const waitMs = ((1 - tokens) / RATE_PER_SEC) * 1000;
    await new Promise(r => setTimeout(r, waitMs));
    tokens = 0;
    lastRefill = Date.now();
  } else {
    tokens -= 1;
  }
}

function upgradeToFullRes(url) {
  if (url.includes('gallica') && url.match(/\/full\/\d+,?\d*\//)) {
    return url.replace(/\/full\/\d+,?\d*\//, '/full/full/');
  }
  return url;
}

async function downloadImage(url, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.status === 429) {
        clearTimeout(timeout);
        // Exponential backoff: 5s, 10s, 20s, 40s
        const backoff = 5000 * Math.pow(2, attempt);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        throw new Error(`HTTP 429 after ${maxRetries + 1} attempts`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return buffer;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries || !err.message?.includes('429')) throw err;
    }
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-gallica] Local Gallica archiver — ${PAGE_LIMIT} pages max, ${CONCURRENCY} workers, ${RATE_PER_SEC} req/s`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log(`[archive-gallica] Pipeline paused. Exiting.`);
    await client.close();
    return;
  }

  // Find Gallica books with unarchived pages
  const gallicaBooks = await db.collection('books')
    .find({
      'image_source.provider': { $in: ['gallica', 'iiif'] },
      pages_count: { $gt: 0 },
    }, { projection: { id: 1, title: 1, pages_count: 1, pages_archived: 1 } })
    .limit(1000)
    .maxTimeMS(30_000)
    .toArray();

  // Collect unarchived pages with Gallica URLs
  const allPages = [];
  for (const book of gallicaBooks) {
    if (allPages.length >= PAGE_LIMIT) break;
    const remaining = PAGE_LIMIT - allPages.length;
    const bookPages = await db.collection('pages')
      .find({
        book_id: book.id,
        photo: { $exists: true, $nin: [null, ''] },
        $or: [
          { archived_photo: { $exists: false } },
          { archived_photo: null },
          { archived_photo: '' },
        ],
      }, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } })
      .limit(remaining)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);

    // Only keep pages that are actually Gallica
    const gallicaPages = bookPages.filter(p => p.photo?.includes('gallica.bnf.fr'));
    if (gallicaPages.length > 0) {
      allPages.push(...gallicaPages);
    }
  }

  console.log(`[archive-gallica] Found ${allPages.length} unarchived Gallica pages`);

  if (allPages.length === 0 || DRY_RUN) {
    if (DRY_RUN && allPages.length > 0) {
      // Show book breakdown
      const byBook = {};
      for (const p of allPages) {
        byBook[p.book_id] = (byBook[p.book_id] || 0) + 1;
      }
      console.log(`  Across ${Object.keys(byBook).length} books`);
    }
    await client.close();
    return;
  }

  // Process pages
  let idx = 0;
  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let consecutiveFails = 0;
  const touchedBookIds = new Set();

  async function worker() {
    while (idx < allPages.length) {
      if (consecutiveFails >= 20) {
        console.log(`  [CIRCUIT BREAKER] 20 consecutive failures — Gallica may be blocking. Stopping.`);
        break;
      }

      const i = idx++;
      if (i >= allPages.length) break;
      const page = allPages[i];

      await waitForToken();

      const originalUrl = page.photo;
      const fullResUrl = upgradeToFullRes(originalUrl);

      try {
        let buffer;
        try {
          buffer = await downloadImage(fullResUrl);
        } catch (err) {
          if (fullResUrl !== originalUrl) {
            buffer = await downloadImage(originalUrl);
          } else {
            throw err;
          }
        }

        const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);

        const dimFields = {};
        if (urls.width) dimFields.image_width = urls.width;
        if (urls.height) dimFields.image_height = urls.height;

        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              archived_photo: urls.archived,
              display_photo: urls.display,
              thumbnail_blob: urls.thumb,
              ...dimFields,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source_url': fullResUrl,
              'archive_metadata.original_url': originalUrl,
              'archive_metadata.full_res': fullResUrl !== originalUrl,
              'archive_metadata.bytes': buffer.byteLength,
              updated_at: new Date(),
            }
          }
        );

        archived++;
        totalBytes += buffer.byteLength;
        touchedBookIds.add(page.book_id);
        consecutiveFails = 0;
      } catch (err) {
        failed++;
        consecutiveFails++;
        if (failed <= 5) console.log(`  FAIL page ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 80)}`);
      }

      const total = archived + failed;
      if (total % 50 === 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        const rate = (archived / ((Date.now() - start) / 1000)).toFixed(2);
        console.log(`  ${total}/${allPages.length} processed, ${archived} archived (${mb} MB), ${failed} failed (${elapsed}s, ${rate}/s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[archive-gallica] Done in ${duration}s: ${archived} archived (${mb} MB), ${failed} failed`);

  // Sync pages_archived on touched books
  if (touchedBookIds.size > 0) {
    let synced = 0;
    for (const bookId of touchedBookIds) {
      const archivedCount = await db.collection('pages').countDocuments(
        { book_id: bookId, archived_photo: { $exists: true, $nin: [null, ''] } },
        { maxTimeMS: 10000 }
      ).catch(() => -1);
      if (archivedCount >= 0) {
        await db.collection('books').updateOne(
          { id: bookId },
          { $set: { pages_archived: archivedCount, updated_at: new Date() } }
        );
        synced++;
      }
    }
    console.log(`[archive-gallica] Synced pages_archived on ${synced} books`);
  }

  // Log run
  await db.collection('cron_runs').insertOne({
    cron: 'archive-gallica',
    source: 'local-mac',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, pages_found: allPages.length },
  });

  await client.close();
}

main().catch(err => { console.error('[archive-gallica] Fatal:', err); process.exit(1); });
