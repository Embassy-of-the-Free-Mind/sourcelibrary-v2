#!/usr/bin/env node
/**
 * Backfill per-half thumbnails for OLD-ERA split pages — issue #1730.
 *
 * Background
 * ----------
 * A spread scan that gets split into two pages should end up with per-half
 * `thumbnail_blob` / `image_thumb` / `display_photo`. The CURRENT splitter
 * (`scripts/workers/batch-split-bph.mjs`) does this — its pages carry a
 * `split_side` field. But a historical tail of "old-era" split pages was
 * created before that: they have `crop` coords (xStart/xEnd, 0–1000) on a
 * full-spread source image, but NO materialized half — their pre-sized
 * variants are resizes of the WHOLE spread.
 *
 * Why it matters (not just cosmetics): the canonical resolver
 * (`src/lib/page-image-url.ts` `resolveSized`) only proxy-crops a split page
 * when it finds NO usable pre-sized variant. An old-era page that still has a
 * stale full-spread `display_photo`/`thumbnail_blob` therefore renders the
 * UNCROPPED spread for that size. Materializing real per-half variants here
 * makes the page render the correct half AND removes the /api/image proxy
 * fallback for it (the #1727 read-side dependency).
 *
 * What it does
 * ------------
 * For each candidate (crop coords, no `split_side`, no `cropped_photo`):
 * fetch the full spread, extract the half by the page's `crop` coords, render
 * 150px (thumb) + 1200px (display), upload to R2, and point
 * `thumbnail_blob` / `image_thumb` / `display_photo` at them. The previous
 * URLs are preserved under `thumb_backfill` for reversibility. New-era pages
 * (`split_side` set) and pages with a real `cropped_photo` are skipped.
 *
 * Safety
 * ------
 * - DRY-RUN by default: prints a classification breakdown + per-book counts +
 *   a sample, and writes nothing. Pass --apply to write.
 * - Image-field-only update; does NOT touch ocr/translation.data (no revision
 *   needed), and stores the prior URLs so it's reversible.
 * - Run on Hetzner (R2 creds + fast Atlas). Laptop Atlas COLLSCANs time out.
 *
 * Usage
 * -----
 *   node scripts/maintenance/backfill-split-page-thumbnails.mjs            # dry-run audit
 *   node scripts/maintenance/backfill-split-page-thumbnails.mjs --apply    # write
 *   ... --book <bookId>   --limit <N>   --concurrency <N>   --verbose
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { parseArgs } from 'util';

const THUMB_WIDTH = 150;
const THUMB_QUALITY = 60;
const DISPLAY_WIDTH = 1200;
const DISPLAY_QUALITY = 85;
// Decode guard — same lesson as the /api/image cap (#2299): a stale spread can
// be a multi-hundred-MP scan; cap the decode so a giant source can't OOM us.
const MAX_INPUT_PIXELS = 100_000_000;

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    book: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    verbose: { type: 'boolean', default: false },
  },
});
const APPLY = args.apply;
const LIMIT = args.limit ? parseInt(args.limit, 10) : 0;
const CONCURRENCY = Math.max(1, parseInt(args.concurrency, 10) || 6);

// Candidate = old-era split page: crop coords present, not produced by the
// current splitter (`split_side` absent), and no materialized cropped half.
const CANDIDATE = {
  'crop.xStart': { $exists: true },
  'crop.xEnd': { $exists: true },
  split_side: { $exists: false },
  $or: [{ cropped_photo: { $exists: false } }, { cropped_photo: { $in: [null, ''] } }],
};

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function uploadToR2(r2, key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// The full, uncropped spread to crop from. Order mirrors getPageSource's
// non-split fallback (archived R2 copy → legacy original → upload).
function spreadSource(page) {
  return page.archived_photo || page.photo_original || page.photo || null;
}

// Stable per-half R2 keys; `oe-` (old-era) namespace avoids clobbering the
// splitter's `sp...` keys.
function halfKeys(bookId, pageId) {
  const base = `pages/${bookId}/oe-${pageId}`;
  return { display: `${base}.jpg`, thumb: `${base}-thumb.jpg` };
}

// 0–1000 crop coords → pixel extract region (full height), mirrors /api/image.
function cropRegion(crop, w, h) {
  const left = Math.max(0, Math.round((crop.xStart / 1000) * w));
  const width = Math.max(1, Math.min(Math.round(((crop.xEnd - crop.xStart) / 1000) * w), w - left));
  return { left, top: 0, width, height: h };
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function renderHalf(page) {
  const src = spreadSource(page);
  if (!src || !/^https?:\/\//.test(src)) return { skip: 'no-source' };
  const buf = await fetchImage(src);
  const img = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) return { skip: 'no-dimensions' };
  const region = cropRegion(page.crop, meta.width, meta.height);
  const cropped = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).extract(region).toBuffer();
  const [display, thumb] = await Promise.all([
    sharp(cropped).resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: DISPLAY_QUALITY, progressive: true }).toBuffer(),
    sharp(cropped).resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: THUMB_QUALITY, progressive: true }).toBuffer(),
  ]);
  return { display, thumb };
}

async function classify(p) {
  const r = await p.aggregate([
    { $match: { 'crop.xStart': { $exists: true } } },
    { $facet: {
      total: [{ $count: 'n' }],
      newEra_fixed: [{ $match: { split_side: { $exists: true } } }, { $count: 'n' }],
      oldEra_withCroppedPhoto: [{ $match: { split_side: { $exists: false }, cropped_photo: { $nin: [null, ''] } } }, { $count: 'n' }],
      candidates: [{ $match: CANDIDATE }, { $count: 'n' }],
      candidates_stale_display: [{ $match: { ...CANDIDATE, display_photo: { $exists: true, $nin: [null, ''] } } }, { $count: 'n' }],
      candidates_stale_thumb: [{ $match: { ...CANDIDATE, thumbnail_blob: { $exists: true, $nin: [null, ''] } } }, { $count: 'n' }],
      candidates_no_source: [{ $match: { ...CANDIDATE, archived_photo: { $in: [null, ''] }, photo_original: { $in: [null, ''] }, photo: { $in: [null, ''] } } }, { $count: 'n' }],
    } },
  ], { allowDiskUse: true }).toArray();
  const g = k => r[0][k]?.[0]?.n || 0;
  return {
    total_split_pages: g('total'),
    newEra_fixed: g('newEra_fixed'),
    oldEra_withCroppedPhoto: g('oldEra_withCroppedPhoto'),
    candidates: g('candidates'),
    '  candidates_with_stale_display_photo': g('candidates_stale_display'),
    '  candidates_with_stale_thumbnail_blob': g('candidates_stale_thumb'),
    '  candidates_with_no_usable_source (unfixable)': g('candidates_no_source'),
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('No Mongo URI in env');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db('bookstore');
  const p = db.collection('pages');

  console.log(`\n#1730 split-page thumbnail backfill — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (args.book) console.log(`Scoped to book: ${args.book}`);

  console.log('\nClassification (split pages = pages with crop coords):');
  console.log(JSON.stringify(await classify(p), null, 2));

  const filter = args.book ? { ...CANDIDATE, book_id: args.book } : CANDIDATE;
  const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, crop: 1, archived_photo: 1, photo_original: 1, photo: 1, thumbnail_blob: 1, display_photo: 1, image_thumb: 1 };

  // Per-book candidate counts (top 15) — surfaces the concentration.
  const byBook = await p.aggregate([
    { $match: filter },
    { $group: { _id: '$book_id', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 15 },
  ], { allowDiskUse: true }).toArray();
  console.log(`\nTop books by candidate count:`);
  if (byBook.length === 0) console.log('  (none — no candidates match)');
  for (const b of byBook) console.log(`  ${b._id}: ${b.n}`);

  if (!APPLY) {
    const sample = await p.find(filter).project(proj).limit(3).toArray();
    console.log(`\nSample candidates (showing source + crop the backfill would use):`);
    for (const s of sample) {
      console.log(`  page ${s.id} (book ${s.book_id} p${s.page_number}) crop=${JSON.stringify(s.crop)} src=${spreadSource(s)?.slice(0, 80)}`);
    }
    console.log('\nDry-run only. Re-run with --apply to materialize per-half thumbnails.');
    await client.close();
    return;
  }

  // --apply: process candidates with bounded concurrency.
  const cursor = p.find(filter).project(proj);
  const r2 = getR2Client();
  const counts = { written: 0, 'skip-no-source': 0, 'skip-no-dimensions': 0, errored: 0 };
  let processed = 0;
  const batch = [];
  const flush = async () => {
    await Promise.all(batch.splice(0).map(async (page) => {
      try {
        const out = await renderHalf(page);
        if (out.skip) { counts[`skip-${out.skip}`] = (counts[`skip-${out.skip}`] || 0) + 1; return; }
        const k = halfKeys(page.book_id, page.id);
        const [displayUrl, thumbUrl] = await Promise.all([
          uploadToR2(r2, k.display, out.display),
          uploadToR2(r2, k.thumb, out.thumb),
        ]);
        await p.updateOne({ id: page.id }, { $set: {
          display_photo: displayUrl, thumbnail_blob: thumbUrl, image_thumb: thumbUrl,
          thumb_backfill: {
            at: new Date(), source: 'backfill-split-page-thumbnails',
            previous_thumbnail_blob: page.thumbnail_blob ?? null,
            previous_display_photo: page.display_photo ?? null,
          },
          updated_at: new Date(),
        } });
        counts.written++;
        if (args.verbose) console.log(`  wrote ${page.id} (book ${page.book_id})`);
      } catch (e) {
        counts.errored++;
        if (args.verbose) console.log(`  ERROR ${page.id}: ${e.message}`);
      }
    }));
  };
  for await (const page of cursor) {
    batch.push(page);
    processed++;
    if (batch.length >= CONCURRENCY) await flush();
    if (processed % 500 === 0) console.log(`  …${processed} processed (${counts.written} written, ${counts.errored} errored)`);
    if (LIMIT && processed >= LIMIT) break;
  }
  await flush();

  console.log(`\nDone. Processed ${processed}.`);
  console.log(JSON.stringify(counts, null, 2));
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
