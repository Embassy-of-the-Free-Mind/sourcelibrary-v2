#!/usr/bin/env node
/**
 * Backfill display (1200px) and thumbnail (150px) variants for pages
 * that already have archived_photo but no display_photo.
 *
 * Strategy: iterate books (small collection, indexed), then query pages
 * per book using the book_id index. Avoids collection-scanning the
 * 9.5M pages collection on unindexed fields.
 *
 * Downloads full-res from R2, generates variants, uploads back to R2.
 * R2 egress is free, so the only cost is CPU time + write ops.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-display-images.mjs
 *   node scripts/migration/backfill-display-images.mjs --limit=1000 --concurrency=8 --dry-run
 *   node scripts/migration/backfill-display-images.mjs --book=BOOK_ID
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '50000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '10', 10);
const BOOK_CONCURRENCY = parseInt(getArg('book-concurrency') || '3', 10);
const DRY_RUN = hasFlag('dry-run');
const BOOK_ID = getArg('book');  // Optional: backfill a single book
const START_AFTER = getArg('start-after');  // Start after this book id (for partitioning)

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function downloadFromR2(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

const stats = {
  processed: 0, succeeded: 0, failed: 0, skipped: 0,
  booksProcessed: 0, booksSkipped: 0,
  bytesUploaded: 0, startTime: Date.now(),
};

async function processPage(page, db) {
  try {
    if (!page.archived_photo?.startsWith('https://')) {
      stats.skipped++;
      return;
    }
    const fullResBuffer = await downloadFromR2(page.archived_photo);

    if (DRY_RUN) {
      stats.skipped++;
      return;
    }

    const { display, thumb } = await generateDisplayVariants(fullResBuffer);

    const num = String(page.page_number).padStart(4, '0');
    const displayKey = `pages/${page.book_id}/${num}.jpg`;
    const thumbKey = `pages/${page.book_id}/${num}-thumb.jpg`;

    const displayUrl = await uploadToR2(displayKey, display);
    const thumbUrl = await uploadToR2(thumbKey, thumb);

    stats.bytesUploaded += display.length + thumb.length;

    // Update Atlas (use id field which matches pages_images.id)
    const pageId = page.id || page._id;
    await db.collection('pages').updateOne(
      { $or: [{ id: pageId }, { _id: pageId }] },
      {
        $set: {
          display_photo: displayUrl,
          thumbnail_blob: thumbUrl,
          updated_at: new Date(),
        }
      }
    );

    // Track for Supabase bulk update (include all required columns for upsert)
    if (!stats._supabaseUpdates) stats._supabaseUpdates = [];
    stats._supabaseUpdates.push({
      id: pageId,
      book_id: page.book_id,
      page_number: page.page_number,
      archived_photo: page.archived_photo,
      display_photo: displayUrl,
      thumbnail_blob: thumbUrl,
    });

    stats.succeeded++;
  } catch (err) {
    stats.failed++;
    if (stats.failed <= 20) {
      console.error(`  FAIL page ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 100)}`);
    }
  }
}

async function processBook(book, db) {
  // Query pages per book — uses book_id index, fast. No sort needed for backfill.
  // Don't filter on display_photo (unindexed) — check in code instead
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id },
      { projection: { _id: 1, book_id: 1, page_number: 1, archived_photo: 1, display_photo: 1 } }
    )
    .batchSize(5000)
    .maxTimeMS(15_000)
    .toArray()
    .catch((err) => {
      if (stats.failed <= 5) console.error(`  [book ${book.id}] page query failed: ${err.message?.slice(0, 80)}`);
      return [];
    });

  // Filter in code: need archived_photo, no display_photo yet
  const needsBackfill = pages.filter(p =>
    p.archived_photo && !p.display_photo && p.archived_photo.startsWith('https://')
  );

  if (needsBackfill.length === 0) {
    stats.booksSkipped++;
    return 0;
  }

  // Process pages within this book with bounded concurrency
  let idx = 0;
  const pageConcurrency = Math.min(CONCURRENCY, needsBackfill.length);
  async function pageWorker() {
    while (idx < needsBackfill.length && stats.processed < LIMIT) {
      const i = idx++;
      if (i >= needsBackfill.length) break;
      await processPage(needsBackfill[i], db);
      stats.processed++;
    }
  }

  await Promise.all(Array.from({ length: pageConcurrency }, () => pageWorker()));
  stats.booksProcessed++;

  return needsBackfill.length;
}

function logProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = (stats.processed / elapsed).toFixed(1);
  const mb = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);
  console.log(`  ${stats.processed.toLocaleString()} pages (${stats.booksProcessed} books) — ${stats.succeeded} ok, ${stats.failed} fail — ${rate}/s — ${mb}MB uploaded`);
}

async function main() {
  console.log(`[backfill-display] Display image backfill — limit=${LIMIT}, concurrency=${CONCURRENCY}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db('bookstore');

  if (BOOK_ID) {
    // Single book mode
    const book = await db.collection('books').findOne(
      { $or: [{ id: BOOK_ID }, { _id: BOOK_ID }] },
      { projection: { id: 1, title: 1 } }
    );
    if (!book) { console.error(`Book not found: ${BOOK_ID}`); await client.close(); return; }
    console.log(`[backfill-display] Single book: ${book.title?.slice(0, 60)}`);
    await processBook(book, db);
  } else {
    // Query pages needing backfill directly from Supabase pages_images table.
    // One indexed query replaces thousands of per-book Atlas queries.
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_KEY) {
      console.error('[backfill-display] Missing SUPABASE_SERVICE_ROLE_KEY');
      process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

    console.log(`[backfill-display] Querying pages_images for pages needing display variants...`);
    const t = Date.now();
    // Supabase default limit is 1000 — paginate to get up to LIMIT
    const pages = [];
    let from = 0;
    while (pages.length < LIMIT) {
      const batchSize = Math.min(1000, LIMIT - pages.length);
      const { data, error: qErr } = await supabase
        .from('pages_images')
        .select('id,book_id,page_number,archived_photo')
        .not('archived_photo', 'is', null)
        .is('display_photo', null)
        .range(from, from + batchSize - 1);
      if (qErr) { console.error('Supabase query error:', qErr.message); break; }
      if (!data || data.length === 0) break;
      pages.push(...data);
      from += data.length;
      if (data.length < batchSize) break; // no more results
    }
    const error = null;

    if (error) {
      console.error('Supabase query error:', error.message);
      await client.close();
      return;
    }

    console.log(`[backfill-display] ${pages.length} pages from Supabase in ${Date.now() - t}ms`);

    if (pages.length === 0) {
      console.log('[backfill-display] No pages need backfill — done!');
      await client.close();
      return;
    }

    // Process pages with bounded concurrency
    // Atlas only needed for writes (updateOne per page) — no reads!
    let idx = 0;
    async function worker() {
      while (idx < pages.length) {
        const i = idx++;
        if (i >= pages.length) break;
        const page = pages[i];
        // Skip non-URL archived photos
        if (!page.archived_photo?.startsWith('https://')) {
          stats.skipped++;
          stats.processed++;
          continue;
        }
        await processPage({ _id: page.id, ...page }, db);
        stats.processed++;

        if (stats.processed % 500 === 0) {
          logProgress();
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker()));

    // Bulk update Supabase mirror so next run skips these pages
    const updates = stats._supabaseUpdates || [];
    if (updates.length > 0) {
      console.log(`  Syncing ${updates.length} display_photo updates to Supabase...`);
      for (let i = 0; i < updates.length; i += 500) {
        const batch = updates.slice(i, i + 500);
        const { error: upsertErr } = await supabase.from('pages_images').upsert(batch, { onConflict: 'id' });
        if (upsertErr) console.error(`  Supabase sync error: ${upsertErr.message}`);
      }
    }
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed > 0 ? parseFloat((stats.processed / elapsed).toFixed(1)) : 0;
  const gb = parseFloat((stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(2));
  console.log(`\n[backfill-display] Done in ${Math.round(elapsed)}s`);
  if (stats.booksProcessed) console.log(`  Books: ${stats.booksProcessed} processed, ${stats.booksSkipped} skipped`);
  console.log(`  Pages: ${stats.processed.toLocaleString()} processed, ${stats.succeeded.toLocaleString()} succeeded, ${stats.failed} failed`);
  console.log(`  Rate: ${rate} pages/sec`);
  console.log(`  Uploaded: ${gb} GB`);

  // Log stats to system_config for the monitoring dashboard
  if (stats.processed > 0) {
    try {
      const runRecord = {
        completedAt: new Date().toISOString(),
        pages: stats.succeeded,
        failed: stats.failed,
        rate,
        gb,
        elapsed: Math.round(elapsed),
        concurrency: CONCURRENCY,
      };
      // Read CPU load from log file
      let cpuLoad = [];
      try {
        const fs = await import('fs');
        const lines = fs.readFileSync('/var/log/sourcelibrary/cpu-load.log', 'utf-8').trim().split('\n').slice(-288); // last 24h at 5min intervals
        cpuLoad = lines.map(line => {
          const [time, ...rest] = line.split(' ');
          const [l1, l5, l15] = rest.join(' ').split(',').map(s => parseFloat(s.trim()));
          return { time, load1: l1, load5: l5, load15: l15 };
        }).filter(d => !isNaN(d.load1));
      } catch {}

      await db.collection('system_config').updateOne(
        { _id: 'display_backfill_stats' },
        {
          $push: { runs: { $each: [runRecord], $slice: -100 } },
          $inc: { totalPages: stats.succeeded, totalGB: gb },
          $set: { cpuLoad, lastRunAt: new Date(), updatedAt: new Date() },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error('  [warn] Failed to write stats to DB:', e.message);
    }
  }

  await client.close();
}

main().catch(err => { console.error('[backfill-display] Fatal:', err); process.exit(1); });
