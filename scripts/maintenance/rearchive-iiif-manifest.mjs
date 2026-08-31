#!/usr/bin/env node
/**
 * Re-archive IIIF books from their Presentation API manifest.
 *
 * Companion to `rearchive-iiif-fullres.mjs`, which assumes each page's
 * stored `photo_original` is a valid IIIF Image API URL that exposes
 * `info.json`. Some hosts (notably Vatican / digi.vatlib.it) store
 * images under a path that is NOT info.json-addressable when accessed
 * via the simplified identifier we cached at import time — and may
 * later 404 entirely when the host renames identifiers. For those
 * books we have to walk the manifest to discover the current canonical
 * Image API service URL for each canvas.
 *
 * Selection (one required):
 *   --book-id <id>             single book
 *   --provider <name>          all books with image_source.provider=<name>
 *
 * Other:
 *   --manifest-url <url>       override book.image_source.iiif_manifest
 *   --concurrency N            books in parallel (default 2)
 *   --page-concurrency N       pages per book (default 4)
 *   --limit N                  max books
 *   --dry-run                  no writes; print mapping summary
 *   --min-upgrade-ratio R      skip if master/current < R (default 1.5)
 *   --max-width N              sharp cap (default 6000)
 *   --jpeg-quality N           default 90
 *
 * Examples:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/rearchive-iiif-manifest.mjs --book-id 6953ab1077f38f6761bd67aa --dry-run
 *   node scripts/maintenance/rearchive-iiif-manifest.mjs --provider vatican
 *
 * Page-to-canvas matching:
 *   The stored URL filename (e.g. `Ott.lat.2074_0001.jp2`) is reduced
 *   to a short identifier (`Ott.lat.2074_0001`). Each manifest canvas
 *   exposes a service @id whose filename has the same `_NNNN` ordinal
 *   prefix, possibly extended with a descriptive folio label suffix
 *   (`Ott.lat.2074_0001_al_piatto.anteriore.jp2`). We index canvases
 *   by their reduced identifier and look up each page directly.
 *
 * Background: `.claude/docs/spread-translation-crisis-2026-05-06.md`
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { rateLimitedFetch } from '../lib/iiif-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.production.local') });

// ── Args ──

const ARG = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const FLAG = (name) => process.argv.includes(name);

const BOOK_ID = ARG('--book-id');
const PROVIDER = ARG('--provider');
const MANIFEST_URL = ARG('--manifest-url');
const DRY_RUN = FLAG('--dry-run');
const CONCURRENCY = parseInt(ARG('--concurrency', '2'));
const PAGE_CONCURRENCY = parseInt(ARG('--page-concurrency', '4'));
const LIMIT = parseInt(ARG('--limit', '0'));
const MIN_UPGRADE_RATIO = parseFloat(ARG('--min-upgrade-ratio', '1.5'));
// Safety valve, not a quality ceiling (#4406). This is a RE-ARCHIVE path whose
// entire purpose is recovering resolution, so a default that quietly caps the
// result works against the job. Raised 6000 -> 30000: high enough that no real
// scan is touched, low enough to stop sharp exhausting memory on a pathological
// one. Pass --max-width to lower it deliberately for a constrained run.
const SHARP_MAX_WIDTH = parseInt(ARG('--max-width', '30000'));
const JPEG_QUALITY = parseInt(ARG('--jpeg-quality', '90'));

if (!BOOK_ID && !PROVIDER) {
  console.error('error: pass --book-id <id> or --provider <name>');
  process.exit(1);
}

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

// ── Manifest helpers ──

async function fetchManifest(url) {
  const buf = await rateLimitedFetch(url, { timeout: 30_000 });
  return JSON.parse(buf.toString('utf8'));
}

function iterCanvases(manifest) {
  if (Array.isArray(manifest?.sequences?.[0]?.canvases)) return manifest.sequences[0].canvases;
  if (Array.isArray(manifest?.items)) return manifest.items; // IIIF v3
  return [];
}

function canvasService(canvas) {
  // IIIF Presentation v2
  const res = canvas?.images?.[0]?.resource;
  if (res?.service) {
    const svc = Array.isArray(res.service) ? res.service[0] : res.service;
    return {
      id: svc['@id'] || svc.id,
      width: res.width || canvas.width,
      height: res.height || canvas.height,
    };
  }
  // IIIF Presentation v3
  const body = canvas?.items?.[0]?.items?.[0]?.body;
  if (body?.service) {
    const svc = Array.isArray(body.service) ? body.service[0] : body.service;
    return {
      id: svc.id || svc['@id'],
      width: body.width || canvas.width,
      height: body.height || canvas.height,
    };
  }
  return null;
}

/**
 * Reduce a IIIF image filename to a short identifier we can match
 * against the stored URL.
 *   `Ott.lat.2074_0001_al_piatto.anteriore.jp2` → `Ott.lat.2074_0001`
 *   `Ott.lat.2074_0001.jp2`                     → `Ott.lat.2074_0001`
 *   `foo_bar_baz.jpg`                            → `foo_bar_baz` (unchanged)
 */
function shortIdFromFilename(filename) {
  if (!filename) return null;
  const stem = filename.replace(/\.(jp2|jpg|jpeg|png|tif|tiff)(?:$|\?)/i, '');
  const m = stem.match(/^(.+?_\d{3,})(?:_.+)?$/);
  return m ? m[1] : stem;
}

function shortIdFromUrl(url) {
  if (!url) return null;
  // Service URL: .../<path>/<filename>.jp2  or  Image API URL: .../<filename>.jp2/full/.../...
  const m = url.match(/\/([^/?]+\.(?:jp2|jpg|jpeg|png|tif|tiff))(?:\/|$|\?)/i);
  return m ? shortIdFromFilename(m[1]) : null;
}

function buildFullResUrl(serviceId) {
  // Strip any trailing slash, then append IIIF Image API request.
  return serviceId.replace(/\/$/, '') + '/full/full/0/default.jpg';
}

async function jpegDims(buf) {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

// ── Per-book processing ──

async function processBook(book) {
  const manifestUrl = MANIFEST_URL || book.image_source?.iiif_manifest || book.image_source?.source_url;
  if (!manifestUrl) return { skipped: 'no-manifest-url' };

  let manifest;
  try {
    manifest = await fetchManifest(manifestUrl);
  } catch (e) {
    return { skipped: `manifest-fetch-fail: ${e.message?.substring(0, 80)}` };
  }

  const canvases = iterCanvases(manifest);
  if (!canvases.length) return { skipped: 'no-canvases' };

  // Index canvases by short id (and also by 1-based ordinal as fallback)
  const byShortId = new Map();
  const byOrdinal = new Map();
  canvases.forEach((c, i) => {
    const svc = canvasService(c);
    if (!svc?.id) return;
    const sid = shortIdFromUrl(svc.id);
    if (sid && !byShortId.has(sid)) byShortId.set(sid, svc);
    byOrdinal.set(i + 1, svc);
  });

  const pages = await db.collection('pages').find(
    { book_id: book.id },
    { projection: { id: 1, _id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, split_side: 1 } },
  ).sort({ page_number: 1 }).toArray();

  if (!pages.length) return { skipped: 'no-pages' };
  if (pages.some(p => p.split_side === 'left' || p.split_side === 'right')) {
    return { skipped: 'already-split (manifest mode needs unsplit input)' };
  }

  // Build the mapping page → canvas.service
  const mapping = pages.map(p => {
    const sid = shortIdFromUrl(p.photo_original || p.photo);
    let svc = sid ? byShortId.get(sid) : null;
    if (!svc) svc = byOrdinal.get(p.page_number) || null;  // ordinal fallback
    return { page: p, sid, svc };
  });

  const unmatched = mapping.filter(m => !m.svc);
  if (unmatched.length) {
    console.log(`  ${(book.title || '').substring(0, 55)} — ${unmatched.length}/${pages.length} pages unmatched (first: p${unmatched[0].page.page_number}, sid=${unmatched[0].sid || 'null'}). Aborting.`);
    return { skipped: `unmatched-pages (${unmatched.length}/${pages.length})` };
  }

  // Decide upgrade ratio from the first matched canvas vs current archived dims
  const firstSvc = mapping[0].svc;
  const currentArchive = pages[0].archived_photo;
  let currentWidth = null;
  if (currentArchive) {
    try {
      const head = await fetch(currentArchive, { method: 'GET', headers: { Range: 'bytes=0-65535' } });
      if (head.ok) {
        const buf = Buffer.from(await head.arrayBuffer());
        const dims = await jpegDims(buf);
        currentWidth = dims?.width;
      }
    } catch { /* ignore */ }
  }
  const masterWidth = firstSvc.width;
  if (currentWidth && masterWidth && masterWidth / currentWidth < MIN_UPGRADE_RATIO) {
    return { skipped: `not-low-res (master=${masterWidth}, current=${currentWidth})` };
  }

  console.log(`  ${(book.title || '').substring(0, 55)} — manifest=${canvases.length} canvases, master≈${masterWidth}px, refetching ${pages.length} pages`);

  let updated = 0, failed = 0;

  await parallelMap(mapping, async ({ page, svc }) => {
    const fullUrl = buildFullResUrl(svc.id);
    let raw;
    try {
      raw = await rateLimitedFetch(fullUrl, { timeout: 60_000 });
    } catch (e) {
      failed++;
      console.error(`    p${page.page_number} fetch fail: ${e.message?.substring(0, 80)}`);
      return;
    }
    let processed;
    try {
      processed = await sharp(raw)
        .resize(SHARP_MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, progressive: true })
        .toBuffer();
    } catch (e) {
      failed++;
      console.error(`    p${page.page_number} sharp fail: ${e.message?.substring(0, 80)}`);
      return;
    }
    const dims = await jpegDims(processed);

    if (DRY_RUN) {
      updated++;
      if (page.page_number <= 3) {
        console.log(`    [dry] p${page.page_number}: ${svc.id.substring(0, 80)} → ${dims?.width}×${dims?.height}px`);
      }
      return;
    }

    const key = `archived/${book.id}/${page.page_number}.jpg`;
    try {
      const newUrl = await r2Put(key, processed);
      await db.collection('pages').updateOne(
        { _id: page._id || new ObjectId(page.id) },
        {
          $set: {
            archived_photo: newUrl,
            photo: newUrl,
            photo_original: fullUrl,
            'image_metadata.width': dims?.width,
            'image_metadata.height': dims?.height,
            'image_metadata.source_max_width': svc.width,
            'image_metadata.upgraded_at': new Date(),
            'image_metadata.upgrade_via': 'manifest',
            updated_at: new Date(),
          },
        },
      );
      updated++;
    } catch (e) {
      failed++;
      console.error(`    p${page.page_number} upload/update fail: ${e.message?.substring(0, 80)}`);
    }
  }, PAGE_CONCURRENCY);

  if (!DRY_RUN && updated > 0) {
    await db.collection('books').updateOne(
      { id: book.id },
      {
        $set: {
          image_resolution_upgraded_at: new Date(),
          image_resolution_upgrade_source: masterWidth,
          image_resolution_upgrade_via: 'manifest',
          updated_at: new Date(),
        },
      },
    );
  }

  return { updated, failed, total: pages.length, masterWidth };
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
  console.log(`Mode: MANIFEST-RECOVERY${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Filters: ${BOOK_ID ? `book-id=${BOOK_ID}` : ''}${PROVIDER ? ` provider=${PROVIDER}` : ''}`);
  console.log(`Concurrency: ${CONCURRENCY} books × ${PAGE_CONCURRENCY} pages | min-upgrade-ratio=${MIN_UPGRADE_RATIO} | max-width=${SHARP_MAX_WIDTH}px | jpeg-q=${JPEG_QUALITY}\n`);

  const q = BOOK_ID ? { id: BOOK_ID } : { 'image_source.provider': PROVIDER };
  const books = await db.collection('books').find(q, {
    projection: { id: 1, slug: 1, title: 1, image_source: 1 },
  }).limit(LIMIT || 0).toArray();
  console.log(`Found ${books.length} books to process\n`);

  let processed = 0, skipped = 0, failed = 0;
  const startTime = Date.now();

  await parallelMap(books, async (book) => {
    try {
      const result = await processBook(book);
      if (result.skipped) {
        skipped++;
        console.log(`  skip: ${(book.title || '').substring(0, 55)} — ${result.skipped}`);
      } else {
        processed++;
        console.log(`  done: ${(book.title || '').substring(0, 55)} — updated=${result.updated} failed=${result.failed} master=${result.masterWidth}px`);
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
