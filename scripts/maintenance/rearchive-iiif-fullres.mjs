#!/usr/bin/env node
/**
 * Re-archive existing IIIF-sourced book pages at full native resolution.
 *
 * Different from `scripts/maintenance/archive-unarchived-books.ts` (which
 * only archives pages with NO `archived_photo`), this script targets
 * pages whose `archived_photo` IS set but where the source was imported
 * at a downsized IIIF resolution (e.g. `/full/1000,/`). It refetches at
 * `/full/full/` and overwrites the existing R2 archive. When the server
 * caps single-request output below the master size (e.g. Cambridge:
 * maxWidth 2000 vs a 9718px master), it tile-stitches region requests to
 * recover native resolution (via fetchIiifNativeRes). It also regenerates
 * the pre-sized display/thumb R2 variants the reader serves directly —
 * without that, the reader keeps showing the old low-res derivative.
 *
 * Three modes:
 *
 *   --audit
 *     Sample one page per book, fetch info.json, report books where
 *     the source IIIF master is significantly larger than the current
 *     archive. No writes.
 *
 *   --refetch (default)
 *     For unsplit books, refetch every page at full-res, overwrite the
 *     same R2 path, update page records with new image_metadata
 *     (width, height, source). Sets book.image_resolution_upgraded_at.
 *
 *   --recover-split
 *     For books where the splitter has already run on low-res inputs
 *     (e.g. Hieroglyphica): refetch each unique parent spread URL
 *     (`page.photo_original`) at full-res, then UNDO the split:
 *     deletes right-half page records, restores left-halves to the
 *     original spread state with the new full-res URL, sets
 *     `pipeline_auto.status='archive_complete'`, `needs_splitting=true`,
 *     `needs_resplit=true`. The next splitter run produces correct
 *     ~2000px halves and the OCR/translate cascade re-runs cleanly.
 *
 * Selection filters (any combination):
 *   --book-id <id>
 *   --provider <name>          e.g. allard_pierson
 *   --crisis-only              books with spread_translation_crisis: true
 *
 * Consistency guard (#3186, ON by default):
 *   Before overwriting any archive, perceptual-hash a sample of pages to confirm
 *   fetched(photo_original) IS the same image as the current archived_photo.
 *   - aligned  → upgrade proceeds
 *   - shift+1  → photo_original is a one-page-offset sequence (the e-rara PDF-cover
 *                defect): book is SKIPPED, flagged books.rearchive_blocked + a
 *                book_events{type:'rearchive_blocked'} record. NOT overwritten.
 *   - ambiguous→ skipped + flagged for manual review.
 *   --no-guard                 disable the guard (ONLY for a provider already
 *                              audited aligned; never blanket — this is the incident switch)
 *   Note: --recover-split does NOT run the guard; don't point it at unaudited providers.
 *
 * Other:
 *   --skip-upgraded            skip books already stamped image_resolution_upgraded_at
 *                              (resume flag for long interruptible runs; the stamp is
 *                              only written when a book completes with zero failures)
 *   --concurrency N            books processed in parallel (default 2)
 *   --page-concurrency N       pages per book (default 4)
 *   --limit N                  max books
 *   --dry-run                  no writes
 *   --min-upgrade-ratio R      only refetch if maxres/current >= R (default 1.5)
 *
 * Examples:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/rearchive-iiif-fullres.mjs --audit --crisis-only
 *   node scripts/maintenance/rearchive-iiif-fullres.mjs --book-id 69b4cd55d5b6c3815e1a59eb --recover-split --dry-run
 *   node scripts/maintenance/rearchive-iiif-fullres.mjs --provider allard_pierson --crisis-only --refetch
 *
 * Companion to:
 *   - scripts/lib/iiif-utils.mjs  (URL upgrade + rate limiting)
 *   - scripts/workers/batch-split-bph.mjs  (the splitter that re-runs after recovery)
 *   - .claude/docs/spread-translation-crisis-2026-05-06.md  (background)
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { upgradeToFullRes, rateLimitedFetch, fetchIiifInfo, isIiifUrl, getIiifSizeCap, fetchIiifNativeRes, shouldTileStitch } from '../lib/iiif-utils.mjs';
import { checkAlignment as checkAlignmentShared, hashBuffer } from '../lib/page-alignment.mjs';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.production.local') });

// ── Args ──

const ARG = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const FLAG = (name) => process.argv.includes(name);

const MODE = FLAG('--audit') ? 'audit' : FLAG('--recover-split') ? 'recover-split' : 'refetch';
const DRY_RUN = FLAG('--dry-run');
const BOOK_ID = ARG('--book-id');
const PROVIDER = ARG('--provider');
const CRISIS_ONLY = FLAG('--crisis-only');
const CONCURRENCY = parseInt(ARG('--concurrency', '2'));
const PAGE_CONCURRENCY = parseInt(ARG('--page-concurrency', '4'));
const LIMIT = parseInt(ARG('--limit', '0'));
const MIN_UPGRADE_RATIO = parseFloat(ARG('--min-upgrade-ratio', '1.5'));
const SHARP_MAX_WIDTH = parseInt(ARG('--max-width', '6000'));
const JPEG_QUALITY = parseInt(ARG('--jpeg-quality', '90'));
const SKIP_UPGRADED = FLAG('--skip-upgraded');
// The consistency guard is ON by default and cannot be silently skipped — it is
// the fix for the e-rara off-by-one incident (#3186). --no-guard exists only for
// explicit, audited one-offs on a provider already proven aligned.
const NO_GUARD = FLAG('--no-guard');

// ── Setup ──

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function r2Put(key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── Helpers ──

function buildBookQuery() {
  if (BOOK_ID) return { id: BOOK_ID };
  const q = {};
  if (PROVIDER) q['image_source.provider'] = PROVIDER;
  if (CRISIS_ONLY) q.spread_translation_crisis = true;
  // Resume support for long interruptible runs: refetchOne stamps
  // image_resolution_upgraded_at on success, so this makes re-runs converge
  // on the remaining books instead of redoing finished ones.
  if (SKIP_UPGRADED) q.image_resolution_upgraded_at = { $exists: false };
  return q;
}

function isAlreadySplit(pages) {
  return pages.some(p => p.split_side === 'left' || p.split_side === 'right');
}

async function jpegDims(buf) {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * How wide is the master we ACTUALLY HOLD for this page?
 *
 * Eligibility used to be `info.width / getIiifSizeCap(sourceUrl)` — the master
 * measured against the size the URL *asks* for. On a SILENT_CAP host that number
 * is a lie: EAP serves 1200px however much you request, so a `/full/full/` URL
 * (no numeric cap at all) reads as "already native" while the archive on disk is
 * 1200px. That blind spot stranded 763 British Library Tibetan books whose EAP
 * masters are 3888-4752px — the rearchiver reported them `not-low-res (cap=full,
 * master=3888)` and skipped every one (#4523).
 *
 * Ask the archive instead, cheapest source first: the width we recorded, else
 * measure the archived bytes, else fall back to the URL cap for non-archived pages.
 */
async function heldMasterWidth(page, cap) {
  if (page.image_metadata?.width) return page.image_metadata.width;
  if (page.archived_photo) {
    try {
      const dims = await jpegDims(await rateLimitedFetch(page.archived_photo, { timeout: 30_000 }));
      if (dims?.width) return dims.width;
    } catch { /* fall through to the URL cap */ }
  }
  return cap || null;
}

// ── Consistency guard (issue #3186) ──
//
// The e-rara off-by-one incident: for PDF-sourced imports, `archived_photo` was
// rasterized from the e-rara PDF (which prepends a cover sheet) while
// `photo_original` was recorded as the IIIF image URL (no cover) — a parallel,
// one-page-offset sequence. Refetching from `photo_original` and overwriting
// `archived_photo` silently slid every image one page against its OCR/translation.
//
// The load-bearing false assumption was: "photo_original is the same image as
// archived_photo, just higher-res." This guard verifies that per-book with a
// perceptual hash (dHash) BEFORE any overwrite.
//
// The verdict logic lives in scripts/lib/page-alignment.mjs so the read-only
// audit of the bulk-JP2 defect (#3368) uses the identical test.

async function hashUrl(url) {
  return hashBuffer(await rateLimitedFetch(url, { timeout: 30_000 }));
}

/**
 * Compare fetched photo_original against the current (pre-overwrite) archived
 * image for a sample of interior pages. Returns { verdict, offset, detail }.
 * verdict ∈ 'aligned' | 'shift+1' | 'ambiguous' | 'unknown'.
 */
function checkAlignment(pages) {
  return checkAlignmentShared(pages, {
    hashUrl,
    sourceUrlFor: p => upgradeToFullRes(p.photo_original || p.photo),
    isUsableSource: p => isIiifUrl(p.photo_original || p.photo),
  });
}

/**
 * Process one source URL: upgrade, fetch, resize-cap, return buffer + dims.
 * Skips if the URL doesn't appear to be IIIF or upgrade is a no-op.
 */
async function fetchUpgraded(url) {
  if (!isIiifUrl(url)) return { skipped: 'not-iiif', url };
  const upgraded = upgradeToFullRes(url);
  let raw;
  try {
    // Servers like Cambridge (maxWidth/maxHeight 2000) silently downscale
    // /full/full/ below the master size — the only path to native pixels is
    // region tiles. Per-page info.json: dimensions vary page to page.
    const pageInfo = await fetchIiifInfo(url);
    if (pageInfo && shouldTileStitch(pageInfo, url)) {
      // Do NOT size the stride from the host's ADVERTISED cap. `shouldTileStitch`
      // only returned true because this host lies about that number; taking the
      // lie as the tile size is what produced 64%-white masters in July 2026
      // (#4523). 1024 is the empirically safe stride; fetchIiifNativeRes probes
      // and shrinks further if even that is capped.
      const maxChunk = Math.min(pageInfo.maxWidth || 1024, pageInfo.maxHeight || 1024, 1024);
      ({ buffer: raw } = await fetchIiifNativeRes(url, { info: pageInfo, maxChunk, timeout: 60_000 }));
    } else if (upgraded === url) {
      // Nothing to gain: the URL already requests native AND this host honours
      // it. (Checked AFTER the tile-stitch branch, not before — on a silent-cap
      // host a `/full/full/` URL is already "upgraded" textually while the bytes
      // come back at 1200px, and bailing here skipped every page of the EAP310
      // cohort whose masters are 3888-4752px. #4523.)
      return { skipped: 'no-upgrade-pattern', url };
    } else {
      raw = await rateLimitedFetch(upgraded, { timeout: 60_000 });
    }
  } catch (e) {
    return { skipped: 'fetch-fail', url: upgraded, error: e.message };
  }
  // Cap at SHARP_MAX_WIDTH
  let processed;
  try {
    processed = await sharp(raw)
      .resize(SHARP_MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, progressive: true })
      .toBuffer();
  } catch (e) {
    return { skipped: 'sharp-fail', url: upgraded, error: e.message };
  }
  const dims = await jpegDims(processed);
  return { upgraded, raw, processed, dims };
}

// ── Audit mode ──

async function audit() {
  const books = await db.collection('books').find(buildBookQuery(), {
    projection: { id: 1, slug: 1, title: 1, 'image_source.provider': 1 },
  }).limit(LIMIT || 0).toArray();

  console.log(`Auditing ${books.length} books for low-res IIIF source...\n`);

  const results = { highRes: 0, lowRes: 0, nonIiif: 0, noPages: 0, fetchFail: 0 };
  const lowResBooks = [];

  for (const b of books) {
    const samplePage = await db.collection('pages').findOne(
      { book_id: b.id, page_number: { $gte: 3 } },
      { projection: { photo: 1, photo_original: 1, archived_photo: 1, image_metadata: 1 } },
      { sort: { page_number: 1 } },
    );
    if (!samplePage) { results.noPages++; continue; }

    const sourceUrl = samplePage.photo_original || samplePage.photo;
    if (!isIiifUrl(sourceUrl)) { results.nonIiif++; continue; }

    const info = await fetchIiifInfo(sourceUrl);
    if (!info) { results.fetchFail++; continue; }

    const cap = getIiifSizeCap(sourceUrl);
    const masterWidth = info.width;
    // Against what we HOLD, not what the URL requests — see heldMasterWidth().
    const held = await heldMasterWidth(samplePage, cap);
    const ratio = held ? masterWidth / held : null;

    const isLowRes = ratio !== null && ratio >= MIN_UPGRADE_RATIO;
    if (isLowRes) {
      results.lowRes++;
      lowResBooks.push({
        id: b.id,
        slug: b.slug,
        title: b.title,
        provider: b.image_source?.provider,
        currentCap: cap,
        heldWidth: held,
        masterWidth,
        masterHeight: info.height,
        upgradeRatio: ratio.toFixed(1) + 'x',
      });
      console.log(`  LOW-RES  held ${held}px → ${masterWidth}px (${ratio.toFixed(1)}x)  ${(b.title || '').substring(0, 50)} [${b.image_source?.provider}]`);
    } else {
      results.highRes++;
    }
  }

  console.log(`\nAudit summary:`);
  console.log(`  Hi-res or already at master: ${results.highRes}`);
  console.log(`  Low-res (refetch candidates): ${results.lowRes}`);
  console.log(`  Non-IIIF source: ${results.nonIiif}`);
  console.log(`  No pages: ${results.noPages}`);
  console.log(`  Fetch failed: ${results.fetchFail}`);

  if (lowResBooks.length) {
    console.log(`\nSample of low-res candidates (top 10 by upgrade ratio):`);
    lowResBooks.sort((a, b) => parseFloat(b.upgradeRatio) - parseFloat(a.upgradeRatio));
    for (const x of lowResBooks.slice(0, 10)) {
      console.log(`  ${x.upgradeRatio.padEnd(6)}  ${x.currentCap}→${x.masterWidth}px  ${(x.title || '').substring(0, 55)}  id=${x.id}`);
    }
  }
}

/**
 * Regenerate the pre-sized R2 display/thumb variants (the files the reader
 * serves directly) from an upgraded master buffer, overwriting the SAME R2
 * keys so no DB pointer changes. No-op for pages without R2-hosted variants.
 */
async function regenerateVariants(page, masterBuffer) {
  const toKey = (url) =>
    typeof url === 'string' && url.startsWith(`${R2_PUBLIC_URL}/`)
      ? url.slice(R2_PUBLIC_URL.length + 1)
      : null;
  const displayKey = toKey(page.display_photo);
  const thumbKey = toKey(page.image_thumb) || toKey(page.thumbnail_blob);
  if (!displayKey && !thumbKey) return;
  const { display, thumb } = await generateDisplayVariants(masterBuffer, {
    bookId: page.book_id, pageNumber: page.page_number,
  });
  if (displayKey) await r2Put(displayKey, display);
  if (thumbKey) await r2Put(thumbKey, thumb);
}

// ── Refetch mode (un-split books) ──

async function refetchOne(book) {
  const pages = await db.collection('pages').find(
    { book_id: book.id },
    // book_id is load-bearing, not decorative: regenerateVariants passes it to
    // generateDisplayVariants as the watermark key. Omitted from the projection,
    // it arrives undefined and every regenerated display/thumb is written
    // WITHOUT the keyed watermark — unattributable in the wild (#2651). The
    // function logs that as a warning, so the only symptom was a line in a log.
    { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, split_side: 1, display_photo: 1, image_thumb: 1, thumbnail_blob: 1, image_metadata: 1 } },
  ).sort({ page_number: 1 }).toArray();

  if (!pages.length) return { skipped: 'no-pages' };
  if (isAlreadySplit(pages)) return { skipped: 'already-split (use --recover-split)' };

  // Decide once based on first IIIF page
  const sample = pages.find(p => isIiifUrl(p.photo_original || p.photo));
  if (!sample) return { skipped: 'no-iiif-source' };
  const sourceUrl = sample.photo_original || sample.photo;
  const info = await fetchIiifInfo(sourceUrl);
  if (!info) return { skipped: 'info-json-fail' };
  const cap = getIiifSizeCap(sourceUrl);
  const held = await heldMasterWidth(sample, cap);
  if (!held || info.width / held < MIN_UPGRADE_RATIO) {
    return { skipped: `not-low-res (held=${held || 'unknown'}, master=${info.width})` };
  }

  // ── Consistency guard: never overwrite an archive whose photo_original is a
  // different image than what we hold (the e-rara off-by-one class, #3186). ──
  if (!NO_GUARD) {
    const align = await checkAlignment(pages);
    if (align.verdict !== 'aligned') {
      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: {
            rearchive_blocked: { verdict: align.verdict, offset: align.offset ?? null, detail: align.detail, at: new Date() },
            updated_at: new Date(),
          } },
        );
        await db.collection('book_events').insertOne({
          book_id: book.id, type: 'rearchive_blocked', at: new Date(), source: 'rearchive-iiif-fullres',
          details: { verdict: align.verdict, offset: align.offset ?? null, detail: align.detail, reason: 'photo_original != archived content (#3186 guard)' },
        });
      }
      return { skipped: `guard:${align.verdict} (${align.detail})` };
    }
  }

  console.log(`  ${(book.title || '').substring(0, 55)} — upgrading ${held}→${info.width}px (${pages.length} pages)`);

  let updated = 0, skipped = 0, failed = 0;
  await parallelMap(pages, async (page) => {
    const url = page.photo_original || page.photo;
    if (!isIiifUrl(url)) { skipped++; return; }
    const result = await fetchUpgraded(url);
    if (result.skipped) { skipped++; return; }

    const key = `archived/${book.id}/${page.page_number}.jpg`;
    assertBookScopedKey(key, book.id, 'rearchive-iiif-fullres');
    if (DRY_RUN) {
      updated++;
      return;
    }
    try {
      const newUrl = await r2Put(key, result.processed);
      // Pre-sized R2 variants (display_photo / image_thumb) are what the reader
      // actually serves — regenerate them from the upgraded master onto the SAME
      // keys, else the reader keeps showing the old low-res derivative.
      await regenerateVariants(page, result.processed);
      await db.collection('pages').updateOne(
        { _id: page._id || new ObjectId(page.id) },
        { $set: {
          archived_photo: newUrl,
          photo: newUrl,
          'image_metadata.width': result.dims?.width,
          'image_metadata.height': result.dims?.height,
          'image_metadata.source_max_width': info.width,
          'image_metadata.upgraded_at': new Date(),
          updated_at: new Date(),
        } },
      );
      updated++;
    } catch (e) {
      console.error(`    page ${page.page_number} fail: ${e.message?.substring(0, 80)}`);
      failed++;
    }
  }, PAGE_CONCURRENCY);

  // Stamp only fully-clean books: a partial failure (e.g. laptop sleep killed
  // in-flight fetches) must not look "done" to --skip-upgraded re-runs.
  if (!DRY_RUN && updated > 0 && failed === 0) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        'image_resolution_upgraded_at': new Date(),
        'image_resolution_upgrade_source': info.width,
        updated_at: new Date(),
      } },
    );
    // `held`, not `cap`: this value is also written as `ocr_input_width`, the
    // width the existing OCR actually read. The URL cap is null on silent-cap
    // hosts, which would record null provenance and an Infinity upgrade_ratio.
    await recordUpgradeEvent(book, { fromWidthCap: held, toMasterWidth: info.width, pagesUpdated: updated });
  }

  return { updated, skipped, failed };
}

/**
 * Provenance for the upgrade (issue #3186): one book_events record per upgraded
 * book, plus a reocr_candidate flag when existing OCR was produced from the old
 * low-res images. OCR always predates the upgrade here, so the OCR input width
 * IS the old import cap — record it now, while that fact is still cheap to know.
 */
async function recordUpgradeEvent(book, { fromWidthCap, toMasterWidth, pagesUpdated }) {
  const now = new Date();
  const full = await db.collection('books').findOne(
    { id: book.id },
    { projection: { pages_ocr: 1, pages_translated: 1, 'image_source.provider': 1 } },
  );
  const ocrPage = await db.collection('pages').findOne(
    { book_id: book.id, 'ocr.updated_at': { $exists: true } },
    { projection: { 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1 } },
  );
  const hasOcr = (full?.pages_ocr ?? 0) > 0;
  await db.collection('book_events').insertOne({
    book_id: book.id,
    type: 'image_resolution_upgrade',
    at: now,
    source: 'rearchive-iiif-fullres',
    details: {
      from_width_cap: fromWidthCap,
      to_master_width: toMasterWidth,
      pages_updated: pagesUpdated,
      provider: full?.image_source?.provider ?? null,
      // OCR provenance at upgrade time: existing OCR read the OLD images.
      ocr_pages: full?.pages_ocr ?? 0,
      ocr_input_width: hasOcr ? fromWidthCap : null,
      ocr_model: ocrPage?.ocr?.model ?? null,
      ocr_prompt_version: ocrPage?.ocr?.prompt_version ?? null,
      ocr_updated_at: ocrPage?.ocr?.updated_at ?? null,
    },
  });
  if (hasOcr) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        reocr_candidate: {
          reason: 'resolution_upgrade',
          flagged_at: now,
          ocr_input_width: fromWidthCap,
          new_width: toMasterWidth,
          upgrade_ratio: Math.round((toMasterWidth / fromWidthCap) * 10) / 10,
        },
      } },
    );
  }
}

// ── Recovery mode (already-split books) ──

async function recoverOne(book) {
  const pages = await db.collection('pages').find(
    { book_id: book.id },
    { projection: { id: 1, _id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, split_side: 1, split_from: 1 } },
  ).sort({ page_number: 1 }).toArray();

  if (!pages.length) return { skipped: 'no-pages' };
  if (!isAlreadySplit(pages)) return { skipped: 'not-split (use --refetch)' };

  // Group by photo_original to identify parent spreads. Each parent
  // produced one or two children (single, or left+right halves).
  const groups = new Map();  // photo_original -> [pages]
  for (const p of pages) {
    const k = p.photo_original || p.photo;
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  // Sample one IIIF source to confirm low-res
  const sampleUrl = [...groups.keys()].find(u => isIiifUrl(u));
  if (!sampleUrl) return { skipped: 'no-iiif-source' };
  const info = await fetchIiifInfo(sampleUrl);
  if (!info) return { skipped: 'info-json-fail' };
  const cap = getIiifSizeCap(sampleUrl);
  if (!cap || info.width / cap < MIN_UPGRADE_RATIO) {
    return { skipped: `not-low-res (cap=${cap || 'full'}, master=${info.width})` };
  }

  console.log(`  ${(book.title || '').substring(0, 55)} — recovering ${groups.size} parent spreads at ${info.width}px (${pages.length} child pages)`);

  // Build the new (pre-split) page set: one record per unique parent.
  // Number them in original sequence (extracted from the page_number on
  // any child — left halves keep the original number; right halves get
  // a +0.5 offset). We pick the LOWEST page_number in each group.
  const newPages = [];  // { originalPageNumber, sourceUrl, children, isSplit }
  for (const [src, children] of groups) {
    children.sort((a, b) => a.page_number - b.page_number);
    const firstChild = children[0];
    // For renumbered books, the original page_number can be reconstructed
    // from the split_from chain. Simpler heuristic: lowest child.page_number
    // is monotone with the original parent's position.
    newPages.push({
      sourceUrl: src,
      children,
      seq: firstChild.page_number,
      isSplit: children.length > 1,
    });
  }
  // Order by seq to assign new page numbers 1..N
  newPages.sort((a, b) => a.seq - b.seq);

  let refetched = 0, fetchFailed = 0;
  const refetchedUrls = new Map();  // sourceUrl -> { key, dims }

  // Step A: refetch every unique parent at full-res, upload to canonical R2 path.
  await parallelMap(newPages, async (entry, idx) => {
    const newPageNum = idx + 1;
    const result = await fetchUpgraded(entry.sourceUrl);
    if (result.skipped) {
      fetchFailed++;
      console.error(`    ${entry.sourceUrl.substring(0, 80)}: ${result.skipped} ${result.error || ''}`);
      return;
    }
    const key = `archived/${book.id}/${newPageNum}.jpg`;
    assertBookScopedKey(key, book.id, 'rearchive-iiif-fullres:split');
    if (DRY_RUN) {
      refetchedUrls.set(entry.sourceUrl, { key, dims: result.dims, newPageNum });
      refetched++;
      return;
    }
    try {
      const newUrl = await r2Put(key, result.processed);
      refetchedUrls.set(entry.sourceUrl, { key, dims: result.dims, newPageNum, url: newUrl });
      refetched++;
    } catch (e) {
      fetchFailed++;
      console.error(`    upload p${newPageNum} fail: ${e.message?.substring(0, 80)}`);
    }
  }, PAGE_CONCURRENCY);

  if (DRY_RUN) {
    return { refetched, fetchFailed, would_replace_pages: pages.length, with_pages: newPages.length };
  }

  // Step B: undo the split. Delete all child pages, recreate one record per parent.
  const session = mongo.startSession();
  try {
    await session.withTransaction(async () => {
      // Delete every child page (we'll create fresh records below)
      await db.collection('pages').deleteMany({ book_id: book.id }, { session });

      // Create new pre-split page records
      const docs = newPages.map((entry, idx) => {
        const newPageNum = idx + 1;
        const r = refetchedUrls.get(entry.sourceUrl);
        if (!r) return null;
        const newId = new ObjectId();
        return {
          _id: newId,
          id: newId.toHexString(),
          book_id: book.id,
          page_number: newPageNum,
          photo: r.url,
          photo_original: entry.sourceUrl,
          archived_photo: r.url,
          image_metadata: {
            width: r.dims?.width,
            height: r.dims?.height,
            source_max_width: info.width,
            upgraded_at: new Date(),
            recovered_from_low_res_split: true,
          },
          created_at: new Date(),
          updated_at: new Date(),
        };
      }).filter(Boolean);

      if (docs.length) {
        await db.collection('pages').insertMany(docs, { session });
      }

      // Reset book to pre-split state, ready for splitter
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          pages_count: docs.length,
          pages_ocr: 0,
          pages_translated: 0,
          needs_splitting: true,
          needs_resplit: true,
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.split_checked': false,
          'pipeline_auto.last_updated': new Date(),
          'image_resolution_upgraded_at': new Date(),
          'image_resolution_upgrade_source': info.width,
          updated_at: new Date(),
        }, $unset: {
          spread_translation_crisis: '',
          translation_stale_reason: '',
        } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return { refetched, fetchFailed, replaced_child_pages: pages.length, new_parent_pages: newPages.length };
}

// ── Concurrency helper ──

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

// ── Main ──

async function main() {
  console.log(`Mode: ${MODE.toUpperCase()}${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Filters: ${BOOK_ID ? `book-id=${BOOK_ID}` : ''}${PROVIDER ? ` provider=${PROVIDER}` : ''}${CRISIS_ONLY ? ' crisis-only' : ''}`);
  console.log(`Concurrency: ${CONCURRENCY} books × ${PAGE_CONCURRENCY} pages | min-upgrade-ratio=${MIN_UPGRADE_RATIO} | max-width=${SHARP_MAX_WIDTH}px | jpeg-q=${JPEG_QUALITY}\n`);

  if (MODE === 'audit') {
    await audit();
    return;
  }

  const books = await db.collection('books').find(buildBookQuery(), {
    projection: { id: 1, slug: 1, title: 1, 'image_source.provider': 1 },
  }).limit(LIMIT || 0).toArray();
  console.log(`Found ${books.length} books to process\n`);

  let processed = 0, skipped = 0, failed = 0;
  const startTime = Date.now();
  const queue = [...books];

  await parallelMap(queue, async (book) => {
    try {
      const result = (MODE === 'recover-split') ? await recoverOne(book) : await refetchOne(book);
      if (result.skipped) {
        skipped++;
        console.log(`  skip: ${(book.title || '').substring(0, 55)} — ${result.skipped}`);
      } else {
        processed++;
      }
    } catch (e) {
      failed++;
      console.error(`  FAIL ${(book.title || '').substring(0, 50)}: ${e.message?.substring(0, 100)}`);
    }
  }, CONCURRENCY);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDone in ${elapsed} min. Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}`);
}

try {
  await main();
} finally {
  await mongo.close();
}
