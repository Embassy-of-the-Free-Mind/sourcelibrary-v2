#!/usr/bin/env node
/**
 * Repoint page image fields that still store a Vercel Blob URL to R2 (#3645).
 *
 * PRIOR ART: scripts/maintenance/restore-blob-only-page-images.mjs (#4030) —
 * copies Blob-only objects for pages that already point at R2; it writes no
 * Mongo and handles only `archived/<book>/<n>.jpg`. repoint-blob-to-r2*.mjs —
 * the Feb 2026 bulk repoint, which assumed the R2 copy existed and checked
 * nothing. This one handles the residue both left behind: page docs whose
 * `archived_photo` / `cropped_photo` / thumb fields still hold a
 * `*.blob.vercel-storage.com` URL (79 pages measured 2026-10-06 by an exact
 * scan; the gate in verify-blob-residue-in-r2.mjs cannot see them because it
 * reasons from R2 keys, not from page docs).
 *
 * For each Blob URL on a page:
 *   1. key = the URL path; assertBookScopedKey(key, page.book_id) — refuse otherwise
 *   2. if R2 lacks the key: download from Blob, PUT to R2 with the same key
 *   3. require R2 ETag === Blob ETag (both are content MD5) — refuse otherwise
 *   4. GET https://images.sourcelibrary.org/<key> and require 200 + an image body
 *   5. only then $set the field to the R2 URL, conditional on it still
 *      holding the Blob URL (another writer may have moved it since)
 *
 * Writes nothing but those fields. Never deletes anything.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repoint-blob-url-pages.mjs [--ids <file>] [--apply]
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const APPLY = process.argv.includes('--apply');
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const FIELDS = ['photo', 'archived_photo', 'display_photo', 'photo_original', 'cropped_photo',
  'enhanced_photo', 'thumbnail_blob', 'image_thumb', 'thumbnail'];
const BLOB_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/(.+)$/;

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const md5 = (b) => createHash('md5').update(b).digest('hex');
const unq = (e) => (e || '').replace(/"/g, '');

async function r2Etag(key) {
  try { return unq((await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).ETag); }
  catch (e) { if (e?.$metadata?.httpStatusCode === 404) return null; throw e; }
}

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const pages = mc.db('bookstore').collection('pages');

// --ids <file>: page _ids (one per line) from an earlier scan; the full scan takes ~25 min.
const idsArg = process.argv.indexOf('--ids');
const idFilter = idsArg > -1
  ? { _id: { $in: readFileSync(process.argv[idsArg + 1], 'utf8').split('\n').filter(Boolean)
      .flatMap(s => (ObjectId.isValid(s) && s.length === 24 ? [s, new ObjectId(s)] : [s])) } }
  : {};
const docs = await pages.find(
  { ...idFilter, $or: FIELDS.map(f => ({ [f]: /vercel-storage\.com/ })) },
  { projection: Object.fromEntries([...FIELDS, 'book_id', 'page_number'].map(f => [f, 1])), maxTimeMS: 3_600_000 },
).toArray();
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${docs.length} page(s) hold a Blob URL`);

const verified = new Map(); // key -> md5 already proven on R2 + CDN
const stats = { copied: 0, alreadyInR2: 0, repointed: 0, refused: 0, raced: 0 };

for (const p of docs) {
  const set = {}, expect = {};
  for (const f of FIELDS) {
    const m = typeof p[f] === 'string' && p[f].match(BLOB_RE);
    if (!m) continue;
    const key = decodeURIComponent(m[1]);
    try {
      assertBookScopedKey(key, p.book_id, `repoint ${p._id}.${f}`);
      if (!verified.has(key)) {
        const blob = await fetch(p[f], { signal: AbortSignal.timeout(60_000) });
        if (!blob.ok) throw new Error(`blob GET ${blob.status}`);
        const body = Buffer.from(await blob.arrayBuffer());
        const sum = md5(body);
        if (sum !== unq(blob.headers.get('etag'))) throw new Error('blob body md5 != blob etag');
        let have = await r2Etag(key);
        if (have === null) {
          if (APPLY) {
            await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body,
              ContentType: blob.headers.get('content-type') || 'image/jpeg',
              CacheControl: 'public, max-age=86400, s-maxage=86400' }));
            have = await r2Etag(key);
          }
          stats.copied++;
          console.log(`  copy   ${key} (${body.length} B)`);
        } else stats.alreadyInR2++;
        if (APPLY || have !== null) {
          if (have !== sum) throw new Error(`R2 etag ${have} != blob md5 ${sum}`);
          // The R2 ETag above proves the stored bytes. The public host does NOT
          // serve them verbatim (the edge re-encodes: an 843 KB object came back
          // as 477 KB, stable across requests), so here we prove only that a
          // reader gets an image.
          const cdn = await fetch(`${R2_PUBLIC}/${key}`, { signal: AbortSignal.timeout(60_000) });
          const len = cdn.ok ? (await cdn.arrayBuffer()).byteLength : 0;
          if (!cdn.ok || !/^image\//.test(cdn.headers.get('content-type') || '') || len < 1000) {
            throw new Error(`CDN GET ${cdn.status} ${cdn.headers.get('content-type')} ${len} B`);
          }
        }
        verified.set(key, sum);
      }
      set[f] = `${R2_PUBLIC}/${key}`;
      expect[f] = p[f];
    } catch (e) {
      stats.refused++;
      console.warn(`  REFUSE ${p._id}.${f}: ${e.message}`);
    }
  }
  if (!Object.keys(set).length) continue;
  console.log(`  page ${p.book_id} #${p.page_number}: ${Object.keys(set).join(', ')}`);
  if (APPLY) {
    const r = await pages.updateOne({ _id: p._id, ...expect }, { $set: set });
    if (r.modifiedCount) stats.repointed++; else stats.raced++;
  }
}
console.log(stats);
await mc.close();
