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
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { fetchWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';
import { upgradeToFullRes, fetchPageMaster, dimensionFields } from '../lib/iiif-utils.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '2000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '2', 10);
const RATE_PER_SEC = parseFloat(getArg('rate') || '1');
const DRY_RUN = hasFlag('dry-run');
// Abort only when a connection goes QUIET for this long — never merely because
// a file is big. Raising this does not slow healthy fetches; it only widens the
// window a genuinely stalled socket gets before we give up on it.
const FETCH_STALL_MS = parseInt(getArg('stall-timeout') || '60000', 10);

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

// upgradeToFullRes is imported from ../lib/iiif-utils.mjs, not redefined here.
// A private copy lived at this spot and was gallica-only (`url.includes('gallica')`),
// so it silently no-op'd on every other host this worker touches — and, more to the
// point, it is the shared version that knows about size caps. A local duplicate of a
// shared helper is how a fix lands in one place and not the other (#4406).

async function downloadImage(url, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Stall timeout, not a total-duration cap: a 21 MB double-page plate is
      // slow because it is large, not because the connection is broken. The
      // old 60s wall-clock abort failed 42 of this book's 45 engravings while
      // every 6 MB text page succeeded. See scripts/lib/fetch-stall-timeout.mjs.
      const { res, buffer } = await fetchWithStallTimeout(url, {
        stallMs: FETCH_STALL_MS,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.status === 429) {
        // Exponential backoff: 5s, 10s, 20s, 40s
        const backoff = 5000 * Math.pow(2, attempt);
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
  console.log(`[archive-gallica] Local Gallica archiver — ${PAGE_LIMIT} pages max, ${CONCURRENCY} workers, ${RATE_PER_SEC} req/s`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(control)) {
    console.log(`[archive-gallica] Pipeline paused. Exiting.`);
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
    console.log(`[archive-gallica] PAUSED globally, scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  // Find Gallica books with unarchived pages
  const gallicaBooks = await db.collection('books')
    .find({
      'image_source.provider': { $in: ['gallica', 'iiif'] },
      pages_count: { $gt: 0 },
      ...SCOPE_FILTER,
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

  // Per-book 404 counters. When a book hits BOOK_404_THRESHOLD consecutive
  // 404s we assume the source has fewer pages than our DB stub claims
  // (Mutus Liber case: 100 pages in DB, 45 on gallica), bulk-mark the
  // remaining pages as failed:source-not-found, and skip past them.
  // Without this a single bad book exhausts the global circuit breaker
  // and halts ALL gallica archiving.
  const BOOK_404_THRESHOLD = 5;
  const bookFails = new Map();          // book_id -> consecutive 404 count
  const skippedBooks = new Set();       // book_id -> already bulk-failed

  async function worker() {
    while (idx < allPages.length) {
      if (consecutiveFails >= 20) {
        console.log(`  [CIRCUIT BREAKER] 20 cross-book consecutive failures — Gallica may be blocking. Stopping.`);
        break;
      }

      const i = idx++;
      if (i >= allPages.length) break;
      const page = allPages[i];

      // Skip pages from books we've already determined are over-stubbed
      if (skippedBooks.has(page.book_id)) continue;

      await waitForToken();

      const originalUrl = page.photo;
      const fullResUrl = upgradeToFullRes(originalUrl);

      try {
        // fetchPageMaster owns only the cap-defeating route; this worker keeps its
        // own retry + full-res-then-original fallback, passed through as `download`
        // (#4406). It also records what the source said was available, so "did we
        // get the master?" stops needing a second trip to the institution.
        const download = async (u) => {
          try {
            return await downloadImage(u);
          } catch (err) {
            if (u !== originalUrl) return await downloadImage(originalUrl);
            throw err;
          }
        };
        const master = await fetchPageMaster(fullResUrl, { download });
        const buffer = master.buffer;

        const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);

        const dimFields = dimensionFields({ width: urls.width, height: urls.height }, master);

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
        bookFails.delete(page.book_id); // reset per-book on success
      } catch (err) {
        failed++;
        consecutiveFails++;
        if (failed <= 5) console.log(`  FAIL page ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 80)}`);

        // Only count 404s toward the per-book bad-stub threshold. Transient
        // errors (5xx, network, timeout) shouldn't permanently mark pages.
        if (err.message?.includes('HTTP 404')) {
          const n = (bookFails.get(page.book_id) || 0) + 1;
          bookFails.set(page.book_id, n);
          if (n >= BOOK_404_THRESHOLD && !skippedBooks.has(page.book_id)) {
            skippedBooks.add(page.book_id);
            const skipReason = `failed:source-not-found (${BOOK_404_THRESHOLD}+ consecutive 404s — gallica has fewer pages than DB stub)`;
            const res = await db.collection('pages').updateMany(
              { book_id: page.book_id, archived_photo: { $exists: false } },
              { $set: { archived_photo: skipReason, updated_at: new Date() } }
            );
            console.log(`  [BOOK-SKIP] ${page.book_id}: marked ${res.modifiedCount} pages source-not-found`);
          }
        }
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
