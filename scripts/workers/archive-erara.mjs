#!/usr/bin/env node
/**
 * Bulk e-rara Archive Worker (PDF download)
 *
 * Downloads full PDF per book instead of individual IIIF page requests.
 * ~10-50x faster than per-page IIIF, politer (1 request vs hundreds), full quality.
 *
 * PDF URL pattern: https://www.e-rara.ch/download/pdf/{manifestId}
 * Manifest ID extracted from: https://www.e-rara.ch/i3f/v21/{manifestId}/manifest
 *
 * Requires: pdftoppm (poppler-utils), sharp
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-erara.mjs
 *   node scripts/workers/archive-erara.mjs --limit=50 --dry-run
 *   node scripts/workers/archive-erara.mjs --concurrency=3
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';
import { fetchToFileWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_LIMIT = parseInt(getArg('limit') || '30', 10);
const BOOK_CONCURRENCY = parseInt(getArg('concurrency') || '2', 10);
const PAGE_CONCURRENCY = parseInt(getArg('page-concurrency') || '8', 10);
const DRY_RUN = hasFlag('dry-run');
const JPEG_QUALITY = 85;
/**
 * Safety valve, not a quality ceiling (#4406). Was `MAX_DIMENSION = 3000` with a
 * silent downsize; now we store what the rasterization produced and SKIP loudly
 * above a pathological size, so a gap is visible instead of a shrink being silent.
 */
const PATHOLOGICAL_DIMENSION = 30000;

/**
 * PDF rasterization density.
 *
 * Was 200, commented "Good balance of quality vs size" — a trade of preservation
 * quality for file size, made once and inherited by 1.92M pages, everything OCR
 * read, everything translated from it, and everything a reader can zoom into.
 * Measured 2026-08-30: e-rara pages sampled 0/14 at full resolution against the
 * source's own info.json, median ratio 0.667 — we held ~44% of the pixels.
 *
 * 400 is the preservation floor for printed text (FADGI/Metamorfoze both treat
 * 400 ppi as the working minimum for reformatted print), and it doubles the
 * linear resolution of what we captured before. It is not a free change — the
 * files are roughly 4x the pixels — but a master is the thing you cannot
 * re-derive, and e-rara is a partner whose IIIF endpoint we do not currently
 * use for archiving.
 *
 * THE REAL FIX IS UPSTREAM OF THIS NUMBER. Rasterizing a PDF is a lossy path we
 * chose for convenience; e-rara serves IIIF, which tile-stitching can pull at
 * true native resolution (see fetchPageMaster). Raising the DPI narrows the gap;
 * it does not close it. Tracked on #4406 alongside #3186's parked e-rara lane.
 */
const PDF_DPI = parseInt(process.env.ERARA_PDF_DPI || '400', 10);
const DELAY_BETWEEN_DOWNLOADS_MS = 2000;  // Polite delay between PDF downloads

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// Verify pdftoppm is available
try { execSync('which pdftoppm', { stdio: 'pipe' }); }
catch { console.error('pdftoppm not found. Install: apt-get install poppler-utils'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const stats = {
  booksProcessed: 0, booksSkipped: 0, booksFailed: 0, countersSynced: 0,
  pagesArchived: 0, pagesFailed: 0,
  bytesDownloaded: 0, bytesUploaded: 0,
  startTime: Date.now(),
};

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Stall timeout, not a total-duration cap (#3477): a whole-book PDF on a slow
// link legitimately outlives a fixed clock. The old 600s total survives as the
// absolute backstop; the abort now asks "is data still arriving?".
const FETCH_STALL_MS = parseInt(process.env.ARCHIVE_STALL_TIMEOUT_MS || '60000', 10);

async function downloadPdf(url, destPath, timeoutMs = 600000) {
  const { res, bytes } = await fetchToFileWithStallTimeout(url, destPath, {
    stallMs: FETCH_STALL_MS,
    maxMs: timeoutMs,
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return bytes;
}

function extractEraraId(book) {
  const manifest = book.image_source?.iiif_manifest || book.image_source?.source_url || '';
  const match = manifest.match(/\/(\d+)\/manifest/);
  return match?.[1] || null;
}

async function processBook(book, db) {
  const eraraId = extractEraraId(book);
  if (!eraraId) {
    console.log(`  [SKIP] ${book.title?.slice(0, 50)} — no e-rara ID`);
    stats.booksSkipped++;
    return;
  }

  // Warehouse books carry their collection names so writes go back to the right
  // place; live books default to the canonical `pages`/`books` collections.
  const pagesCol = book._pagesCol || 'pages';
  const booksCol = book._booksCol || 'books';

  // Find unarchived pages
  const pages = await db.collection(pagesCol)
    .find({
      book_id: book.id,
      $or: [
        { archived_photo: { $exists: false } },
        { archived_photo: null },
        { archived_photo: '' },
        { archived_photo: /^failed/ },
      ],
    }, { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1 } })
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    // Nothing to archive — but the ONLY reason this book was selected is
    // `pages_archived: { $not: { $gte: 1 } }`, so returning here without writing
    // the counter leaves it eligible forever. Measured 2026-08-27: 6,865
    // warehouse e-rara books sat in exactly this state — every page already
    // archived in `pages_warehouse`, `pages_archived` never written on the
    // warehouse doc — and this worker re-selected 100 of them every 30 minutes,
    // ran for ~207s, and reported "0 archived, 0 failed, 100 skipped". 227 such
    // runs in the log, none of which moved anything.
    //
    // A skip that does not record WHY is an infinite loop with a progress bar.
    // Sync the counter from the pages themselves, using the same predicate the
    // archive route uses, so the book leaves the queue by being correct rather
    // than by being ignored.
    const archivedCount = await db.collection(pagesCol).countDocuments(
      { book_id: book.id, archived_photo: { $exists: true, $nin: [null, ''] } },
      { maxTimeMS: 10000 },
    );
    if (archivedCount > 0) {
      await db.collection(booksCol).updateOne(
        { id: book.id },
        {
          $set: {
            pages_archived: archivedCount,
            archive_status: archivedCount >= (book.pages_count || 0) ? 'archive_complete' : 'archive_partial',
            updated_at: new Date(),
          },
        },
      );
      stats.countersSynced++;
    }
    stats.booksSkipped++;
    return;
  }

  const pdfUrl = `https://www.e-rara.ch/download/pdf/${eraraId}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-erara-${eraraId}-`));

  try {
    // Download PDF
    const pdfPath = path.join(tmpDir, 'book.pdf');
    console.log(`  [PDF] ${book.title?.slice(0, 50)} — ${pages.length}/${book.pages_count || '?'} pages, ID ${eraraId}`);

    let pdfSize;
    try {
      pdfSize = await downloadPdf(pdfUrl, pdfPath);
    } catch (err) {
      console.log(`    [FAIL] PDF download: ${err.message?.slice(0, 100)}`);
      // Mark pages as failed so we don't retry forever
      if (err.message?.includes('403') || err.message?.includes('404')) {
        await db.collection(pagesCol).updateMany(
          { book_id: book.id, archived_photo: { $exists: false } },
          { $set: { archived_photo: `failed:${err.message.slice(0, 50)}` } }
        );
      }
      stats.booksFailed++;
      return;
    }
    stats.bytesDownloaded += pdfSize;

    // Extract to JPEG with pdftoppm
    const outPrefix = path.join(tmpDir, 'page');
    try {
      execSync(`pdftoppm -jpeg -jpegopt quality=${JPEG_QUALITY} -r ${PDF_DPI} "${pdfPath}" "${outPrefix}"`, {
        timeout: 600000,
        stdio: 'pipe',
      });
    } catch (err) {
      console.log(`    [FAIL] pdftoppm: ${err.message?.slice(0, 100)}`);
      stats.booksFailed++;
      return;
    }
    fs.unlinkSync(pdfPath);

    // pdftoppm outputs: page-01.jpg, page-02.jpg, ... (1-indexed, zero-padded)
    const pageFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
      .sort()
      .map(f => path.join(tmpDir, f));

    if (pageFiles.length === 0) {
      console.log(`    [WARN] No pages extracted from PDF`);
      stats.booksFailed++;
      return;
    }

    // Map pages: page_number 1 → pageFiles[0] (first PDF page)
    // Build a set of needed page numbers
    const neededPages = new Map(pages.map(p => [p.page_number, p]));
    const workItems = [];

    for (let i = 0; i < pageFiles.length; i++) {
      const pageNum = i + 1;  // e-rara pages are 1-indexed
      const page = neededPages.get(pageNum);
      if (page) {
        workItems.push({ page, srcFile: pageFiles[i] });
      }
    }

    // Process pages in parallel
    let workIdx = 0;
    let archived = 0;
    let failed = 0;

    async function pageWorker() {
      while (workIdx < workItems.length) {
        const idx = workIdx++;
        if (idx >= workItems.length) break;
        const { page, srcFile } = workItems[idx];
        try {
          const sharpInst = sharp(srcFile);
          const meta = await sharpInst.metadata();
          // No downsize: store what the rasterization produced. See PATHOLOGICAL_DIMENSION.
          if (meta.width > PATHOLOGICAL_DIMENSION || meta.height > PATHOLOGICAL_DIMENSION) {
            throw new Error(`pathological dimensions ${meta.width}x${meta.height} — skipped, not downsized (#4406)`);
          }
          const jpegBuffer = await sharpInst.jpeg({ quality: JPEG_QUALITY }).toBuffer();

          // Upload full-res + generate and upload display (1200px) + thumbnail (150px)
          const urls = await uploadPageVariants(jpegBuffer, page.book_id, page.page_number, uploadToR2);
          stats.bytesUploaded += jpegBuffer.length;

          const dimFields = {};
          if (urls.width) dimFields.image_width = urls.width;
          if (urls.height) dimFields.image_height = urls.height;

          await db.collection(pagesCol).updateOne(
            { _id: page._id },
            {
              $set: {
                archived_photo: urls.archived,
                display_photo: urls.display,
                thumbnail_blob: urls.thumb,
                ...dimFields,
                'archive_metadata.archived_at': new Date(),
                'archive_metadata.source': 'erara_pdf',
                'archive_metadata.source_url': `https://www.e-rara.ch/download/pdf/${eraraId}`,
                'archive_metadata.bytes': jpegBuffer.length,
                'archive_metadata.full_res': true,
              },
            }
          );
          archived++;
        } catch (err) {
          failed++;
          if (failed <= 3) console.log(`    [FAIL] page ${page.page_number}: ${err.message?.slice(0, 100)}`);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, workItems.length) }, () => pageWorker())
    );

    stats.pagesArchived += archived;
    stats.pagesFailed += failed;
    stats.booksProcessed++;

    const rate = (archived / ((Date.now() - stats.startTime) / 1000)).toFixed(1);
    console.log(`    ${archived}/${workItems.length} archived, ${failed} failed (${rate} pages/sec overall)`);

    // Sync pages_archived counter (#497)
    if (archived > 0) {
      const archivedCount = await db.collection(pagesCol).countDocuments(
        { book_id: book.id, archived_photo: { $exists: true, $nin: [null, ''] } },
        { maxTimeMS: 10000 }
      );
      const archiveStatus = archivedCount >= book.pages_count ? 'archive_complete' : 'archive_partial';
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: { pages_archived: archivedCount, archive_status: archiveStatus, updated_at: new Date() } }
      );
    }

    // If all pages archived, mark book as archive_complete
    const remainingUnarchived = await db.collection(pagesCol).countDocuments({
      book_id: book.id,
      $or: [
        { archived_photo: { $exists: false } },
        { archived_photo: null },
        { archived_photo: '' },
      ],
    });
    if (remainingUnarchived === 0) {
      await db.collection(booksCol).updateOne(
        { id: book.id },
        {
          $set: {
            'pipeline_auto.status': 'archive_complete',
            'pipeline_auto.last_updated': new Date(),
            updated_at: new Date(),
          },
        }
      );
    }

  } catch (err) {
    console.log(`  [ERROR] ${book.title?.slice(0, 50)}: ${err.message?.slice(0, 100)}`);
    stats.booksFailed++;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-erara] Bulk PDF archiver — ${BOOK_LIMIT} books, ${BOOK_CONCURRENCY} concurrent, ${DELAY_BETWEEN_DOWNLOADS_MS}ms delay`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find e-rara books that need archiving — any pipeline status, not just 'archiving'.
  // Many e-rara books sailed past the archiving stage before this worker existed.
  // Priority: smaller books first (faster throughput), then first translations
  const eraraFilter = {
    'image_source.provider': 'e-rara',
    pages_count: { $gt: 0 },
    pages_archived: { $not: { $gte: 1 } },  // No pages archived yet (null, 0, or missing)
  };
  const eraraProjection = { id: 1, title: 1, image_source: 1, pages_count: 1, language: 1, is_first_translation: 1 };

  const eraraBooks = await db.collection('books')
    .find(eraraFilter)
    .sort({ pages_count: 1 })  // Small books first — clear the queue faster
    .project(eraraProjection)
    .limit(BOOK_LIMIT)
    .toArray();

  // Also scan the warehouse — the bulk of the e-rara backlog was moved out of the
  // live `books` collection into `books_warehouse` (statuses archiving/archive_complete)
  // to keep Atlas queries fast. archive-bulk already scans the warehouse this way;
  // mirror it here so the e-rara backlog is reachable. Each warehouse book is tagged
  // with its collection names so processBook() writes back to the right place.
  const warehouseRemaining = Math.max(0, BOOK_LIMIT - eraraBooks.length);
  const warehouseEraraBooks = warehouseRemaining > 0
    ? await db.collection('books_warehouse')
        .find(eraraFilter)
        .sort({ pages_count: 1 })
        .project(eraraProjection)
        .limit(warehouseRemaining)
        .toArray()
        .catch(() => [])
    : [];
  warehouseEraraBooks.forEach(b => { b._pagesCol = 'pages_warehouse'; b._booksCol = 'books_warehouse'; });
  eraraBooks.push(...warehouseEraraBooks);

  console.log(`[archive-erara] Found ${eraraBooks.length - warehouseEraraBooks.length} live + ${warehouseEraraBooks.length} warehouse e-rara books to archive`);

  if (DRY_RUN) {
    eraraBooks.forEach((b, i) =>
      console.log(`  ${i + 1}. ${b._booksCol === 'books_warehouse' ? '[WH] ' : ''}${b.title?.slice(0, 60)} (${b.pages_count || '?'} pages, ID ${extractEraraId(b)})`)
    );
    await client.close();
    return;
  }

  // Process sequentially with delay between downloads (polite to e-rara)
  // But pages within each book are processed in parallel (local work, not network)
  for (let i = 0; i < eraraBooks.length; i++) {
    const book = eraraBooks[i];
    console.log(`\n[${i + 1}/${eraraBooks.length}] ${book.title?.slice(0, 60)} (${book.pages_count || '?'} pages)`);
    await processBook(book, db);

    // Polite delay between downloads
    if (i < eraraBooks.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_DOWNLOADS_MS));
    }
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  const pagesPerSec = stats.pagesArchived > 0 ? (stats.pagesArchived / elapsed).toFixed(1) : '0';
  console.log(`\n============================================================`);
  console.log(`Done in ${Math.round(elapsed)}s — ${stats.pagesArchived} archived, ${stats.pagesFailed} failed`);
  console.log(`Rate: ${pagesPerSec} pages/sec`);
  console.log(`Data: ${(stats.bytesDownloaded / (1024 * 1024)).toFixed(0)}MB downloaded, ${(stats.bytesUploaded / (1024 * 1024)).toFixed(0)}MB uploaded`);
  console.log(`Books: ${stats.booksProcessed} processed, ${stats.booksFailed} failed, ${stats.booksSkipped} skipped` +
    (stats.countersSynced ? `, ${stats.countersSynced} stale counters synced (already archived)` : ''));

  // Log to cron_runs
  await db.collection('cron_runs').insertOne({
    cron: 'archive-erara',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: stats.booksFailed === 0 ? 'success' : 'partial',
    actions: { ...stats },
  });

  await client.close();
}

main().catch(err => { console.error('[archive-erara] Fatal:', err); process.exit(1); });
