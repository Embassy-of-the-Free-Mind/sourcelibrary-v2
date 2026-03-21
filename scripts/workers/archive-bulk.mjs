#!/usr/bin/env node
/**
 * Bulk IA Archive Worker (pipeline-aware)
 *
 * Downloads _jp2.zip per book instead of individual IIIF requests.
 * ~4x faster than per-page IIIF archiving, full original quality.
 *
 * Only handles IA books. Non-IA sources stay on archive-ocr.mjs (IIIF per-page).
 *
 * Priority: first translations > non-English > English
 *
 * Requires: opj_decompress (libopenjp2-tools), sharp, unzip
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-bulk.mjs
 *   node scripts/workers/archive-bulk.mjs --limit=10 --dry-run
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { execSync } from 'child_process';
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

const BOOK_LIMIT = parseInt(getArg('limit') || '20', 10);  // Books per cron run
const BOOK_CONCURRENCY = parseInt(getArg('concurrency') || '2', 10);
const PAGE_CONCURRENCY = parseInt(getArg('page-concurrency') || '8', 10);
const DRY_RUN = hasFlag('dry-run');
const JPEG_QUALITY = 85;
const MAX_DIMENSION = 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// sharp handles JP2 decoding via libvips — no external tools needed

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const stats = {
  booksProcessed: 0, booksSkipped: 0, booksFailed: 0,
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

async function downloadToFile(url, destPath, timeoutMs = 600000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(destPath));
    return fs.statSync(destPath).size;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function resolveDownloadUrl(iaId) {
  const metaRes = await fetch(`https://archive.org/metadata/${iaId}/files`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!metaRes.ok) return null;
  const data = await metaRes.json();
  const files = data.result || data.files || [];

  const jp2Zip = files.find(f => f.name?.endsWith('_jp2.zip'));
  if (jp2Zip) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(jp2Zip.name)}`,
      format: 'jp2', size: parseInt(jp2Zip.size || '0'),
    };
  }

  const pdfs = files.filter(f => f.name?.endsWith('.pdf'));
  const chosenPdf = pdfs.find(f => f.format === 'Image Container PDF') || pdfs.find(f => !f.name.endsWith('_text.pdf')) || pdfs[0];
  if (chosenPdf) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(chosenPdf.name)}`,
      format: 'pdf', size: parseInt(chosenPdf.size || '0'),
    };
  }
  return null;
}

function extractJp2Zip(zipPath, destDir) {
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { timeout: 300000, stdio: 'pipe' });
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

async function jp2ToJpeg(jp2Path) {
  // Use sharp directly — it has built-in JPEG2000 support via libvips
  // No need for opj_decompress intermediate step
  let sharpPipeline = sharp(jp2Path);
  const meta = await sharpPipeline.metadata();
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    sharpPipeline = sharp(jp2Path).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }
  return sharpPipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

async function processBook(book, db) {
  const iaId = book.ia_identifier || book.image_source?.identifier;
  if (!iaId) { stats.booksSkipped++; return; }

  const pages = await db.collection('pages')
    .find({ book_id: book.id, $or: [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }] },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1 } })
    .sort({ page_number: 1 }).toArray();

  if (pages.length === 0) { stats.booksSkipped++; return; }

  const allPages = await db.collection('pages')
    .find({ book_id: book.id }, { projection: { _id: 1, id: 1, page_number: 1, photo: 1, photo_original: 1 } })
    .sort({ page_number: 1 }).toArray();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-bulk-${iaId.slice(0, 20)}-`));

  try {
    const download = await resolveDownloadUrl(iaId);
    if (!download) {
      console.log(`  [SKIP] ${book.title?.slice(0, 50)} — no JP2 zip or PDF`);
      stats.booksSkipped++;
      return;
    }

    const sizeMb = download.size ? `${(download.size / (1024 * 1024)).toFixed(0)}MB` : '?MB';
    console.log(`  [${download.format.toUpperCase()}] ${book.title?.slice(0, 50)} — ${pages.length} pages, ${sizeMb}`);

    const downloadPath = path.join(tmpDir, `book.${download.format === 'jp2' ? 'zip' : 'pdf'}`);
    const downloadSize = await downloadToFile(download.url, downloadPath);
    stats.bytesDownloaded += downloadSize;

    let pageFiles;
    if (download.format === 'jp2') {
      pageFiles = extractJp2Zip(downloadPath, tmpDir);
      fs.unlinkSync(downloadPath);
    } else {
      const outPrefix = path.join(tmpDir, 'page');
      execSync(`pdftoppm -jpeg -r 200 "${downloadPath}" "${outPrefix}"`, { timeout: 600000, stdio: 'pipe' });
      fs.unlinkSync(downloadPath);
      pageFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('page-') && f.endsWith('.jpg')).sort().map(f => path.join(tmpDir, f));
    }

    if (pageFiles.length === 0) {
      console.log(`    [WARN] No page files extracted`);
      stats.booksFailed++;
      return;
    }

    const needsArchiveIds = new Set(pages.map(p => (p.id || p._id.toString())));
    const workItems = [];

    for (const page of allPages) {
      const pageId = page.id || page._id.toString();
      if (!needsArchiveIds.has(pageId)) continue;
      const photoUrl = page.photo_original || page.photo || '';
      const leafMatch = photoUrl.match(/\/page\/n(\d+)/);
      if (!leafMatch) continue;
      const leafNum = parseInt(leafMatch[1]);
      if (leafNum >= pageFiles.length) continue;
      const srcFile = pageFiles[leafNum];
      if (!fs.existsSync(srcFile)) continue;
      workItems.push({ page, srcFile, format: download.format });
    }

    let workIdx = 0;
    let archived = 0;
    let failed = 0;

    async function pageWorker() {
      while (workIdx < workItems.length) {
        const idx = workIdx++;
        if (idx >= workItems.length) break;
        const { page, srcFile, format } = workItems[idx];
        try {
          let jpegBuffer;
          if (format === 'jp2') {
            jpegBuffer = await jp2ToJpeg(srcFile);
          } else {
            let sharpInst = sharp(srcFile);
            const meta = await sharpInst.metadata();
            if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
              sharpInst = sharp(srcFile).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
            }
            jpegBuffer = await sharpInst.jpeg({ quality: JPEG_QUALITY }).toBuffer();
          }

          const key = `archived/${page.book_id}/${page.page_number}.jpg`;
          const url = await uploadToR2(key, jpegBuffer);
          stats.bytesUploaded += jpegBuffer.length;

          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: {
              archived_photo: url,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source': 'bulk_jp2',
              'archive_metadata.bytes': jpegBuffer.length,
            }}
          );
          archived++;
        } catch (err) {
          failed++;
          if (failed <= 3) console.log(`    [FAIL] page ${page.page_number}: ${err.message?.slice(0, 100)}`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, workItems.length) }, () => pageWorker()));
    stats.pagesArchived += archived;
    stats.pagesFailed += failed;
    stats.booksProcessed++;
    console.log(`    ${archived} archived, ${failed} failed`);

  } catch (err) {
    console.log(`  [ERROR] ${book.title?.slice(0, 50)}: ${err.message?.slice(0, 100)}`);
    stats.booksFailed++;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-bulk] Bulk JP2 archiver — ${BOOK_LIMIT} books, ${BOOK_CONCURRENCY} concurrent`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find IA books in archiving status with unarchived pages
  // Priority: first translations > non-English > English
  const ENGLISH_VARIANTS = ['english', 'eng', 'en'];
  const iaBooks = await db.collection('books')
    .aggregate([
      { $match: {
        'pipeline_auto.status': 'archiving',
        $or: [
          { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
          { 'image_source.provider': 'internet_archive' },
        ],
      }},
      { $addFields: {
        _priority: {
          $switch: {
            branches: [
              { case: { $eq: ['$is_first_translation', true] }, then: 0 },
              { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS] }, then: 2 },
            ],
            default: 1,
          },
        },
      }},
      { $sort: { _priority: 1, hidden: 1 } },
      { $project: { id: 1, title: 1, ia_identifier: 1, image_source: 1, pages_count: 1, language: 1 } },
      { $limit: BOOK_LIMIT },
    ])
    .toArray();

  console.log(`[archive-bulk] Found ${iaBooks.length} IA books to archive`);

  if (DRY_RUN) {
    iaBooks.forEach((b, i) => console.log(`  ${i + 1}. ${b.title?.slice(0, 60)} (${b.pages_count || '?'} pages, ${b.language || '?'})`));
    await client.close();
    return;
  }

  let bookIndex = 0;
  async function worker() {
    while (bookIndex < iaBooks.length) {
      const idx = bookIndex++;
      const book = iaBooks[idx];
      console.log(`\n[${idx + 1}/${iaBooks.length}] ${book.title?.slice(0, 60)} (${book.pages_count || '?'} pages)`);
      await processBook(book, db);
    }
  }

  await Promise.all(Array.from({ length: Math.min(BOOK_CONCURRENCY, iaBooks.length) }, () => worker()));

  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n[archive-bulk] Done in ${Math.round(elapsed)}s`);
  console.log(`  Books: ${stats.booksProcessed} processed, ${stats.booksFailed} failed, ${stats.booksSkipped} skipped`);
  console.log(`  Pages: ${stats.pagesArchived} archived, ${stats.pagesFailed} failed`);
  console.log(`  Data: ${(stats.bytesDownloaded / (1024 * 1024 * 1024)).toFixed(1)}GB down, ${(stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(1)}GB up`);

  // Log to cron_runs
  await db.collection('cron_runs').insertOne({
    cron: 'archive-bulk',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: stats.booksFailed === 0 ? 'success' : 'partial',
    actions: { ...stats },
  });

  await client.close();
}

main().catch(err => { console.error('[archive-bulk] Fatal:', err); process.exit(1); });
