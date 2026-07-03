#!/usr/bin/env node
/**
 * Local IIIF archive worker (runs on Mac, not Hetzner)
 *
 * Books from generic IIIF providers (uni-goettingen, staatsbibliothek-berlin,
 * e-codices.unifr.ch, …) pile up at pipeline_auto.status:'archiving' because
 * their page-image hosts match none of the archivable-host regexes used by the
 * Hetzner orchestrator and the /api/books/[id]/archive-images route. Those hosts
 * are NOT IP-blocked — they just aren't enumerated — so nothing ever fetches
 * their remaining pages and the books stall indefinitely (~2,300 books, found
 * 2026-06-16). See memory: lesson_archiving_provider_routing_gaps.
 *
 * Unlike archive-gallica.mjs this does NOT filter pages by host — it archives
 * whatever `photo` URL the page carries. It also advances pipeline_auto.status
 * to 'archive_complete' once a book is fully archived, so OCR can pick it up.
 *
 * Safe to run repeatedly; idempotent (skips pages that already have
 * archived_photo). Mac-only by intent — do NOT cron on Hetzner.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-iiif-local.mjs --dry-run
 *   ... node scripts/workers/archive-iiif-local.mjs --limit=3000 --concurrency=4 --rate=3
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '3000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '4', 10);
const RATE_PER_SEC = parseFloat(getArg('rate') || '3');
const PROVIDERS = (getArg('providers') || 'iiif,e-codices').split(',');
const MAX_FAILS = parseInt(getArg('max-fails') || '25', 10);     // circuit-breaker threshold
const TIMEOUT_MS = parseInt(getArg('timeout') || '60', 10) * 1000; // per-download timeout
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

// Token-bucket rate limiter (global across workers)
let tokens = RATE_PER_SEC;
let lastRefill = Date.now();
async function waitForToken() {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(RATE_PER_SEC, tokens + ((now - lastRefill) / 1000) * RATE_PER_SEC);
    lastRefill = now;
    if (tokens >= 1) { tokens -= 1; return; }
    await new Promise(r => setTimeout(r, Math.ceil((1 - tokens) / RATE_PER_SEC * 1000)));
  }
}

async function downloadImage(url, maxRetries = 3) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 4000 * Math.pow(2, attempt))); continue; }
        throw new Error(`HTTP ${res.status} after ${maxRetries + 1} attempts`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      clearTimeout(timeout);
      const transient = err.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(err.message || '');
      if (attempt < maxRetries && transient) { await new Promise(r => setTimeout(r, 4000 * Math.pow(2, attempt))); continue; }
      throw err;
    }
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-iiif] providers=${PROVIDERS.join(',')} | ${PAGE_LIMIT} pages max, ${CONCURRENCY} workers, ${RATE_PER_SEC} req/s, breaker=${MAX_FAILS}, timeout=${TIMEOUT_MS / 1000}s${DRY_RUN ? ' | DRY RUN' : ''}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 8, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Archiving to R2 is free (no Gemini spend). The global pause guards paid
  // OCR/translation — pass --ignore-pause to archive while OCR stays paused.
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused && !hasFlag('ignore-pause')) {
    console.log('[archive-iiif] Pipeline paused (free archiving allowed via --ignore-pause). Exiting.');
    await client.close(); return;
  }

  const books = await db.collection('books')
    .find({
      'pipeline_auto.status': 'archiving',
      'image_source.provider': { $in: PROVIDERS },
      pages_count: { $gt: 0 },
    }, { projection: { id: 1, title: 1, pages_count: 1, pages_archived: 1 } })
    .sort({ pages_archived: -1 })   // finish nearly-done books first → status advances sooner
    .limit(4000)
    .maxTimeMS(30_000)
    .toArray();

  const allPages = [];
  for (const book of books) {
    if (allPages.length >= PAGE_LIMIT) break;
    const remaining = PAGE_LIMIT - allPages.length;
    const bookPages = await db.collection('pages')
      .find({
        book_id: book.id,
        photo: { $exists: true, $nin: [null, ''] },
        $or: [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }],
      }, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1 } })
      .limit(remaining)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);
    if (bookPages.length) allPages.push(...bookPages);
  }

  const bookSet = new Set(allPages.map(p => p.book_id));
  console.log(`[archive-iiif] ${allPages.length} unarchived pages across ${bookSet.size} books`);
  if (allPages.length === 0 || DRY_RUN) { await client.close(); return; }

  let idx = 0, archived = 0, failed = 0, totalBytes = 0, consecutiveFails = 0;
  const touchedBookIds = new Set();
  const BOOK_404_THRESHOLD = 5;
  const bookFails = new Map();
  const skippedBooks = new Set();

  async function worker() {
    while (idx < allPages.length) {
      if (consecutiveFails >= MAX_FAILS) { console.log(`  [CIRCUIT BREAKER] ${MAX_FAILS} consecutive failures — stopping.`); break; }
      const i = idx++;
      if (i >= allPages.length) break;
      const page = allPages[i];
      if (skippedBooks.has(page.book_id)) continue;

      await waitForToken();
      const url = page.photo_original || page.photo;
      try {
        const buffer = await downloadImage(url);
        const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);
        const dimFields = {};
        if (urls.width) dimFields.image_width = urls.width;
        if (urls.height) dimFields.image_height = urls.height;
        await db.collection('pages').updateOne({ _id: page._id }, {
          $set: {
            archived_photo: urls.archived, display_photo: urls.display, thumbnail_blob: urls.thumb,
            ...dimFields,
            'archive_metadata.archived_at': new Date(),
            'archive_metadata.source_url': url,
            'archive_metadata.bytes': buffer.byteLength,
            updated_at: new Date(),
          },
        });
        archived++; totalBytes += buffer.byteLength; touchedBookIds.add(page.book_id);
        consecutiveFails = 0; bookFails.delete(page.book_id);
      } catch (err) {
        failed++; consecutiveFails++;
        if (failed <= 8) console.log(`  FAIL ${page.book_id}/${page.page_number}: ${(err.message || '').slice(0, 80)}`);
        if ((err.message || '').includes('HTTP 404')) {
          const n = (bookFails.get(page.book_id) || 0) + 1;
          bookFails.set(page.book_id, n);
          if (n >= BOOK_404_THRESHOLD && !skippedBooks.has(page.book_id)) {
            skippedBooks.add(page.book_id);
            const res = await db.collection('pages').updateMany(
              { book_id: page.book_id, $or: [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }] },
              { $set: { archived_photo: 'failed:source-not-found (5+ consecutive 404s)', updated_at: new Date() } }
            );
            console.log(`  [BOOK-SKIP] ${page.book_id}: marked ${res.modifiedCount} pages source-not-found`);
          }
        }
      }
      const total = archived + failed;
      if (total % 100 === 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (archived / ((Date.now() - start) / 1000)).toFixed(2);
        console.log(`  ${total}/${allPages.length} processed, ${archived} archived (${(totalBytes / 1048576).toFixed(0)} MB), ${failed} failed (${elapsed}s, ${rate}/s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Sync pages_archived and advance fully-archived books to archive_complete.
  let synced = 0, advanced = 0;
  for (const bookId of touchedBookIds) {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { pages_count: 1 } });
    const archivedCount = await db.collection('pages').countDocuments(
      { book_id: bookId, archived_photo: { $exists: true, $nin: [null, ''] }, $expr: { $not: { $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: '^failed:' } } } },
      { maxTimeMS: 10000 }
    ).catch(() => -1);
    if (archivedCount < 0) continue;
    const set = { pages_archived: archivedCount, updated_at: new Date() };
    // Count non-failed pages remaining: a book is "done" when no page still lacks a real archived_photo.
    const remaining = await db.collection('pages').countDocuments({
      book_id: bookId,
      $or: [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }],
    }).catch(() => -1);
    if (remaining === 0 && book?.pages_count > 0) {
      set['pipeline_auto.status'] = 'archive_complete';
      set['pipeline_auto.last_updated'] = new Date();
      advanced++;
    }
    await db.collection('books').updateOne({ id: bookId }, { $set: set });
    synced++;
  }
  console.log(`[archive-iiif] synced ${synced} books, advanced ${advanced} to archive_complete`);

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[archive-iiif] Done in ${duration}s: ${archived} archived (${(totalBytes / 1048576).toFixed(0)} MB), ${failed} failed`);

  await db.collection('cron_runs').insertOne({
    cron: 'archive-iiif-local', source: 'local-mac',
    started_at: new Date(start), finished_at: new Date(), duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, pages_found: allPages.length, books_advanced: advanced },
  }).catch(() => {});

  await client.close();
}

main().catch(err => { console.error('[archive-iiif] Fatal:', err); process.exit(1); });
