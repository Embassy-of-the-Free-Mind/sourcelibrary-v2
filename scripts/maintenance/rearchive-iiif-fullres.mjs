#!/usr/bin/env node
/**
 * Re-archive existing IIIF-sourced book pages at full native resolution.
 *
 * Different from `scripts/maintenance/archive-unarchived-books.ts` (which
 * only archives pages with NO `archived_photo`), this script targets
 * pages whose `archived_photo` IS set but where the source was imported
 * at a downsized IIIF resolution (e.g. `/full/1000,/`). It refetches at
 * `/full/full/` and overwrites the existing R2 archive.
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
 * Other:
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

import { upgradeToFullRes, rateLimitedFetch, fetchIiifInfo, isIiifUrl, getIiifSizeCap } from '../lib/iiif-utils.mjs';

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
 * Process one source URL: upgrade, fetch, resize-cap, return buffer + dims.
 * Skips if the URL doesn't appear to be IIIF or upgrade is a no-op.
 */
async function fetchUpgraded(url) {
  if (!isIiifUrl(url)) return { skipped: 'not-iiif', url };
  const upgraded = upgradeToFullRes(url);
  if (upgraded === url) return { skipped: 'no-upgrade-pattern', url };
  let raw;
  try {
    raw = await rateLimitedFetch(upgraded, { timeout: 60_000 });
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
      { projection: { photo: 1, photo_original: 1, archived_photo: 1 } },
      { sort: { page_number: 1 } },
    );
    if (!samplePage) { results.noPages++; continue; }

    const sourceUrl = samplePage.photo_original || samplePage.photo;
    if (!isIiifUrl(sourceUrl)) { results.nonIiif++; continue; }

    const info = await fetchIiifInfo(sourceUrl);
    if (!info) { results.fetchFail++; continue; }

    const cap = getIiifSizeCap(sourceUrl);
    const masterWidth = info.width;
    const ratio = cap ? masterWidth / cap : null;

    const isLowRes = ratio !== null && ratio >= MIN_UPGRADE_RATIO;
    if (isLowRes) {
      results.lowRes++;
      lowResBooks.push({
        id: b.id,
        slug: b.slug,
        title: b.title,
        provider: b.image_source?.provider,
        currentCap: cap,
        masterWidth,
        masterHeight: info.height,
        upgradeRatio: ratio.toFixed(1) + 'x',
      });
      console.log(`  LOW-RES  ${cap}px → ${masterWidth}px (${ratio.toFixed(1)}x)  ${(b.title || '').substring(0, 50)} [${b.image_source?.provider}]`);
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

// ── Refetch mode (un-split books) ──

async function refetchOne(book) {
  const pages = await db.collection('pages').find(
    { book_id: book.id },
    { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, split_side: 1 } },
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
  if (!cap || info.width / cap < MIN_UPGRADE_RATIO) {
    return { skipped: `not-low-res (cap=${cap || 'full'}, master=${info.width})` };
  }

  console.log(`  ${(book.title || '').substring(0, 55)} — upgrading ${cap}→${info.width}px (${pages.length} pages)`);

  let updated = 0, skipped = 0, failed = 0;
  await parallelMap(pages, async (page) => {
    const url = page.photo_original || page.photo;
    if (!isIiifUrl(url)) { skipped++; return; }
    const result = await fetchUpgraded(url);
    if (result.skipped) { skipped++; return; }

    const key = `archived/${book.id}/${page.page_number}.jpg`;
    if (DRY_RUN) {
      updated++;
      return;
    }
    try {
      const newUrl = await r2Put(key, result.processed);
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

  if (!DRY_RUN && updated > 0) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        'image_resolution_upgraded_at': new Date(),
        'image_resolution_upgrade_source': info.width,
        updated_at: new Date(),
      } },
    );
  }

  return { updated, skipped, failed };
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
          tenant_id: 'default',
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
