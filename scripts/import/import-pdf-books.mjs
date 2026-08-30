#!/usr/bin/env node
/**
 * Generic PDF → Source Library importer (highest-res masters + full provenance).
 *
 * Reads a manifest JSON (array of book entries), and for each book:
 *   1. Resolves the source PDF (remote URL or local path; downloads with retry).
 *   2. Archives the ORIGINAL PDF to R2 as the preservation master
 *      (masters/<bookId>/source.pdf) — we never discard the source.
 *   3. Rasterizes pages at high DPI (default 300) and uploads three JPEG
 *      variants per page: -full.jpg (archival), .jpg (1200px display),
 *      -thumb.jpg (150px). "Highest res to R2 when possible."
 *   4. Creates the Mongo book + page docs with COMPLETE metadata + provenance
 *      (image_source, dublin_core, field_provenance, metadata) and assigns the
 *      configured collections.
 *
 * IMPORTANT — by design this does NOT set `pipeline_auto`. The orchestrator
 * only picks up books where `pipeline_auto.status` exists, so omitting it keeps
 * these books OUT of the auto OCR/translate pipeline until a model is chosen via
 * the qa-eval benchmark (learning from the Tibetan-OCR incident: never scale OCR
 * before benchmarking the model on the script). Books import as
 * visible:false / hidden:true for QA.
 *
 * Usage:
 *   set -a; source /Users/dereklomas/sourcelibrary/.env.production.local; set +a
 *   node scripts/import/import-pdf-books.mjs --manifest scripts/import/pilot-manifest.json --dry-run
 *   node scripts/import/import-pdf-books.mjs --manifest scripts/import/pilot-manifest.json
 *   node scripts/import/import-pdf-books.mjs --manifest ... --only "babad-bedhah"   # one fingerprint/slug substring
 *   node scripts/import/import-pdf-books.mjs --manifest ... --max-pages 60          # cap pages (pilot)
 *
 * Required env: MONGODB_URI, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseArgs } from 'util';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const { values: args } = parseArgs({ options: {
  manifest:    { type: 'string' },
  'dry-run':   { type: 'boolean', default: false },
  force:       { type: 'boolean', default: false },
  only:        { type: 'string' },
  'max-pages': { type: 'string' },
  dpi:         { type: 'string', default: '300' },
} });

if (!args.manifest) { console.error('usage: --manifest <path.json> [--dry-run] [--only substr] [--max-pages N] [--dpi 300]'); process.exit(1); }
const DRY = args['dry-run'];
const FORCE = args.force;
const ONLY = args.only;
const MAX_PAGES = args['max-pages'] ? parseInt(args['max-pages'], 10) : null;
const DPI = parseInt(args.dpi, 10);

const DISPLAY_WIDTH = 1200, THUMBNAIL_WIDTH = 150;
const FULL_QUALITY = 88, DISPLAY_QUALITY = 80, THUMBNAIL_QUALITY = 60;
const PARALLEL_PAGES = 6;

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const mongo = new MongoClient(process.env.MONGODB_URI);

function slugify(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  if (DRY) return `${R2_PUBLIC_URL}/${key}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Download a URL to a local file with retry-once (BL/Wikimedia large PDFs 500 on first render).
async function downloadPdf(url, destPath) {
  // b-nice's PDF endpoint is slow/flaky (8s+ TTFB) and drops connections mid-stream,
  // surfacing as a thrown "fetch failed" (not a bad HTTP status). Retry on BOTH a
  // thrown network error and a non-OK status, with generous backoff.
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-importer/1.0 (https://sourcelibrary.org; library ingest)' } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(destPath, buf);
        return buf.length;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
    if (attempt < 5) await new Promise(r => setTimeout(r, 6000 * attempt));
  }
  throw new Error(`download failed after 5 attempts (${lastErr?.message}): ${url}`);
}

function pdfPageCount(pdfPath) {
  const out = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const m = out.match(/^Pages:\s+(\d+)/m);
  return m ? parseInt(m[1], 10) : 0;
}

// Inspect embedded images. Returns { clean, perPage, minWidth, rows } where
// `clean` means exactly one JPEG image per page (safe to extract losslessly at
// native resolution). poppler `pdfimages -list` columns:
// page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
function inspectPdfImages(pdfPath) {
  const out = execFileSync('pdfimages', ['-list', pdfPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  const perPage = new Map();
  let minWidth = Infinity;
  for (const line of out.split('\n')) {
    const c = line.trim().split(/\s+/);
    const page = parseInt(c[0], 10);
    if (!Number.isInteger(page)) continue;          // skip headers
    const type = c[2], width = parseInt(c[3], 10), enc = c[8];
    perPage.set(page, [...(perPage.get(page) || []), { type, width, enc }]);
    if (type === 'image') minWidth = Math.min(minWidth, width);
  }
  const pages = [...perPage.keys()];
  const clean = pages.length > 0 && pages.every(p => {
    const imgs = perPage.get(p).filter(i => i.type === 'image');
    return imgs.length === 1 && imgs[0].enc === 'jpeg';
  });
  return { clean, pageCount: pages.length, minWidth: minWidth === Infinity ? 0 : minWidth };
}

// Produce an ordered array of page-image filenames in tmpDir. Prefers lossless
// native extraction (pdfimages -j) for clean scanned PDFs — "highest res when
// possible" — and falls back to high-DPI rasterization (pdftoppm).
function extractPages(pdfPath, tmpDir, { method, dpi, limit }) {
  let useNative = false;
  if (method !== 'pdftoppm') {
    try {
      const info = inspectPdfImages(pdfPath);
      // Explicit 'pdfimages' trusts native extraction whenever the PDF is a clean
      // 1-JPEG-per-page scan (each page comes out at its own true embedded res —
      // small front-matter/color-chart images don't disqualify content pages).
      // 'auto' is conservative and only goes native if even the smallest image is large.
      useNative = method === 'pdfimages' ? info.clean : (info.clean && info.minWidth >= 1200);
      if (method === 'pdfimages' && !info.clean) {
        console.log(`  WARN: pdfimages requested but PDF is not 1-JPEG-per-page (minW=${info.minWidth}); falling back to pdftoppm`);
      } else {
        console.log(`  embedded images: clean=${info.clean} minWidth=${info.minWidth}px → ${useNative ? 'NATIVE extract (lossless)' : `rasterize @ ${dpi} DPI`}`);
      }
    } catch (e) { console.log(`  (pdfimages -list failed: ${e.message}; rasterizing)`); }
  }
  const range = limit ? ['-f', '1', '-l', String(limit)] : [];
  if (useNative) {
    execFileSync('pdfimages', ['-j', '-p', ...range, pdfPath, join(tmpDir, 'img')], { maxBuffer: 1024 * 1024 * 64 });
    // files: img-<page>-<num>.jpg ; sort numerically by page (not zero-padded)
    return { method: 'pdfimages-native', files: readdirSync(tmpDir)
      .filter(f => /^img-\d+-\d+\.jpg$/.test(f))
      .sort((a, b) => parseInt(a.match(/^img-(\d+)-/)[1]) - parseInt(b.match(/^img-(\d+)-/)[1])) };
  }
  execFileSync('pdftoppm', ['-r', String(dpi), '-jpeg', '-jpegopt', `quality=${FULL_QUALITY}`, ...range, pdfPath, join(tmpDir, 'page')], { maxBuffer: 1024 * 1024 * 64 });
  return { method: `pdftoppm@${dpi}`, files: readdirSync(tmpDir).filter(f => /^page.*\.jpg$/.test(f)).sort() };
}

// Fetch per-page images from a URL template (e.g. Wikimedia Commons thumb.php at
// high width — the reliable "highest res" path for Commons-hosted manuscript PDFs,
// avoiding a multi-hundred-MB whole-PDF download). Template uses {page} and {w}.
// Renders on the server can 500 on first hit; retry-once per page.
async function fetchPageImages(template, width, count, tmpDir, parallel = 4) {
  const pages = Array.from({ length: count }, (_, i) => i + 1);
  const ok = [];
  await parallelMap(pages, async (p) => {
    const url = template.replace('{page}', String(p)).replace('{w}', String(width));
    const dest = join(tmpDir, `page-${String(p).padStart(4, '0')}.jpg`);
    // Cold server-side renders (esp. the first page of a large PDF) can 500 for
    // 10-30s before the thumbnail is cached. Be patient: 6 attempts, growing backoff.
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-importer/1.0 (https://sourcelibrary.org; library ingest)' } });
        if (res.ok) { writeFileSync(dest, Buffer.from(await res.arrayBuffer())); ok.push(p); return; }
      } catch {}
      if (attempt < 6) await new Promise(r => setTimeout(r, 5000 * attempt));
    }
    console.log(`    WARN: page ${p} failed after retries`);
  }, parallel);
  return readdirSync(tmpDir).filter(f => /^page-\d+\.jpg$/.test(f)).sort();
}

async function parallelMap(items, fn, n) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

async function importBook(db, entry) {
  const now = new Date();
  const fingerprint = entry.fingerprint || `${entry.provider}:${entry.source_id}`;
  console.log(`\n=== ${entry.title} ===`);
  console.log(`  provider=${entry.provider} source_id=${entry.source_id} license=${entry.license}`);

  // Dupe check — by fingerprint AND by original filename (underscore/space variants),
  // so the same Commons file isn't re-imported even under a different fingerprint scheme.
  const ofn = entry.original_filename;
  const dupeOr = [{ source_fingerprint: fingerprint }];
  if (ofn) dupeOr.push({ 'metadata.original_filename': { $in: [ofn, ofn.replace(/_/g, ' '), ofn.replace(/ /g, '_')] } });
  const existing = await db.collection('books').findOne({ $or: dupeOr });
  if (existing && !FORCE) { console.log(`  SKIP: already imported (book id=${existing.id})`); return { skipped: true }; }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const baseSlug = entry.slug || slugify(entry.title);
  let slug = baseSlug, n = 1;
  while (await db.collection('books').findOne({ slug })) { slug = `${baseSlug}-${++n}`; }

  const tmpDir = mkdtempSync(join(tmpdir(), 'sl-pdf-'));
  const pdfPath = join(tmpDir, 'source.pdf');
  const perDpi = entry.dpi || DPI;
  const archiveMaster = entry.archive_master !== false;
  let masterUrl = null;
  try {
    let extractMethod, rendered, sourcePageCount;

    if (entry.page_image_url) {
      // 1a. Per-page image fetch (Commons thumb.php high-res). No whole-PDF download;
      //     the source PDF URL is recorded as the durable CC0 master reference.
      const width = entry.page_image_width || 4000;
      const total = entry.page_count || 0;
      if (!total) throw new Error('page_image_url mode requires page_count');
      const limit = DRY ? 1 : (MAX_PAGES ? Math.min(MAX_PAGES, total) : total);
      console.log(`  per-page fetch: ${limit}/${total} page(s) @ w=${width} (Commons thumb.php)`);
      rendered = await fetchPageImages(entry.page_image_url, width, limit, tmpDir);
      extractMethod = `commons-thumb@w${width}`;
      sourcePageCount = total;
    } else {
      // 1b. Whole-PDF mode: download, then native lossless extract (if clean) or rasterize.
      let pdfBytes;
      if (/^https?:\/\//.test(entry.source_pdf)) { console.log(`  downloading: ${entry.source_pdf}`); pdfBytes = await downloadPdf(entry.source_pdf, pdfPath); }
      else { pdfBytes = readFileSync(entry.source_pdf).length; execFileSync('cp', [entry.source_pdf, pdfPath]); }
      const totalPages = pdfPageCount(pdfPath);
      sourcePageCount = totalPages;
      console.log(`  PDF: ${(pdfBytes / 1048576).toFixed(1)} MB, ${totalPages} pages${MAX_PAGES ? ` (cap ${MAX_PAGES})` : ''}`);
      if (archiveMaster && !DRY) {
        await uploadToR2(`masters/${bookIdStr}/source.pdf`, readFileSync(pdfPath), 'application/pdf');
        masterUrl = `${R2_PUBLIC_URL}/masters/${bookIdStr}/source.pdf`;
      }
      ({ method: extractMethod, files: rendered } = extractPages(pdfPath, tmpDir,
        { method: entry.extract || 'auto', dpi: perDpi, limit: DRY ? 1 : (MAX_PAGES || null) }));
    }
    if (!rendered.length) throw new Error('page extraction produced no images');

    if (DRY) {
      const buf = readFileSync(join(tmpDir, rendered[0]));
      const dim = await sharp(buf, { limitInputPixels: false }).metadata();
      console.log(`  [DRY] master=${archiveMaster && !entry.page_image_url ? 'R2' : 'ref source'}; extract=${extractMethod}; page1 ${dim.width}×${dim.height} ${(buf.length/1048576).toFixed(2)}MB; ${rendered.length} page(s) → slug=${slug}`);
      return { dry: true, slug, pages: rendered.length, extract: extractMethod, w: dim.width, h: dim.height };
    }

    // 4. Upload page variants
    const pageDocs = await parallelMap(rendered, async (file, idx) => {
      const pageNum = idx + 1;
      const pageNumStr = String(pageNum).padStart(4, '0');
      const base = `pages/${bookIdStr}/${pageNumStr}`;
      const fullBuf = readFileSync(join(tmpDir, file));
      const meta = await sharp(fullBuf, { limitInputPixels: false }).metadata();
      const [displayBuf, thumbBuf] = await Promise.all([
        sharp(fullBuf, { limitInputPixels: false }).resize(DISPLAY_WIDTH).jpeg({ quality: DISPLAY_QUALITY }).toBuffer(),
        sharp(fullBuf, { limitInputPixels: false }).resize(THUMBNAIL_WIDTH).jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer(),
      ]);
      const [fullUrl, displayUrl, thumbUrl] = await Promise.all([
        uploadToR2(`${base}-full.jpg`, fullBuf),
        uploadToR2(`${base}.jpg`, displayBuf),
        uploadToR2(`${base}-thumb.jpg`, thumbBuf),
      ]);
      if (pageNum % 25 === 0) console.log(`    uploaded ${pageNum}/${rendered.length}`);
      return makePageDoc({
        _id: new ObjectId(), id: new ObjectId().toHexString(), book_id: bookIdStr,
        page_number: pageNum,
        photo: displayUrl, display_photo: displayUrl, archived_photo: fullUrl,
        thumbnail: thumbUrl, image_thumb: thumbUrl,
        image_width: meta.width, image_height: meta.height, width: meta.width, height: meta.height,
        ocr: null, status: 'archived', created_at: now, updated_at: now,
      });
    }, PARALLEL_PAGES);

    const validPages = pageDocs.filter(Boolean);

    // 5. Build the book record — full provenance
    const provEntry = { source: 'import-pdf-books', provider: entry.provider, method: extractMethod, confidence: 1.0, date: now.toISOString() };
    const book = makeBookDoc({
      _id: bookId, id: bookIdStr, slug,
      title: entry.title,
      display_title: entry.display_title || entry.title,
      author: entry.author || 'Anonymous',
      language: entry.language,            // SCRIPT-ACCURATE: see manifest. Drives getModelForBook routing.
      published: entry.published || null,
      publisher: entry.publisher || null,
      place_of_publication: entry.place_of_publication || null,
      collections: entry.collections || [],
      categories: entry.categories || [],
      image_source: {
        provider: entry.provider,
        provider_name: entry.provider_name,
        contributing_library: entry.contributing_library,
        source_id: entry.source_id,
        source_url: entry.source_url,
        iiif_manifest: entry.iiif_manifest || null,
        original_pdf: entry.source_pdf,
        master_pdf_r2: masterUrl,
        license: entry.license,
        license_url: entry.license_url || null,
        attribution: entry.attribution,
        access_date: now,
        shelfmark: entry.shelfmark || null,
      },
      dublin_core: {
        dc_title: entry.title,
        dc_creator: entry.author || null,
        dc_date: entry.published || null,
        dc_publisher: entry.publisher || null,
        dc_language: entry.dc_language || entry.language,
        dc_type: entry.dc_type || null,
        dc_identifier: entry.shelfmark || entry.source_id,
        dc_source: entry.source_url,
        dc_rights: entry.license,
      },
      field_provenance: { title: provEntry, author: provEntry, published: provEntry, language: provEntry },
      metadata: {
        genre: entry.genre || null,
        script: entry.script || null,
        holding_library: entry.contributing_library,
        shelfmark: entry.shelfmark || null,
        original_filename: entry.original_filename || null,
        source_pdf_url: entry.source_pdf,
        source_pdf_pages: sourcePageCount,
        extraction_method: extractMethod,
        pilot_sample: !!MAX_PAGES,
      },
      source_fingerprint: fingerprint,
      normalized_title: slugify(entry.title).replace(/-/g, ' '),
      normalized_author: slugify(entry.author || 'anonymous').replace(/-/g, ' '),
      pages_count: validPages.length,
      pages_ocr: 0, pages_translated: 0, pages_archived: validPages.length,
      page_count_source: 'pdf_extraction',
      acquisition_campaign: entry.acquisition_campaign || 'Javanese Kraton collection',
      metadata_quality: 'curated',
      contributing_library: entry.contributing_library,
      status: MAX_PAGES ? 'pilot' : 'imported',
      hidden: true, visible: false,
      archive_status: 'complete', archive_completed_at: now,
      // The pipeline cron auto-enrolls any imageful book that LACKS pipeline_auto
      // (source:'cron'), so omitting it does NOT keep a book out of OCR. To keep a
      // book image-only, set a TERMINAL pipeline_auto at insert (wins the race) so
      // the cron sees it as already done. Books without image_only intentionally get
      // no pipeline_auto and flow into OCR/translate via the cron.
      ...(entry.image_only ? { pipeline_auto: {
        status: 'complete',
        ocr_deferred: true,
        ocr_deferred_reason: entry.ocr_deferred_reason || 'OCR deferred — image-only import',
        source: 'image-only-import',
        queued_at: now, last_updated: now, retry_count: 0,
      } } : {}),
      thumbnail: (validPages.find(p => p.page_number === 1) || validPages[0])?.photo,
      created_at: now, updated_at: now,
    });

    await db.collection('books').insertOne(book);
    await db.collection('pages').insertMany(validPages);
    console.log(`  ✓ ${slug}: ${validPages.length} pages [${extractMethod}], master ${masterUrl ? 'archived→R2' : '(ref source)'}. lang='${entry.language}'`);
    console.log(`    https://sourcelibrary.org/book/${slug}  (hidden — flip after QA)`);
    return { slug, pages: validPages.length };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  const entries = manifest.filter(e => !ONLY || (e.fingerprint || '').includes(ONLY) || (e.slug || '').includes(ONLY) || e.title.toLowerCase().includes(ONLY.toLowerCase()));
  console.log(`Manifest: ${entries.length} book(s)${DRY ? ' (DRY RUN)' : ''}${MAX_PAGES ? `, max-pages=${MAX_PAGES}` : ''}, dpi=${DPI}`);

  await mongo.connect();
  const db = mongo.db('bookstore');
  const summary = [];
  for (const entry of entries) {
    try { summary.push({ title: entry.title, ...(await importBook(db, entry)) }); }
    catch (err) { console.error(`  FAIL ${entry.title}: ${err.message}`); summary.push({ title: entry.title, error: err.message }); }
  }
  await mongo.close();
  console.log('\n=== Summary ===');
  for (const s of summary) console.log(`  ${s.error ? '✗' : s.skipped ? '∅' : s.dry ? '·' : '✓'} ${s.title}${s.pages ? ` (${s.pages}p)` : ''}${s.extract ? ` [${s.extract}${s.w ? ` ${s.w}×${s.h}` : ''}]` : ''}${s.error ? ` — ${s.error}` : ''}`);
}

main().catch(async err => { console.error('\nFATAL:', err.stack || err.message); try { await mongo.close(); } catch {} process.exit(1); });
