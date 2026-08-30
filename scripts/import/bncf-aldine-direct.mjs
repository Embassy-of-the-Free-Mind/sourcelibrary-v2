#!/usr/bin/env node
/**
 * BNCF Aldine direct import — writes straight to MongoDB from Hetzner.
 * Bypasses /api/import/ia to avoid Vercel connection pool saturation (the
 * May 15 incident: ~20 concurrent Vercel functions doing insertMany on Atlas).
 *
 * Usage (on Hetzner):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/bncf-aldine-direct.mjs
 *
 * Options:
 *   --dry-run        Preview without writing
 *   --delay=N        ms between imports (default: 3000)
 *   --start-from=N   Resume from item index N (0-based)
 *   --limit=N        Stop after N successful imports
 *   --data=PATH      Path to JSON input file (default: bncf-aldine-remaining.json)
 *
 * PDF-only books (step 5):
 *   Items with only a PDF are rasterized via pdftoppm (poppler-utils) and
 *   uploaded to R2 at the same key layout as jp2/IIIF books. Requires:
 *     apt-get install -y poppler-utils
 *   R2 env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *                R2_BUCKET_NAME (default: sourcelibrary), R2_PUBLIC_URL
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '3000');
const START_FROM = parseInt(args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '0');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

const DATA_FILE_ARG = args.find(a => a.startsWith('--data='))?.split('=')[1];
const DATA_FILE = DATA_FILE_ARG || new URL('../../bncf-aldine-remaining.json', import.meta.url).pathname;
const LOG_FILE = '/root/bncf-aldine-direct.log';

// R2 config (only required when PDF rasterization is needed)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

// Lazy-init S3 client — only created on first PDF book
let _s3 = null;
function getS3() {
  if (_s3) return _s3;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 env vars missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) — required for PDF rasterization');
  }
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return _s3;
}

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  const s3 = getS3();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const PDF_RASTERIZE_DPI = 300;
const PDF_JPEG_QUALITY = 85;
const PDF_MAX_DIMENSION = 3000;

if (!fs.existsSync(DATA_FILE)) {
  console.error(`Data file not found: ${DATA_FILE}`);
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
console.log(`Loaded ${entries.length} BNCF Aldine entries`);

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeTitle(t) {
  return t?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}

/**
 * Encode a filename component for an archive.org URL.
 *
 * IA stores Arabic/Hebrew/Persian filenames as NFD (decomposed Unicode) on
 * disk: e.g. أ is stored as ا + ٔ (alif + combining hamza-above), not as the
 * precomposed U+0623. CDN mirrors and the IIIF image server 404 on the NFC
 * form. NFD-normalizing first is a no-op for ASCII filenames, so it's safe
 * to apply universally.
 */
function nfdEnc(filename) {
  return encodeURIComponent(filename.normalize('NFD'));
}
function normalizeAuthor(a) {
  return a?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function sourceFingerprint({ ia_identifier }) {
  return `ia:${ia_identifier}`;
}

function slugify(text, maxLen = 60) {
  if (!text) return 'untitled';
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim().replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

async function generateUniqueSlug(db, title, author) {
  const base = slugify(`${title}-${author}`.substring(0, 80));
  let slug = base;
  let i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function getPageCount(iaIdentifier) {
  // 1. Try IIIF manifest
  try {
    const res = await fetch(
      `https://iiif.archive.org/iiif/${iaIdentifier}/manifest.json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) {
      const manifest = await res.json();
      if (manifest.items?.length) return { count: manifest.items.length, source: 'iiif_v3' };
      if (manifest.sequences?.[0]?.canvases?.length) return { count: manifest.sequences[0].canvases.length, source: 'iiif_v2' };
    }
  } catch {}

  // 2. Try IA metadata imagecount
  let iaMeta = null;
  try {
    const res = await fetch(`https://archive.org/metadata/${iaIdentifier}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      iaMeta = await res.json();
      const imagecount = iaMeta.metadata?.imagecount;
      if (imagecount) return { count: parseInt(imagecount, 10), source: 'imagecount' };

      // 3. Count JP2 files
      const jp2Count = (iaMeta.files || []).filter(f => f.name?.endsWith('.jp2') && !f.name.includes('thumb')).length;
      if (jp2Count > 1) return { count: jp2Count, source: 'jp2_files' };

      // 4. Count JPG files (BULAC and similar institutions upload sequential .jpg instead of .jp2)
      // Note: IA sometimes zips JP2s (zip not counted by step 3) but still serves them via IIIF image API.
      // JPG fallback is low-res (~72KB); prefer IIIF image server URLs when a jp2.zip is present.
      const jp2Zip = (iaMeta.files || []).find(f => f.name?.endsWith('_jp2.zip'));
      const jpgFiles = (iaMeta.files || [])
        .filter(f => f.name?.endsWith('.jpg') && !f.name.includes('thumb'))
        .map(f => f.name)
        .sort();
      if (jpgFiles.length > 1) return { count: jpgFiles.length, source: 'jpg_files', jpgFiles, jp2Zip: jp2Zip?.name || null };

      // 5. Detect single PDF item — download and count pages with pdfinfo
      // BNCF Aldine PDF-only items: no JP2s, no imagecount, IIIF returns 500/504
      // because IA's IIIF server has no source images to derive from.
      const pdfFiles = (iaMeta.files || []).filter(f =>
        f.name?.endsWith('.pdf') &&
        !f.name.endsWith('_text.pdf') &&
        // Prefer the canonical "<identifier>.pdf" but accept any non-text PDF
        (f.name === `${iaIdentifier}.pdf` || true)
      );
      const canonicalPdf = pdfFiles.find(f => f.name === `${iaIdentifier}.pdf`) || pdfFiles[0];
      if (canonicalPdf) {
        const pdfUrl = `https://archive.org/download/${iaIdentifier}/${encodeURIComponent(canonicalPdf.name)}`;
        const pageCount = await countPdfPages(pdfUrl, iaIdentifier);
        if (pageCount && pageCount > 0) {
          return { count: pageCount, source: 'pdf_rasterized', pdfUrl, pdfName: canonicalPdf.name };
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Download a PDF to a tmpfile and use pdfinfo to count its pages.
 * Returns page count or null on failure. Cleans up the tmpfile.
 * Requires poppler-utils (apt-get install -y poppler-utils).
 */
async function countPdfPages(pdfUrl, iaIdentifier) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-pdfcount-${iaIdentifier.slice(0, 20)}-`));
  const pdfPath = path.join(tmpDir, 'book.pdf');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(pdfUrl, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(res.body, createWriteStream(pdfPath));
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
    const out = execSync(`pdfinfo "${pdfPath}"`, { timeout: 30000, encoding: 'utf8', stdio: 'pipe' });
    const match = out.match(/^Pages:\s*(\d+)/m);
    return match ? parseInt(match[1], 10) : null;
  } catch (err) {
    log(`  [pdfinfo] ${iaIdentifier}: ${err.message?.slice(0, 100)}`);
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Rasterize all pages of a PDF and upload to R2.
 * Returns array of { pageNumber, r2Key, url } in order.
 * Cleans up tmpdir when done.
 */
async function rasterizeAndUploadPdf(pdfUrl, iaIdentifier, bookId, pageCount) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-pdfras-${iaIdentifier.slice(0, 20)}-`));
  try {
    // Download PDF
    const pdfPath = path.join(tmpDir, 'book.pdf');
    log(`  [PDF] downloading ${pdfUrl}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);
    try {
      const res = await fetch(pdfUrl, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading PDF`);
      await pipeline(res.body, createWriteStream(pdfPath));
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }

    const pdfSizeMb = (fs.statSync(pdfPath).size / (1024 * 1024)).toFixed(1);
    log(`  [PDF] ${pdfSizeMb}MB — rasterizing at ${PDF_RASTERIZE_DPI}dpi`);

    // Rasterize: pdftoppm -jpeg -r DPI <pdf> <prefix>
    const outPrefix = path.join(tmpDir, 'page');
    execSync(`pdftoppm -jpeg -r ${PDF_RASTERIZE_DPI} "${pdfPath}" "${outPrefix}"`, {
      timeout: 600000,
      stdio: 'pipe',
    });
    fs.unlinkSync(pdfPath);

    // Collect rendered pages (named page-1.jpg, page-2.jpg, ... or page-001.jpg etc.)
    const pageFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page-') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.ppm')))
      .sort()
      .map(f => path.join(tmpDir, f));

    if (pageFiles.length === 0) throw new Error('pdftoppm produced no output files');
    log(`  [PDF] rasterized ${pageFiles.length} pages, uploading to R2`);

    const results = [];
    for (let i = 0; i < pageFiles.length; i++) {
      const pageNumber = i + 1;
      const srcFile = pageFiles[i];

      // Read and optionally resize
      let sharpInst = sharp(srcFile);
      const meta = await sharpInst.metadata();
      if ((meta.width || 0) > PDF_MAX_DIMENSION || (meta.height || 0) > PDF_MAX_DIMENSION) {
        sharpInst = sharp(srcFile).resize(PDF_MAX_DIMENSION, PDF_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
      }
      const jpegBuffer = await sharpInst.jpeg({ quality: PDF_JPEG_QUALITY }).toBuffer();

      // Upload to R2 at the same key layout used by archive-bulk
      const num = String(pageNumber).padStart(4, '0');
      const archivedKey = `archived/${bookId}/${pageNumber}.jpg`;
      const displayKey = `pages/${bookId}/${num}.jpg`;
      const thumbKey = `pages/${bookId}/${num}-thumb.jpg`;

      // Generate display (1200px) and thumb (150px) variants
      const displayBuffer = await sharp(jpegBuffer)
        .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
      const thumbBuffer = await sharp(jpegBuffer)
        .resize(150, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      const [archivedUrl, displayUrl, thumbUrl] = await Promise.all([
        uploadToR2(archivedKey, jpegBuffer, 'image/jpeg'),
        uploadToR2(displayKey, displayBuffer, 'image/jpeg'),
        uploadToR2(thumbKey, thumbBuffer, 'image/jpeg'),
      ]);

      results.push({
        pageNumber,
        archivedUrl,
        displayUrl,
        thumbUrl,
        r2Key: archivedKey,
        width: meta.width || null,
        height: meta.height || null,
      });

      try { fs.unlinkSync(srcFile); } catch {}
    }

    return results;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 3,  // keep Atlas connection pressure low
  });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, skipped = 0, errors = 0, totalPages = 0;
  const startTime = Date.now();

  const toProcess = entries.slice(START_FROM);
  log(`Starting from index ${START_FROM}, ${toProcess.length} entries to attempt`);

  for (let i = 0; i < toProcess.length; i++) {
    if (imported >= LIMIT) {
      log(`Reached --limit=${LIMIT}, stopping`);
      break;
    }

    const entry = toProcess[i];
    const globalIdx = START_FROM + i + 1;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    const prefix = `[${globalIdx}/${entries.length}] ${entry.year || '?'} ${entry.ia_identifier}`;

    // Check duplicate
    const existing = await db.collection('books').findOne(
      { $or: [{ ia_identifier: entry.ia_identifier }, { source_fingerprint: `ia:${entry.ia_identifier}` }] },
      { projection: { _id: 1 } }
    );
    if (existing) {
      log(`${prefix} SKIP (dupe)`);
      skipped++;
      continue;
    }

    // Get page count
    const pageResult = await getPageCount(entry.ia_identifier);
    if (!pageResult) {
      log(`${prefix} ERROR: No page count (no IIIF, no imagecount, no JP2)`);
      errors++;
      await sleep(DELAY);
      continue;
    }

    const { count: pageCount, source: pageCountSource, jpgFiles, jp2Zip, pdfUrl, pdfName } = pageResult;
    const isPdfRasterized = pageCountSource === 'pdf_rasterized';

    if (DRY_RUN) {
      const note = isPdfRasterized ? ` [PDF: ${pdfName}]` : '';
      log(`${prefix} DRY-RUN: would import ${pageCount}p${note} — "${entry.title.substring(0, 60)}"`);
      imported++;
      continue;
    }

    try {
      const slug = await generateUniqueSlug(db, entry.title, entry.author);
      const bookId = new ObjectId();
      const bookIdStr = bookId.toHexString();

      // PDF-rasterized books get their pages uploaded to R2 inline.
      // Other books use IA IIIF/download URLs stored as photo fields (archive-bulk handles R2 later).
      let rasterizedPages = null;
      if (isPdfRasterized) {
        log(`${prefix} PDF rasterize: ${pageCount}p from ${pdfUrl}`);
        rasterizedPages = await rasterizeAndUploadPdf(pdfUrl, entry.ia_identifier, bookIdStr, pageCount);
        if (rasterizedPages.length !== pageCount) {
          log(`${prefix} WARN: expected ${pageCount} pages, got ${rasterizedPages.length} — using actual count`);
        }
      }

      // jpg_files + jp2Zip: institution uploaded zipped JP2s — use IIIF image server (full-res)
      // jpg_files only: use direct JPG download (lower-res, last resort)
      // default: use IA IIIF viewer page URLs
      let getPageUrl, getThumbUrl;
      if (!isPdfRasterized) {
        if (jpgFiles && jp2Zip) {
          const zipBase = jp2Zip.replace('.zip', '');
          const iiifBase = `${nfdEnc(entry.ia_identifier)}%2F${nfdEnc(jp2Zip)}%2F${nfdEnc(zipBase)}`;
          const stem = jpgFiles[0].replace(/\d+\.jpg$/, '');
          getPageUrl = (n) => {
            const idx = String(n - 1).padStart(jpgFiles[0].match(/(\d+)\.jpg$/)[1].length, '0');
            return `https://iiif.archive.org/image/iiif/3/${iiifBase}%2F${nfdEnc(stem + idx + '.jp2')}/full/max/0/default.jpg`;
          };
          getThumbUrl = (n) => {
            const idx = String(n - 1).padStart(jpgFiles[0].match(/(\d+)\.jpg$/)[1].length, '0');
            return `https://iiif.archive.org/image/iiif/3/${iiifBase}%2F${nfdEnc(stem + idx + '.jp2')}/full/pct:15/0/default.jpg`;
          };
        } else if (jpgFiles) {
          getPageUrl = (n) => `https://archive.org/download/${nfdEnc(entry.ia_identifier)}/${nfdEnc(jpgFiles[n - 1])}`;
          getThumbUrl = (n) => `https://archive.org/download/${nfdEnc(entry.ia_identifier)}/${nfdEnc(jpgFiles[n - 1].replace('.jpg', '_thumb.jpg'))}`;
        } else {
          getPageUrl = (n) => `https://archive.org/download/${entry.ia_identifier}/page/n${n}/full/full/0/default.jpg`;
          getThumbUrl = (n) => `https://archive.org/download/${entry.ia_identifier}/page/n${n}/full/pct:15/0/default.jpg`;
        }
      }

      const actualPageCount = isPdfRasterized ? (rasterizedPages?.length || pageCount) : pageCount;
      // For PDF books use the first page's display URL as the thumbnail
      const bookThumbnail = isPdfRasterized
        ? (rasterizedPages?.[0]?.thumbUrl || rasterizedPages?.[0]?.displayUrl || '')
        : getThumbUrl(0);

      const bookDoc = makeBookDoc({
        _id: bookId,
        id: bookIdStr,
        slug,
        title: entry.title,
        display_title: null,
        author: entry.author,
        language: entry.original_language || 'Latin',
        published: entry.year ? String(entry.year) : 'Unknown',
        categories: [],
        ia_identifier: entry.ia_identifier,
        thumbnail: bookThumbnail,
        pages_count: actualPageCount,
        pages_ocr: 0,
        pages_translated: 0,
        // PDF-rasterized books are already archived to R2 — set the counter so
        // archive-bulk doesn't re-queue them (they have archived_photo set).
        pages_archived: isPdfRasterized ? actualPageCount : 0,
        dublin_core: {
          dc_identifier: [`IA:${entry.ia_identifier}`],
          dc_source: `https://archive.org/details/${entry.ia_identifier}`,
        },
        image_source: {
          provider: 'internet_archive',
          provider_name: 'Internet Archive',
          source_url: `https://archive.org/details/${entry.ia_identifier}`,
          identifier: entry.ia_identifier,
          license: 'publicdomain',
          contributing_library: 'Biblioteca Nazionale Centrale di Firenze',
          access_date: new Date(),
        },
        page_count_source: pageCountSource,
        // High priority so archive-bulk/archive-ocr crons pick this book up
        // on their next pass instead of waiting behind the long-tail backlog.
        // Cleared/recomputed once the book reaches downstream pipeline phases.
        processing_priority: 80,
        processing_priority_breakdown: { import_default: 'fresh import — promote for archive priority' },
        // PDF-rasterized books already have R2 images — mark archive complete
        ...(isPdfRasterized ? {
          archive_status: 'archive_complete',
          archive_metadata: {
            source: 'pdf_rasterized',
            pdf_url: pdfUrl,
            archived_at: new Date(),
          },
        } : {}),
        status: 'draft',
        hidden: true,
        visible: false,
        source_fingerprint: sourceFingerprint({ ia_identifier: entry.ia_identifier }),
        normalized_title: normalizeTitle(entry.title),
        normalized_author: normalizeAuthor(entry.author),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await db.collection('books').insertOne(bookDoc);

      // Insert pages in chunks of 500 to avoid large single operations
      const CHUNK = 500;
      if (isPdfRasterized && rasterizedPages) {
        // PDF pages: archived_photo, display_photo, thumbnail_blob already in R2
        for (let start = 0; start < rasterizedPages.length; start += CHUNK) {
          const pageDocs = rasterizedPages.slice(start, start + CHUNK).map(rp => {
            const pageId = new ObjectId();
            return makePageDoc({
              _id: pageId,
              id: pageId.toHexString(),
              book_id: bookIdStr,
              page_number: rp.pageNumber,
              photo: rp.displayUrl,
              thumbnail: rp.thumbUrl,
              photo_original: rp.archivedUrl,
              archived_photo: rp.archivedUrl,
              display_photo: rp.displayUrl,
              thumbnail_blob: rp.thumbUrl,
              ...(rp.width ? { image_width: rp.width } : {}),
              ...(rp.height ? { image_height: rp.height } : {}),
              archive_metadata: { archived_at: new Date(), source: 'pdf_rasterized' },
              created_at: new Date(),
              updated_at: new Date(),
            });
          });
          await db.collection('pages').insertMany(pageDocs, { ordered: false });
        }
      } else {
        for (let start = 0; start < pageCount; start += CHUNK) {
          const pageDocs = [];
          for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) {
            const pageId = new ObjectId();
            pageDocs.push(makePageDoc({
              _id: pageId,
              id: pageId.toHexString(),
              book_id: bookIdStr,
              page_number: p + 1,
              photo: getPageUrl(p),
              thumbnail: getThumbUrl(p),
              photo_original: getPageUrl(p),
              created_at: new Date(),
              updated_at: new Date(),
            }));
          }
          await db.collection('pages').insertMany(pageDocs, { ordered: false });
        }
      }

      totalPages += actualPageCount;
      imported++;
      log(`${prefix} OK ${actualPageCount}p [${elapsed}m elapsed, ${imported} imported] — "${entry.title.substring(0, 60)}"`);
    } catch (err) {
      log(`${prefix} ERROR: ${err.message}`);
      errors++;
    }

    await sleep(DELAY);
  }

  await client.close();

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  log(`\n=== DONE in ${elapsed}m ===`);
  log(`Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors} | Pages: ${totalPages}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
