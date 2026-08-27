#!/usr/bin/env node
/**
 * Re-extract silently-missed illustrations (issue #2533).
 *
 * Target ("Case 3" / the page-10-comet pattern): VISIBLE books that are ALREADY
 * image-extracted (`detected_images_count > 0`) but contain individual pages that
 * are valid illustration candidates — `page_type` in the candidate set OR a
 * non-trivial high-significance `<image-desc>` OCR marker — yet have EMPTY
 * `detected_images`. The original vision pass missed them; the book finalized as
 * `complete`, so the catch-up cron (which only revisits books with no
 * `detected_images_count`) never re-examines them.
 *
 * This re-runs the SAME extraction the production worker runs (identical prompt,
 * pulled from image-extract-worker.mjs so it can't drift), then materializes the
 * result through the canonical paths: generate-thumbnails (crops → R2) and the
 * sync-gallery-images pipeline (full denormalized gallery_images docs).
 *
 * Idempotent & resumable: every page we test gets `miss_recheck_at` stamped, so
 * OCR-over-claim pages (vision correctly found nothing) are never re-tested, and
 * recovered pages drop out of the candidate filter once they have detected_images.
 * Re-run until no candidates remain.
 *
 * Usage:
 *   node scripts/maintenance/reextract-missed-pages.mjs --limit=2000 [--apply] [--concurrency=10]
 *   --apply       actually write detected_images + materialize (default: dry-run, measure yield only)
 *   --limit=N     max candidate pages to process this run (default 500)
 *   --concurrency vision-call concurrency (default 10)
 *   --book=ID     restrict to a single book (debugging)
 *   --any-marker  widen the candidate test to ANY non-trivial <image-desc> tag,
 *                 including bare attribute-less tags from old OCR vintages
 *                 (issue #3165). Skips pages the vision model already examined.
 *   --page-type-candidates
 *                 ALSO accept pages whose `page_type` is already an illustration
 *                 class (illustration/diagram/map/frontispiece/mixed/title-page)
 *                 even when OCR left no <image-desc> marker at all — the
 *                 production worker's own rule. Every marker-based gate above is
 *                 blind to those pages, so they are never offered to the vision
 *                 model and read as "extracted, empty" permanently. Also skips
 *                 pages already examined.
 *   --all-pages   Offer EVERY never-examined page (page_number > 0, no
 *                 detected_images) to the vision model — no marker, no
 *                 page_type needed. For books whose OCR vintage has neither
 *                 (the worker sees "no candidates" and stamps them
 *                 images_complete on first touch, #4241). Requires --book.
 *   --reconcile   No vision calls. Re-crop + re-materialize books whose
 *                 recovered pages have no gallery_images doc. The corpus scan
 *                 selects on `detected_images_count > 0` — a field written BY
 *                 materialization — so a book whose FIRST materialization died
 *                 is invisible to it (#4241). For that case use:
 *   --reconcile --book=ID
 *                 targeted repair of one book: skips the rollup-field gate and
 *                 considers ANY qualifying detection (not just miss_recheck_at
 *                 pages), so worker-written detections that never materialized
 *                 are repaired too.
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getPageSource } from '../lib/page-image-url.mjs';

const args = process.argv.slice(2);
const getArg = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const APPLY = args.includes('--apply');
// Reconcile mode: don't extract — find books whose recovered pages have no
// gallery_images doc (materialization was interrupted) and re-crop + re-materialize
// just those. Self-healing after a partial sweep run.
const RECONCILE = args.includes('--reconcile');
const LIMIT = parseInt(getArg('limit', '500'));
const CONCURRENCY = parseInt(getArg('concurrency', '10'));
const ONLY_BOOK = getArg('book', null);
// Random-book sampling gives a representative yield measurement (deterministic
// _id-order iteration front-loads early-imported books that aren't typical).
// Use for validation batches; omit for an exhaustive full sweep.
const RANDOM_BOOKS = parseInt(getArg('random-books', '0'));
// Old-vintage OCR (pre-2026 prompts) emits bare, attribute-less <image-desc>
// tags — no significance/type — which the default high-significance filter
// can't see, so books extracted before the #2094 gate widening stay stranded
// (issue #3165; the al-Qazwini case: 159 tagged pages, 0 candidates). This
// opt-in widens the marker test to the production worker's gate: any
// <image-desc> whose type attribute is absent or non-trivial. Expect lower
// yield than the default filter's measured ~63% (Qazwini pilot: 49%).
const ANY_MARKER = args.includes('--any-marker');
// Also accept pages the page-typer already called an illustration, whether or
// not OCR left a marker behind — see pageIsWorkerCandidate() below.
const PAGE_TYPE_CANDIDATES = args.includes('--page-type-candidates');
// Offer EVERY never-examined page to the vision model, no marker or page_type
// required. For books whose OCR vintage predates the <image-desc> convention
// AND whose pages were never typed, every gate above sees zero candidates —
// the production worker then stamps the book images_complete on first touch
// and it exits the queue forever (the Utriusque Cosmi Vol. 2 case, #4241:
// 700pp of plates, page_type null on every page, no markers). Requires --book:
// this is a per-book recovery tool, not a corpus sweep — an unbounded all-pages
// vision pass over the library would be a five-figure spend.
const ALL_PAGES = args.includes('--all-pages');

if (ALL_PAGES && !getArg('book', null)) {
  console.error('FATAL: --all-pages requires --book=ID (per-book recovery only, never a corpus sweep)');
  process.exit(1);
}

const MODEL = 'gemini-3-flash-preview';
const TRIVIAL = new Set(['symbol', 'stamp', 'ornament', 'blank', 'exlibris', 'bookplate', 'decorative', "printer's mark", 'photograph', 'photographic']);
// Mirrors IMAGE_CANDIDATE_PAGE_TYPES in scripts/workers/image-extract-worker.mjs.
const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];

// ── Reuse the production prompt verbatim (extract from the worker source) ──
const workerSrc = readFileSync(new URL('../workers/image-extract-worker.mjs', import.meta.url), 'utf8');
const pm = workerSrc.match(/IMAGE_EXTRACTION_PROMPT = `([\s\S]*?)`;/);
if (!pm) { console.error('FATAL: could not extract IMAGE_EXTRACTION_PROMPT from worker source'); process.exit(1); }
const PROMPT = pm[1].replace(/\\`/g, '`').replace(/\\\$/g, '$');

// ── Gemini keys (mirror worker: exclude free-tier KEY_4) ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => (i + 2 === 4 ? null : process.env[`GEMINI_API_KEY_${i + 2}`])),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
if (!API_KEYS.length) { console.error('FATAL: no Gemini API keys'); process.exit(1); }
let _ki = 0;
const nextClient = () => new GoogleGenerativeAI(API_KEYS[_ki++ % API_KEYS.length]);
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY'].map(category => ({ category, threshold: 'BLOCK_NONE' }));

async function fetchImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return { data: b.toString('base64'), mimeType: (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() };
  } catch { return null; }
}

// Mirror of worker parseImageExtractionResponse (object form) + normalizeBbox.
function parseExtracted(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const o = cleaned.match(/\{[\s\S]*\}/);
  if (o) { try { const p = JSON.parse(o[0]); if (p && !Array.isArray(p)) return Array.isArray(p.extracted_images) ? p.extracted_images : []; } catch {} }
  const a = cleaned.match(/\[[\s\S]*\]/);
  if (a) { try { const p = JSON.parse(a[0]); return Array.isArray(p) ? p : []; } catch {} }
  return [];
}
function normalizeBbox(raw) {
  const x = parseFloat(raw.x) || 0, y = parseFloat(raw.y) || 0, width = parseFloat(raw.width) || 0, height = parseFloat(raw.height) || 0;
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    const scale = Math.max(x + width, y + height, 1000);
    return { x: Math.min(x / scale, 0.95), y: Math.min(y / scale, 0.95), width: Math.min(width / scale, 1), height: Math.min(height / scale, 1) };
  }
  return { x, y, width, height };
}

function pageHasNonTrivialHighSigMarker(ocr) {
  if (!ocr) return false;
  if (ocr.includes('<detected-images>')) return true;
  const tags = [...ocr.matchAll(/<image-desc([^>]*)>/g)];
  return tags.some(m => {
    const type = (m[1].match(/type="([^"]+)"/) || [])[1];
    if (ANY_MARKER) return !type || !TRIVIAL.has(type);
    const sig = (m[1].match(/significance="([^"]+)"/) || [])[1];
    return sig === 'high' && type && !TRIVIAL.has(type);
  });
}

// Every marker test above keys off OCR markup, so a page the page-typer called
// an `illustration` but whose OCR emitted no <image-desc> tag is invisible to
// this script — the vision model is never asked, and the page reads as
// "extracted, nothing there" forever. That is a coverage hole, not a judgment:
// the production worker (image-extract-worker.mjs) keeps a page whose
// `page_type` is in its candidate list regardless of markup, and only consults
// markup to decide about UNtyped pages. `--page-type-candidates` opts into that
// same rule so this script can reach them.
//
// Kept opt-in because the default gate is deliberately narrow: it targets the
// measured ~63%-yield "vision missed it" pattern, and widening it lowers yield.
function pageIsWorkerCandidate(page) {
  if (IMAGE_CANDIDATE_PAGE_TYPES.includes(page.page_type)) return true;
  // Untyped/other pages still have to clear the markup test.
  return pageHasNonTrivialHighSigMarker(page.ocr?.data);
}

async function main() {
  console.log(`[reextract-missed] start ${new Date().toISOString()} | apply=${APPLY} limit=${LIMIT} conc=${CONCURRENCY} anyMarker=${ANY_MARKER} pageTypeCandidates=${PAGE_TYPE_CANDIDATES} allPages=${ALL_PAGES} keys=${API_KEYS.length}`);
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db('bookstore');

  if (RECONCILE) { await reconcile(db); await client.close(); return; }

  // ── Gather candidate pages by iterating already-extracted visible books ──
  // (book_id is indexed; scanning books with detected_images_count>0 is bounded.)
  const bookFilter = ONLY_BOOK
    ? { id: ONLY_BOOK }
    : { visible: true, detected_images_count: { $gt: 0 } };
  const bookProj = { id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1 };
  const bookSource = RANDOM_BOOKS > 0
    ? (await db.collection('books').aggregate([{ $match: bookFilter }, { $sample: { size: RANDOM_BOOKS } }, { $project: bookProj }]).toArray())[Symbol.iterator]()
    : db.collection('books').find(bookFilter, { projection: bookProj }).sort({ _id: 1 });

  const candidates = [];
  let booksScanned = 0;
  const bookMeta = new Map();
  for await (const book of bookSource) {
    booksScanned++;
    const pages = await db.collection('pages').find({
      book_id: book.id,
      page_number: { $gt: 0 },
      'detected_images.0': { $exists: false },
      miss_recheck_at: { $exists: false },
      // Default mode re-tests examined-but-empty pages (the vision-missed
      // pattern its high-significance marker is strong evidence for). The
      // relaxed marker isn't — restrict to never-examined pages. Same reasoning
      // for --page-type-candidates: page_type alone is weaker evidence than a
      // high-significance marker, so don't spend a second vision call on a page
      // some earlier pass already looked at and found empty.
      ...(ANY_MARKER || PAGE_TYPE_CANDIDATES || ALL_PAGES ? { image_extraction_updated_at: { $exists: false } } : {}),
    }, { projection: { id: 1, page_number: 1, page_type: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, display_photo: 1, crop: 1, split_from_spread: 1, 'ocr.data': 1 } }).toArray();
    for (const p of pages) {
      // Require the high-significance non-trivial OCR marker — the precise
      // "genuine miss" signal the pilot measured at ~63% recovery. (page_type
      // alone is a weaker signal and dilutes yield.) --page-type-candidates
      // trades that yield for coverage of typed pages OCR never marked up.
      const accept = ALL_PAGES
        ? true
        : PAGE_TYPE_CANDIDATES
          ? pageIsWorkerCandidate(p)
          : pageHasNonTrivialHighSigMarker(p.ocr?.data);
      if (!accept) continue;
      // Keep only the fields getPageSource() needs — drop ocr.data so a 56K-page
      // full sweep doesn't hold the entire OCR corpus in memory.
      candidates.push({
        id: p.id, page_number: p.page_number,
        photo: p.photo, photo_original: p.photo_original, archived_photo: p.archived_photo,
        cropped_photo: p.cropped_photo, display_photo: p.display_photo,
        crop: p.crop, split_from_spread: p.split_from_spread, _book: book.id,
      });
      bookMeta.set(book.id, book);
      if (candidates.length >= LIMIT) break;
    }
    if (candidates.length >= LIMIT) break;
    if (booksScanned % 500 === 0) console.log(`  …scanned ${booksScanned} books, ${candidates.length} candidates so far`);
  }
  console.log(`[reextract-missed] ${candidates.length} candidate pages from ${bookMeta.size} books (scanned ${booksScanned} books)`);
  if (!candidates.length) { console.log('No candidates — nothing to do.'); await client.close(); return; }

  // ── Re-extract each candidate ──
  let hits = 0, empty = 0, fetchFail = 0, errors = 0, imagesRecovered = 0;
  const affectedBooks = new Set();
  const examples = [];

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (page) => {
      const url = getPageSource(page);
      if (!url || !/^https?:/.test(url)) { fetchFail++; return; }
      const img = await fetchImage(url);
      if (!img) { fetchFail++; return; }
      const book = bookMeta.get(page._book);
      const ctx = [book.title && `Book: "${book.title}"`, book.author && `Author: ${book.author}`, book.year && `Year: ${book.year}`, book.language && `Language: ${book.language}`, book.subjects?.length && `Subjects: ${book.subjects.join(', ')}`].filter(Boolean).join(' | ');
      const prompt = ctx ? `BOOK CONTEXT:\n${ctx}\n\n${PROMPT}` : PROMPT;
      try {
        const model = nextClient().getGenerativeModel({ model: MODEL, safetySettings: SAFETY, generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' } });
        const res = await model.generateContent([{ text: prompt }, { inlineData: { mimeType: img.mimeType, data: img.data } }]);
        const now = new Date();
        const raw = parseExtracted(res.response.text())
          .filter(x => x && x.bbox && typeof x.gallery_quality === 'number') // drop zombie rows
          .map(x => ({
            description: x.description || '', type: x.type || 'unknown',
            bbox: normalizeBbox(x.bbox), confidence: x.confidence,
            gallery_quality: x.gallery_quality, gallery_rationale: x.gallery_rationale || undefined,
            metadata: x.metadata || undefined, museum_description: x.museum_description || undefined,
            detected_at: now, detection_source: 'vision_model', model: MODEL,
          }));
        if (raw.length) {
          hits++; imagesRecovered += raw.length; affectedBooks.add(page._book);
          if (examples.length < 15) examples.push(`p${page.page_number} ${page._book.slice(-6)} q=${raw.map(r => r.gallery_quality).join('/')} ${raw[0].type}: ${(raw[0].description || '').slice(0, 64)}`);
          if (APPLY) await db.collection('pages').updateOne({ id: page.id }, { $set: { detected_images: raw, miss_recheck_at: now, image_extraction_updated_at: now, updated_at: now } });
        } else {
          empty++;
          if (APPLY) await db.collection('pages').updateOne({ id: page.id }, { $set: { miss_recheck_at: now } });
        }
      } catch (e) {
        errors++;
        if (/429|RESOURCE_EXHAUSTED/.test(e.message || '')) _ki++; // rotate
      }
    }));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, candidates.length)}/${candidates.length}  hits=${hits} empty=${empty} fetchFail=${fetchFail} err=${errors}`);
  }
  const answered = hits + empty;
  console.log(`\n[reextract-missed] tested ${candidates.length}: answered=${answered} recovered=${hits} (${answered ? Math.round(100 * hits / answered) : 0}% of answered), images=${imagesRecovered}, empty=${empty}, fetchFail=${fetchFail}, err=${errors}`);
  console.log('examples:'); examples.forEach(e => console.log('  ' + e));

  if (!APPLY) { console.log('\nDRY RUN — no writes, no materialization. Re-run with --apply.'); await client.close(); return; }
  if (!affectedBooks.size) { console.log('No images recovered — nothing to materialize.'); await client.close(); return; }

  // ── Materialize: thumbnails (crops → R2) then canonical gallery_images docs ──
  const books = [...affectedBooks];
  console.log(`\n[reextract-missed] materializing ${books.length} affected books…`);
  let matFail = 0;
  for (const bid of books) {
    try { await thumbnailAndMaterialize(db, bid); }
    catch (e) { matFail++; console.error(`  [materialize-fail] ${bid}: ${e.codeName || ''} ${e.message}`); }
  }
  if (matFail) console.log(`[reextract-missed] ${matFail} books failed materialization (logged above).`);
  console.log('[reextract-missed] done. Sample recovered gallery images:');
  const sample = await db.collection('gallery_images').find({ book_id: { $in: books }, gallery_quality: { $gte: 0.5 }, extracted_url: { $ne: null } }).project({ page_number: 1, gallery_quality: 1, type: 1, extracted_url: 1 }).limit(15).toArray();
  sample.forEach(g => console.log(`  p${g.page_number} q=${g.gallery_quality} ${g.type} ${g.extracted_url}`));
  await client.close();
}

const REPO_ROOT = fileURLToPath(import.meta.url).replace(/\/scripts\/maintenance\/.*/, '');
// Crop (→R2) then canonically materialize one book. Per-book try/catch lives at the call site
// so one bad book never aborts a whole batch's materialization (the batch-3 FATAL root cause).
async function thumbnailAndMaterialize(db, bid) {
  await new Promise((resolve) => {
    const proc = spawn('node', [`${REPO_ROOT}/scripts/workers/generate-thumbnails.mjs`, `--book-id=${bid}`], { stdio: 'ignore', env: process.env });
    proc.on('exit', resolve); proc.on('error', resolve);
  });
  await materializeGalleryForBook(db, bid);
  // Recovered detections change the book-level rollup and the ISR-cached book
  // page; without these two steps every sweep needs a manual follow-up pass.
  const [agg] = await db.collection('pages').aggregate([
    { $match: { book_id: bid, 'detected_images.0': { $exists: true } } },
    { $unwind: '$detected_images' },
    { $count: 'n' },
  ]).toArray();
  await db.collection('books').updateOne({ id: bid }, { $set: { detected_images_count: agg?.n || 0, updated_at: new Date() } });
  if (process.env.CRON_SECRET) {
    await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bid}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'User-Agent': 'Mozilla/5.0 (reextract-missed-pages)' },
    }).catch(() => {}); // best-effort — ISR windows self-heal
  }
}

// ── Reconcile: re-crop + re-materialize books whose recovered pages have no gallery_images doc ──
// Returns true when the book had a gap (i.e. thumbnailAndMaterialize was attempted).
async function bookHasGalleryGap(db, bookId, { anyDetection }) {
  // recovered pages with a gallery-worthy detection (these MUST end up visible)
  const recovered = await db.collection('pages').find(
    {
      book_id: bookId,
      ...(anyDetection ? {} : { miss_recheck_at: { $exists: true } }),
      detected_images: { $elemMatch: { bbox: { $exists: true }, gallery_quality: { $gte: 0.5 } } },
    },
    { projection: { id: 1, detected_images: 1 } }
  ).toArray();
  if (!recovered.length) return false;
  const haveGallery = new Set(await db.collection('gallery_images').distinct('page_id', { book_id: bookId }));
  // A page needs repair if it has no gallery doc, OR a qualifying detection has no
  // extracted_url crop yet (thumbnails never ran → it'd be filtered from the gallery).
  return recovered.some(p =>
    !haveGallery.has(p.id) ||
    (p.detected_images || []).some(d => d?.bbox && (d.gallery_quality ?? 0) >= 0.5 && !d.extracted_url)
  );
}

async function reconcile(db) {
  if (ONLY_BOOK) {
    // Targeted repair. No `detected_images_count` gate (that field is written by
    // materialization itself, so a book whose first materialization failed never has
    // it) and no miss_recheck_at requirement (the failed run may have been the
    // production worker's, which doesn't stamp it).
    console.log(`[reconcile] targeted repair of ${ONLY_BOOK}…`);
    const gap = await bookHasGalleryGap(db, ONLY_BOOK, { anyDetection: true });
    if (!gap) { console.log('[reconcile] done. No gap — gallery already consistent with detections.'); return; }
    await thumbnailAndMaterialize(db, ONLY_BOOK);
    const rows = await db.collection('gallery_images').countDocuments({ book_id: ONLY_BOOK });
    console.log(`[reconcile] done. Gap repaired; gallery_images rows now: ${rows}`);
    return;
  }
  console.log('[reconcile] scanning Case-3 books for recovered pages missing gallery docs…');
  const cursor = db.collection('books').find({ visible: true, detected_images_count: { $gt: 0 } }, { projection: { id: 1 } }).sort({ _id: 1 });
  let scanned = 0, gapBooks = 0, fixed = 0, failed = 0;
  for await (const book of cursor) {
    scanned++;
    if (scanned % 1000 === 0) console.log(`  …scanned ${scanned} books, ${gapBooks} gap, ${fixed} fixed, ${failed} failed`);
    if (!await bookHasGalleryGap(db, book.id, { anyDetection: false })) continue;
    gapBooks++;
    try { await thumbnailAndMaterialize(db, book.id); fixed++; }
    catch (e) { failed++; console.error(`  [reconcile-fail] ${book.id}: ${e.codeName || ''} ${e.message}`); }
  }
  console.log(`[reconcile] done. scanned=${scanned} gapBooks=${gapBooks} fixed=${fixed} failed=${failed}`);
}

// Canonical gallery materialization (mirrors POST /api/admin/sync-gallery-images), scoped to one book.
async function materializeGalleryForBook(db, bookId) {
  const pipeline = [
    { $match: { book_id: bookId, 'detected_images.0': { $exists: true }, $or: [{ cropped_photo: { $exists: true, $ne: '' } }, { photo_original: { $exists: true, $ne: '' } }, { photo: { $exists: true, $ne: '' } }], detected_images: { $elemMatch: { bbox: { $exists: true }, detection_source: { $in: ['vision_model', 'manual', 'ocr_tag'] }, gallery_quality: { $gte: 0.5 } } } } },
    { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    { $match: { 'book.visible': true } },
    { $project: { id: 1, book_id: 1, page_number: 1, cropped_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, enhanced_photo: 1, detected_images: 1, book: 1 } },
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detection_index' } },
    { $match: { 'detected_images.bbox': { $exists: true }, 'detected_images.detection_source': { $in: ['vision_model', 'manual', 'ocr_tag'] }, 'detected_images.gallery_quality': { $gte: 0.5 } } },
    { $setWindowFields: { partitionBy: '$book_id', sortBy: { 'detected_images.gallery_quality': -1 }, output: { book_rank: { $documentNumber: {} } } } },
    { $project: {
      _id: 0,
      id: { $concat: ['$id', '-', { $toString: '$detection_index' }] },
      page_id: '$id', book_id: '$book_id', page_number: '$page_number', detection_index: '$detection_index',
      image_url: { $ifNull: ['$enhanced_photo', { $ifNull: ['$cropped_photo', { $ifNull: ['$archived_photo', { $ifNull: ['$photo_original', '$photo'] }] }] }] },
      thumbnail_url: '$detected_images.thumbnail_url', extracted_url: '$detected_images.extracted_url',
      description: { $ifNull: ['$detected_images.description', ''] }, type: '$detected_images.type', bbox: '$detected_images.bbox',
      rotation: '$detected_images.rotation', gallery_quality: '$detected_images.gallery_quality', confidence: '$detected_images.confidence',
      museum_description: '$detected_images.museum_description', detection_source: '$detected_images.detection_source',
      // Rebuild metadata from known subfields ONLY. A stray `metadata.language`
      // (e.g. "Greek" on Byzantine-manuscript detections) is read by the
      // gallery_images text index (language_override at the metadata subtree)
      // and aborts the $merge with "language override unsupported". Dropping it
      // is the root fix — the same latent bug lives in the prod sync routes (#2531).
      metadata: {
        subjects: '$detected_images.metadata.subjects',
        figures: '$detected_images.metadata.figures',
        symbols: '$detected_images.metadata.symbols',
        style: '$detected_images.metadata.style',
        technique: '$detected_images.metadata.technique',
      },
      dhash: '$detected_images.dhash',
      book_title: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] }, book_author: '$book.author',
      book_year: '$book.year', book_language: '$book.language', book_visible: { $ifNull: ['$book.visible', false] },
      book_hidden: '$book.hidden', book_provider: '$book.image_source.provider', book_rank: '$book_rank', updated_at: new Date(),
    } },
    { $merge: { into: 'gallery_images', on: 'id', whenMatched: 'replace', whenNotMatched: 'insert' } },
  ];
  await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();
}

main().catch(err => { console.error('[reextract-missed] FATAL', err); process.exit(1); });
