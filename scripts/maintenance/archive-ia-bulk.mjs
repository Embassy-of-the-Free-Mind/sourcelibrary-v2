#!/usr/bin/env node
/**
 * Bulk IA image archiver using JP2 zip downloads.
 *
 * Instead of hitting IA's IIIF endpoint once per page (server-side rendering),
 * downloads the pre-built _jp2.zip per book (1 static file), extracts pages,
 * converts JP2 → JPEG, and uploads to R2.
 *
 * ~3,500 IA books × 1 zip download each vs ~1M individual IIIF requests.
 *
 * Requires: opj_decompress (apt-get install libopenjp2-tools), sharp, @aws-sdk/client-s3
 *
 * Usage:
 *   node scripts/maintenance/archive-ia-bulk.mjs                     # all IA books
 *   node scripts/maintenance/archive-ia-bulk.mjs --limit=50          # first 50 books
 *   node scripts/maintenance/archive-ia-bulk.mjs --concurrency=5     # parallel book downloads
 *   node scripts/maintenance/archive-ia-bulk.mjs --book-id=abc123    # single book
 *   node scripts/maintenance/archive-ia-bulk.mjs --skip-thumbnails   # skip 150px thumbs
 *   node scripts/maintenance/archive-ia-bulk.mjs --dry-run           # count only
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const CONCURRENCY = parseInt(getArg('concurrency') || '3', 10); // book-level concurrency
const BOOK_LIMIT = parseInt(getArg('limit') || '0', 10);
const BOOK_ID = getArg('book-id');
const SKIP_THUMBNAILS = hasFlag('skip-thumbnails');
const DRY_RUN = hasFlag('dry-run');
const JPEG_QUALITY = parseInt(getArg('quality') || '85', 10);
const MAX_DIMENSION = parseInt(getArg('max-dim') || '3000', 10); // cap huge pages

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// Verify opj_decompress is available
try { execSync('which opj_decompress', { stdio: 'pipe' }); }
catch { console.error('opj_decompress not found. Install: apt-get install libopenjp2-tools'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

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
  // Use PNG output (smaller than BMP, lossless)
  const pngPath = jp2Path + '.out.png';
  try {
    execSync(`opj_decompress -i "${jp2Path}" -o "${pngPath}" -threads ALL_CPUS`, {
      timeout: 120000,
      stdio: 'pipe',
    });
  } catch (err) {
    // opj_decompress exits non-zero even on success sometimes, check if output exists
    if (!fs.existsSync(pngPath)) {
      throw new Error(`opj_decompress failed: ${err.stderr?.toString().slice(0, 200) || err.message}`);
    }
  }

  let sharpPipeline = sharp(pngPath);

  // Get dimensions and cap if too large
  const meta = await sharpPipeline.metadata();
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    sharpPipeline = sharp(pngPath).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  const jpegBuffer = await sharpPipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

  // Clean up intermediate PNG (JP2 cleaned up with tmpDir)
  try { fs.unlinkSync(pngPath); } catch {}

  return jpegBuffer;
}

/**
 * Process a single IA book: download zip, extract, convert, upload.
 */
async function processBook(book, db) {
  const iaId = book.ia_identifier || book.image_source?.identifier;
  if (!iaId) { stats.booksSkipped++; return; }

  // Get pages needing archiving for this book
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, archived_photo: { $exists: false } },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) { stats.booksSkipped++; return; }

  // Also get all pages to build the leaf-number mapping
  const allPages = await db.collection('pages')
    .find(
      { book_id: book.id },
      { projection: { _id: 1, id: 1, page_number: 1, photo: 1, photo_original: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-ia-${iaId.slice(0, 20)}-`));

  try {
    // Resolve download URL
    const download = await resolveDownloadUrl(iaId);
    if (!download) {
      console.log(`  [SKIP] ${book.title?.slice(0, 50)} — no JP2 zip or PDF found`);
      stats.booksSkipped++;
      return;
    }

    const sizeMb = download.size ? `${(download.size / (1024 * 1024)).toFixed(0)}MB` : '?MB';
    console.log(`  [${download.format.toUpperCase()}] ${book.title?.slice(0, 50)} — ${pages.length}/${allPages.length} pages, ${sizeMb} download`);

    // Download
    const downloadPath = path.join(tmpDir, `book.${download.format === 'jp2' ? 'zip' : 'pdf'}`);
    const downloadSize = await downloadToFile(download.url, downloadPath);
    stats.bytesDownloaded += downloadSize;

    // Extract/split pages
    let pageFiles; // sorted array of file paths
    if (download.format === 'jp2') {
      pageFiles = extractJp2Zip(downloadPath, tmpDir);
      fs.unlinkSync(downloadPath); // free disk
    } else {
      // PDF fallback — use pdftoppm
      const outPrefix = path.join(tmpDir, 'page');
      execSync(`pdftoppm -jpeg -r 200 "${downloadPath}" "${outPrefix}"`, { timeout: 600000, stdio: 'pipe' });
      fs.unlinkSync(downloadPath);
      pageFiles = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
        .sort()
        .map(f => path.join(tmpDir, f));
    }

    if (pageFiles.length === 0) {
      console.log(`    [WARN] No page files extracted`);
      stats.booksFailed++;
      return;
    }

    console.log(`    ${pageFiles.length} ${download.format} files extracted (first: ${path.basename(pageFiles[0])}, last: ${path.basename(pageFiles[pageFiles.length - 1])})`);


    // Build leaf-number → file-index mapping
    // IA URLs: /page/nN/ where N is 0-based leaf number
    // JP2 zip files are named like identifier_0000.jp2 (0-indexed)
    // PDF pages via pdftoppm are 1-indexed: page-01.jpg
    const needsArchiveIds = new Set(pages.map(p => (p.id || p._id.toString())));
    let archived = 0;
    let failed = 0;

    for (const page of allPages) {
      const pageId = page.id || page._id.toString();
      if (!needsArchiveIds.has(pageId)) continue;

      // Extract leaf number from URL
      const photoUrl = page.photo_original || page.photo || '';
      const leafMatch = photoUrl.match(/\/page\/n(\d+)/);
      if (!leafMatch) { failed++; continue; }

      const leafNum = parseInt(leafMatch[1]);
      if (leafNum >= pageFiles.length) { failed++; continue; }

      const srcFile = pageFiles[leafNum];

      try {
        let jpegBuffer;
        if (download.format === 'jp2') {
          jpegBuffer = await jp2ToJpeg(srcFile);
        } else {
          // PDF pages are already JPEG — just resize if needed
          let pipeline = sharp(srcFile);
          const meta = await pipeline.metadata();
          if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
            pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
          }
          jpegBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
        }

        // Upload to R2
        const key = `archived/${page.book_id}/${page.page_number}.jpg`;
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
        if (failed <= 3) console.log(`    [FAIL] page ${page.page_number}: ${err.message?.slice(0, 80)}`);
      }
    }

    stats.pagesArchived += archived;
    stats.pagesFailed += failed;
    stats.booksProcessed++;

    console.log(`    ${archived} archived, ${failed} failed`);

  } catch (err) {
    console.log(`  [ERROR] ${book.title?.slice(0, 50)}: ${err.message?.slice(0, 100)}`);
    stats.booksFailed++;
  } finally {
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  console.log(`IA Bulk Archiver — concurrency: ${CONCURRENCY} books, quality: ${JPEG_QUALITY}, max-dim: ${MAX_DIMENSION}`);
  console.log(`  R2 bucket: ${R2_BUCKET_NAME}, URL: ${R2_PUBLIC_URL}`);
  console.log(`  User-Agent: ${USER_AGENT}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find IA books with unarchived pages
  // Query books collection (indexed, fast) instead of scanning pages
  const bookQuery = {
    $or: [
      { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
      { 'image_source.provider': 'ia' },
    ],
  };
  if (BOOK_ID) bookQuery._id = BOOK_ID;

  const iaBooks = await db.collection('books')
    .find(bookQuery, { projection: { _id: 1, id: 1, title: 1, ia_identifier: 1, image_source: 1, pages_count: 1 } })
    .sort({ created_at: -1 }) // newest books first (likely unarchived)
    .limit(BOOK_LIMIT || 0)
    .toArray();

  console.log(`Found ${iaBooks.length} IA books`);

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
