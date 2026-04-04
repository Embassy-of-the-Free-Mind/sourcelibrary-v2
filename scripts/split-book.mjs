#!/usr/bin/env node
/**
 * BPH Spread Split — Clean Implementation
 *
 * Two-phase approach:
 *   Phase 1 (OCR): Already done — spread OCR stored on original page records
 *   Phase 2 (Split): This script — deletes old pages, creates new clean ones
 *
 * Key principles:
 *   - Always fetch from IIIF manifest (original source), never from page.photo
 *   - Delete and recreate pages (no stale fields, no partial state)
 *   - If no <page-break/> in OCR, keep full image (don't crop)
 *   - Idempotent: safe to rerun
 *
 * Usage:
 *   node scripts/split-book.mjs <slug-or-id>
 *   node scripts/split-book.mjs <slug-or-id> --dry-run
 *   node scripts/split-book.mjs <slug-or-id> --with-ocr   # also run Gemini OCR (realtime)
 */
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// --- Config ---
const OVERLAP = 0.01;        // 1% overlap on each crop
const CONCURRENCY = 3;       // Gemini / fetch concurrency
const MAX_RETRIES = 3;       // Image fetch retries
const FETCH_TIMEOUT = 15000; // 15s per image

// --- Parse args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const WITH_OCR = args.includes('--with-ocr');
const targetSlug = args.find(a => !a.startsWith('--'));

if (!targetSlug) {
  console.log('Usage: node scripts/split-book.mjs <slug-or-id> [--dry-run] [--with-ocr]');
  process.exit(1);
}

// --- DB + R2 ---
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function upload(key, buf) {
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000' }));
  return `${R2_URL}/${key}`;
}

// Use a unique prefix per run to avoid CDN cache collision with previous splits.
// R2 overwrites succeed but Cloudflare serves the old cached version for up to 1 year.
const RUN_ID = Math.random().toString(36).slice(2, 6); // 4-char random, e.g. "a3x9"

function spPath(bookId, pageNum, suffix) {
  return `pages/${bookId}/sp${RUN_ID}-${String(pageNum).padStart(4, '0')}${suffix}`;
}

async function cropAndUpload(buf, left, width, height, bookId, pageNum) {
  const full = await sharp(buf).extract({ left, top: 0, width, height }).jpeg({ quality: 90, progressive: true }).toBuffer();
  const display = await sharp(full).resize(1200, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toBuffer();
  const thumb = await sharp(full).resize(150, null, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
  const [, dispUrl, thumbUrl] = await Promise.all([
    upload(spPath(bookId, pageNum, '-full.jpg'), full),
    upload(spPath(bookId, pageNum, '.jpg'), display),
    upload(spPath(bookId, pageNum, '-thumb.jpg'), thumb),
  ]);
  return { dispUrl, thumbUrl };
}

async function uploadFullImage(buf, bookId, pageNum) {
  const display = await sharp(buf).resize(1200, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toBuffer();
  const thumb = await sharp(buf).resize(150, null, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
  const [, dispUrl, thumbUrl] = await Promise.all([
    upload(spPath(bookId, pageNum, '-full.jpg'), buf),
    upload(spPath(bookId, pageNum, '.jpg'), display),
    upload(spPath(bookId, pageNum, '-thumb.jpg'), thumb),
  ]);
  return { dispUrl, thumbUrl };
}

// --- Page type extraction ---
const VALID_PAGE_TYPES = new Set(['title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index', 'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text', 'digitizer-insert']);
function extractPageType(text) {
  const m = text?.match(/<page-type>([\s\S]*?)<\/page-type>/i);
  if (!m) return undefined;
  const t = m[1].trim().toLowerCase();
  return VALID_PAGE_TYPES.has(t) ? t : undefined;
}

// --- Fetch image with retries ---
async function fetchImage(url) {
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (retry < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 2000 * (retry + 1)));
      } else {
        throw e;
      }
    }
  }
}

// --- Get original spread image URLs ---
// Prefer our archived R2 copies (fast, reliable), fall back to IIIF (slow, unreliable)
async function getOriginalImageUrls(bookId, manifestUrl, pageCount) {
  const urls = [];

  // First: try archived copies in R2 (archived/{bookId}/{N}.jpg)
  // Verify the first image is a real spread (width > 1000), not a previously-cropped half
  const testUrl = `${R2_URL}/archived/${bookId}/1.jpg`;
  try {
    const testResp = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
    if (testResp.ok) {
      const testBuf = Buffer.from(await testResp.arrayBuffer());
      const meta = await sharp(testBuf).metadata();
      if (meta.width > 1000) {
        console.log(`  Using archived R2 copies (${meta.width}x${meta.height}, fast)`);
        for (let i = 1; i <= pageCount; i++) {
          urls.push(`${R2_URL}/archived/${bookId}/${i}.jpg`);
        }
        return urls;
      } else {
        console.log(`  Archived copies are cropped halves (${meta.width}px) — skipping`);
      }
    }
  } catch {}

  // Fallback: IIIF manifest
  console.log('  No archived copies — falling back to IIIF manifest (slow)');
  const resp = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) });
  const manifest = await resp.json();

  const canvases = manifest.sequences?.[0]?.canvases || manifest.items || [];
  for (const canvas of canvases) {
    let imgUrl = canvas.images?.[0]?.resource?.['@id'];
    if (!imgUrl) imgUrl = canvas.items?.[0]?.items?.[0]?.body?.id;

    if (imgUrl) {
      imgUrl = imgUrl.replace(/\/![0-9]+,[0-9]+\//, '/full/');
      imgUrl = imgUrl.replace(/\/full\/0\//, '/!2000,2000/0/');
      urls.push(imgUrl);
    } else {
      urls.push(null);
    }
  }
  return urls;
}

// --- Gemini OCR (realtime, only if --with-ocr) ---
let geminiModel = null;
let ocrPromptText = null;

async function initGemini() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
  const ocrDoc = await db.collection('prompts').findOne({ type: 'ocr', is_default: true });
  const spreadPrefix = `**TWO-PAGE SPREAD HANDLING:**
This image is a two-page spread (open book scan). Process BOTH pages separately.

CRITICAL: Each page may have its own multi-column layout. Handle columns WITHIN each page:
- If a page has 2+ columns, use <column-break/> between columns ON THAT PAGE
- Each page MUST include its own <vocab> tag with key terms from THAT page only.
- Use ISO 639-1 language codes.

If this is NOT a two-page spread (single page), set split_position to null and process normally.

Output structure:
1. <split-position>N</split-position> (0-1000, or null if single page) at the very top
2. All metadata and content for LEFT page
3. <page-break/> on its own line
4. All metadata and content for RIGHT page

`;
  ocrPromptText = spreadPrefix + ocrDoc.content.replace('{language_instruction}', '');
  return ocrDoc.version;
}

async function runSpreadOCR(imageBuf) {
  const r = await geminiModel.generateContent([
    ocrPromptText,
    { inlineData: { mimeType: 'image/jpeg', data: imageBuf.toString('base64') } }
  ]);
  return r.response.text();
}

// --- Parse spread OCR ---
function parseSpreadOCR(ocrText) {
  if (!ocrText) return null;

  const splitMatch = ocrText.match(/<split-position>([^<]*)<\/split-position>/);
  const splitNum = parseInt(splitMatch?.[1]);
  const splitPosition = (!isNaN(splitNum) && splitNum > 0 && splitNum < 1000) ? splitNum : null;

  const hasBreak = ocrText.includes('<page-break/>');
  if (!hasBreak) {
    return {
      isTwoPage: false,
      splitPosition,
      pages: [{ side: 'single', ocr: ocrText.replace(/<split-position>[^<]*<\/split-position>\s*/, '').trim() }],
    };
  }

  const parts = ocrText.split('<page-break/>');
  const leftOCR = parts[0]?.replace(/<split-position>[^<]*<\/split-position>\s*/, '').trim();
  const rightOCR = parts[1]?.trim();

  if (!rightOCR) {
    return {
      isTwoPage: false,
      splitPosition,
      pages: [{ side: 'single', ocr: leftOCR }],
    };
  }

  return {
    isTwoPage: true,
    splitPosition: splitPosition || 500, // default to center if missing
    pages: [
      { side: 'left', ocr: leftOCR },
      { side: 'right', ocr: rightOCR },
    ],
  };
}

// =============================================================
// MAIN
// =============================================================

const book = await db.collection('books').findOne(
  { $or: [{ slug: targetSlug }, { id: targetSlug }] },
  { projection: { id: 1, title: 1, pages_count: 1, slug: 1, split_completed: 1, needs_splitting: 1, image_source: 1 } }
);

if (!book) { console.log('Book not found:', targetSlug); process.exit(1); }
console.log(`\n=== ${book.title} ===`);
console.log(`Current: ${book.pages_count} pages | needs_splitting: ${book.needs_splitting} | split_completed: ${book.split_completed}`);

// --- Step 1: Get original image URLs ---
// First load existing pages to know the original spread count
const allExistingPagesPreload = await db.collection('pages')
  .find({ book_id: book.id })
  .sort({ page_number: 1 })
  .project({ id: 1 })
  .toArray();

const manifestUrl = book.image_source?.iiif_manifest;

console.log('\n--- Step 1: Get original image URLs ---');
// Use the ORIGINAL spread count. For previously-split books, count archived images.
// For never-split books, use existing page count.
let iiifUrls;

// Try archived copies first (works for S3-imported books without IIIF)
const archivedUrls = [];
for (let i = 1; i <= 1000; i++) {
  const testUrl = `${R2_URL}/archived/${book.id}/${i}.jpg`;
  try {
    const resp = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      archivedUrls.push(testUrl);
    } else {
      break; // No more archived images
    }
  } catch {
    break;
  }
}

if (archivedUrls.length > 0) {
  // Verify first image is an original (not a cropped half)
  try {
    const testResp = await fetch(archivedUrls[0], { signal: AbortSignal.timeout(8000) });
    const testBuf = Buffer.from(await testResp.arrayBuffer());
    const meta = await sharp(testBuf).metadata();
    if (meta.width > 500) { // Archived originals are at least 600px+ wide
      console.log(`  Using ${archivedUrls.length} archived R2 copies (${meta.width}x${meta.height})`);
      iiifUrls = archivedUrls;
    } else {
      console.log(`  Archived copies too small (${meta.width}px) — need IIIF fallback`);
    }
  } catch {}
}

if (!iiifUrls && manifestUrl) {
  const originalCount = archivedUrls.length || allExistingPagesPreload.length;
  iiifUrls = await getOriginalImageUrls(book.id, manifestUrl, originalCount);
}

if (!iiifUrls || iiifUrls.length === 0) {
  console.log('ERROR: No original images available (no archived copies, no IIIF manifest).');
  process.exit(1);
}

console.log(`  ${iiifUrls.length} original images found`);

// --- Step 2: Load existing pages (for their OCR) ---
console.log('\n--- Step 2: Load existing page OCR ---');
const allExistingPages = await db.collection('pages')
  .find({ book_id: book.id })
  .sort({ page_number: 1 })
  .project({ id: 1, page_number: 1, photo: 1, 'ocr.data': 1, 'ocr.prompt_version': 1 })
  .toArray();

// Only use the first N pages matching the IIIF manifest count (the original spreads).
// If the book was previously split, there may be more page records than IIIF images.
const existingPages = allExistingPages.slice(0, iiifUrls.length);

console.log(`  ${allExistingPages.length} existing page records, using first ${existingPages.length} (matching ${iiifUrls.length} source images)`);

// Check if OCR has spread markers
const withPageBreak = existingPages.filter(p => p.ocr?.data?.includes('<page-break/>'));
const withSplitPos = existingPages.filter(p => /<split-position>\d+<\/split-position>/.test(p.ocr?.data || ''));
console.log(`  ${withPageBreak.length} have <page-break/>, ${withSplitPos.length} have <split-position>`);

// --- Step 3: Run OCR if needed ---
let ocrVersion = 'existing';
if (WITH_OCR || withPageBreak.length === 0) {
  if (!WITH_OCR && withPageBreak.length === 0) {
    console.log('\n  No spread OCR found. Running Gemini OCR (use --with-ocr to force)...');
  }
  console.log('\n--- Step 3: Running Gemini spread OCR ---');
  ocrVersion = await initGemini();

  // Download original images and run OCR
  for (let i = 0; i < iiifUrls.length; i += CONCURRENCY) {
    const batch = iiifUrls.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (url, j) => {
      const idx = i + j;
      if (!url || idx >= existingPages.length) return;
      const page = existingPages[idx];
      try {
        const buf = await fetchImage(url);
        const ocrText = await runSpreadOCR(buf);
        page.ocr = { data: ocrText, prompt_version: `spread-v2+ocr-v${ocrVersion}` };
        page._imageBuf = buf; // cache for cropping later
        const meta = await sharp(buf).metadata();
        page._w = meta.width;
        page._h = meta.height;
      } catch (e) {
        console.log(`  FAIL p.${page.page_number}: ${e.message?.slice(0, 50)}`);
        page._error = true;
      }
    }));
    process.stderr.write(`  OCR: ${Math.min(i + CONCURRENCY, iiifUrls.length)}/${iiifUrls.length}\r`);
  }
  console.log();
} else {
  console.log('\n--- Step 3: Using existing spread OCR ---');
}

// --- Step 4: Build the new page list ---
console.log('\n--- Step 4: Build new page list ---');

const newPages = []; // { side, ocr, sourceIdx, splitPosition }

for (let idx = 0; idx < existingPages.length; idx++) {
  const page = existingPages[idx];
  if (page._error) {
    newPages.push({ side: 'error', ocr: null, sourceIdx: idx, splitPosition: null });
    continue;
  }

  const parsed = parseSpreadOCR(page.ocr?.data);
  if (!parsed) {
    newPages.push({ side: 'single', ocr: null, sourceIdx: idx, splitPosition: null });
    continue;
  }

  for (const p of parsed.pages) {
    newPages.push({
      side: p.side,
      ocr: p.ocr,
      sourceIdx: idx,
      splitPosition: parsed.splitPosition,
      pageType: extractPageType(p.ocr),
    });
  }
}

const spreads = newPages.filter(p => p.side === 'left').length;
const singles = newPages.filter(p => p.side === 'single').length;
const errors = newPages.filter(p => p.side === 'error').length;

console.log(`  ${iiifUrls.length} spreads → ${newPages.length} pages (${spreads} spreads×2 + ${singles} singles + ${errors} errors)`);

if (DRY_RUN) {
  console.log('\n--- DRY RUN — would create: ---');
  for (let i = 0; i < newPages.length; i++) {
    const p = newPages[i];
    console.log(`  p.${i + 1} ${p.side.padEnd(7)} source:${p.sourceIdx + 1} split:${p.splitPosition || '-'} type:${p.pageType || '-'} ocr:${p.ocr?.length || 0}ch`);
  }
  await client.close();
  process.exit(0);
}

// --- Step 5: Download images (if not cached from OCR step) and crop ---
console.log('\n--- Step 5: Download, crop, upload ---');

// Group by source index to avoid downloading the same spread twice
const bySource = {};
for (const p of newPages) {
  if (!bySource[p.sourceIdx]) bySource[p.sourceIdx] = [];
  bySource[p.sourceIdx].push(p);
}

const sourceIndices = Object.keys(bySource).map(Number).sort((a, b) => a - b);

for (let batch = 0; batch < sourceIndices.length; batch += CONCURRENCY) {
  const batchIndices = sourceIndices.slice(batch, batch + CONCURRENCY);
  await Promise.all(batchIndices.map(async (srcIdx) => {
    const entries = bySource[srcIdx];
    const page = existingPages[srcIdx];

    // Get image buffer (cached from OCR, or download now)
    let buf = page._imageBuf;
    if (!buf) {
      const url = iiifUrls[srcIdx];
      if (!url) { entries.forEach(e => e._error = true); return; }
      try {
        buf = await fetchImage(url);
      } catch (e) {
        console.log(`  FAIL source ${srcIdx + 1}: ${e.message?.slice(0, 50)}`);
        entries.forEach(e => e._error = true);
        return;
      }
    }

    const meta = page._w ? { width: page._w, height: page._h } : await sharp(buf).metadata();
    const w = meta.width;
    const h = meta.height;

    for (const entry of entries) {
      const pageNum = newPages.indexOf(entry) + 1;

      if (entry.side === 'error' || entry._error) continue;

      if (entry.side === 'single') {
        // Keep full image — don't crop
        const urls = await uploadFullImage(buf, book.id, pageNum);
        entry._photo = urls.dispUrl;
        entry._thumb = urls.thumbUrl;
      } else if (entry.side === 'left') {
        const splitFrac = (entry.splitPosition || 500) / 1000;
        const leftEnd = Math.round(Math.min(1, splitFrac + OVERLAP) * w);
        const urls = await cropAndUpload(buf, 0, leftEnd, h, book.id, pageNum);
        entry._photo = urls.dispUrl;
        entry._thumb = urls.thumbUrl;
      } else if (entry.side === 'right') {
        const splitFrac = (entry.splitPosition || 500) / 1000;
        const rightStart = Math.round(Math.max(0, splitFrac - OVERLAP) * w);
        const urls = await cropAndUpload(buf, rightStart, w - rightStart, h, book.id, pageNum);
        entry._photo = urls.dispUrl;
        entry._thumb = urls.thumbUrl;
      }
    }
  }));
  process.stderr.write(`  Upload: ${Math.min(batch + CONCURRENCY, sourceIndices.length)}/${sourceIndices.length}\r`);
}
console.log();

// --- Step 6: Delete old pages, insert new ones ---
console.log('\n--- Step 6: Delete old pages, insert new ones ---');

const ocrModel = WITH_OCR ? 'gemini-3.1-flash-lite-preview' : (existingPages[0]?.ocr?.model || 'gemini-3.1-flash-lite-preview');
const promptVersion = WITH_OCR ? `spread-v2+ocr-v${ocrVersion}` : (existingPages[0]?.ocr?.prompt_version || 'spread-v2+ocr-v10');

// Find best cover
let coverPage = null;

const newDocs = [];
for (let i = 0; i < newPages.length; i++) {
  const p = newPages[i];
  const pageNum = i + 1;

  if (!p._photo) continue; // skip failed pages

  const id = new ObjectId().toHexString();
  const doc = {
    _id: new ObjectId(id),
    id,
    tenant_id: 'default',
    book_id: book.id,
    page_number: pageNum,
    photo: p._photo,
    thumbnail: p._thumb,
    ocr: p.ocr ? {
      data: p.ocr,
      model: ocrModel,
      prompt_version: promptVersion,
    } : undefined,
    page_type: p.pageType,
    split_from_spread: true,
    split_side: p.side === 'error' ? 'single' : p.side,
    split_position: p.splitPosition,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Track cover
  if (!coverPage && (p.pageType === 'title-page' || p.pageType === 'frontispiece')) {
    coverPage = { num: pageNum, url: p._photo, type: p.pageType };
  }

  newDocs.push(doc);
}

// Fallback cover: first non-blank page
if (!coverPage && newDocs.length > 0) {
  const first = newDocs.find(d => d.page_type !== 'blank') || newDocs[0];
  coverPage = { num: first.page_number, url: first.photo, type: first.page_type };
}

console.log(`  Deleting ${existingPages.length} old pages...`);
await db.collection('pages').deleteMany({ book_id: book.id });

console.log(`  Inserting ${newDocs.length} new pages...`);
if (newDocs.length > 0) {
  await db.collection('pages').insertMany(newDocs);
}

// --- Step 7: Update book ---
console.log('\n--- Step 7: Update book ---');

const pagesWithOCR = newDocs.filter(d => d.ocr?.data).length;

await db.collection('books').updateOne({ id: book.id }, {
  $set: {
    pages_count: newDocs.length,
    pages_ocr: pagesWithOCR,
    needs_splitting: false,
    split_completed: true,
    split_completed_at: new Date(),
    thumbnail: coverPage?.url,
    cover_page: coverPage?.num,
    updated_at: new Date(),
  }
});

console.log(`  pages: ${existingPages.length} spread → ${newDocs.length} split`);
console.log(`  OCR: ${pagesWithOCR}/${newDocs.length}`);
console.log(`  cover: p.${coverPage?.num || '?'} (${coverPage?.type || 'auto'})`);

const url = book.slug
  ? `https://sourcelibrary.org/book/${book.slug}`
  : `https://sourcelibrary.org/book/${book.id}`;
console.log(`\nDone: ${url}`);

await client.close();
