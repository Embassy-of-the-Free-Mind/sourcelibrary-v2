#!/usr/bin/env node
/**
 * BPH S3→R2 Migration — imports BPH books from Momo's S3 manifest into R2 + MongoDB.
 *
 * Handles JP2 source images: downloads JP2, converts via opj_decompress → sharp pipeline.
 * Generates full-res, display (1200px), and thumbnail (150px) variants.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/bph-s3-to-r2.mjs --manifest /tmp/bph-manifest.json
 *   node scripts/migration/bph-s3-to-r2.mjs --manifest /tmp/bph-manifest.json --dry-run --limit 5
 *   node scripts/migration/bph-s3-to-r2.mjs --manifest /tmp/bph-manifest.json --resume  # skip books already imported
 *
 * Required env vars:
 *   MONGODB_URI, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { parseArgs } from 'util';
import sharp from 'sharp';
import { join } from 'path';

// --- Config ---
const CONCURRENCY = 20; // pages in parallel per book
const BOOK_CONCURRENCY = 3; // books in parallel
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const PROVIDER = 'bph';
const PROVIDER_NAME = 'Bibliotheca Philosophica Hermetica';
const DISPLAY_WIDTH = 1200;
const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_QUALITY = 60;
const DISPLAY_QUALITY = 80;
const FULL_QUALITY = 85;
const TMP_DIR = '/tmp/bph-jp2';
const PROGRESS_FILE = '/tmp/bph-migration-progress.json';

// --- Parse args ---
const { values: args } = parseArgs({
  options: {
    'manifest': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'limit': { type: 'string' },
    'offset': { type: 'string' },
    'concurrency': { type: 'string' },
    'book-concurrency': { type: 'string' },
    'resume': { type: 'boolean', default: false },
  },
});

const DRY_RUN = args['dry-run'];
const LIMIT = args['limit'] ? parseInt(args['limit']) : Infinity;
const OFFSET = args['offset'] ? parseInt(args['offset']) : 0;
const PARALLEL = args['concurrency'] ? parseInt(args['concurrency']) : CONCURRENCY;
const BOOK_PARALLEL = args['book-concurrency'] ? parseInt(args['book-concurrency']) : BOOK_CONCURRENCY;

// --- R2 client ---
function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

// --- Upload to R2 ---
async function uploadToR2(r2, key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// --- Convert JP2 to JPEG buffer ---
async function convertJp2(jp2Buffer) {
  // Write JP2 to temp file, convert with opj_decompress → TIF → sharp
  const id = Math.random().toString(36).slice(2);
  const jp2Path = join(TMP_DIR, `${id}.jp2`);
  const tifPath = join(TMP_DIR, `${id}.tif`);

  try {
    writeFileSync(jp2Path, jp2Buffer);
    execSync(`opj_decompress -i ${jp2Path} -o ${tifPath} 2>/dev/null`, {
      timeout: 60_000,
    });
    // Convert TIF to JPEG via sharp
    const jpegBuf = await sharp(tifPath).jpeg({ quality: FULL_QUALITY }).toBuffer();
    return jpegBuf;
  } finally {
    try { unlinkSync(jp2Path); } catch {}
    try { unlinkSync(tifPath); } catch {}
  }
}

// --- Fetch remote image ---
async function fetchImage(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

// --- Path helpers (mirrors src/lib/storage.ts) ---
function pagePaths(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return {
    full: `${base}-full.jpg`,
    display: `${base}.jpg`,
    thumb: `${base}-thumb.jpg`,
  };
}

// --- Make page record ---
function makePageRecord(bookId, pageNumber, photoUrl, thumbnailUrl) {
  const id = new ObjectId().toHexString();
  return {
    _id: new ObjectId(id),
    id,
    book_id: bookId,
    page_number: pageNumber,
    photo: photoUrl,
    thumbnail: thumbnailUrl,
    ocr: null,
    translation: null,
    summary: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// --- Provenance helper ---
function prov(field, value) {
  return {
    value,
    provenance: {
      source: 'bph-s3-manifest',
      provider: 'picturae-dam',
      method: 'bulk-import',
      confidence: 1.0,
      date: new Date().toISOString(),
    },
  };
}

// --- Make book record ---
function makeBookRecord(meta) {
  const id = new ObjectId().toHexString();
  const now = new Date();
  const provEntry = {
    source: 'bph-s3-manifest',
    provider: 'picturae-dam',
    method: 'bulk-import',
    confidence: 1.0,
    date: now.toISOString(),
  };

  return {
    _id: new ObjectId(id),
    id,
    title: meta.title || 'Untitled',
    display_title: meta.display_title || meta.title,
    author: meta.author || 'Unknown',
    language: meta.language || 'auto-detect',
    published: meta.year?.toString(),
    publisher: meta.publisher,
    place_published: meta.place_published,
    image_source: {
      provider: PROVIDER,
      provider_name: PROVIDER_NAME,
      license: 'publicdomain',
      source_id: meta.source_id, // Picturae DAM ID (RIT number)
    },
    dublin_core: {
      dc_title: meta.title,
      dc_creator: meta.author,
      dc_date: meta.year?.toString(),
      dc_publisher: meta.publisher,
      ...(meta.source_id && { dc_identifier: meta.source_id }),
      dc_source: `BPH / Picturae DAM (${meta.source_id})`,
    },
    field_provenance: {
      title: provEntry,
      author: provEntry,
      published: provEntry,
      publisher: provEntry,
      place_published: provEntry,
      language: meta.language ? provEntry : undefined,
    },
    pages_count: 0,
    pages_ocr: 0,
    pages_translated: 0,
    needs_splitting: true, // BPH scans are two-page spreads
    status: 'imported',
    hidden: true,
    pipeline_auto: {
      status: 'archive_complete', // images already on R2, skip archiving
      source: 'bph-s3-migration',
      queued_at: now,
      last_updated: now,
      retry_count: 0,
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// --- Concurrency limiter ---
async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// --- Import one book ---
async function importBook(r2, db, bookMeta, pageSourceList, bookIdx, totalBooks) {
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');
  const prefix = `[${bookIdx + 1}/${totalBooks}]`;

  // Check for existing by source_id
  const existing = await booksCol.findOne({
    'image_source.source_id': bookMeta.source_id,
    'image_source.provider': { $in: ['bph', 'efm'] },
  });
  if (existing) {
    console.log(`${prefix} SKIP (exists): ${bookMeta.title?.substring(0, 60)}`);
    return { skipped: true };
  }

  if (DRY_RUN) {
    console.log(`${prefix} DRY RUN: "${bookMeta.title?.substring(0, 60)}" — ${pageSourceList.length} pages`);
    return { dryRun: true };
  }

  // Create book record
  const book = makeBookRecord(bookMeta);
  await booksCol.insertOne(book);

  // Upload pages
  let uploaded = 0;
  let failed = 0;
  const startTime = Date.now();

  const pageRecords = await parallelMap(pageSourceList, async (pageSrc, idx) => {
    try {
      // Download JP2
      const jp2Buf = await fetchImage(pageSrc.url);
      const pageNum = pageSrc.page_number ?? idx + 1;
      const paths = pagePaths(book.id, pageNum);

      // Convert JP2 → JPEG
      const fullBuf = await convertJp2(jp2Buf);

      // Generate display + thumb variants
      const [displayBuf, thumbBuf] = await Promise.all([
        sharp(fullBuf).resize(DISPLAY_WIDTH).jpeg({ quality: DISPLAY_QUALITY }).toBuffer(),
        sharp(fullBuf).resize(THUMBNAIL_WIDTH).jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer(),
      ]);

      // Upload all three to R2
      const [photoUrl, , thumbUrl] = await Promise.all([
        uploadToR2(r2, paths.full, fullBuf),
        uploadToR2(r2, paths.display, displayBuf),
        uploadToR2(r2, paths.thumb, thumbBuf),
      ]);

      uploaded++;
      if (uploaded % 20 === 0 || uploaded === pageSourceList.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = uploaded / elapsed;
        const remaining = Math.round((pageSourceList.length - uploaded) / rate);
        console.log(`${prefix}   ${uploaded}/${pageSourceList.length} pages (${rate.toFixed(1)}/s, ~${remaining}s left)`);
      }

      return makePageRecord(book.id, pageNum, photoUrl, thumbUrl);
    } catch (err) {
      failed++;
      console.error(`${prefix}   FAIL page ${pageSrc.page_number ?? idx}: ${err.message}`);
      return null;
    }
  }, PARALLEL);

  // Insert page records
  const validPages = pageRecords.filter(Boolean);
  if (validPages.length > 0) {
    await pagesCol.insertMany(validPages);
  }

  // Update book with counts + thumbnail
  const firstPage = validPages.find(p => p.page_number === 1) || validPages[0];
  await booksCol.updateOne({ _id: book._id }, {
    $set: {
      pages_count: validPages.length,
      thumbnail: firstPage?.photo,
      updated_at: new Date(),
    },
  });

  console.log(`${prefix} Done: ${validPages.length} pages (${failed} failed) — ${bookMeta.title?.substring(0, 60)}`);
  return { imported: validPages.length, failed };
}

// --- Progress tracking ---
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { completed: [] };
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

// --- Main ---
async function main() {
  if (!args['manifest']) {
    console.error('Usage: node bph-s3-to-r2.mjs --manifest /tmp/bph-manifest.json [--dry-run] [--limit N] [--offset N] [--resume]');
    process.exit(1);
  }

  console.log('BPH S3→R2 Migration');
  console.log(`Concurrency: ${PARALLEL} pages/book × ${BOOK_PARALLEL} books = ${PARALLEL * BOOK_PARALLEL} total`);
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT}, Offset: ${OFFSET}`);

  // Ensure tmp dir exists
  mkdirSync(TMP_DIR, { recursive: true });

  // Load manifest
  const manifest = JSON.parse(readFileSync(args['manifest'], 'utf8'));
  console.log(`Manifest: ${manifest.length} books total`);

  // Filter by offset/limit
  let books = manifest.slice(OFFSET, OFFSET + LIMIT);

  // Resume support
  const progress = args['resume'] ? loadProgress() : { completed: [] };
  if (args['resume'] && progress.completed.length > 0) {
    const completedSet = new Set(progress.completed);
    const before = books.length;
    books = books.filter(b => !completedSet.has(b.source_id));
    console.log(`Resume: skipping ${before - books.length} already completed`);
  }

  console.log(`Importing ${books.length} books\n`);

  const r2 = getR2Client();
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  let imported = 0, skipped = 0, failed = 0;
  let totalPages = 0;
  const globalStart = Date.now();
  let bookIdx = 0;

  // Process books in parallel batches
  await parallelMap(books, async (bookData) => {
    const myIdx = bookIdx++;
    try {
      const result = await importBook(r2, db, bookData, bookData.pages, myIdx, books.length);
      if (result.skipped) {
        skipped++;
      } else if (result.dryRun) {
        // nothing
      } else {
        imported++;
        totalPages += result.imported || 0;
        // Track progress
        progress.completed.push(bookData.source_id);
        if (imported % 3 === 0) saveProgress(progress);
      }
    } catch (err) {
      console.error(`ERROR on ${bookData.source_id}: ${err.message}`);
      failed++;
    }

    // Print global stats every 10 books
    const done = imported + skipped + failed;
    if (done % 10 === 0 && imported > 0) {
      const elapsed = (Date.now() - globalStart) / 1000 / 60;
      const pagesPerMin = totalPages / elapsed;
      const avgPagesPerBook = totalPages / imported;
      const remainingPages = (books.length - done) * avgPagesPerBook;
      const remainingMin = Math.round(remainingPages / pagesPerMin);
      const remainingHrs = (remainingMin / 60).toFixed(1);
      console.log(`\n--- ${imported} imported, ${skipped} skipped, ${failed} failed | ${totalPages} pages | ${pagesPerMin.toFixed(0)} pages/min | ~${remainingHrs}h remaining ---\n`);
    }
  }, BOOK_PARALLEL);

  saveProgress(progress);

  const elapsed = ((Date.now() - globalStart) / 1000 / 60).toFixed(1);
  console.log(`\nDone in ${elapsed} min. Imported: ${imported} books (${totalPages} pages), Skipped: ${skipped}, Failed: ${failed}`);
  console.log('Next: run split detection + OCR as batch jobs on imported books.');
  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
