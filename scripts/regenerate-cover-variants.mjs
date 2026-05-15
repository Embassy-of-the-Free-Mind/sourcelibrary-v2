#!/usr/bin/env node
/**
 * Regenerate the missing `{NNNN}.jpg` (1200px display) and `{NNNN}-thumb.jpg`
 * (150px thumbnail) variants from the existing `{NNNN}-full.jpg` (cropped
 * single-page content) on R2. Restores the 3-variant convention for books
 * whose covers were cropped by `backfill-fullres-split-pages.mjs` (which only
 * wrote 2 of 3 variants).
 *
 * Originals at `archived/{bookId}/{N}.jpg` are NEVER touched — that's where
 * primary-source provenance lives.
 *
 * Idempotent: if the bare `.jpg` already matches the `-full.jpg` content
 * (same aspect ratio within 2%), we skip — no regeneration needed.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/regenerate-cover-variants.mjs --dry-run --ids 69099634cf28baa1b4cae779
 *   node scripts/regenerate-cover-variants.mjs --ids id1,id2,id3
 *   node scripts/regenerate-cover-variants.mjs --scope all-bph-full     # all BPH books with image_display ending in -full.jpg
 *   node scripts/regenerate-cover-variants.mjs --scope all-bph-full --apply
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DISPLAY_WIDTH = 1200;
const THUMB_WIDTH = 150;
const DISPLAY_QUALITY = 85;
const THUMB_QUALITY = 80;
// Aspect-ratio match tolerance — if bare and -full agree this closely, the
// variants are already consistent and we skip the book.
const ASPECT_TOLERANCE = 0.02;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DRY_RUN = !APPLY;
const idsArg = argv.find((_, i) => argv[i - 1] === '--ids');
const scopeArg = argv.find((_, i) => argv[i - 1] === '--scope');
if (!idsArg && !scopeArg) {
  console.error('Need --ids id1,id2 or --scope all-bph-full');
  process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function dims(buf) {
  const m = await sharp(buf).metadata();
  return { w: m.width || 0, h: m.height || 0, ratio: m.width && m.height ? m.width / m.height : null };
}

async function uploadR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));
  return `${R2_PUBLIC}/${key}`;
}

function parseFullPath(url) {
  // Match pages/{bookId}/{NNNN}-full.jpg OR pages/{bookId}/{name}-full.jpg
  const m = url.match(/\/pages\/([^/]+)\/(.+)-full\.jpg$/);
  if (!m) return null;
  return { bookId: m[1], base: m[2], fullKey: `pages/${m[1]}/${m[2]}-full.jpg`, displayKey: `pages/${m[1]}/${m[2]}.jpg`, thumbKey: `pages/${m[1]}/${m[2]}-thumb.jpg` };
}

async function processBook(book) {
  const url = book.image_display;
  if (!url || !url.endsWith('-full.jpg')) return { status: 'skip', reason: 'image_display not -full.jpg' };
  const paths = parseFullPath(url);
  if (!paths) return { status: 'skip', reason: 'unparseable url' };

  // 1. Fetch -full.jpg (cropped content, source of truth)
  let fullBuf;
  try { fullBuf = await fetchImage(url); }
  catch (e) { return { status: 'error', reason: `fetch -full: ${e.message}` }; }
  const fullDims = await dims(fullBuf);

  // 2. Check current bare .jpg for consistency
  const displayUrl = `${R2_PUBLIC}/${paths.displayKey}`;
  let bareDims = null;
  try {
    const bareBuf = await fetchImage(displayUrl);
    bareDims = await dims(bareBuf);
  } catch {
    // bare doesn't exist — definitely need to regenerate
  }

  let consistent = false;
  if (bareDims && fullDims.ratio && bareDims.ratio) {
    consistent = Math.abs(fullDims.ratio - bareDims.ratio) < ASPECT_TOLERANCE;
  }

  if (consistent) {
    return { status: 'ok-noop', fullDims: `${fullDims.w}x${fullDims.h}`, bareDims: `${bareDims.w}x${bareDims.h}` };
  }

  // 3. Generate display + thumb from -full content
  const displayBuf = await sharp(fullBuf)
    .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
    .toBuffer();
  const thumbBuf = await sharp(fullBuf)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, progressive: true })
    .toBuffer();

  if (DRY_RUN) {
    const dDims = await dims(displayBuf);
    const tDims = await dims(thumbBuf);
    return { status: 'dry-run', fullDims: `${fullDims.w}x${fullDims.h}`, bareDimsBefore: bareDims ? `${bareDims.w}x${bareDims.h}` : '(missing)', wouldWriteDisplay: `${dDims.w}x${dDims.h}`, wouldWriteThumb: `${tDims.w}x${tDims.h}` };
  }

  // 4. Apply
  await uploadR2(paths.displayKey, displayBuf);
  await uploadR2(paths.thumbKey, thumbBuf);
  return { status: 'fixed', fullDims: `${fullDims.w}x${fullDims.h}`, bareDimsBefore: bareDims ? `${bareDims.w}x${bareDims.h}` : '(missing)' };
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  let books;
  if (idsArg) {
    const ids = idsArg.split(',').map(s => s.trim()).filter(Boolean);
    books = await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, slug: 1, title: 1, image_display: 1 } }).toArray();
  } else if (scopeArg === 'all-bph-full') {
    books = await db.collection('books').find({ held_by: 'bph', image_display: { $regex: '-full\\.jpg$' } }, { projection: { id: 1, slug: 1, title: 1, image_display: 1 } }).toArray();
  } else {
    throw new Error(`unknown scope: ${scopeArg}`);
  }

  console.log(`${DRY_RUN ? 'DRY-RUN' : 'APPLY'} — processing ${books.length} books\n`);
  const counts = { fixed: 0, 'ok-noop': 0, 'dry-run': 0, skip: 0, error: 0 };
  for (const b of books) {
    const r = await processBook(b);
    counts[r.status] = (counts[r.status] || 0) + 1;
    const slug = (b.slug || b.id).slice(0, 50);
    if (r.status === 'fixed') console.log(`  ✓ fixed   ${slug.padEnd(52)} full=${r.fullDims} (was ${r.bareDimsBefore})`);
    else if (r.status === 'dry-run') console.log(`  • would   ${slug.padEnd(52)} full=${r.fullDims} write display=${r.wouldWriteDisplay} thumb=${r.wouldWriteThumb} (bare was ${r.bareDimsBefore})`);
    else if (r.status === 'ok-noop') console.log(`  ◦ noop    ${slug.padEnd(52)} already consistent (${r.fullDims} ≈ ${r.bareDims})`);
    else if (r.status === 'skip') console.log(`  - skip    ${slug.padEnd(52)} ${r.reason}`);
    else console.log(`  ✗ ERR     ${slug.padEnd(52)} ${r.reason}`);
  }
  console.log(`\n${JSON.stringify(counts)}`);
  await c.close();
}

main().catch(e => { console.error(e); process.exit(1); });
