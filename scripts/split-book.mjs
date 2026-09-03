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
import { extractPageType } from './lib/ocr-result-parse.mjs';

// --- Config ---
const OVERLAP = 0.03;        // 3% overlap on each crop (#1491 lesson #6: 1% clipped tight gutters)
const CONCURRENCY = 3;       // Gemini / fetch concurrency
const MAX_RETRIES = 3;       // Image fetch retries
const FETCH_TIMEOUT = 15000; // 15s per image
const MIN_SPREAD_AR = 1.1;   // Aspect ratio gate: below this is portrait (single page), skip splitting

// --- Parse args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const WITH_OCR = args.includes('--with-ocr');
const GUTTER_ONLY = args.includes('--gutter-only');
let detectGutterPixel; // lazy-loaded in gutter-only mode (avoids sharp import cost on OCR runs) // #2454: split images BEFORE OCR — cheap gutter detection, pages created without OCR
const targetSlug = args.find(a => !a.startsWith('--'));

if (!targetSlug) {
  console.log('Usage: node scripts/split-book.mjs <slug-or-id> [--dry-run] [--with-ocr] [--gutter-only]');
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
  const fullDim = { width, height };
  const display = await sharp(full).resize(1200, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toBuffer();
  const thumb = await sharp(full).resize(150, null, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
  const [fullUrl, dispUrl, thumbUrl] = await Promise.all([
    upload(spPath(bookId, pageNum, '-full.jpg'), full),
    upload(spPath(bookId, pageNum, '.jpg'), display),
    upload(spPath(bookId, pageNum, '-thumb.jpg'), thumb),
  ]);
  return { fullUrl, dispUrl, thumbUrl, width: fullDim.width, height: fullDim.height };
}

async function uploadFullImage(buf, bookId, pageNum) {
  const fm = await sharp(buf).metadata();
  const display = await sharp(buf).resize(1200, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toBuffer();
  const thumb = await sharp(buf).resize(150, null, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
  const [fullUrl, dispUrl, thumbUrl] = await Promise.all([
    upload(spPath(bookId, pageNum, '-full.jpg'), buf),
    upload(spPath(bookId, pageNum, '.jpg'), display),
    upload(spPath(bookId, pageNum, '-thumb.jpg'), thumb),
  ]);
  return { fullUrl, dispUrl, thumbUrl, width: fm.width, height: fm.height };
}

// --- Page type extraction: shared via scripts/lib/ocr-result-parse.mjs (#4443) ---
// Validating, as this script's private copy always did — but against the current
// vocabulary rather than the 15-value set it had frozen at (which predated
// `exlibris` and `bookplate`). The shared function is equally null-tolerant,
// which matters here: `p.ocr` is null on an un-OCR'd page.

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
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
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

// --- Gutter-only detection (#2454: split BEFORE OCR) ---
// One cheap vision call per page: where is the gutter? No transcription, so
// output is ~10 tokens instead of ~2K. The split pages then flow through the
// normal single-page OCR pipeline (batch, 50% off) instead of realtime.
// NO center hint: measured that "usually 400-600" anchors the model to ~500 and
// it ignores the real (often offset) gutter. Without the hint, gemini-3-flash-preview
// localizes the gutter to within ~3/1000 of the pixel detector even on strongly
// offset RTL manuscripts. flash-lite stays center-biased — must use preview.
const GUTTER_MODEL = 'gemini-3-flash-preview';
const GUTTER_PROMPT = `This is a photo of an open book showing a left page and a right page. Find the GUTTER — the vertical line where the two pages meet at the binding (often a shadow, or the innermost margins of the two pages). It may NOT be at the center; look carefully.

Respond with EXACTLY one tag and nothing else:
- Two-page spread: <split-position>N</split-position> where N (0-1000) is the gutter's horizontal position. 0 = far left edge, 1000 = far right edge.
- Single page (not a spread): <split-position>null</split-position>`;

async function initGeminiGutter() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: GUTTER_MODEL });
}

async function runGutterDetect(imageBuf) {
  const r = await geminiModel.generateContent([
    GUTTER_PROMPT,
    { inlineData: { mimeType: 'image/jpeg', data: imageBuf.toString('base64') } }
  ]);
  const text = r.response.text();
  const m = text.match(/<split-position>([^<]*)<\/split-position>/);
  if (!m) return null; // unparseable — caller decides fallback
  const n = parseInt(m[1]);
  return (!isNaN(n) && n > 0 && n < 1000) ? n : 'single';
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
const manifestUrl = book.image_source?.iiif_manifest;

console.log('\n--- Step 1: Get original image URLs ---');

// Use existing page count as the expected spread count (before any prior split).
// For books that were already split once, batch_jobs.page_count is the true spread count.
const existingPageCount = book.pages_count || 0;
let iiifUrls;

// Try archived copies first — use known page count instead of sequential HEAD probing.
// BPH books use zero-padded names (0001.jpg), others use plain (1.jpg). Try both.
const archivePatterns = [
  { fmt: (i) => `${R2_URL}/archived/${book.id}/${String(i).padStart(4, '0')}.jpg`, label: '0001.jpg' },
  { fmt: (i) => `${R2_URL}/archived/${book.id}/${i}.jpg`, label: '1.jpg' },
];

for (const pattern of archivePatterns) {
  if (iiifUrls) break;
  try {
    const testResp = await fetch(pattern.fmt(1), { signal: AbortSignal.timeout(8000) });
    if (!testResp.ok) continue;
    const testBuf = Buffer.from(await testResp.arrayBuffer());
    const meta = await sharp(testBuf).metadata();
    if (meta.width <= 500) {
      console.log(`  Archived copies too small (${meta.width}px, ${pattern.label}) — skipping`);
      continue;
    }
    // Check the last expected image exists too
    const lastResp = await fetch(pattern.fmt(existingPageCount), { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    if (lastResp.ok) {
      iiifUrls = Array.from({ length: existingPageCount }, (_, i) => pattern.fmt(i + 1));
      console.log(`  Using ${iiifUrls.length} archived R2 copies (${pattern.label}, ${meta.width}x${meta.height})`);
    } else {
      // Archived count doesn't match page count — binary search for actual count
      let hi = existingPageCount;
      let lo = 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const r = await fetch(pattern.fmt(mid), { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        if (r.ok) lo = mid; else hi = mid - 1;
      }
      iiifUrls = Array.from({ length: lo }, (_, i) => pattern.fmt(i + 1));
      console.log(`  Using ${iiifUrls.length} archived R2 copies (binary search, ${pattern.label}, ${meta.width}x${meta.height})`);
    }
  } catch {}
}

if (!iiifUrls && manifestUrl) {
  iiifUrls = await getOriginalImageUrls(book.id, manifestUrl, existingPageCount);
}

// Page-record fallback: providers that don't use the /archived/{id}/{n}.jpg
// convention (e.g. cmc_kloss PDF extracts at /books/{id}/pages/NNNN.jpg, the
// largest cohort) still carry the correct R2 URL on the page document itself.
// Only safe for never-split books — on an already-split book `photo` is a
// cropped half, not the spread. All #2454 first-time splits qualify.
if (!iiifUrls && book.split_completed !== true) {
  const srcPages = await db.collection('pages')
    .find({ book_id: book.id }, { projection: { page_number: 1, archived_photo: 1, photo: 1 } })
    .sort({ page_number: 1 })
    .toArray();
  const urls = srcPages
    .map(p => p.archived_photo || p.photo)
    .filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
  if (urls.length > 0 && urls.length >= srcPages.length * 0.9) {
    iiifUrls = urls;
    console.log(`  Using ${iiifUrls.length} page-record image URLs (provider: ${book.image_source?.provider || 'unknown'})`);
  }
}

if (!iiifUrls || iiifUrls.length === 0) {
  console.log('ERROR: No original images available (no archived copies, no IIIF manifest, no usable page-record URLs).');
  process.exit(1);
}

console.log(`  ${iiifUrls.length} original images found`);

// --- AR gate: sample several pages and use the median aspect ratio ---
// The first page is often a portrait cover/title on a book whose body is
// spreads (e.g. Hollandus VCQ 37: page 1 AR 0.45, body AR ~1.35), so gating
// on iiifUrls[0] alone produced false "portrait" verdicts. Sample up to 5
// pages spread through the book and decide on the median.
try {
  const sampleCount = Math.min(5, iiifUrls.length);
  const sampleIdxs = [...new Set(
    Array.from({ length: sampleCount }, (_, i) =>
      Math.floor(((i + 1) / (sampleCount + 1)) * iiifUrls.length))
  )];
  const ars = [];
  for (const idx of sampleIdxs) {
    try {
      const gateBuf = await fetchImage(iiifUrls[idx]);
      const gateMeta = await sharp(gateBuf).metadata();
      ars.push(gateMeta.width / gateMeta.height);
    } catch { /* skip unfetchable sample */ }
  }
  if (ars.length > 0) {
    ars.sort((a, b) => a - b);
    const ar = ars[Math.floor(ars.length / 2)];
    const arList = ars.map(a => a.toFixed(2)).join(', ');
    if (ar < MIN_SPREAD_AR) {
      console.log(`  AR gate: median ${ar.toFixed(2)} < ${MIN_SPREAD_AR} over ${ars.length} samples [${arList}] — portrait pages, not spreads. Skipping.`);
      if (!DRY_RUN) {
        await db.collection('books').updateOne({ id: book.id }, {
          $set: { needs_splitting: false, split_completed: true, split_note: `AR gate: median ${ar.toFixed(2)} — portrait` },
        });
      } else {
        console.log('  (dry run — not writing needs_splitting/split_completed)');
      }
      await client.close();
      process.exit(0);
    }
    console.log(`  AR: median ${ar.toFixed(2)} over ${ars.length} samples [${arList}] — confirmed spreads`);
  } else {
    console.log('  AR gate: no sample images fetchable — proceeding anyway');
  }
} catch (e) {
  console.log(`  AR gate: failed (${e.message?.slice(0, 40)}) — proceeding anyway`);
}

// --- Step 2: Load existing pages (for their OCR) ---
console.log('\n--- Step 2: Load existing page OCR ---');
const allExistingPages = await db.collection('pages')
  .find({ book_id: book.id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }) // live pages only — skip spreads archived by a prior run (idempotency)
  .sort({ page_number: 1 })
  .project({ id: 1, page_number: 1, photo: 1, page_type: 1, 'ocr.data': 1, 'ocr.prompt_version': 1, 'ocr.model': 1 })
  .toArray();

// Only use the first N pages matching the source image count (the original spreads).
// If the book was previously split, there may be more page records than source images.
const existingPages = allExistingPages.slice(0, iiifUrls.length);

console.log(`  ${allExistingPages.length} existing page records, using first ${existingPages.length} (matching ${iiifUrls.length} source images)`);

// Check if OCR has spread markers
const withPageBreak = existingPages.filter(p => p.ocr?.data?.includes('<page-break/>'));
const withSplitPos = existingPages.filter(p => /<split-position>\d+<\/split-position>/.test(p.ocr?.data || ''));
console.log(`  ${withPageBreak.length} have <page-break/>, ${withSplitPos.length} have <split-position>`);

// --- Step 3: Run OCR if needed ---
let ocrVersion = 'existing';
if (GUTTER_ONLY) {
  // #2454 decision tree: split images BEFORE any OCR.
  //   portrait (AR < 1.1)               → keep whole
  //   pixel valley + Gemini AGREE (≤8%) → cut (two independent methods concur — strongest)
  //   only one of pixel/Gemini confident → cut on it
  //   both confident but DISAGREE (>8%) → uncertain (don't trust either blindly)
  //   neither confident + wide          → center, uncertain
  //   neither confident + tight         → keep whole, uncertain
  // Gemini = gemini-3-flash-preview with a no-center-hint prompt (it tracks
  // offset gutters to ~3/1000; flash-lite + the old hint just guessed center).
  // Pixel is free and runs first; Gemini cross-checks / rescues the tail.
  // Book-level park: too many uncertain pages, OR confident gutter positions
  // SCATTERED across pages (a real binding is stable book-wide; scatter ⇒ not a
  // spread book — map atlas / plate album — must not be cut).
  // ── Step 2.5: OCR-based content classification (FREE — uses existing OCR) ──
  // These books were already OCR'd, so each page carries a <page-type>. A
  // single map/plate book has page_type 'map'/'illustration' on most pages and
  // almost no body text; a real text spread is page_type 'text' with thousands
  // of chars. That separates the two cases pixels/Gemini can't (an atlas of
  // single wide maps vs two text pages) — for free, no model call. Only 6 of
  // the 331 #2454 books are plate books, and this finds them precisely.
  const IMG_PAGE_TYPES = new Set(['map', 'illustration', 'diagram', 'frontispiece', 'plate']);
  let imgPages = 0, contentPages = 0;
  for (const pg of existingPages) {
    if (pg.page_type === 'blank') continue;
    const body = (pg.ocr?.data || '').replace(/<[^>]+>/g, '').trim().length;
    const isImg = IMG_PAGE_TYPES.has(pg.page_type) || (/<image-desc>/i.test(pg.ocr?.data || '') && body < 400);
    if (isImg) imgPages++; else contentPages++;
  }
  const imgFrac = (imgPages + contentPages) ? imgPages / (imgPages + contentPages) : 0;
  console.log(`  Content class (from existing OCR): ${imgPages} image-pages / ${contentPages} text-pages → imgFrac ${imgFrac.toFixed(2)}`);

  if (imgFrac >= 0.6) {
    // Plate/map book — these are single wide images, not two-page text spreads.
    // Splitting would bisect maps; they display best as full spreads. Stop
    // trying to split: clear needs_splitting, leave pages intact.
    console.log(`  PLATE/MAP BOOK (imgFrac ${imgFrac.toFixed(2)} ≥ 0.6) — not a text spread book; clearing needs_splitting, keeping pages whole.`);
    if (!DRY_RUN) {
      await db.collection('books').updateOne({ id: book.id }, {
        $set: {
          needs_splitting: false,
          split_completed: true,
          split_note: `OCR page_type: ${imgPages}/${imgPages + contentPages} image pages — plate/map book, kept whole (#2454)`,
          'pipeline_auto.status': 'complete',
          'pipeline_auto.last_updated': new Date(),
        },
      });
    }
    await client.close();
    process.exit(0);
  }
  if (imgFrac >= 0.25) {
    // Mixed (text + a meaningful share of plates) — too risky to auto-split.
    console.log(`  MIXED BOOK (imgFrac ${imgFrac.toFixed(2)}) — text + plates; parking for review rather than auto-splitting.`);
    if (!DRY_RUN) {
      await db.collection('books').updateOne({ id: book.id }, {
        $set: {
          'pipeline_auto.status': 'needs_attention',
          'pipeline_auto.error': `Mixed text/plate book (imgFrac ${imgFrac.toFixed(2)}) — manual split review (#2454)`,
          'pipeline_auto.split_review_needed': true,
          'pipeline_auto.last_updated': new Date(),
        },
      });
    }
    await client.close();
    process.exit(0);
  }
  // imgFrac < 0.25 → text spread book → split it.

  console.log('\n--- Step 3: Gutter detection — pixel/page (free), Gemini on a sample (no OCR) ---');
  ({ detectGutterPixel } = await import('./lib/gutter-detect.mjs'));
  let geminiReady = false;
  const stats = { portrait: 0, agree: 0, pixelOnly: 0, geminiOnly: 0, disagree: 0, centerUncertain: 0, keptWholeUncertain: 0 };
  const AGREE_TOL = 80; // 0-1000 → 8% of width
  // The binding is stable book-wide, so Gemini (the paid call) only needs to run
  // on a small SAMPLE to validate/establish the book gutter. Pixel runs on every
  // page (free); non-sample pages where pixel is unsure snap to the book median.
  const GEM_SAMPLE = Math.min(8, iiifUrls.length);
  const gemSampleIdx = new Set(Array.from({ length: GEM_SAMPLE }, (_, k) => Math.floor(((k + 1) / (GEM_SAMPLE + 1)) * iiifUrls.length)));

  for (let i = 0; i < iiifUrls.length; i += CONCURRENCY) {
    const batch = iiifUrls.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (url, j) => {
      const idx = i + j;
      if (!url || idx >= existingPages.length) return;
      const page = existingPages[idx];
      try {
        const buf = await fetchImage(url);
        const meta = await sharp(buf).metadata();
        page._imageBuf = buf;
        page._w = meta.width;
        page._h = meta.height;
        const ar = meta.width / meta.height;

        if (ar < MIN_SPREAD_AR) {
          page._gutter = 'single'; page._splitMethod = 'portrait'; stats.portrait++;
          return;
        }

        // Pixel every page (free). Gemini only on the sample (validates the
        // book gutter + cross-checks pixel; the binding is stable book-wide).
        const pix = await detectGutterPixel(buf);
        const pixPos = (pix.confidence === 'high' && pix.column != null) ? Math.round((pix.column / meta.width) * 1000) : null;
        let gemPos = null;
        if (gemSampleIdx.has(idx)) {
          if (!geminiReady) { await initGeminiGutter(); geminiReady = true; }
          try { const g = await runGutterDetect(buf); if (typeof g === 'number') gemPos = g; } catch { /* gemini optional */ }
        }

        if (pixPos != null && gemPos != null) {
          if (Math.abs(pixPos - gemPos) <= AGREE_TOL) {
            page._gutter = Math.round((pixPos + gemPos) / 2); // concur → average
            page._splitMethod = `agree(px${pixPos}/gem${gemPos})`;
            page._confidentPos = page._gutter; stats.agree++;
          } else {
            // Two methods disagree — genuinely ambiguous, don't guess.
            page._splitMethod = `disagree(px${pixPos}/gem${gemPos})`;
            page._uncertain = true;
            if (ar >= 1.3) { page._gutter = pixPos; stats.disagree++; } // wide: trust pixel (measures the image), flag for review
            else { page._gutter = 'single'; stats.disagree++; }
          }
        } else if (pixPos != null) {
          page._gutter = pixPos; page._splitMethod = `pixel:${pix.reason}`; page._confidentPos = pixPos; stats.pixelOnly++;
        } else if (gemPos != null) {
          // Text book (maps already filtered out in Step 2.5), so a Gemini-only
          // position is a real spread that pixel found hard (e.g. faint gutter).
          // Trust it as a confident position.
          page._gutter = gemPos; page._splitMethod = 'gemini'; page._confidentPos = gemPos; stats.geminiOnly++;
        } else if (ar >= 1.3) {
          page._gutter = 500; page._splitMethod = 'center-uncertain'; page._uncertain = true; stats.centerUncertain++;
        } else {
          page._gutter = 'single'; page._splitMethod = 'kept-whole-uncertain'; page._uncertain = true; stats.keptWholeUncertain++;
        }
      } catch (e) {
        console.log(`  FAIL p.${page.page_number}: ${e.message?.slice(0, 50)}`);
        page._error = true;
      }
    }));
    process.stderr.write(`  Gutter: ${Math.min(i + CONCURRENCY, iiifUrls.length)}/${iiifUrls.length}\r`);
  }
  const confidentPositions = [];
  for (const p of existingPages) if (typeof p._confidentPos === 'number') confidentPositions.push(p._confidentPos);
  console.log();

  // ── Book-level consensus (approach A) ──────────────────────────────────────
  // The binding sits at a STABLE position book-wide, so a single page's bad
  // detection should be overruled by the book median — not park the whole book
  // (a 10-page book parked over one diagram page is the failure this fixes).
  // Robust median + MAD over confident positions; scatter = no stable binding.
  const sorted = [...confidentPositions].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 500;
  const mad = sorted.length
    ? [...sorted.map(p => Math.abs(p - median))].sort((a, b) => a - b)[Math.floor(sorted.length / 2)]
    : 0;
  const landscapeCount = existingPages.filter(p => !p._error && p._gutter !== 'single' || p._uncertain).length;
  // Maps are already filtered out (Step 2.5), so any confident gutter — pixel OR
  // Gemini — counts. Need at least a couple to anchor the book median.
  const enoughSignal = confidentPositions.length >= Math.max(2, Math.ceil(landscapeCount * 0.25));
  const SCATTER_MAD = 60; // 0-1000 → 6% — robust scatter measure (MAD, not stdev: one outlier won't trip it)
  const scattered = confidentPositions.length >= 3 && mad > SCATTER_MAD;
  console.log(`  Methods: agree ${stats.agree}, pixel-only ${stats.pixelOnly}, gemini-only ${stats.geminiOnly}, disagree ${stats.disagree}, portrait ${stats.portrait}, center-unc ${stats.centerUncertain}, kept-whole-unc ${stats.keptWholeUncertain}`);
  console.log(`  Book consensus: median ${median}/1000, MAD ${mad}/1000, ${confidentPositions.length} confident/${landscapeCount} landscape${scattered ? ' — SCATTERED' : ''}`);

  // Park only when there's no trustworthy consensus: too few confident pages, or
  // genuinely scattered positions (maps/plates, not a spread book).
  const parkReason = !enoughSignal
    ? `only ${confidentPositions.length}/${landscapeCount} landscape pages gave a confident gutter — too little signal`
    : scattered
      ? `gutter positions scattered (MAD ${mad}/1000 > ${SCATTER_MAD}) — inconsistent binding, needs review`
      : null;

  // Resolve every landscape page against the consensus: outliers and uncertain
  // pages snap to the book median; pages near the median keep their own (more
  // accurate per-page) cut. Only runs when we're going to split (not parking).
  if (!parkReason) {
    const OUTLIER_TOL = 80; // 0-1000 → 8% from median = outlier, use median instead
    let snapped = 0;
    for (const p of existingPages) {
      if (p._error || p._gutter === 'single' && !p._uncertain && p._splitMethod === 'portrait') continue;
      if (typeof p._gutter === 'number' && typeof p._confidentPos === 'number' && Math.abs(p._confidentPos - median) <= OUTLIER_TOL) {
        continue; // confident & consistent → keep its own cut
      }
      // outlier, uncertain, or kept-whole landscape page → apply book median
      if (p._gutter !== 'single' || p._uncertain) {
        if (p._splitMethod === 'portrait') continue;
        p._gutter = median;
        p._splitMethod = `book-median(${median})`;
        p._uncertain = false;
        snapped++;
      }
    }
    if (snapped) console.log(`  Snapped ${snapped} outlier/uncertain pages to book median ${median}`);
  }
  if (parkReason && DRY_RUN) {
    console.log(`\n  WOULD PARK: ${parkReason} — real run flags needs_attention instead of splitting.`);
  }
  if (parkReason && !DRY_RUN) {
    console.error(`\n  PARK: ${parkReason}. Not splitting — flagging needs_attention for review.`);
    await db.collection('books').updateOne({ id: book.id }, {
      $set: {
        'pipeline_auto.status': 'needs_attention',
        'pipeline_auto.error': `Split review needed (#2454): ${parkReason}`,
        'pipeline_auto.split_review_needed': true,
        'pipeline_auto.last_updated': new Date(),
      },
    });
    await client.close();
    process.exit(0);
  }
} else if (WITH_OCR || withPageBreak.length === 0) {
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

  if (GUTTER_ONLY) {
    const method = page._splitMethod || 'unknown';
    if (page._gutter === 'single') {
      // Singles keep any existing OCR — it was made from this exact image.
      newPages.push({ side: 'single', ocr: page.ocr?.data || null, sourceIdx: idx, splitPosition: null, splitMethod: method, uncertain: !!page._uncertain });
    } else {
      // Spread: two OCR-less pages; the normal pipeline OCRs them as singles.
      const pos = typeof page._gutter === 'number' ? page._gutter : 500;
      newPages.push({ side: 'left', ocr: null, sourceIdx: idx, splitPosition: pos, splitMethod: method, uncertain: !!page._uncertain });
      newPages.push({ side: 'right', ocr: null, sourceIdx: idx, splitPosition: pos, splitMethod: method, uncertain: !!page._uncertain });
    }
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
    console.log(`  p.${i + 1} ${p.side.padEnd(7)} source:${p.sourceIdx + 1} split:${p.splitPosition || '-'} ${p.splitMethod ? `[${p.splitMethod}${p.uncertain ? ' UNCERTAIN' : ''}]` : ''} type:${p.pageType || '-'} ocr:${p.ocr?.length || 0}ch`);
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
        entry._full = urls.fullUrl;
        entry._imgW = urls.width;
        entry._imgH = urls.height;
      } else if (entry.side === 'left') {
        const splitFrac = (entry.splitPosition || 500) / 1000;
        const leftEnd = Math.round(Math.min(1, splitFrac + OVERLAP) * w);
        const urls = await cropAndUpload(buf, 0, leftEnd, h, book.id, pageNum);
        entry._photo = urls.dispUrl;
        entry._thumb = urls.thumbUrl;
        entry._full = urls.fullUrl;
        entry._imgW = urls.width;
        entry._imgH = urls.height;
      } else if (entry.side === 'right') {
        const splitFrac = (entry.splitPosition || 500) / 1000;
        const rightStart = Math.round(Math.max(0, splitFrac - OVERLAP) * w);
        const urls = await cropAndUpload(buf, rightStart, w - rightStart, h, book.id, pageNum);
        entry._photo = urls.dispUrl;
        entry._thumb = urls.thumbUrl;
        entry._full = urls.fullUrl;
        entry._imgW = urls.width;
        entry._imgH = urls.height;
      }
    }

    // Free image buffer to avoid memory buildup on large books
    page._imageBuf = null;
  }));
  process.stderr.write(`  Upload: ${Math.min(batch + CONCURRENCY, sourceIndices.length)}/${sourceIndices.length}\r`);
}
console.log();

// --- Step 6: Archive old spreads, insert new pages ---
console.log('\n--- Step 6: Archive old spreads, insert new pages ---');

const ocrModel = WITH_OCR ? 'gemini-3.1-flash-lite' : (existingPages[0]?.ocr?.model || 'gemini-3.1-flash-lite');
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
    ...(book.tenantId ? { tenantId: book.tenantId } : {}),
    book_id: book.id,
    page_number: pageNum,
    photo: p._photo,
    thumbnail: p._thumb,
    archived_photo: p._full || p._photo,   // full-res crop — what archive audits key on (#829)
    display_photo: p._photo,
    thumbnail_blob: p._thumb,
    ...(p._imgW ? { image_width: p._imgW, image_height: p._imgH } : {}), // #1491: dims on each page record
    ...(iiifUrls[p.sourceIdx] ? { spread_source: iiifUrls[p.sourceIdx] } : {}), // lineage to the pre-split spread
    ocr: p.ocr ? {
      data: p.ocr,
      model: ocrModel,
      prompt_version: promptVersion,
    } : undefined,
    page_type: p.pageType,
    split_from_spread: true,
    split_side: p.side === 'error' ? 'single' : p.side,
    split_position: p.splitPosition,
    ...(p.splitMethod ? { split_method: p.splitMethod } : {}),
    ...(p.uncertain ? { split_uncertain: true } : {}),
    field_provenance: {
      ...(p.ocr ? { ocr: { source: 'gemini', method: 'spread-split-ocr', confidence: 1.0, date: new Date() } } : {}),
      photo: { source: 'r2', method: 'spread-split-crop', confidence: 1.0, date: new Date() },
    },
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

// Safety check: don't touch old pages if too many failed (>20% loss = abort)
const failedCount = newPages.length - newDocs.length;
if (failedCount > 0 && failedCount / newPages.length > 0.2) {
  console.error(`\nABORT: ${failedCount}/${newPages.length} pages failed (>${Math.round(0.2 * 100)}% threshold). Not archiving old pages.`);
  await client.close();
  process.exit(1);
}
if (newDocs.length === 0) {
  console.error('\nABORT: Zero pages would be created. Not archiving old pages.');
  await client.close();
  process.exit(1);
}

// Save pre-split revision snapshot.
const pagesWithOcrData = allExistingPages.filter(p => p.ocr?.data);
if (pagesWithOcrData.length > 0) {
  await db.collection('page_revisions').insertOne({
    id: `split-${book.id}-${Date.now()}`,
    book_id: book.id,
    type: 'pre-split-snapshot',
    page_count: allExistingPages.length,
    pages_with_ocr: pagesWithOcrData.length,
    created_at: new Date(),
    note: `Snapshot before spread split. ${allExistingPages.length} pages → ${newDocs.length} split pages.`,
  });
}

// Archive old spreads in place rather than delete (#1491): negate page_number
// and tag page_type:'archived-spread' so the originals stay fully recoverable.
// The read path filters page_number>=0 && page_type!='archived-spread' in the
// Mongo query (PR #1441), so archived spreads never surface in the reader,
// grids, galleries, or extraction. page_number = -(abs+1) avoids a 0 collision.
console.log(`  Archiving ${allExistingPages.length} old spread pages (negative page_number)...`);
await db.collection('pages').updateMany(
  { book_id: book.id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } },
  [{ $set: {
    page_number: { $subtract: [-1, { $abs: '$page_number' }] },
    page_type: 'archived-spread',
    archived_spread: true,
    hidden: true,
    updated_at: new Date(),
  } }]
);

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
    pages_translated: 0,  // Reset — old spread translations are gone
    pages_blank: 0,        // Reset — will be recomputed by sync-page-counts cron
    needs_splitting: false,
    split_completed: true,
    split_completed_at: new Date(),
    thumbnail: coverPage?.url,
    cover_page: coverPage?.num,
    updated_at: new Date(),
  }
});

if (GUTTER_ONLY) {
  // #2454: pages were created without OCR — requeue the book so the normal
  // single-page batch OCR pipeline picks it up (needs_splitting is now false,
  // so no spread prompt and no Phase 1.5 skip).
  await db.collection('books').updateOne({ id: book.id }, {
    $set: { 'pipeline_auto.status': 'archive_complete', 'pipeline_auto.last_updated': new Date() },
  });
  console.log('  Requeued at archive_complete for single-page OCR');
}

console.log(`  pages: ${existingPages.length} spread → ${newDocs.length} split`);
console.log(`  OCR: ${pagesWithOCR}/${newDocs.length}`);
console.log(`  cover: p.${coverPage?.num || '?'} (${coverPage?.type || 'auto'})`);

const url = book.slug
  ? `https://sourcelibrary.org/book/${book.slug}`
  : `https://sourcelibrary.org/book/${book.id}`;
console.log(`\nDone: ${url}`);

await client.close();
