#!/usr/bin/env node
/**
 * Local Harvard MPS archive worker (runs on Mac, not Hetzner)
 *
 * Harvard's MPS (mps.lib.harvard.edu) returns HTTP 429 for every request
 * from Hetzner IPs (verified 2026-05-25: both IPv4 and IPv6 addresses
 * blocked at the AWS ELB layer regardless of User-Agent, URL variant, or
 * pacing). Same pattern as archive-erara/gallica.
 *
 * Downloads IIIF pages at the bounded 2000px-wide variant already stored
 * in pages.photo (NOT /full/full/ — Harvard rate-limits the full-res
 * endpoint more aggressively even from non-Hetzner IPs), uploads to R2,
 * updates MongoDB.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-harvard.mjs
 *   node scripts/workers/archive-harvard.mjs --limit=500 --concurrency=2 --dry-run
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { fetchWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '2000', 10);
// Process workers are CPU+R2-upload bound; download workers are Harvard-rate-limit bound.
// Decoupling them keeps the Harvard token bucket fully utilised while sharp+R2 happens in parallel.
const PROCESS_CONCURRENCY = parseInt(getArg('concurrency') || '6', 10);
const DOWNLOAD_CONCURRENCY = parseInt(getArg('download-concurrency') || '3', 10);
const QUEUE_MAX = parseInt(getArg('queue-size') || '50', 10);
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

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

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

// Stall timeout, not a total-duration cap (#3477): the old 60s-from-start abort
// selected for the largest page in a book — the foldout, the map, the plate.
// The old 60s becomes the stall window; the lib's 15-min maxMs is the backstop.
const FETCH_STALL_MS = parseInt(process.env.ARCHIVE_STALL_TIMEOUT_MS || '60000', 10);

async function downloadImage(url, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { res, buffer } = await fetchWithStallTimeout(url, {
        stallMs: FETCH_STALL_MS,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.status === 429) {
        const backoff = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s, 40s
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        throw new Error(`HTTP 429 after ${maxRetries + 1} attempts`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return buffer;
    } catch (err) {
      if (attempt === maxRetries || !err.message?.includes('429')) throw err;
    }
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-harvard] Local Harvard archiver — ${PAGE_LIMIT} pages max, ${DOWNLOAD_CONCURRENCY}d/${PROCESS_CONCURRENCY}p workers, ${RATE_PER_SEC} req/s, queue ${QUEUE_MAX}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(control)) {
    console.log(`[archive-harvard] Pipeline paused. Exiting.`);
    await client.close();
    return;
  }
  // Selective unpause: confine to scoped books while globally paused (free
  // archiving must honor the same scope as the paid path, #2616). Empty in
  // normal operation.
  let SCOPE_FILTER = {};
  if (control?.paused && hasScope(control)) {
    const scopeIds = [...await resolveScopeBookIds(db, control)];
    SCOPE_FILTER = { id: { $in: scopeIds } };
    console.log(`[archive-harvard] PAUSED globally, scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  // Find Harvard books with unarchived pages. Books with pages_archived < pages_count
  // are the ones we still owe work; the $expr lets us skip already-complete books cheaply.
  const harvardBooks = await db.collection('books')
    .find({
      'image_source.provider': 'harvard',
      pages_count: { $gt: 0 },
      $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] },
      'archive_metadata.blocked': { $ne: true },
      ...SCOPE_FILTER,
    }, { projection: { id: 1, title: 1, pages_count: 1, pages_archived: 1 } })
    .limit(1000)
    .maxTimeMS(30_000)
    .toArray();

  // Collect unarchived pages with Harvard URLs (pages_book_pagenum_idx makes the per-book lookup fast)
  const allPages = [];
  for (const book of harvardBooks) {
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
        // Skip pages permanently blocked at 3 strikes (broken photo URLs)
        $and: [{
          $or: [
            { 'archive_metadata.failure_count': { $exists: false } },
            { 'archive_metadata.failure_count': { $lt: 3 } },
          ],
        }],
      }, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } })
      .limit(remaining)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);

    // Only keep pages that are actually Harvard MPS
    const harvardPages = bookPages.filter(p => p.photo?.includes('mps.lib.harvard.edu'));
    if (harvardPages.length > 0) {
      allPages.push(...harvardPages);
    }
  }

  console.log(`[archive-harvard] Found ${allPages.length} unarchived Harvard pages across ${new Set(allPages.map(p => p.book_id)).size} books`);

  if (allPages.length === 0 || DRY_RUN) {
    if (DRY_RUN && allPages.length > 0) {
      const byBook = {};
      for (const p of allPages) byBook[p.book_id] = (byBook[p.book_id] || 0) + 1;
      console.log(`  Sample: ${Object.entries(byBook).slice(0, 5).map(([b, n]) => `${b}:${n}p`).join(', ')}`);
    }
    await client.close();
    return;
  }

  // Two-stage pipeline: download workers fill a bounded queue; process workers
  // drain it. Download is gated by the Harvard token bucket (~1 req/s);
  // processing (sharp resize + R2 upload + Mongo) is CPU/network bound and
  // runs unrestricted in parallel. Decoupling them keeps the Harvard bucket
  // continuously full instead of one-page-at-a-time waiting on local upload.
  let dlIdx = 0;
  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let consecutiveFails = 0;
  let downloadFailures = 0;
  const queue = [];                         // [{ page, buffer }, ...]
  const touchedBookIds = new Set();
  let allDownloadsDone = false;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function downloadWorker() {
    while (dlIdx < allPages.length) {
      if (consecutiveFails >= 20) {
        console.log(`  [CIRCUIT BREAKER] 20 consecutive download failures — Harvard may be blocking. Stopping downloads.`);
        break;
      }
      // Backpressure: if process workers are behind, slow down downloads so
      // queue doesn't grow unbounded.
      while (queue.length >= QUEUE_MAX) await sleep(100);

      const i = dlIdx++;
      if (i >= allPages.length) break;
      const page = allPages[i];

      await waitForToken();
      const url = page.photo; // already at /full/2000,/; no upgrade

      try {
        const buffer = await downloadImage(url);
        queue.push({ page, buffer, url });
        totalBytes += buffer.byteLength;
        consecutiveFails = 0;
      } catch (err) {
        downloadFailures++;
        consecutiveFails++;
        if (downloadFailures <= 5) console.log(`  DL-FAIL ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 80)}`);
        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              'archive_metadata.last_failure_at': new Date(),
              'archive_metadata.last_failure_reason': String(err.message || err).slice(0, 200),
              'archive_metadata.last_failure_source_url': url,
            },
            $inc: { 'archive_metadata.failure_count': 1 },
          }
        ).catch(() => {});
      }
    }
  }

  async function processWorker() {
    while (true) {
      if (queue.length === 0) {
        if (allDownloadsDone) break;
        await sleep(100);
        continue;
      }
      const item = queue.shift();
      if (!item) continue;
      const { page, buffer, url } = item;

      try {
        // Archive-only: upload the full-res original to R2 and write archived_photo.
        // display_photo and thumbnail_blob are intentionally NOT written here — the
        // Hetzner-side display-backfill cron (scripts/migration/backfill-display-images.mjs,
        // runs every 30 min) detects pages with archived_photo set and no display_photo,
        // and generates the 1200px + 150px variants from R2. Skipping the variants here
        // cuts each page's R2 upload bytes ~3× (full only, no display+thumb), which on
        // residential upstream is the dominant cost.
        const archivedKey = `archived/${page.book_id}/${page.page_number}.jpg`;
        const [archivedUrl, meta] = await Promise.all([
          uploadToR2(archivedKey, buffer, 'image/jpeg'),
          sharp(buffer).metadata().catch(() => ({})),
        ]);

        const dimFields = {};
        if (meta.width) dimFields.image_width = meta.width;
        if (meta.height) dimFields.image_height = meta.height;

        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              archived_photo: archivedUrl,
              ...dimFields,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source_url': url,
              'archive_metadata.bytes': buffer.byteLength,
              updated_at: new Date(),
            },
            $unset: {
              'archive_metadata.failure_count': '',
              'archive_metadata.last_failure_at': '',
              'archive_metadata.last_failure_reason': '',
              'archive_metadata.last_failure_source_url': '',
            },
          }
        );

        archived++;
        touchedBookIds.add(page.book_id);
      } catch (err) {
        failed++;
        if (failed <= 5) console.log(`  PROC-FAIL ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 80)}`);
      }

      const total = archived + failed;
      if (total % 50 === 0 && total > 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        const rate = (archived / ((Date.now() - start) / 1000)).toFixed(2);
        console.log(`  ${total}/${allPages.length} processed, ${archived} archived (${mb} MB), ${failed + downloadFailures} failed, queue=${queue.length} (${elapsed}s, ${rate}/s)`);
      }
    }
  }

  // Run downloads and processing in parallel pools. Downloads finish first
  // (gated by Harvard rate); processing winds down draining the queue.
  const downloadPool = Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, () => downloadWorker()))
    .then(() => { allDownloadsDone = true; });
  const processPool = Promise.all(Array.from({ length: PROCESS_CONCURRENCY }, () => processWorker()));
  await Promise.all([downloadPool, processPool]);
  failed += downloadFailures;

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[archive-harvard] Done in ${duration}s: ${archived} archived (${mb} MB), ${failed} failed`);

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
    console.log(`[archive-harvard] Synced pages_archived on ${synced} books`);
  }

  // Log run for monitoring
  await db.collection('cron_runs').insertOne({
    cron: 'archive-harvard',
    source: 'local-mac',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, pages_found: allPages.length },
  });

  await client.close();
}

main().catch(err => { console.error('[archive-harvard] Fatal:', err); process.exit(1); });
