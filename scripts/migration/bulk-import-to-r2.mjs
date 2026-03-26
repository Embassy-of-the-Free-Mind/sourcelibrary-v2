#!/usr/bin/env node
/**
 * Bulk BPH/EFM image import — uploads directly to R2, inserts MongoDB records.
 *
 * Skips split detection, OCR, translation — those run as batch jobs after import.
 *
 * Required env vars:
 *   MONGODB_URI, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME (default: sourcelibrary), R2_PUBLIC_URL (default: https://images.sourcelibrary.org)
 *
 * Usage:
 *   node scripts/migration/bulk-import-to-r2.mjs --source-dir /path/to/images
 *   node scripts/migration/bulk-import-to-r2.mjs --source-url https://s3.amazonaws.com/bucket/manifest.json
 *   node scripts/migration/bulk-import-to-r2.mjs --dry-run --limit 10
 *
 * Manifest format (JSON array):
 *   [{ "book_id": "abc", "title": "...", "author": "...", "year": 1728,
 *      "pages": [{ "url": "https://...", "page_number": 1 }, ...] }]
 *
 * Or provide a directory with structure:
 *   /source-dir/{book_id}/page_001.jpg, page_002.jpg, ...
 *   /source-dir/{book_id}/metadata.json  (title, author, year, language)
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient, ObjectId } from 'mongodb';
import { createReadStream, readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { basename, join, extname } from 'path';
import { parseArgs } from 'util';
import sharp from 'sharp';

// --- Config ---
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20');
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const PROVIDER = 'bph';
const PROVIDER_NAME = 'Bibliotheca Philosophica Hermetica';
const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_QUALITY = 60;

// --- Parse args ---
const { values: args } = parseArgs({
  options: {
    'source-dir': { type: 'string' },
    'source-url': { type: 'string' },
    'manifest': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'limit': { type: 'string' },
    'skip-existing': { type: 'boolean', default: true },
    'concurrency': { type: 'string' },
  },
});

const DRY_RUN = args['dry-run'];
const LIMIT = args['limit'] ? parseInt(args['limit']) : Infinity;
const PARALLEL = args['concurrency'] ? parseInt(args['concurrency']) : CONCURRENCY;

// --- R2 client ---
function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
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

// --- Generate thumbnail ---
async function makeThumbnail(buffer) {
  return sharp(buffer)
    .resize(THUMBNAIL_WIDTH)
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}

// --- Fetch remote image ---
async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- Create page record ---
function makePageRecord(bookId, pageNumber, photoUrl, thumbnailUrl) {
  const id = new ObjectId().toHexString();
  return {
    _id: new ObjectId(id),
    id,
    tenant_id: 'default',
    book_id: bookId,
    page_number: pageNumber,
    photo: photoUrl,
    photo_original: photoUrl,
    thumbnail: thumbnailUrl,
    ocr: null,
    translation: null,
    summary: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// --- Create book record ---
function makeBookRecord(meta) {
  const id = new ObjectId().toHexString();
  return {
    _id: new ObjectId(id),
    id,
    tenant_id: 'default',
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
      ...(meta.source_id && { source_id: meta.source_id }),
    },
    pages_count: 0,
    pages_ocr: 0,
    pages_translated: 0,
    status: 'draft',
    hidden: true,
    pipeline_auto: true,
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

// --- Import a single book ---
async function importBook(r2, db, bookMeta, pageSourceList) {
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');

  // Check for existing
  if (args['skip-existing']) {
    const existing = await booksCol.findOne({
      title: bookMeta.title,
      'image_source.provider': { $in: ['bph', 'efm'] },
    });
    if (existing) {
      console.log(`  SKIP (exists): ${bookMeta.title.substring(0, 60)}`);
      return { skipped: true };
    }
  }

  // Create book
  const book = makeBookRecord(bookMeta);

  if (DRY_RUN) {
    console.log(`  DRY RUN: would create book "${book.title.substring(0, 60)}" with ${pageSourceList.length} pages`);
    return { dryRun: true };
  }

  await booksCol.insertOne(book);
  console.log(`  Created book: ${book.id} — ${book.title.substring(0, 60)}`);

  // Upload pages in parallel
  let uploaded = 0;
  const pageRecords = await parallelMap(pageSourceList, async (pageSrc, idx) => {
    try {
      // Get image buffer
      const buffer = typeof pageSrc.url === 'string'
        ? await fetchImage(pageSrc.url)
        : pageSrc.buffer;

      const pageNum = pageSrc.page_number ?? idx + 1;
      const key = `archived/${book.id}/${String(pageNum).padStart(4, '0')}.jpg`;
      const thumbKey = `thumbnails/${book.id}/${String(pageNum).padStart(4, '0')}.jpg`;

      // Upload original + thumbnail in parallel
      const thumbBuf = await makeThumbnail(buffer);
      const [photoUrl, thumbUrl] = await Promise.all([
        uploadToR2(r2, key, buffer),
        uploadToR2(r2, thumbKey, thumbBuf),
      ]);

      uploaded++;
      if (uploaded % 50 === 0) {
        console.log(`    ${uploaded}/${pageSourceList.length} pages uploaded`);
      }

      return makePageRecord(book.id, pageNum, photoUrl, thumbUrl);
    } catch (err) {
      console.error(`    FAIL page ${pageSrc.page_number ?? idx}: ${err.message}`);
      return null;
    }
  }, PARALLEL);

  // Insert page records
  const validPages = pageRecords.filter(Boolean);
  if (validPages.length > 0) {
    await pagesCol.insertMany(validPages);
  }

  // Update book counts + thumbnail
  const firstPage = validPages.find(p => p.page_number === 1) || validPages[0];
  await booksCol.updateOne({ _id: book._id }, {
    $set: {
      pages_count: validPages.length,
      thumbnail: firstPage?.photo,
      updated_at: new Date(),
    },
  });

  console.log(`  Done: ${validPages.length} pages imported for ${book.title.substring(0, 60)}`);
  return { imported: validPages.length };
}

// --- Load manifest from directory ---
function loadFromDirectory(dir) {
  const books = [];
  for (const entry of readdirSync(dir)) {
    const bookDir = join(dir, entry);
    if (!statSync(bookDir).isDirectory()) continue;

    const metaPath = join(bookDir, 'metadata.json');
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : { title: entry };

    const pages = readdirSync(bookDir)
      .filter(f => /\.(jpe?g|png|tiff?)$/i.test(f))
      .sort()
      .map((f, i) => ({
        page_number: i + 1,
        buffer: readFileSync(join(bookDir, f)),
      }));

    books.push({ meta, pages });
  }
  return books;
}

// --- Load manifest from URL/file ---
async function loadManifest(source) {
  let data;
  if (source.startsWith('http')) {
    const res = await fetch(source);
    data = await res.json();
  } else {
    data = JSON.parse(readFileSync(source, 'utf8'));
  }
  return data.map(item => ({
    meta: {
      title: item.title,
      author: item.author,
      year: item.year,
      language: item.language,
      publisher: item.publisher,
      place_published: item.place_published,
      source_id: item.source_id,
    },
    pages: item.pages.map(p => ({ url: p.url, page_number: p.page_number })),
  }));
}

// --- Main ---
async function main() {
  console.log(`BPH Bulk Import to R2`);
  console.log(`Concurrency: ${PARALLEL}, Dry run: ${DRY_RUN}, Limit: ${LIMIT}`);

  const r2 = getR2Client();
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  let books;
  if (args['source-dir']) {
    console.log(`Loading from directory: ${args['source-dir']}`);
    books = loadFromDirectory(args['source-dir']);
  } else if (args['manifest'] || args['source-url']) {
    const src = args['manifest'] || args['source-url'];
    console.log(`Loading manifest: ${src}`);
    books = await loadManifest(src);
  } else {
    console.error('Provide --source-dir, --manifest, or --source-url');
    process.exit(1);
  }

  console.log(`Found ${books.length} books, importing up to ${LIMIT}\n`);

  let imported = 0, skipped = 0, failed = 0;
  for (const { meta, pages } of books.slice(0, LIMIT)) {
    try {
      console.log(`[${imported + skipped + 1}/${Math.min(books.length, LIMIT)}] ${meta.title?.substring(0, 60)}`);
      const result = await importBook(r2, db, meta, pages);
      if (result.skipped) skipped++;
      else imported++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log('Next steps: run split detection + OCR as batch jobs on the imported books.');
  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
