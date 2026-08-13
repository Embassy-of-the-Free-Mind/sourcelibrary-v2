#!/usr/bin/env node
/**
 * Batch import Kloss collection PDFs from CMC into Source Library.
 *
 * Reads digitized records from the `kloss_catalog` MongoDB collection,
 * constructs PDF URLs from the CMC file server, downloads + extracts pages
 * with pdftoppm, uploads to Vercel Blob, and creates book + page records.
 *
 * Full provenance chain preserved:
 *   CMC catalog (priref) → PDF URL → pdftoppm extraction → Vercel Blob
 *   Stored on book.image_source + book.catalog_metadata + page.archive_metadata
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-kloss-collection.mjs
 *
 * Options:
 *   --limit N          Process at most N records
 *   --start-from N     Skip first N records (for resume)
 *   --dry-run          Show what would be imported without doing it
 *   --skip-existing    Skip records already imported (match on priref)
 *   --delay N          Delay between imports in ms (default: 3000)
 *   --dpi N            Extraction DPI (default: 150)
 *
 * Requires: pdftoppm (poppler-utils), MONGODB_URI, BLOB_READ_WRITE_TOKEN
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execSync, execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Config ────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set'); process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function storagePut(key, body, contentType = 'application/octet-stream') {
  const k = key.replace(/^\//, '');
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: k, Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return { url: `${R2_PUBLIC_URL}/${k}`, pathname: k };
}

// Check pdftoppm
try {
  execSync('which pdftoppm', { stdio: 'pipe' });
} catch {
  console.error('pdftoppm not found. Install poppler: brew install poppler');
  process.exit(1);
}

const CMC_PDF_BASE = 'https://ais.vrijmetselarij.nl/pdf/';
const PROVIDER = 'cmc_kloss';
const PROVIDER_NAME = 'CMC Prins Frederik — Bibliotheca Klossiana';
const UPLOAD_CONCURRENCY = 10;

// ── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');

function getArgValue(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1], 10) : fallback;
}

const maxRecords = getArgValue('--limit', Infinity);
const startFrom = getArgValue('--start-from', 0);
const delayMs = getArgValue('--delay', 3000);
const dpi = getArgValue('--dpi', 150);

// ── Slug generation (simplified — matches the pattern in _tmp-import-pdf-items.mjs) ──

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

async function generateSlug(db, title, author) {
  const base = slugify(`${title} ${author}`);
  const existing = await db.collection('books').findOne({ slug: base });
  if (!existing) return base;
  return `${base}-${Math.random().toString(36).substring(2, 6)}`;
}

// ── Construct PDF URL from digital_reference ──────────────────────────

function buildPdfUrl(digitalRef) {
  // digital_references look like: "F:\Adlib\images\pdf\NL-HaCMC_Kloss-MS_192C14.pdf"
  // Strip the F: drive prefix, extract just the filename
  let filename = digitalRef;

  // Strip common prefixes
  filename = filename.replace(/^F:\\Adlib\\images\\pdf\\/i, '');
  filename = filename.replace(/^F:\/Adlib\/images\/pdf\//i, '');
  // If there's still a path, take just the filename
  if (filename.includes('\\')) filename = filename.split('\\').pop();
  if (filename.includes('/')) filename = filename.split('/').pop();

  return `${CMC_PDF_BASE}${encodeURIComponent(filename)}`;
}

// ── Import a single record ────────────────────────────────────────────

async function importRecord(db, record, index, total) {
  const { priref, title, authors, year, shelf_mark, kloss_shelf_mark, notes, digital_references } = record;

  console.log(`\n[${index + 1}/${total}] priref=${priref}: ${title}`);

  if (!digital_references || digital_references.length === 0) {
    console.log('  SKIP: no digital_reference');
    return { status: 'skip', reason: 'no_digital_ref' };
  }

  const pdfUrl = buildPdfUrl(digital_references[0]);
  const author = authors?.[0] || 'Unknown';
  const published = year || 'Unknown';

  console.log(`  PDF: ${pdfUrl}`);
  console.log(`  Author: ${author} | Year: ${published} | Shelf: ${kloss_shelf_mark || shelf_mark || 'n/a'}`);

  if (dryRun) {
    return { status: 'dry_run' };
  }

  // Check for existing import (match on priref or PDF URL)
  if (skipExisting) {
    const existing = await db.collection('books').findOne({
      $or: [
        { 'image_source.identifier': priref },
        { 'image_source.pdf_url': pdfUrl },
      ],
    });
    if (existing) {
      console.log(`  SKIP: already imported (${existing.id})`);
      return { status: 'skip', reason: 'existing', bookId: existing.id };
    }
  }

  // Download PDF
  const tmpDir = mkdtempSync(join(tmpdir(), 'sl-kloss-'));
  const pdfPath = join(tmpDir, 'book.pdf');

  try {
    console.log('  Downloading PDF...');
    const pdfRes = await fetch(pdfUrl, {
      signal: AbortSignal.timeout(180000), // 3 min for large PDFs
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
    });

    if (!pdfRes.ok) {
      console.log(`  ERROR: PDF download failed (${pdfRes.status} ${pdfRes.statusText})`);
      return { status: 'error', reason: `download_${pdfRes.status}` };
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    writeFileSync(pdfPath, pdfBuffer);
    const pdfSizeMB = (pdfBuffer.length / 1048576).toFixed(1);
    console.log(`  Downloaded: ${pdfSizeMB} MB`);

    // Extract pages with pdftoppm
    console.log('  Extracting pages...');
    const pagesDir = join(tmpDir, 'pages');
    execSync(`mkdir -p "${pagesDir}"`);

    try {
      execFileSync('pdftoppm', [
        '-jpeg', '-r', String(dpi), '-jpegopt', 'quality=85',
        pdfPath, join(pagesDir, 'page'),
      ], { timeout: 600000 }); // 10 min
    } catch (err) {
      console.log(`  ERROR: pdftoppm failed: ${err.message}`);
      return { status: 'error', reason: 'pdftoppm_failed' };
    }

    const pageFiles = readdirSync(pagesDir).filter(f => f.endsWith('.jpg')).sort();
    const pageCount = pageFiles.length;

    if (pageCount === 0) {
      console.log('  ERROR: 0 pages extracted');
      return { status: 'error', reason: '0_pages' };
    }
    console.log(`  Extracted ${pageCount} pages`);

    // Upload to Vercel Blob
    console.log(`  Uploading ${pageCount} pages to Blob...`);
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const blobUrls = []; // { photo, bytes }

    for (let batch = 0; batch < pageCount; batch += UPLOAD_CONCURRENCY) {
      const chunk = pageFiles.slice(batch, batch + UPLOAD_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (file, idx) => {
        const pageIdx = batch + idx;
        const imgBuffer = readFileSync(join(pagesDir, file));
        const blobPath = `books/${bookIdStr}/pages/${String(pageIdx).padStart(4, '0')}.jpg`;
        const blob = await storagePut(blobPath, imgBuffer, 'image/jpeg');
        return { pageIdx, photo: blob.url, bytes: imgBuffer.length };
      }));

      for (const r of results) {
        blobUrls[r.pageIdx] = { photo: r.photo, bytes: r.bytes };
      }

      if (batch + UPLOAD_CONCURRENCY < pageCount) {
        process.stdout.write(`    ${Math.min(batch + UPLOAD_CONCURRENCY, pageCount)}/${pageCount} uploaded\r`);
      }
    }
    console.log(`    ${pageCount}/${pageCount} uploaded`);

    const totalBlobBytes = blobUrls.reduce((sum, b) => sum + b.bytes, 0);

    // Create book record — full provenance chain
    const slug = await generateSlug(db, title, author);
    const now = new Date();

    // Catalog URL for this specific record
    const catalogUrl = `https://ais.vrijmetselarij.nl/axiellwebapi/wwwopac.ashx?command=search&database=fullCatalogue&search=priref=${priref}&xmltype=grouped&output=xml`;

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: null,
      author,
      language: 'Unknown',  // 0% coverage in catalog — AI detects from OCR
      published,
      categories: ['Freemasonry', 'Kloss Collection'],
      thumbnail: blobUrls[0]?.photo || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: {
        dc_identifier: [`CMC_KLOSS:${priref}`],
        dc_source: catalogUrl,
        dc_description: notes?.length ? notes.join(' | ') : undefined,
      },
      image_source: {
        provider: PROVIDER,
        provider_name: PROVIDER_NAME,
        source_url: catalogUrl,
        pdf_url: pdfUrl,                         // Direct URL to the PDF
        identifier: priref,                      // CMC catalog priref
        license: 'unknown',                      // CMC doesn't specify licensing
        access_date: now,
        extraction: {
          method: 'pdftoppm',
          dpi,
          jpeg_quality: 85,
          pdf_size_bytes: pdfBuffer.length,
          pages_extracted: pageCount,
          total_blob_bytes: totalBlobBytes,
          extracted_at: now,
        },
      },
      // Full original catalog record for provenance
      catalog_metadata: {
        source: 'cmc_axiell_webapi',
        collection: 'kloss_catalog',
        priref,
        shelf_mark: shelf_mark || null,
        kloss_shelf_mark: kloss_shelf_mark || null,
        authors: authors || [],
        year: year || null,
        notes: notes || [],
        digital_references: digital_references || [],
        scraped_at: record.scraped_at,
      },
      page_count_source: 'pdf_extraction',
      status: 'draft',
      hidden: true,
      created_at: now,
      updated_at: now,
    };

    await db.collection('books').insertOne(bookDoc);

    // Create page records — each page traces back to source PDF
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      const photoUrl = blobUrls[i]?.photo || '';
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: i + 1,
        photo: photoUrl,
        photo_original: pdfUrl,          // Source provenance: the PDF this page came from
        archived_photo: photoUrl,        // Already on Blob — no separate archive step
        archive_metadata: {
          source_url: pdfUrl,
          source_page: i + 1,            // Which PDF page this image was extracted from
          archived_at: now,
          method: 'pdf_extraction',
          dpi,
          bytes: blobUrls[i]?.bytes || 0,
          catalog_priref: priref,        // Cross-reference back to catalog
        },
        // Do NOT initialize ocr/translation — causes false completion bug
        created_at: now,
        updated_at: now,
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    console.log(`  OK: ${pageCount} pages → ${bookIdStr}`);
    console.log(`  URL: https://sourcelibrary.org/book/${slug}`);
    console.log(`  PDF: ${pdfSizeMB} MB → Blob: ${(totalBlobBytes / 1048576).toFixed(1)} MB`);

    return { status: 'ok', bookId: bookIdStr, slug, pages: pageCount, pdfMB: pdfSizeMB };

  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Fetch digitized Kloss records from catalog
const query = { is_kloss: true, has_digital_copy: true };
const totalAvailable = await db.collection('kloss_catalog').countDocuments(query);
console.log(`Kloss catalog: ${totalAvailable} digitized records`);

const cursor = db.collection('kloss_catalog')
  .find(query)
  .sort({ priref: 1 })
  .skip(startFrom);

if (maxRecords < Infinity) {
  cursor.limit(maxRecords);
}

const records = await cursor.toArray();
const totalToProcess = records.length;

console.log(`Processing: ${totalToProcess} records (start-from: ${startFrom}, limit: ${maxRecords === Infinity ? 'none' : maxRecords})`);
console.log(`Settings: dpi=${dpi}, delay=${delayMs}ms, dry-run=${dryRun}, skip-existing=${skipExisting}`);

if (dryRun) {
  console.log('\n--- DRY RUN ---\n');
}

let imported = 0, skipped = 0, errors = 0, totalPages = 0;
const errorLog = [];

for (let i = 0; i < records.length; i++) {
  try {
    const result = await importRecord(db, records[i], i, totalToProcess);

    if (result.status === 'ok') {
      imported++;
      totalPages += result.pages;
    } else if (result.status === 'skip' || result.status === 'dry_run') {
      skipped++;
    } else {
      errors++;
      errorLog.push({ priref: records[i].priref, title: records[i].title, reason: result.reason });
    }
  } catch (err) {
    console.log(`  FATAL ERROR: ${err.message}`);
    errors++;
    errorLog.push({ priref: records[i].priref, title: records[i].title, reason: err.message });
  }

  // Polite delay between imports (skip on last item)
  if (!dryRun && i < records.length - 1) {
    await new Promise(r => setTimeout(r, delayMs));
  }
}

// ── Summary ───────────────────────────────────────────────────────────

console.log('\n========================================');
console.log('KLOSS COLLECTION IMPORT — SUMMARY');
console.log('========================================');
console.log(`Imported: ${imported}`);
console.log(`Skipped: ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`Total pages: ${totalPages}`);

if (errorLog.length > 0) {
  console.log('\nErrors:');
  for (const e of errorLog) {
    console.log(`  priref=${e.priref}: ${e.title} — ${e.reason}`);
  }
}

// Show total collection size after import
if (!dryRun && imported > 0) {
  const totalBooks = await db.collection('books').countDocuments({
    'image_source.provider': PROVIDER,
  });
  console.log(`\nTotal Kloss books in Source Library: ${totalBooks}`);
}

await client.close();
