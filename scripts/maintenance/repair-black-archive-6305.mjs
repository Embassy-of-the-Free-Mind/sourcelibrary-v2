#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/rearchive-iiif-fullres.mjs — refetches a master and rebuilds the
// display variants, but only when the source is LARGER than what we hold; a black copy is the
// same size as its source and is skipped as "not-low-res". scripts/maintenance/rearchive-drifted-ia.mjs
// — clears `archived_photo` on every page of a book and waits for the archiver, which would unset
// the black copies before anything replaced them. scripts/audit/detect-fabricated-ocr.mjs measures
// ink for blank leaves, not a black frame. The R2 put, the version copy and the variant builder
// are imported, not rewritten.
/**
 * Replace the solid-black archive copies of the 12 CADAL Siku Quanshu volumes (#6305).
 *
 * Per page, in this order:
 *   1. read the R2 archive copy straight from the bucket (not the CDN) and measure it; a page
 *      that is not black (mean > 3 of 255) is left alone;
 *   2. fetch the page's own Internet Archive BookReader leaf (`photo_original`, else `photo`):
 *      the URL as stored, which is the leaf the stored OCR was read from (the OCR predates the
 *      archive on these books), so image and text stay the pair they were. Refused when the
 *      fetch fails or the source itself measures black or blank;
 *   3. build the display and thumbnail copies and refuse the page if either comes out black;
 *   4. copy the black objects to `versions/<key>.<ts>` (scripts/lib/r2-version.mjs), then write
 *      the three objects onto the SAME keys, so no page pointer changes;
 *   5. record size and source on the page (`archive_metadata.source: 'ia_bookreader_refetch'`,
 *      the old block under `archive_metadata.replaced`), one JSONL line per page in --log.
 * Serial, with a pause between Internet Archive fetches (three hosts blocked us in August 2026).
 * No model call. Resumable: a repaired page is no longer black.
 *
 *   node --env-file=.env.production.local scripts/maintenance/repair-black-archive-6305.mjs --log out.jsonl [--book <id>] [--limit N] [--apply]
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { preserveObjectVersion } from '../lib/r2-version.mjs';

/** The census of 2026-10-08 (#6305): black on all three sampled pages. */
export const BOOKS = [
  '6a05f0776a888f57ebd77176', '6a05f07e6a888f57ebd77205', '6a05f0836a888f57ebd7727e', '6a05f08d6a888f57ebd772f9',
  '6a1d60cdd274b9630ccf8ff4', '6a1d682cb764c55231287ca6', '6a1d6833b764c55231287d4d', '6a1d683bb764c55231287dd8',
  '6a1d684e013dfd9d9e18ed06', '6a3cc095f9474f825c1705be', '6a3cc099f9474f825c17087d', '6a3cc2bdaf74b230c6908ddd',
];
export const BLACK_MAX_MEAN = 3;
/** A source this dark or this flat is not a page scan we can vouch for. */
const SOURCE_MIN_MEAN = 30;

/** Mean pixel value over all channels, 0–255. */
export async function meanOf(buffer) {
  const s = await sharp(buffer).stats();
  return s.channels.reduce((n, c) => n + c.mean, 0) / s.channels.length;
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const APPLY = process.argv.includes('--apply');
  const LOG = arg('--log');
  if (!LOG) { console.error('--log <file.jsonl> is required'); process.exit(2); }
  const ONLY = arg('--book');
  const LIMIT = Number(arg('--limit', 'Infinity'));
  const PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
  const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
  const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const get = async (key) => Buffer.from(await (await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToByteArray());
  const put = (key, body) => r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  const toKey = (url) => (typeof url === 'string' && url.startsWith(`${PUBLIC}/`) ? url.slice(PUBLIC.length + 1) : null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const log = fs.createWriteStream(LOG, { flags: 'a' });
  const tally = {};
  let done = 0;
  try {
    for (const bookId of ONLY ? [ONLY] : BOOKS) {
      if (!BOOKS.includes(bookId)) throw new Error(`${bookId} is not one of the 12 census books`);
      const pages = await db.collection('pages').find({ book_id: bookId }, { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, display_photo: 1, thumbnail_blob: 1, image_thumb: 1, archive_metadata: 1, image_width: 1, image_height: 1 } }).sort({ page_number: 1 }).toArray();
      const t = {};
      for (const page of pages) {
        if (done >= LIMIT) break;
        const row = { book_id: bookId, page: page.page_number, id: page.id };
        const note = (status, extra = {}) => { Object.assign(row, { status, ...extra }); t[status] = (t[status] || 0) + 1; tally[status] = (tally[status] || 0) + 1; log.write(JSON.stringify(row) + '\n'); };
        const archivedKey = toKey(page.archived_photo);
        if (!archivedKey) { note('no_r2_archive'); continue; }
        assertBookScopedKey(archivedKey, bookId, 'repair-black-archive-6305');
        let held;
        try { held = await meanOf(await get(archivedKey)); } catch (e) { note('archive_unreadable', { why: String(e.message).slice(0, 80) }); continue; }
        row.held_mean = +held.toFixed(2);
        if (held > BLACK_MAX_MEAN) { note('not_black'); continue; }
        const src = page.photo_original || page.photo;
        if (!/^https:\/\/archive\.org\/download\/[^/]+\/page\/n\d+\//.test(String(src))) { note('refused_source_not_ia_leaf', { src }); continue; }
        let master;
        try {
          await sleep(700);
          const res = await fetch(src, { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) { note('refused_source_http', { http: res.status }); if (res.status === 429 || res.status === 403) throw new Error(`Internet Archive answered ${res.status}: stopping`); continue; }
          master = Buffer.from(await res.arrayBuffer());
        } catch (e) { if (/stopping/.test(e.message)) throw e; note('refused_source_fetch', { why: String(e.message).slice(0, 80) }); continue; }
        const meta = await sharp(master).metadata();
        const srcMean = await meanOf(master);
        Object.assign(row, { src_mean: +srcMean.toFixed(1), width: meta.width, height: meta.height, bytes: master.length, channels: meta.channels });
        if (srcMean < SOURCE_MIN_MEAN || !meta.width) { note('refused_source_dark'); continue; }
        const { display, thumb, displayWidth, displayHeight } = await generateDisplayVariants(master, { bookId, pageNumber: page.page_number });
        const dMean = await meanOf(display), tMean = await meanOf(thumb);
        if (dMean < SOURCE_MIN_MEAN || tMean < SOURCE_MIN_MEAN) { note('refused_variant_dark', { display_mean: dMean, thumb_mean: tMean }); continue; }
        done++;
        if (!APPLY) { note('would_repair'); continue; }
        const displayKey = toKey(page.display_photo), thumbKey = toKey(page.image_thumb) || toKey(page.thumbnail_blob);
        const versions = {};
        for (const [name, key] of [['archived', archivedKey], ['display', displayKey], ['thumb', thumbKey]]) {
          if (!key) continue;
          assertBookScopedKey(key, bookId, 'repair-black-archive-6305');
          versions[name] = await preserveObjectVersion(r2, BUCKET, key);
        }
        if (versions.archived === false) { note('refused_version_copy_failed'); continue; }
        await put(archivedKey, master);
        if (displayKey) await put(displayKey, display);
        if (thumbKey) await put(thumbKey, thumb);
        const now = new Date();
        await db.collection('pages').updateOne({ id: page.id, archived_photo: page.archived_photo }, { $set: {
          image_width: meta.width, image_height: meta.height,
          ...(displayWidth ? { display_width: displayWidth, display_height: displayHeight } : {}),
          archive_metadata: { archived_at: now, bytes: master.length, source: 'ia_bookreader_refetch', issue: 6305, replaced: page.archive_metadata ?? null, versions },
          updated_at: now,
        } });
        note('repaired', { versions });
      }
      console.log(`${bookId} ${JSON.stringify(t)}`);
      if (APPLY && t.repaired) await db.collection('books').updateOne({ id: bookId }, { $set: { updated_at: new Date() } });
      if (done >= LIMIT) break;
    }
  } finally {
    await new Promise((r) => log.end(r));
    await client.close();
  }
  console.log(JSON.stringify(tally), APPLY ? '' : 'DRY RUN');
}
