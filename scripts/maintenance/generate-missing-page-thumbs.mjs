#!/usr/bin/env node
/**
 * Generate real pre-sized thumbnails for pages whose thumb fields still point
 * at a full-resolution image with NO derivable pre-sized sibling.
 *
 * Companion to fix-fullres-page-thumbs.mjs. That script does a cheap URL swap
 * (`…-full.jpg` → existing `…-thumb.jpg`). This one handles the leftover pages
 * where no `-thumb.jpg` exists to point at — chiefly legacy split halves stored
 * as `/cropped/{book}/{objectid}.jpg` (full-res, no variant) plus a handful of
 * `pages/{book}/{NNNN}-full.jpg` whose thumb sibling was never generated.
 *
 * For each target page it fetches the page's true displayed source (the cropped
 * half for split pages), resizes to a 150px-wide JPEG, uploads it to R2 at a
 * collision-free key derived from the page id, and repoints image_thumb +
 * thumbnail_blob at it. photo / cropped_photo (the full-res source) are left
 * untouched — only the thumb fields change.
 *
 * Requires R2 credentials + sharp (present on the Hetzner workers box).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/generate-missing-page-thumbs.mjs --provider bph            # dry run
 *   node scripts/maintenance/generate-missing-page-thumbs.mjs --provider bph --apply    # write
 *   node scripts/maintenance/generate-missing-page-thumbs.mjs --book <bookId> --apply
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const APPLY = process.argv.includes('--apply');
const bookIdx = process.argv.indexOf('--book');
const BOOK_ID = bookIdx !== -1 ? process.argv[bookIdx + 1] : null;
const provIdx = process.argv.indexOf('--provider');
const PROVIDER = provIdx !== -1 ? process.argv[provIdx + 1] : null;
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx !== -1 ? parseInt(process.argv[limIdx + 1], 10) : 0;
const CONCURRENCY = 8;
const THUMB_WIDTH = 150;
const THUMB_QUALITY = 60;

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

async function uploadThumb(key, body) {
  const k = key.replace(/^\//, '');
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: k, Body: body, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=604800, s-maxage=604800',
  }));
  return `${R2_PUBLIC_URL}/${k}`;
}

// The page's true displayed full-res source (split-aware), mirroring
// getPageSource() in src/lib/page-image-url.ts.
function pageSource(p) {
  if (p.cropped_photo) return p.cropped_photo;
  if (p.split_from_spread && p.photo) return p.photo;
  return p.archived_photo || p.photo_original || p.photo || null;
}

async function fetchBuf(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  if (!APPLY && !r2) console.warn('(R2 creds absent — dry run only)');
  if (APPLY && !r2) { console.error('R2 creds required for --apply.'); process.exit(1); }
  if (!BOOK_ID && !PROVIDER) { console.error('Pass --book <id> or --provider <name>.'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 0 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const pages = db.collection('pages');

  // Heavy thumb field with no derivable pre-sized sibling: legacy /cropped/
  // URLs, or any remaining -full.jpg (the cheap-swap script already handled the
  // ones whose -thumb.jpg sibling existed, so a -full.jpg still here has none).
  const heavy = { $regex: '(/cropped/|-full\\.jpg$)' };
  const query = { $or: [{ image_thumb: heavy }, { thumbnail_blob: heavy }] };
  let scope = 'ALL';
  if (BOOK_ID) { query.book_id = BOOK_ID; scope = `book ${BOOK_ID}`; }
  else if (PROVIDER) {
    const ids = await db.collection('books').find({ 'image_source.provider': PROVIDER }, { projection: { _id: 0, id: 1 } }).map(b => b.id).toArray();
    query.book_id = { $in: ids };
    scope = `provider ${PROVIDER} (${ids.length} books)`;
  }

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  scope: ${scope}`);

  const cursor = pages.find(query, { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1 } });
  if (LIMIT) cursor.limit(LIMIT);

  let scanned = 0, generated = 0, skipped = 0, failed = 0;
  let queue = [];

  const flush = async () => {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    await Promise.all(batch.map(async (p) => {
      const src = pageSource(p);
      if (!src) { skipped++; return; }
      try {
        if (!APPLY) { generated++; if (generated <= 8) console.log(`  would gen ${p.book_id} p${p.page_number} from ${src.split('/').slice(-2).join('/')}`); return; }
        const buf = await fetchBuf(src);
        const thumb = await sharp(buf).resize(THUMB_WIDTH).jpeg({ quality: THUMB_QUALITY }).toBuffer();
        const key = `pages/${p.book_id}/gen-${p.id}-thumb.jpg`;
        assertBookScopedKey(key, p.book_id, 'generate-missing-page-thumbs');
        const url = await uploadThumb(key, thumb);
        await pages.updateOne({ _id: p._id }, { $set: { image_thumb: url, thumbnail_blob: url, updated_at: new Date() } });
        generated++;
        if (generated % 500 === 0) console.log(`  ...generated ${generated}`);
      } catch (e) {
        failed++;
        if (failed <= 10) console.log(`  FAIL ${p.book_id} p${p.page_number}: ${e.message}`);
      }
    }));
  };

  for await (const p of cursor) {
    scanned++;
    queue.push(p);
    if (queue.length >= CONCURRENCY) await flush();
    if (scanned % 1000 === 0) console.log(`  ...scanned ${scanned}, generated ${generated}, failed ${failed}`);
  }
  await flush();

  console.log('---');
  console.log(`scanned:   ${scanned}`);
  console.log(`generated: ${generated}${APPLY ? '' : ' (dry run)'}`);
  console.log(`skipped (no source): ${skipped}`);
  console.log(`failed:    ${failed}`);
  await client.close();
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
