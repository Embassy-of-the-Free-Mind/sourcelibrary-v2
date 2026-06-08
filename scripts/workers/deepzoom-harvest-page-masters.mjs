#!/usr/bin/env node
/**
 * Deep-zoom: harvest native-resolution masters for illustrated book pages (#2411).
 *
 * Most IIIF-partner book pages were imported at a ~1000px cap, so the page scan we
 * hold (`archived_photo`) is too small to deep-zoom. The source servers will hand
 * back a 2–9× larger master at `/full/full/`. This worker re-fetches that master —
 * but ONLY for pages that actually carry a detected illustration (a gallery_image),
 * which is a small, bounded set (~7k pages across the low-res partners).
 *
 * It writes the master to a SEPARATE R2 key and a `fullres_master` field on the page
 * doc. It does NOT touch `archived_photo` — the reader keeps serving the light display
 * copy, and OCR / gallery-extraction / the splitter stay pinned to what they already
 * processed. This is the master tier that book pages lack and artworks already have
 * (`archived_full_url`); deep-zoom (and, later, better gallery crops) read from it.
 *
 * The page-level deep-zoom tiler consumes `fullres_master` the same way the artwork
 * tiler consumes a book's master.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/deepzoom-harvest-page-masters.mjs --providers bl --limit 20 [--dry-run]
 *     [--providers bl,mdz,...] [--min-mp 4] [--concurrency 3] [--book-id <id>] [--force]
 *
 * Idempotent: pages with a `fullres_master` are skipped unless --force. The gate is the
 * master's ABSOLUTE resolution, not its ratio over the current archive: a page is only
 * worth deep-zooming if its native master clears --min-mp megapixels (default 4). Some
 * sources (e.g. BL/EAP) already serve `/full/full/` yet the master itself is small —
 * those get marked skipped so we don't re-check them.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { upgradeToFullRes, rateLimitedFetch, isIiifUrl } from '../lib/iiif-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.production.local') });

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const has = (n) => process.argv.includes(n);

const PROVIDERS = (arg('--providers', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BOOK_ID = arg('--book-id', null);
const LIMIT = parseInt(arg('--limit', '50'), 10);
const MIN_MP = parseFloat(arg('--min-mp', '4'));
const CONCURRENCY = parseInt(arg('--concurrency', '3'), 10);
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');

const SHARP_MAX = 12000; // guard against pathological dimensions
const JPEG_QUALITY = 88;

if (!PROVIDERS.length && !BOOK_ID) {
  console.error('Pass --providers <a,b> or --book-id <id>.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

async function harvestPage(pages, page) {
  const src = page.photo_original;
  if (!src || !isIiifUrl(src)) return { id: page._id, status: 'not-iiif' };

  // Upgrade a capped IIIF request (/full/1000,/) to native; a no-op when the URL
  // is already /full/full/ (e.g. BL/EAP).
  const fullUrl = upgradeToFullRes(src);

  try {
    const buf = await rateLimitedFetch(fullUrl, { timeout: 45000 });
    const meta = await sharp(buf, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) return { id: page._id, status: 'no-dims' };
    if (meta.width > SHARP_MAX || meta.height > SHARP_MAX) return { id: page._id, status: 'oversize', w: meta.width, h: meta.height };

    // Absolute-resolution gate: deep-zoom only adds value if the master itself is
    // large. Ratio-over-archive is the wrong test — a 1.5MP master that's 2× our
    // archive still isn't worth tiling. Some sources (BL/EAP) already serve
    // /full/full/ yet the master is small; those get marked so we skip re-checking.
    const mp = (meta.width * meta.height) / 1e6;
    if (mp < MIN_MP && !FORCE) {
      if (!DRY_RUN)
        await pages.updateOne(
          { _id: page._id },
          { $set: { fullres_master_skip: { width: meta.width, height: meta.height, mp: +mp.toFixed(1), checked_at: new Date() } } }
        );
      return { id: page._id, status: 'below-gate', w: meta.width, h: meta.height, mp: +mp.toFixed(1) };
    }

    if (DRY_RUN) return { id: page._id, status: 'would-harvest', w: meta.width, h: meta.height, mp: +mp.toFixed(1) };

    // Normalize to a clean JPEG; tiles are generated from this later.
    const out = await sharp(buf, { limitInputPixels: false }).jpeg({ quality: JPEG_QUALITY }).toBuffer();
    const key = `page-masters/${page.book_id}/${page.page_number}.jpg`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: out,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    const url = `https://images.sourcelibrary.org/${key}`;
    await pages.updateOne(
      { _id: page._id },
      {
        $set: {
          fullres_master: {
            url,
            width: meta.width,
            height: meta.height,
            source_url: fullUrl,
            harvested_at: new Date(),
          },
        },
        $unset: { fullres_master_skip: '' },
      }
    );
    return { id: page._id, status: 'harvested', w: meta.width, h: meta.height, mp: +mp.toFixed(1) };
  } catch (e) {
    return { id: page._id, status: 'error', error: e.message };
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const gallery = db.collection('gallery_images');

// 1. Resolve the candidate books.
const bookQuery = BOOK_ID
  ? { _id: new ObjectId(BOOK_ID) }
  : { visible: true, content_type: { $ne: 'artwork' }, 'image_source.provider': { $in: PROVIDERS } };
const bookIds = (await books.find(bookQuery, { projection: { _id: 1 } }).toArray()).map((b) => b._id.toString());
if (!bookIds.length) {
  console.error('No matching books.');
  process.exit(1);
}

// 2. Find their illustrated pages (distinct book_id + page_number that have a gallery_image).
const illustrated = await gallery
  .aggregate([{ $match: { book_id: { $in: bookIds } } }, { $group: { _id: { b: '$book_id', p: '$page_number' } } }])
  .toArray();

// 3. Load the page docs for those illustrated pages, skipping already-harvested.
const orKeys = illustrated.map((g) => ({ book_id: g._id.b, page_number: g._id.p }));
const pageFilter = { $or: orKeys };
if (!FORCE) pageFilter.fullres_master = { $exists: false };
const targets = await pages
  .find(pageFilter, { projection: { book_id: 1, page_number: 1, photo_original: 1 } })
  .limit(LIMIT)
  .toArray();

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}Harvesting masters for ${targets.length} illustrated page(s) ` +
    `across ${bookIds.length} book(s), min-mp ${MIN_MP}…`
);

const results = await pool(targets, CONCURRENCY, async (p) => {
  const r = await harvestPage(pages, p);
  console.log(`  ${p.book_id}/${p.page_number} → ${r.status}${r.w ? ` (${r.w}×${r.h}${r.mp ? `, ${r.mp}MP` : ''})` : ''}${r.error ? `: ${r.error}` : ''}`);
  return r;
});
await client.close();

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log('\nDone:', JSON.stringify(tally));
