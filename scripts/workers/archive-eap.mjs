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

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_LIMIT = parseInt(getArg('limit') || '5000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '5', 10);
const DRY_RUN = hasFlag('dry-run');

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

async function downloadImage(url, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      clearTimeout(timeout);
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

  // Find EAP books (IIIF manifest contains eap.bl.uk)
  const eapBooks = await db.collection('books')
    .find({
      'image_source.iiif_manifest': /eap\.bl\.uk/,
      pages_count: { $gt: 0 },
    }, { projection: { id: 1, title: 1, pages_count: 1 } })
    .limit(5000)
    .maxTimeMS(30_000)
    .toArray();

  console.log(`[archive-eap] Found ${eapBooks.length} EAP books`);

  // Collect unarchived pages
  const allPages = [];
  for (const book of eapBooks) {
    if (allPages.length >= PAGE_LIMIT) break;
    const remaining = PAGE_LIMIT - allPages.length;
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        photo: { $regex: /images\.eap\.bl\.uk/ },
        $or: [
          { archived_photo: { $exists: false } },
          { archived_photo: null },
          { archived_photo: '' },
        ],
      }, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } })
      .limit(remaining)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);

    if (pages.length > 0) allPages.push(...pages);
  }

  console.log(`[archive-eap] Found ${allPages.length} unarchived pages`);

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
        // Request full/full resolution (not capped at 2000px)
        const fullResUrl = page.photo.replace(/\/full\/\d+,?\d*\//, '/full/full/');
        const buffer = await downloadImage(fullResUrl);

        // Fetch IIIF info.json for metadata (best effort)
        let iiifInfo = null;
        try {
          const serviceUrl = page.photo.replace(/\/full\/.*/, '');
          const infoResp = await fetch(serviceUrl + '/info.json');
          if (infoResp.ok) iiifInfo = await infoResp.json();
        } catch {}

        const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);

        const dimFields = {};
        if (urls.width) dimFields.image_width = urls.width;
        if (urls.height) dimFields.image_height = urls.height;

        const iiifFields = {};
        if (iiifInfo) {
          iiifFields['iiif_info.width'] = iiifInfo.width;
          iiifFields['iiif_info.height'] = iiifInfo.height;
          iiifFields['iiif_info.service_url'] = iiifInfo['@id'] || iiifInfo.id;
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
