#!/usr/bin/env node
/**
 * Bulk IA image archiver using per-page IIIF downloads.
 *
 * Fetches each page directly from its IIIF URL (stored in photo_original),
 * converts to JPEG, and uploads to R2. This avoids the archive drift problem
 * caused by JP2 zip extraction ordering not matching IIIF leaf numbers.
 *
 * Requires: sharp, @aws-sdk/client-s3
 *
 * Usage:
 *   node scripts/maintenance/archive-ia-bulk.mjs                     # all IA books
 *   node scripts/maintenance/archive-ia-bulk.mjs --limit=50          # first 50 books
 *   node scripts/maintenance/archive-ia-bulk.mjs --concurrency=5     # parallel book downloads
 *   node scripts/maintenance/archive-ia-bulk.mjs --book-id=abc123    # single book
 *   node scripts/maintenance/archive-ia-bulk.mjs --skip-thumbnails   # skip 150px thumbs
 *   node scripts/maintenance/archive-ia-bulk.mjs --dry-run           # count only
 */

import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const CONCURRENCY = parseInt(getArg('concurrency') || '3', 10); // book-level concurrency
const PAGE_CONCURRENCY = parseInt(getArg('page-concurrency') || '8', 10); // page-level within each book
const BOOK_LIMIT = parseInt(getArg('limit') || '0', 10);
const BOOK_ID = getArg('book-id');
const SKIP_THUMBNAILS = hasFlag('skip-thumbnails');
const DRY_RUN = hasFlag('dry-run');
const JPEG_QUALITY = parseInt(getArg('quality') || '85', 10);
// Archive at source fidelity by default: no resolution cap. Storage is cheap
// ($0.015/GB/mo); source resolution is the product (#3897). Pass --max-dim=N only
// for a pathological source. 0 = uncapped.
const MAX_DIMENSION = parseInt(getArg('max-dim') || '0', 10);

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// opj_decompress no longer needed — we fetch JPEG directly from IIIF

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

// R2 client
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Stats
const stats = {
  booksProcessed: 0,
  booksSkipped: 0,
  booksFailed: 0,
  pagesArchived: 0,
  pagesFailed: 0,
  bytesDownloaded: 0,
  bytesUploaded: 0,
  startTime: Date.now(),
};

function printProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.pagesArchived / Math.max(elapsed, 1);
  const mbDown = (stats.bytesDownloaded / (1024 * 1024)).toFixed(0);
  const mbUp = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);
  console.log(
    `  [PROGRESS] ${stats.booksProcessed} books (${stats.booksFailed} failed, ${stats.booksSkipped} skipped) | ` +
    `${stats.pagesArchived} pages | ${rate.toFixed(1)} pg/s | ${mbDown}MB down, ${mbUp}MB up | ${Math.round(elapsed)}s`
  );
}

/**
 * Download a file to disk using streaming (no memory bloat for large zips).
 */
async function downloadToFile(url, destPath, timeoutMs = 600000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(destPath));
    return fs.statSync(destPath).size;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Resolve the JP2 zip URL for an IA item.
 * Falls back to PDF if no JP2 zip exists.
 */
async function resolveDownloadUrl(iaId) {
  const metaRes = await fetch(`https://archive.org/metadata/${iaId}/files`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!metaRes.ok) return null;

  const data = await metaRes.json();
  const files = data.result || data.files || [];

  // Prefer JP2 zip (original quality scans)
  const jp2Zip = files.find(f => f.name?.endsWith('_jp2.zip'));
  if (jp2Zip) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(jp2Zip.name)}`,
      format: 'jp2',
      size: parseInt(jp2Zip.size || '0'),
    };
  }

  // Fall back to Image Container PDF
  const pdfs = files.filter(f => f.name?.endsWith('.pdf'));
  const imagePdf = pdfs.find(f => f.format === 'Image Container PDF');
  const primaryPdf = pdfs.find(f => !f.name.endsWith('_text.pdf'));
  const chosenPdf = imagePdf || primaryPdf || pdfs[0];
  if (chosenPdf) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(chosenPdf.name)}`,
      format: 'pdf',
      size: parseInt(chosenPdf.size || '0'),
    };
  }

  return null;
}

/**
 * Extract JP2 files from a zip without loading the whole thing into memory.
 * Uses unzip command-line tool.
 */
function extractJp2Zip(zipPath, destDir) {
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { timeout: 300000, stdio: 'pipe' });
  // Find all JP2 files recursively and return sorted
  const jp2Files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jp2')) jp2Files.push(full);
    }
  }
  walk(destDir);
  return jp2Files.sort();
}

/**
 * Convert a single JP2 file to JPEG buffer using opj_decompress + sharp.
 */
async function jp2ToJpeg(jp2Path) {
  // Use BMP output — opj_decompress writes it directly, no PNG encode overhead
  const bmpPath = jp2Path + '.out.bmp';
  try {
    await execFileAsync('opj_decompress', ['-i', jp2Path, '-o', bmpPath, '-threads', 'ALL_CPUS'], {
      timeout: 120000,
    });
  } catch (err) {
    // opj_decompress exits non-zero even on success sometimes, check if output exists
    if (!fs.existsSync(bmpPath)) {
      throw new Error(`opj_decompress failed: ${err.stderr?.slice(0, 200) || err.message}`);
    }
  }

  let sharpPipeline = sharp(bmpPath);

  // Cap only when explicitly requested via --max-dim
  const meta = await sharpPipeline.metadata();
  if (MAX_DIMENSION > 0 && (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION)) {
    sharpPipeline = sharp(bmpPath).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  const jpegBuffer = await sharpPipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

  // Clean up intermediate BMP
  try { fs.unlinkSync(bmpPath); } catch {}

  return jpegBuffer;
}

/**
 * Fetch an image from a URL, resize if needed, return JPEG buffer.
 * Handles full-res IIIF URLs by requesting a capped size.
 */
async function fetchPageImage(photoUrl, iaId) {
  // Fetch source fidelity by default: leave the IIIF size segment alone unless
  // --max-dim was passed. Note IA's IIIF v3 zip-path endpoint accepts ONLY
  // `full/max` — a `!W,H` rewrite there is an HTTP 400, so capping happens
  // post-download via sharp in that case anyway.
  let url = photoUrl;
  if (MAX_DIMENSION > 0 &&
      (/\/full\/[^/]+\/[0-9]+\/[a-z]+\.(jpe?g|png|tif)/i.test(url) ||
       (url.includes('archive.org') && url.includes('/page/'))) &&
      !url.includes('iiif.archive.org/image/iiif/3/')) {
    url = url.replace(/\/full\/[^/]+\//, `/full/!${MAX_DIMENSION},${MAX_DIMENSION}/`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    stats.bytesDownloaded += buf.length;

    // Convert to JPEG at target quality (input might be any format)
    let sharpInst = sharp(buf);
    const meta = await sharpInst.metadata();
    if (MAX_DIMENSION > 0 && (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION)) {
      sharpInst = sharp(buf).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
    }
    return await sharpInst.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Process a single IA book: fetch each page from its IIIF URL, upload to R2.
 *
 * Previous approach downloaded _jp2.zip and mapped by leaf index, but IA's IIIF
 * manifest can reorder pages relative to JP2 filenames (plates, fold-outs, etc.),
 * causing ~33% of books to have drifted page images.
 *
 * New approach: fetch each page directly from its photo_original IIIF URL.
 * Correct by construction — no mapping needed.
 */
async function processBook(book, db) {
  // For provenance/logging only. IIIF books from NDL/Bodleian/etc. won't
  // have ia_identifier; that's fine — the actual fetch uses each page's
  // own photo_original URL.
  const sourceId = book.ia_identifier
    || book.image_source?.identifier
    || (book.image_source?.iiif_manifest ? book.image_source.iiif_manifest.split('/').slice(-2, -1)[0] : null);

  // Get pages needing archiving for this book
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, archived_photo: { $exists: false } },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) { stats.booksSkipped++; return; }

  const totalPages = book.pages_count || pages.length;
  console.log(`  [IIIF] ${book.title?.slice(0, 50)} — ${pages.length}/${totalPages} pages to archive`);

  // Accept any IIIF-shaped page URL (any provider) plus IA's /page/ legacy
  // shape. Reject pages that already point at our own R2 (images.sourcelibrary.org).
  const workItems = pages.filter(p => {
    const url = p.photo_original || p.photo || '';
    if (!url || url.includes('images.sourcelibrary.org')) return false;
    return url.includes('/page/')                                  // IA legacy
      || /\/full\/[^/]+\/[0-9]+\/[a-z]+\.(jpe?g|png|tif)/i.test(url); // IIIF
  });

  if (workItems.length === 0) {
    console.log(`    [SKIP] No fetchable image URLs found`);
    stats.booksSkipped++;
    return;
  }

  // Process pages with parallel workers
  let workIdx = 0;
  let archived = 0;
  let failed = 0;

  async function pageWorker() {
    while (workIdx < workItems.length) {
      const idx = workIdx++;
      if (idx >= workItems.length) break;
      const page = workItems[idx];
      const photoUrl = page.photo_original || page.photo;

      try {
        const jpegBuffer = await fetchPageImage(photoUrl, sourceId);

        // Upload to R2
        const key = `archived/${page.book_id}/${page.page_number}.jpg`;
        // This exact line shipped the #3362 incident: `book_id` was missing from
        // the pages projection, so the key became `archived/undefined/<N>.jpg`.
        assertBookScopedKey(key, page.book_id, 'archive-ia-bulk');
        const url = await uploadToR2(key, jpegBuffer);
        stats.bytesUploaded += jpegBuffer.length;

        // Generate thumbnail
        let thumbnailUrl;
        if (!SKIP_THUMBNAILS) {
          const thumbBuffer = await sharp(jpegBuffer).resize(150, 150, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
          const thumbKey = `thumbnails/${page.book_id}/${page.page_number}.jpg`;
          thumbnailUrl = await uploadToR2(thumbKey, thumbBuffer);
          stats.bytesUploaded += thumbBuffer.length;
        }

        // Update MongoDB
        const update = { $set: { archived_photo: url } };
        if (thumbnailUrl) update.$set.thumbnail_blob = thumbnailUrl;
        await db.collection('pages').updateOne({ _id: page._id }, update);

        archived++;
      } catch (err) {
        failed++;
        if (failed <= 5) {
          console.log(`    [FAIL] page ${page.page_number}: ${err.message?.slice(0, 120)}`);
        }
      }
    }
  }

  const numWorkers = Math.min(PAGE_CONCURRENCY, workItems.length);
  await Promise.all(Array.from({ length: numWorkers }, () => pageWorker()));

  stats.pagesArchived += archived;
  stats.pagesFailed += failed;
  stats.booksProcessed++;

  console.log(`    ${archived} archived, ${failed} failed (${numWorkers} workers)`);
}

async function main() {
  console.log(`IA Bulk Archiver — ${CONCURRENCY} books × ${PAGE_CONCURRENCY} pages concurrent, quality: ${JPEG_QUALITY}, max-dim: ${MAX_DIMENSION}`);
  console.log(`  R2 bucket: ${R2_BUCKET_NAME}, URL: ${R2_PUBLIC_URL}`);
  console.log(`  User-Agent: ${USER_AGENT}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find books with unarchived pages. By default include any provider
  // whose pages hotlink to an external IIIF/IA URL. --ia-only restores
  // the original IA-only behaviour for callers who want it.
  const IA_ONLY = hasFlag('ia-only');
  const bookQuery = IA_ONLY
    ? { $or: [
        { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
        { 'image_source.provider': { $in: ['ia', 'internet_archive'] } },
      ]}
    : { 'image_source.provider': { $exists: true, $ne: null, $nin: ['wikimedia_commons', 'rijksmuseum', 'met', 'nga'] } };
  if (BOOK_ID) bookQuery._id = /^[a-f0-9]{24}$/i.test(BOOK_ID) ? ObjectId.createFromHexString(BOOK_ID) : BOOK_ID;

  const iaBooks = await db.collection('books')
    .find(bookQuery, { projection: { _id: 1, id: 1, title: 1, ia_identifier: 1, image_source: 1, pages_count: 1 } })
    .sort({ created_at: -1 }) // newest books first (likely unarchived)
    .limit(BOOK_LIMIT || 0)
    .toArray();

  console.log(`Found ${iaBooks.length} candidate books (${IA_ONLY ? 'IA-only' : 'all IIIF providers'})`);

  if (DRY_RUN) {
    console.log('Dry run — not processing.');
    await client.close();
    return;
  }

  // Process books with controlled concurrency
  let bookIndex = 0;
  const progressInterval = setInterval(printProgress, 30000);

  async function worker() {
    while (bookIndex < iaBooks.length) {
      const idx = bookIndex++;
      const book = iaBooks[idx];
      console.log(`\n[${idx + 1}/${iaBooks.length}] ${book.title?.slice(0, 60)} (${book.pages_count || '?'} pages)`);
      await processBook(book, db);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, iaBooks.length) }, () => worker());
  await Promise.all(workers);

  clearInterval(progressInterval);
  printProgress();

  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n============================================================`);
  console.log(`Done in ${Math.round(elapsed)}s`);
  console.log(`Books: ${stats.booksProcessed} processed, ${stats.booksFailed} failed, ${stats.booksSkipped} skipped`);
  console.log(`Pages: ${stats.pagesArchived} archived, ${stats.pagesFailed} failed`);
  console.log(`Data: ${(stats.bytesDownloaded / (1024 * 1024 * 1024)).toFixed(1)}GB downloaded, ${(stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(1)}GB uploaded`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
