#!/usr/bin/env node
/**
 * Backfill display (1200px) + thumbnail (150px) R2 variants for pages that have
 * a full-res source but no free, browser-safe display variant — issue #1814.
 *
 * For those pages the read-side resolver (`src/lib/page-image-url.ts`) falls
 * through to the metered `/api/image` proxy on every view; materializing the
 * variants + persisting the fields moves the reads onto free R2 egress.
 *
 * SOURCE CORRECTNESS (the #1814 fix). We resize whatever `getPageSource()`
 * returns — never `archived_photo` blindly. `archived_photo` is the *full
 * spread* for split scans; the half lives in `cropped_photo` (old-era) or the
 * `sp…` `photo` (new-era). Resizing the spread bakes a wrong variant at scale.
 *   - new-era split  → `photo` (the sp half)        → backfilled here
 *   - normal page    → `archived_photo` / `photo`   → backfilled here
 *   - old-era split  → `cropped_photo`              → SKIPPED (out of scope)
 * Old-era split pages are skipped because the read-side `resolveSized`
 * deliberately ignores `display_photo`/`image_thumb` whenever `cropped_photo`
 * is set and always proxies+crops instead — so a variant we wrote would never
 * be served (wasted R2 + Mongo writes). They need a read-side change to benefit
 * (tracked separately; revisit with #1730 / materialize-crops).
 *
 * ENUMERATION is Mongo-driven, per-book. The Supabase `pages_images` mirror was
 * the old selector, but it only covers ~2.96M of 6.49M pages and exposes just
 * ~2.7K of the ~700K gap (verified 2026-06-01, #1814) — the gap is almost
 * entirely in *unmirrored* Mongo pages, so the mirror is a silent cap. Instead
 * we walk the `books` collection (small) and, per book, query its pages on the
 * `{book_id, page_number}` index — full docs, so `getPageSource()` has what it
 * needs. A persisted cursor (`system_config.display_backfill_cursor`, with a
 * `phase`) lets the cron resume across runs and wrap when the corpus is drained.
 *
 * SEEN-FIRST: the book walk is two-phase — `visible: true` books first, then
 * the rest — so the variants readers actually see get backfilled before the
 * hidden/non-public long tail (~2/3 of the gap). See the enumeration block for
 * why read_count / page-number sub-ordering is deliberately omitted.
 *
 * PERSIST canonical `image_thumb` (+ `display_photo`) on the Mongo page — not
 * the deprecated `thumbnail_blob`. The Supabase mirror is updated best-effort
 * (UPDATE-only, never INSERT) so browse/cover surfaces pick up the new thumb;
 * mirror failures never fail the run.
 *
 * IDEMPOTENCY: selection on missing `display_photo` is the primary gate (field/
 * file drift measured ~0pp). A HEAD on the display key is cheap insurance for
 * the rare file-present/field-absent case — it re-persists the field without
 * re-resizing; it does not gate throughput.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-display-images.mjs --dry-run
 *   node scripts/migration/backfill-display-images.mjs --limit=20000 --concurrency=10 --dry-run
 *   node scripts/migration/backfill-display-images.mjs --book=BOOK_ID
 *   node scripts/migration/backfill-display-images.mjs --no-cursor   # ignore/scan from start
 *
 * ⚠️ --dry-run reports counts only. A real run writes to R2 + Mongo (+ best-effort
 *    Supabase). Per #1814, get the source-selection diff reviewed before a prod run.
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';
import { getPageSource, isUsableImageUrl } from '../lib/page-image-url.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '50000', 10);       // max pages backfilled per run
const CONCURRENCY = parseInt(getArg('concurrency') || '10', 10);
const BOOK_LIMIT = parseInt(getArg('books') || '100000', 10); // max books with a gap per run
const DRY_RUN = hasFlag('dry-run');
const NO_CURSOR = hasFlag('no-cursor');
const BOOK_ID = getArg('book');                               // single-book mode
const START_AFTER = getArg('start-after');                    // manual cursor override (book id)

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

/** Image-bearing fields getPageSource() and the variant writer need. */
const PAGE_PROJECTION = {
  _id: 1, id: 1, book_id: 1, page_number: 1,
  photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1,
  cropped_photo: 1, display_photo: 1, image_thumb: 1, split_from_spread: 1,
};

/**
 * Per-book Mongo pre-filter: pages missing display_photo AND not old-era split.
 *
 * Excluding old-era split (`cropped_photo` set) at the QUERY level — not just in
 * `resolveSource()` — matters because BPH (~half the catalogue) is almost
 * entirely old-era split spreads. Without this, a split-heavy book returns
 * thousands of pages that all get skipped, burning the per-run page budget on
 * scan-and-skip instead of producing variants (observed: one run skipped
 * 9,830 / 10,009 pages). The read-side proxies+crops these regardless, so they
 * are out of scope (see header). `resolveSource()` keeps its guard as defence
 * in depth for any that slip through (e.g. cropped_photo added after this read).
 */
const gapFilter = (bookId) => ({
  book_id: bookId,
  $or: [{ display_photo: { $exists: false } }, { display_photo: null }, { display_photo: '' }],
  cropped_photo: { $in: [null, ''] },  // exclude old-era split (field absent or empty)
});

function variantKeys(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  return {
    display: `pages/${bookId}/${num}.jpg`,
    thumb: `pages/${bookId}/${num}-thumb.jpg`,
  };
}

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function r2Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadFromR2(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

const stats = {
  processed: 0, succeeded: 0, failed: 0,
  skip_legacy_split: 0, skip_no_source: 0, skip_already_present: 0,
  wouldBackfill: 0, booksScanned: 0, booksWithGap: 0,
  bytesUploaded: 0, startTime: Date.now(),
  _supabaseUpdates: [],
};

// Safety net for an unattended multi-hour drain: a stray async rejection (e.g.
// a future floating-promise like the #1814 empty-buffer crash) must not abort
// the whole batch — log it loudly and keep going. Per-page work is already in
// try/catch; this only catches escapes.
process.on('unhandledRejection', (reason) => {
  stats.failed++;
  console.error('[backfill-display] unhandledRejection (continuing):', reason?.message || reason);
});

/**
 * Resolve the correct source for a full Mongo page doc, or a skip reason.
 * Old-era split (cropped_photo) is intentionally out of scope (see header).
 */
function resolveSource(page) {
  if (isUsableImageUrl(page.cropped_photo)) return { skip: 'legacy_split' };
  const source = getPageSource(page);
  if (!source || !/^https?:\/\//.test(source) || /\.(jp2|jpx|jpf|j2k|tiff?)(\?|$)/i.test(source)) {
    return { skip: 'no_source' };
  }
  return { source };
}

async function processPage(page, db) {
  const { source, skip } = resolveSource(page);
  if (skip === 'legacy_split') { stats.skip_legacy_split++; return; }
  if (skip === 'no_source') { stats.skip_no_source++; return; }

  const keys = variantKeys(page.book_id, page.page_number);

  if (DRY_RUN) { stats.wouldBackfill++; return; }

  try {
    const pageId = page.id || page._id;
    const mongoFilter = { $or: [{ id: pageId }, { _id: pageId }] };

    // Cheap insurance: if the display file already exists (field/file drift),
    // just persist the fields — don't re-download/resize/upload.
    const fileAlready = await r2Exists(keys.display);
    let displayUrl = `${R2_PUBLIC_URL}/${keys.display}`;
    let thumbUrl = `${R2_PUBLIC_URL}/${keys.thumb}`;

    if (!fileAlready) {
      const fullResBuffer = await downloadFromR2(source);
      // A 200-with-empty-body slips past downloadFromR2's !res.ok check; an
      // empty buffer would make sharp throw. Fail this page cleanly instead.
      if (!fullResBuffer || fullResBuffer.length === 0) {
        throw new Error(`empty source download: ${source.slice(0, 100)}`);
      }
      const { display, thumb } = await generateDisplayVariants(fullResBuffer, {
        bookId: page.book_id, pageNumber: page.page_number,
      });
      displayUrl = await uploadToR2(keys.display, display);
      thumbUrl = await uploadToR2(keys.thumb, thumb);
      stats.bytesUploaded += display.length + thumb.length;
    } else {
      stats.skip_already_present++;
    }

    // Mongo (read-side source of truth): canonical image_thumb, not thumbnail_blob.
    await db.collection('pages').updateOne(mongoFilter, {
      $set: { display_photo: displayUrl, image_thumb: thumbUrl, updated_at: new Date() },
    });

    // Best-effort Supabase mirror UPDATE (existing rows only) so browse/cover
    // surfaces pick up the new thumb. Never INSERTs, never fails the run.
    stats._supabaseUpdates.push({ id: pageId, display_photo: displayUrl, thumbnail_blob: thumbUrl });

    stats.succeeded++;
  } catch (err) {
    stats.failed++;
    if (stats.failed <= 20) {
      console.error(`  FAIL page ${page.book_id}/${page.page_number}: ${err.message?.slice(0, 100)}`);
    }
  }
}

/** Run a list of full page docs through processPage with bounded concurrency. */
async function runBatch(pages, db) {
  let idx = 0;
  async function worker() {
    while (idx < pages.length && stats.processed < LIMIT) {
      const i = idx++;
      if (i >= pages.length) break;
      await processPage(pages[i], db);
      stats.processed++;
      if (stats.processed % 500 === 0) logProgress();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker()));
}

/** Best-effort flush of mirror updates (UPDATE existing rows only). */
async function flushSupabase(supabase) {
  const updates = stats._supabaseUpdates;
  if (!supabase || updates.length === 0) return;
  stats._supabaseUpdates = [];
  for (const u of updates) {
    try {
      await supabase.from('pages_images')
        .update({ display_photo: u.display_photo, thumbnail_blob: u.thumbnail_blob })
        .eq('id', u.id);
    } catch { /* mirror is best-effort; sync-worker will reconcile */ }
  }
}

function logProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = (stats.processed / elapsed).toFixed(1);
  const mb = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);
  console.log(`  ${stats.processed.toLocaleString()} pages (${stats.booksWithGap} books) — ${stats.succeeded} ok, ${stats.failed} fail, ${stats.skip_legacy_split} split-skip — ${rate}/s — ${mb}MB`);
}

async function main() {
  console.log(`[backfill-display] #1814 split-aware backfill — page-limit=${LIMIT}, book-limit=${BOOK_LIMIT}, concurrency=${CONCURRENCY}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 12 });
  await client.connect();
  const db = client.db('bookstore');

  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = SUPABASE_KEY
    ? createClient(process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co', SUPABASE_KEY, { auth: { persistSession: false } })
    : null;
  if (!supabase) console.warn('[backfill-display] No SUPABASE_SERVICE_ROLE_KEY — skipping mirror updates (Mongo is the read-side source of truth).');

  if (BOOK_ID) {
    // Single-book mode.
    const book = await db.collection('books').findOne(
      { $or: [{ id: BOOK_ID }, { _id: BOOK_ID }] }, { projection: { id: 1, title: 1 } },
    );
    if (!book) { console.error(`Book not found: ${BOOK_ID}`); await client.close(); return; }
    console.log(`[backfill-display] Single book: ${book.title?.slice(0, 60)}`);
    const pages = await db.collection('pages')
      .find(gapFilter(book.id), { projection: PAGE_PROJECTION }).batchSize(5000).toArray();
    console.log(`  ${pages.length} pages missing display_photo`);
    if (pages.length) { stats.booksWithGap++; await runBatch(pages, db); if (!DRY_RUN) await flushSupabase(supabase); }
  } else {
    // Bulk mode — walk the books collection in _id order from a persisted
    // cursor, backfilling each book's gap pages. Resume + wrap across cron runs.
    //
    // SEEN-FIRST ordering (measured 2026-06-01): only ~31% of gap pages are in
    // `visible` books; ~2/3 are hidden/non-public. So we drain in two phases —
    // `visible: true` books first, then the rest — each phase walked in `_id`
    // order with the same resumable high-water cursor. That ~3×'s the share of
    // early drain effort that lands on publicly-visible pages.
    //
    // We deliberately do NOT sub-sort by read_count: it's a near-flat signal on
    // this gap (≈90% of gap books have 0 reads, max ~17), so a compound
    // (read_count,_id) cursor would add bug surface for no real prioritization
    // gain. Page order within a book stays natural (cover/early pages are mostly
    // already backfilled — only ~5% of the gap is pages ≤10 — so page-level
    // ordering buys little either).
    const PHASES = ['visible', 'rest'];
    const phaseQuery = (phase) => (phase === 'visible' ? { visible: true } : { visible: { $ne: true } });

    let phase = 'visible';
    let cursor = null;
    if (START_AFTER) {
      const sb = await db.collection('books').findOne({ $or: [{ id: START_AFTER }, { _id: START_AFTER }] }, { projection: { _id: 1 } });
      cursor = sb?._id ?? null;
    } else if (!NO_CURSOR) {
      const c = await db.collection('system_config').findOne({ _id: 'display_backfill_cursor' });
      // Back-compat: old cursors stored only lastBookMongoId (no phase).
      if (c && PHASES.includes(c.phase)) phase = c.phase;
      cursor = c?.lastBookMongoId ?? null;
    }

    let lastBookMongoId = cursor;
    let phaseIdx = PHASES.indexOf(phase);
    let limitHit = false;

    // Walk phases from the resumed one onward; advance to the next phase when a
    // phase is fully scanned, and wrap to 'visible' after the last phase drains.
    outer:
    for (; phaseIdx < PHASES.length; phaseIdx++) {
      phase = PHASES[phaseIdx];
      const q = phaseQuery(phase);
      if (lastBookMongoId) q._id = { $gt: lastBookMongoId };
      const bookCursor = db.collection('books')
        .find(q, { projection: { _id: 1, id: 1 } }).sort({ _id: 1 });

      for await (const book of bookCursor) {
        if (stats.booksWithGap >= BOOK_LIMIT || stats.processed >= LIMIT) { limitHit = true; break outer; }
        stats.booksScanned++;
        lastBookMongoId = book._id;
        if (!book.id) continue;

        const pages = await db.collection('pages')
          .find(gapFilter(book.id), { projection: PAGE_PROJECTION }).toArray();
        if (pages.length === 0) continue;

        stats.booksWithGap++;
        await runBatch(pages, db);
        if (!DRY_RUN) await flushSupabase(supabase);
      }
      // Finished this phase within the page/book budget → next phase starts fresh.
      lastBookMongoId = null;
    }

    // Resolve the cursor to persist:
    //  - limit hit mid-phase → resume same phase after lastBookMongoId
    //  - a phase finished    → start of the next phase (or wrap to 'visible')
    let nextPhase, nextCursor;
    if (limitHit) {
      nextPhase = phase;
      nextCursor = lastBookMongoId;
    } else {
      nextPhase = 'visible';      // walked off the end of 'rest' → wrap
      nextCursor = null;
    }

    if (!DRY_RUN && !NO_CURSOR && !START_AFTER) {
      await db.collection('system_config').updateOne(
        { _id: 'display_backfill_cursor' },
        { $set: { phase: nextPhase, lastBookMongoId: nextCursor, updatedAt: new Date() } },
        { upsert: true },
      );
      if (!limitHit) console.log('[backfill-display] Drained all phases — cursor wrapped to start of visible.');
    }
    console.log(`[backfill-display] phase=${phase}${limitHit ? ' (budget hit, will resume here)' : ' → next: ' + nextPhase}`);
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed > 0 ? parseFloat((stats.processed / elapsed).toFixed(1)) : 0;
  const gb = parseFloat((stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(2));
  console.log(`\n[backfill-display] Done in ${Math.round(elapsed)}s`);
  console.log(`  Books scanned: ${stats.booksScanned.toLocaleString()}, with gap: ${stats.booksWithGap.toLocaleString()}`);
  console.log(`  Pages processed: ${stats.processed.toLocaleString()} — succeeded ${stats.succeeded.toLocaleString()}, failed ${stats.failed}`);
  console.log(`  Skipped — old-era split: ${stats.skip_legacy_split.toLocaleString()}, no source: ${stats.skip_no_source.toLocaleString()}, file-present (field repair): ${stats.skip_already_present.toLocaleString()}`);
  if (DRY_RUN) {
    const estPuts = stats.wouldBackfill * 2;
    const estGb = (stats.wouldBackfill * 0.126 / 1024).toFixed(2);
    console.log(`  WOULD backfill: ${stats.wouldBackfill.toLocaleString()} pages → ~${estPuts.toLocaleString()} R2 PUTs, ~${estGb} GB`);
    console.log(`  DRY RUN — no writes. Get the source-selection diff reviewed before a prod run (#1814).`);
  } else {
    console.log(`  Uploaded: ${gb} GB`);
  }

  // Stats for the monitoring dashboard (display_backfill_stats).
  if (!DRY_RUN && stats.processed > 0) {
    try {
      const runRecord = {
        completedAt: new Date().toISOString(),
        pages: stats.succeeded, failed: stats.failed,
        splitSkipped: stats.skip_legacy_split,
        rate, gb, elapsed: Math.round(elapsed), concurrency: CONCURRENCY,
      };
      let cpuLoad = [];
      try {
        const fs = await import('fs');
        const lines = fs.readFileSync('/var/log/sourcelibrary/cpu-load.log', 'utf-8').trim().split('\n').slice(-288);
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
        { upsert: true },
      );
    } catch (e) {
      console.error('  [warn] Failed to write stats to DB:', e.message);
    }
  }

  await client.close();
}

main().catch(err => { console.error('[backfill-display] Fatal:', err); process.exit(1); });
