#!/usr/bin/env node
/**
 * Remove deep-zoom from book pages whose best illustration is below the gallery_quality
 * bar (#2411). Deep-zoom is for high-quality illustrations only; the first tiler pass ran
 * unfiltered, so some sub-bar pages got a manifest + tiles. This unsets the `deepzoom`
 * manifest (removes the reader button) and deletes the page's tile pyramid from R2.
 *
 * Leaves `fullres_master` in place — only deep-zoom display is gated, and re-tiling later
 * at a different bar shouldn't re-fetch the master.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/deepzoom-untile-below-quality.mjs [--min-gallery-quality 0.7] [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const MIN_Q = parseFloat(arg('--min-gallery-quality', '0.7'));
const DRY_RUN = process.argv.includes('--dry-run');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function deletePrefix(prefix) {
  let token;
  let deleted = 0;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: `${prefix}/`, ContinuationToken: token })
    );
    const objs = (list.Contents || []).map((o) => ({ Key: o.Key }));
    if (objs.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET_NAME, Delete: { Objects: objs } }));
      deleted += objs.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const gallery = db.collection('gallery_images');

const tiled = await pages
  .find({ deepzoom: { $exists: true } }, { projection: { book_id: 1, page_number: 1, 'deepzoom.prefix': 1 } })
  .toArray();
console.log(`Tiled pages: ${tiled.length}. Checking against gallery_quality ≥ ${MIN_Q}…`);

// Best gallery_quality per (book, page) for the tiled set.
const bookIds = [...new Set(tiled.map((t) => t.book_id))];
const rows = await gallery
  .aggregate([
    { $match: { book_id: { $in: bookIds } } },
    { $group: { _id: { b: '$book_id', p: '$page_number' }, maxq: { $max: '$gallery_quality' } } },
  ])
  .toArray();
const bestQ = new Map();
for (const r of rows) bestQ.set(`${r._id.b}:${r._id.p}`, r.maxq ?? 0);

const below = tiled.filter((t) => (bestQ.get(`${t.book_id}:${t.page_number}`) ?? 0) < MIN_Q);
console.log(`${below.length} tiled page(s) are below the bar → ${DRY_RUN ? 'would remove' : 'removing'} deep-zoom.`);

let tilesDeleted = 0;
for (const p of below) {
  const prefix = p.deepzoom?.prefix || `deepzoom/page/${p.book_id}/${p.page_number}`;
  if (DRY_RUN) {
    console.log(`  [dry] ${p.book_id}/${p.page_number} (q=${(bestQ.get(`${p.book_id}:${p.page_number}`) ?? 0).toFixed(2)})`);
    continue;
  }
  tilesDeleted += await deletePrefix(prefix);
  await pages.updateOne({ _id: p._id }, { $unset: { deepzoom: '' } });
}
await client.close();
console.log(`\nDone. ${DRY_RUN ? '(dry-run)' : `Removed deep-zoom from ${below.length} pages, deleted ${tilesDeleted} tiles.`}`);
