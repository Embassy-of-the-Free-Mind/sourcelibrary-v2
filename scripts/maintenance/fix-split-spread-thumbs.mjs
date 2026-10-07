#!/usr/bin/env node
/**
 * Regenerate thumbnails for split-spread pages whose thumb shows the WHOLE
 * two-page spread instead of the page's own half.
 *
 * Cause: fix-fullres-page-thumbs.mjs (#2381) swapped `NNNN-full.jpg` thumb
 * fields to the `NNNN-thumb.jpg` sibling, assuming the two were sizes of the
 * same image. For legacy BPH split halves they are not: `-full.jpg` is the
 * cropped half, but `-thumb.jpg` was generated from the uncropped spread. So
 * the filmstrip shows a spread while the main viewer shows the single page
 * (e.g. several-small-works-on-alchemy-anonymous p13).
 *
 * Detection is by image shape, not URL: a page with a `crop` whose thumb is
 * landscape while its displayed source (cropped_photo) is portrait. Only
 * those pages are touched. A fresh 150px thumb is cut from the page's own
 * source, uploaded to a new key (pages/{book}/gen-{pageId}-thumb.jpg, same
 * convention as generate-missing-page-thumbs.mjs), and image_thumb +
 * thumbnail_blob are repointed. Old values are printed for reversal.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-split-spread-thumbs.mjs --book <bookId>          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/fix-split-spread-thumbs.mjs --book <bookId> --apply
 *   node --env-file=.env.production.local scripts/maintenance/fix-split-spread-thumbs.mjs --books-file ids.json --apply
 *     (ids.json: array of book ids, or of objects with an `id`)
 * With --apply, each book that changed is revalidated via
 * POST /api/admin/revalidate-book/<bookId> (needs CRON_SECRET).
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const APPLY = process.argv.includes('--apply');
const bookIdx = process.argv.indexOf('--book');
const BOOK_ID = bookIdx !== -1 ? process.argv[bookIdx + 1] : null;
const fileIdx = process.argv.indexOf('--books-file');
const BOOK_IDS = fileIdx !== -1
  ? JSON.parse(readFileSync(process.argv[fileIdx + 1], 'utf8')).map(b => (typeof b === 'string' ? b : b.id))
  : BOOK_ID ? [BOOK_ID] : [];
const CONCURRENCY = 8;
const SITE = process.env.SITE_URL || 'https://sourcelibrary.org';
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

async function fetchBuf(url, range) {
  const resp = await fetch(url, { headers: range ? { Range: 'bytes=0-131071' } : {}, signal: AbortSignal.timeout(45000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

// Read dimensions from the JPEG header without downloading the whole file.
async function dims(url) {
  const meta = await sharp(await fetchBuf(url, true), { failOn: 'none' }).metadata();
  return { w: meta.width, h: meta.height };
}

async function fixPage(pages, p) {
  const thumb = p.image_thumb || p.thumbnail_blob;
  if (!thumb || !p.cropped_photo) return 'skip';
  const [t, s] = await Promise.all([dims(thumb), dims(p.cropped_photo)]);
  if (!(t.w > t.h && s.h > s.w)) return 'skip';
  console.log(`  ${p.book_id} p${p.page_number}: thumb ${t.w}x${t.h} vs page ${s.w}x${s.h}  old=${thumb}`);
  if (!APPLY) return 'fixed';
  const buf = await sharp(await fetchBuf(p.cropped_photo)).rotate().resize(THUMB_WIDTH).jpeg({ quality: THUMB_QUALITY }).toBuffer();
  const key = `pages/${p.book_id}/gen-${p.id}-thumb.jpg`;
  assertBookScopedKey(key, p.book_id, 'fix-split-spread-thumbs');
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=604800, s-maxage=604800',
  }));
  const url = `${R2_PUBLIC_URL}/${key}`;
  await pages.updateOne({ _id: p._id }, { $set: { image_thumb: url, thumbnail_blob: url, updated_at: new Date() } });
  return 'fixed';
}

async function revalidate(bookId) {
  const resp = await fetch(`${SITE}/api/admin/revalidate-book/${bookId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`revalidate HTTP ${resp.status}`);
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  if (!BOOK_IDS.length) { console.error('Pass --book <id> or --books-file <json>.'); process.exit(1); }
  if (APPLY && !r2) { console.error('R2 creds required for --apply.'); process.exit(1); }
  if (APPLY && !process.env.CRON_SECRET) { console.error('CRON_SECRET required for --apply (revalidation).'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const pages = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  books: ${BOOK_IDS.length}`);
  let total = 0, failed = 0, n = 0;
  for (const bookId of BOOK_IDS) {
    n++;
    const docs = await pages.find(
      // Only the swapped `/pages/{book}/NNNN-thumb.jpg` sibling can carry this bug;
      // gen-*/cropped thumbs were cut from the half and are skipped without a fetch.
      { book_id: bookId, crop: { $exists: true }, image_thumb: { $regex: '/pages/[^/]+/\\d+-thumb\\.jpg$' } },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, cropped_photo: 1, image_thumb: 1, thumbnail_blob: 1 } },
    ).sort({ page_number: 1 }).toArray();
    let fixed = 0;
    for (let i = 0; i < docs.length; i += CONCURRENCY) {
      const res = await Promise.all(docs.slice(i, i + CONCURRENCY).map(p => fixPage(pages, p).catch(e => {
        failed++;
        console.log(`  FAIL ${bookId} p${p.page_number}: ${e.message}`);
        return 'fail';
      })));
      fixed += res.filter(r => r === 'fixed').length;
    }
    total += fixed;
    if (APPLY && fixed) {
      try { await revalidate(bookId); } catch (e) { failed++; console.log(`  FAIL revalidate ${bookId}: ${e.message}`); }
    }
    console.log(`[${n}/${BOOK_IDS.length}] ${bookId}: ${APPLY ? 'fixed' : 'would fix'} ${fixed}  (running total ${total}, failures ${failed})`);
  }
  console.log(`---\n${APPLY ? 'fixed' : 'would fix'}: ${total}  failed: ${failed}`);
  await client.close();
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
