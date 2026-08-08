#!/usr/bin/env node
// Catch EPIPE and other unhandled errors — R2 TLS connections drop occasionally
process.on('uncaughtException', (err) => {
  const transient = ['EPIPE', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'];
  if (transient.includes(err.code) || err.message?.includes('EPIPE') || err.message?.includes('ECONNRESET')) {
    console.log(`  [WARN] ${err.code || err.message?.substring(0, 40)} — transient error, continuing...`);
    return;
  }
  console.error('Uncaught:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
    console.log(`  [WARN] Unhandled rejection: ${msg.substring(0, 60)} — continuing...`);
    return;
  }
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
/**
 * EAP (British Library Endangered Archives) archiver
 *
 * Downloads page images from images.eap.bl.uk, uploads to R2, updates MongoDB.
 * images.eap.bl.uk has no WAF, no rate limiting, and CORS enabled — fast archiving.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-eap.mjs
 *   node scripts/workers/archive-eap.mjs --limit=5000 --concurrency=5 --dry-run
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';
import { fetchIiifInfo, fetchIiifNativeRes, shouldTileStitch } from '../lib/iiif-utils.mjs';
import { fetchWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '5000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '5', 10);
const DRY_RUN = hasFlag('dry-run');

// --upgrade re-archives pages whose existing archived image is below the
// native master resolution (the BL silent-cap problem). Targets pages with
// image_width <= 1200 (the BL /full/ output cap) and re-fetches via tile
// stitching. See scripts/lib/iiif-utils.mjs::SILENT_CAP_HOSTS.
const UPGRADE = hasFlag('upgrade');
const BOOK_ID = getArg('book');

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Stall timeout, not a total-duration cap (#3477): the old 30s-from-start abort
// selected for the largest page in a book. The old 30s becomes the stall
// window; the lib's 15-min maxMs is the backstop.
const FETCH_STALL_MS = parseInt(process.env.ARCHIVE_STALL_TIMEOUT_MS || '30000', 10);

async function downloadImage(url, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { res, buffer } = await fetchWithStallTimeout(url, { stallMs: FETCH_STALL_MS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return buffer;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-eap] EAP archiver — ${PAGE_LIMIT} pages, ${CONCURRENCY} workers`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find books. In upgrade mode, target every book with EAP imagery (any
  // tenant). In default mode, keep the existing Bhutan-tenant filter for
  // backwards compatibility with the unarchived-pages backlog.
  const BHUTAN_TENANT_ID = 'fd1907e5-5965-4bea-a978-77be3dff08a8';
  const bookQuery = BOOK_ID
    ? { id: BOOK_ID }
    : UPGRADE
      ? { 'image_source.provider': 'bl', pages_count: { $gt: 0 } }
      : { tenantId: BHUTAN_TENANT_ID, pages_count: { $gt: 0 } };

  const eapBooks = await db.collection('books')
    .find(bookQuery, { projection: { id: 1, title: 1, pages_count: 1 } })
    .limit(BOOK_ID ? 1 : 5000)
    .maxTimeMS(30_000)
    .toArray();

  console.log(`[archive-eap] Found ${eapBooks.length} EAP books${UPGRADE ? ' (upgrade mode)' : ''}`);

  // Collect target pages. In upgrade mode: pages already archived but at the
  // 1200 px cap (and below). In default mode: pages with no archive yet.
  const allPages = [];
  for (const book of eapBooks) {
    if (allPages.length >= PAGE_LIMIT) break;
    const remaining = PAGE_LIMIT - allPages.length;
    const pageQuery = UPGRADE
      ? {
          book_id: book.id,
          photo: { $regex: /images\.eap\.bl\.uk/ },
          $or: [
            { image_width: { $lte: 1200 } },
            { image_width: { $exists: false } },
          ],
        }
      : {
          book_id: book.id,
          photo: { $regex: /images\.eap\.bl\.uk/ },
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: null },
            { archived_photo: '' },
          ],
        };

    const pages = await db.collection('pages')
      .find(pageQuery, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1, image_width: 1, image_height: 1 } })
      .limit(remaining)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);

    if (pages.length > 0) allPages.push(...pages);
  }

  console.log(`[archive-eap] Found ${allPages.length} ${UPGRADE ? 'pages to upgrade' : 'unarchived pages'}`);

  if (allPages.length === 0 || DRY_RUN) {
    if (DRY_RUN && allPages.length > 0) {
      const byBook = {};
      for (const p of allPages) byBook[p.book_id] = (byBook[p.book_id] || 0) + 1;
      console.log(`  Across ${Object.keys(byBook).length} books`);
    }
    await client.close();
    return;
  }

  let idx = 0;
  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let consecutiveFails = 0;
  const touchedBookIds = new Set();

  async function worker() {
    while (idx < allPages.length) {
      if (consecutiveFails >= 30) {
        console.log(`  [CIRCUIT BREAKER] 30 consecutive failures — stopping.`);
        break;
      }

      const i = idx++;
      if (i >= allPages.length) break;
      const page = allPages[i];

      try {
        // Fetch IIIF info.json first — we need master dims to decide between
        // /full/full/ and tile stitching (BL silently caps /full/ at 1200 px
        // regardless of the requested size). See scripts/lib/iiif-utils.mjs.
        const iiifInfo = await fetchIiifInfo(page.photo).catch(() => null);

        let buffer;
        let fullResUrl;
        let stitchedTiles = 0;
        if (iiifInfo && shouldTileStitch(iiifInfo, page.photo)) {
          const stitch = await fetchIiifNativeRes(page.photo, { info: iiifInfo });
          buffer = stitch.buffer;
          stitchedTiles = stitch.tiles;
          fullResUrl = `${iiifInfo.serviceBase}/full/full/0/default.jpg`;
        } else {
          fullResUrl = page.photo.replace(/\/full\/\d+,?\d*\//, '/full/full/');
          buffer = await downloadImage(fullResUrl);
        }

        const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);

        const dimFields = {};
        if (urls.width) dimFields.image_width = urls.width;
        if (urls.height) dimFields.image_height = urls.height;

        const iiifFields = {};
        if (iiifInfo) {
          iiifFields['iiif_info.width'] = iiifInfo.width;
          iiifFields['iiif_info.height'] = iiifInfo.height;
          iiifFields['iiif_info.service_url'] = iiifInfo.raw?.['@id'] || iiifInfo.raw?.id || iiifInfo.serviceBase;
          if (iiifInfo.sizes) iiifFields['iiif_info.sizes'] = iiifInfo.sizes;
          if (iiifInfo.tiles) iiifFields['iiif_info.tiles'] = iiifInfo.tiles;
        }

        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              archived_photo: urls.archived,
              display_photo: urls.display,
              thumbnail_blob: urls.thumb,
              photo_original: fullResUrl,
              ...dimFields,
              ...iiifFields,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source_url': fullResUrl,
              'archive_metadata.original_url': page.photo,
              'archive_metadata.full_res': true,
              'archive_metadata.bytes': buffer.byteLength,
              'archive_metadata.fetch_method': stitchedTiles > 0 ? `tile_stitch_${stitchedTiles}` : 'full',
              updated_at: new Date(),
            }
          }
        );

        archived++;
        totalBytes += buffer.byteLength;
        touchedBookIds.add(page.book_id);
        consecutiveFails = 0;

        if (archived % 100 === 0) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          const rate = (archived / (Date.now() - start) * 1000).toFixed(1);
          const mb = (totalBytes / 1024 / 1024).toFixed(0);
          console.log(`  ${archived}/${allPages.length} archived (${failed} failed) — ${rate}/s — ${mb} MB — ${elapsed}s`);
        }
      } catch (err) {
        failed++;
        consecutiveFails++;
        if (failed <= 5 || failed % 50 === 0) {
          console.log(`  FAIL p${page.page_number} of ${page.book_id}: ${err.message?.substring(0, 80)}`);
        }
      }
    }
  }

  // Run workers
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Update pages_archived on touched books
  for (const bookId of touchedBookIds) {
    const archivedCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: true, $ne: null, $ne: '' },
    });
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { pages_archived: archivedCount, updated_at: new Date() } }
    );
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  const mb = (totalBytes / 1024 / 1024).toFixed(0);
  console.log(`\n[archive-eap] Done: ${archived} archived, ${failed} failed, ${mb} MB, ${elapsed}s`);
  console.log(`  Books touched: ${touchedBookIds.size}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
