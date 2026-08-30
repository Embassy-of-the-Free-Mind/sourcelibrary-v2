#!/usr/bin/env node
/**
 * Direct import of CCAG vol. VII (Boll, Codices Germanici, Brussels 1908)
 * from the Wayback Machine PDF mirror of hellenisticastrology.com.
 *
 * The HathiTrust copy (mdp.39015033004238) is the canonical source but its
 * image endpoint blocks programmatic fetches. The Wayback PDF is a single
 * 13MB bundled scan of the same Michigan copy, openly accessible.
 *
 * Cited in SHWEP ep 217 (Three Ancient Sages, May 13 2026) for the
 * "βίβλος σοφίας καὶ συνέσεως ἀποτελεσμάτων Ἀπολλονίου τοῦ Τυανέως"
 * (Book of Apollonios of Tyana) at pp. 175-181.
 *
 * Pipeline:
 *   1. Download Wayback PDF → /tmp/ccag-vii/book.pdf
 *   2. pdftoppm at 150 DPI → /tmp/ccag-vii/pages/page-NNNN.jpg
 *   3. Upload each page to R2 at books/{bookId}/pages/{NNNN}.jpg
 *   4. Insert book + pages to MongoDB as a draft (hidden: true)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/ccag-vii-pdf-direct.mjs [--dry-run] [--pages=PATTERN]
 *
 * Flags:
 *   --dry-run        Skip R2 upload + Mongo writes; just download + extract
 *   --pages=N        Limit to first N pages (smoke test)
 *   --skip-download  Reuse /tmp/ccag-vii/book.pdf if already present
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_DOWNLOAD = args.includes('--skip-download');
const PAGES_LIMIT = parseInt(args.find(a => a.startsWith('--pages='))?.split('=')[1] || '0') || Infinity;

const PDF_URL = 'http://web.archive.org/web/20240730113802id_/http://hellenisticastrology.com/ccag/CCAG07.pdf';
const DPI = 150;
const WORK_DIR = '/tmp/ccag-vii';
const PDF_PATH = join(WORK_DIR, 'book.pdf');
const PAGES_DIR = join(WORK_DIR, 'pages');

const BOOK_META = {
  title: 'Catalogus Codicum Astrologorum Graecorum, Vol. VII: Codices Germanici',
  display_title: 'Catalogus Codicum Astrologorum Graecorum, Vol. VII (Codices Germanici)',
  author: 'Franz Boll (ed.)',
  language: 'Greek',
  original_language: 'Greek',
  year: 1908,
  place_published: 'Brussels',
  publisher: 'Maurice Lamertin',
  categories: ['astrology', 'manuscript-studies', 'classics'],
  notes: 'Vol. VII of the Catalogus Codicum Astrologorum Graecorum series (1898–1953). Catalogues Greek astrological manuscripts held in German libraries. Imported from a Wayback Machine mirror of hellenisticastrology.com, which itself derived from the University of Michigan copy (HathiTrust mdp.39015033004238). Cited in SHWEP ep 217 for the Book of Apollonios of Tyana (pp. 175–181).',
};


function ensureDirs() {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(PAGES_DIR, { recursive: true });
}

async function downloadPdf() {
  if (SKIP_DOWNLOAD && existsSync(PDF_PATH)) {
    const sz = statSync(PDF_PATH).size;
    console.log(`Reusing existing PDF (${(sz / 1e6).toFixed(2)} MB)`);
    return;
  }
  console.log(`Downloading ${PDF_URL}`);
  const t0 = Date.now();
  const res = await fetch(PDF_URL, {
    signal: AbortSignal.timeout(120000),
    headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
  });
  if (!res.ok) throw new Error(`PDF download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(PDF_PATH, buf);
  console.log(`  → ${(buf.length / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function extractPages() {
  const existing = readdirSync(PAGES_DIR).filter(f => f.endsWith('.jpg'));
  if (SKIP_DOWNLOAD && existing.length > 0) {
    console.log(`Reusing ${existing.length} already-extracted pages in ${PAGES_DIR}`);
    return existing.sort();
  }
  console.log(`Extracting pages at ${DPI} DPI with pdftoppm (this can take a minute)…`);
  const t0 = Date.now();
  execFileSync('pdftoppm', [
    '-jpeg', '-r', String(DPI), '-jpegopt', 'quality=85',
    PDF_PATH, join(PAGES_DIR, 'page'),
  ], { timeout: 600000, stdio: ['ignore', 'inherit', 'inherit'] });
  const pages = readdirSync(PAGES_DIR).filter(f => f.endsWith('.jpg')).sort();
  console.log(`  → ${pages.length} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!pages.length) throw new Error('pdftoppm produced 0 pages');
  return pages;
}

function r2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 env vars missing — source .env.production.local first');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function uploadPage(client, key, buf) {
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC}/${key}`;
}

function normalizeTitle(t) {
  return t?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function normalizeAuthor(a) {
  return a?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function slugify(text, maxLen = 60) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .trim().replace(/^-|-$/g, '').substring(0, maxLen);
}
async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function main() {
  ensureDirs();
  await downloadPdf();
  const allPages = extractPages();
  const pageFiles = allPages.slice(0, PAGES_LIMIT);
  const pageCount = pageFiles.length;
  console.log(`Will process ${pageCount} page(s)`);

  if (DRY_RUN) {
    console.log('=== DRY RUN — no R2 upload, no DB writes ===');
    const sample = pageFiles.slice(0, 3).map(f => statSync(join(PAGES_DIR, f)).size);
    console.log(`First 3 page sizes: ${sample.map(s => (s/1024).toFixed(0) + 'KB').join(', ')}`);
    const totalKB = pageFiles.reduce((sum, f) => sum + statSync(join(PAGES_DIR, f)).size, 0) / 1024;
    console.log(`Estimated total: ${(totalKB / 1024).toFixed(1)} MB`);
    return;
  }

  // Connect to Mongo
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  // Dedup
  const fingerprint = `pdf:wayback:hellenisticastrology/CCAG07`;
  const existing = await db.collection('books').findOne(
    { source_fingerprint: fingerprint },
    { projection: { _id: 1, slug: 1 } }
  );
  if (existing) {
    console.log(`Already imported: ${existing._id} (${existing.slug})`);
    await client.close();
    return;
  }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await generateUniqueSlug(db, slugify(`${BOOK_META.title}-${BOOK_META.author}`.substring(0, 80)));

  // Upload pages to R2 with bounded concurrency
  console.log(`Uploading ${pageCount} pages to R2…`);
  const t0 = Date.now();
  const r2 = r2Client();
  const pageUrls = new Array(pageCount);
  const CONCURRENCY = 10;
  let uploaded = 0;
  for (let batch = 0; batch < pageCount; batch += CONCURRENCY) {
    const chunk = pageFiles.slice(batch, batch + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (file, idx) => {
      const pageIdx = batch + idx;
      const imgBuf = readFileSync(join(PAGES_DIR, file));
      const key = `books/${bookIdStr}/pages/${String(pageIdx).padStart(4, '0')}.jpg`;
      const url = await uploadPage(r2, key, imgBuf);
      return { pageIdx, url, bytes: imgBuf.length };
    }));
    for (const r of results) {
      pageUrls[r.pageIdx] = { url: r.url, bytes: r.bytes };
      uploaded++;
    }
    if (uploaded % 50 === 0 || uploaded === pageCount) {
      const pct = ((uploaded / pageCount) * 100).toFixed(0);
      const rate = uploaded / ((Date.now() - t0) / 1000);
      console.log(`  ${uploaded}/${pageCount} (${pct}%, ${rate.toFixed(1)} pages/sec)`);
    }
  }
  const totalBytes = pageUrls.reduce((s, p) => s + p.bytes, 0);
  console.log(`  R2 upload done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(totalBytes / 1e6).toFixed(1)} MB total`);

  // Build + insert book
  const now = new Date();
  const pdfStat = statSync(PDF_PATH);
  const bookDoc = makeBookDoc({
    _id: bookId,
    id: bookIdStr,
    slug,
    title: BOOK_META.title,
    display_title: BOOK_META.display_title,
    author: BOOK_META.author,
    language: BOOK_META.language,
    original_language: BOOK_META.original_language,
    published: String(BOOK_META.year),
    place_published: BOOK_META.place_published,
    publisher: BOOK_META.publisher,
    categories: BOOK_META.categories,
    thumbnail: pageUrls[0].url,
    pages_count: pageCount,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: pageCount,
    dublin_core: {
      dc_identifier: ['HATHITRUST:mdp.39015033004238', 'OCLC:2981927'],
      dc_source: 'https://catalog.hathitrust.org/Record/000527862',
      dc_publisher: BOOK_META.publisher,
    },
    image_source: {
      provider: 'wayback_pdf',
      provider_name: 'Wayback Machine (mirror of hellenisticastrology.com)',
      source_url: 'https://catalog.hathitrust.org/Record/000527862',
      pdf_url: PDF_URL,
      identifier: 'mdp.39015033004238',
      license: 'publicdomain',
      access_date: now,
      extraction: {
        method: 'pdftoppm',
        dpi: DPI,
        jpeg_quality: 85,
        pdf_size_bytes: pdfStat.size,
        pages_extracted: pageCount,
        total_blob_bytes: totalBytes,
        extracted_at: now,
      },
    },
    catalog_metadata: {
      source: 'hathitrust_via_wayback',
      hathitrust_id: 'mdp.39015033004238',
      hathitrust_catalog: 'https://catalog.hathitrust.org/Record/000527862',
      oclc_series: '2981927',
      holding_institution: 'University of Michigan',
      rights_code: 'pdus',
    },
    notes: BOOK_META.notes,
    page_count_source: 'pdf_extraction',
    processing_priority: 80,
    processing_priority_breakdown: { import_default: 'fresh import — promote for archive priority' },
    status: 'draft',
    hidden: true,
    visible: false,
    needs_splitting: true,
    needs_splitting_reason: 'PDF source is 2-page spreads (page dimensions ~1645x1276 px, aspect 1.29:1 landscape)',
    source_fingerprint: fingerprint,
    normalized_title: normalizeTitle(BOOK_META.title),
    normalized_author: normalizeAuthor(BOOK_META.author),
    created_at: now,
    updated_at: now,
  });

  await db.collection('books').insertOne(bookDoc);
  console.log(`Inserted book ${bookIdStr} (${slug})`);

  // Insert pages
  const CHUNK = 500;
  for (let start = 0; start < pageCount; start += CHUNK) {
    const docs = [];
    for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) {
      const pageId = new ObjectId();
      docs.push(makePageDoc({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: p + 1,
        photo: pageUrls[p].url,
        photo_original: PDF_URL,
        archived_photo: pageUrls[p].url,
        archive_metadata: {
          source_url: PDF_URL,
          source_page: p + 1,
          archived_at: now,
          method: 'pdf_extraction',
          dpi: DPI,
          bytes: pageUrls[p].bytes,
        },
        created_at: now,
        updated_at: now,
      }));
    }
    await db.collection('pages').insertMany(docs, { ordered: false });
    console.log(`  pages ${start + 1}–${start + docs.length} inserted`);
  }

  await client.close();
  console.log(`\n=== DONE: bookId=${bookIdStr}, ${pageCount} pages, ${(totalBytes / 1e6).toFixed(1)} MB on R2 ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
