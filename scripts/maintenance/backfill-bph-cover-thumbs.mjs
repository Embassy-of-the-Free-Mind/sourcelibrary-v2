/**
 * Backfill `-thumb.jpg` variants for digitised BPH covers that only have the
 * 1200px display variant.
 *
 * Why: the BPH catalogue grid (and the EFM embed) render covers via the SL
 * image optimiser. ~82% of covers live under /pages/ and already have a
 * pipeline-generated `-thumb.jpg` (150px). The remaining ~18% — the /cropped/
 * manuscript covers and /uploads/ — were never given a thumb, so the
 * thumb-swap loader (bookCoverResponsiveLoader) would 404 exactly those.
 * This script generates the missing 150px thumbs and uploads them to R2 so
 * the loader is safe for every cover.
 *
 * Idempotent: skips any cover whose `-thumb.jpg` already returns 200.
 *
 * Run:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/maintenance/backfill-bph-cover-thumbs.mjs [--dry-run] [--all]
 *
 *   --dry-run  enumerate + report, write nothing
 *   --all      also (re)check /pages/ covers, not just /cropped/ + /uploads/
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const THUMB_WIDTH = 150;
const THUMB_QUALITY = 60; // matches scripts/workers/lib/display-image.mjs
const CONCURRENCY = 8;
const API = 'https://sourcelibrary.org/api/catalog/bph';
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
if (!DRY_RUN && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('Missing R2_* env vars. Source .env.production.local first.');
  process.exit(1);
}
const s3 = DRY_RUN ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

/** Enumerate every digitised BPH cover URL via the catalogue API. */
async function collectCovers() {
  const seen = new Set();
  let offset = 0;
  const limit = 200;
  for (;;) {
    const res = await fetch(`${API}?digitized=sl&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error(`API ${res.status} at offset ${offset}`);
    const { works, total } = await res.json();
    for (const w of works) {
      if (typeof w.sl_cover === 'string' && w.sl_cover.startsWith(PUBLIC_URL) && w.sl_cover.endsWith('.jpg')) {
        seen.add(w.sl_cover);
      }
    }
    offset += limit;
    if (offset >= total) break;
  }
  return [...seen];
}

async function thumbExists(thumbUrl) {
  try {
    const r = await fetch(thumbUrl, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return r.status === 200 || r.status === 206;
  } catch {
    return false;
  }
}

async function backfillOne(displayUrl) {
  const thumbUrl = displayUrl.replace(/\.jpg$/, '-thumb.jpg');
  if (await thumbExists(thumbUrl)) return 'exists';
  if (DRY_RUN) return 'would-write';

  const res = await fetch(displayUrl);
  if (!res.ok) return `display-${res.status}`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return 'empty-display';

  const thumb = await sharp(buf)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();

  const key = thumbUrl.slice(PUBLIC_URL.length + 1); // strip "https://host/"
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: thumb, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return 'written';
}

async function run() {
  console.log(`[backfill] mode=${DRY_RUN ? 'DRY-RUN' : 'LIVE'} scope=${ALL ? 'all' : 'cropped+uploads'}`);
  const all = await collectCovers();
  const targets = ALL
    ? all
    : all.filter((u) => /\/(cropped|uploads)\//.test(u));
  console.log(`[backfill] ${all.length} digitised covers, ${targets.length} in scope`);

  const tally = {};
  let done = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(backfillOne));
    for (const r of results) tally[r] = (tally[r] || 0) + 1;
    done += batch.length;
    if (done % 80 === 0 || done === targets.length) {
      console.log(`[backfill] ${done}/${targets.length} ${JSON.stringify(tally)}`);
    }
  }
  console.log('[backfill] DONE', JSON.stringify(tally, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
