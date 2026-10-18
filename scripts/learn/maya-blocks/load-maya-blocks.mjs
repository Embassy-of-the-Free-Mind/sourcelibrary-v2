#!/usr/bin/env node
// Upload the block crops and upsert one Mongo doc per reading entry into `maya_glyph_blocks` (#6903).
// Input: <work-dir>/out of build.py (blocks.jsonl + img/). Idempotent: keys carry the image hash, docs
// upsert by _id. Dry run by default; --apply writes. Entries with no crop (block broken off the drawing)
// are loaded too, with image: null and `dropped`, so the answer key is complete.
// Only images whose rights record a GRANTED permission go to R2 (public bucket).
//   node --env-file=.env.production.local scripts/learn/maya-blocks/load-maya-blocks.mjs <work-dir>/out [--apply]
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { validateR2Key } from '../../lib/r2-key.mjs';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('usage: load-maya-blocks.mjs <out-dir> [--apply]'); process.exit(2); }
const apply = flag === '--apply';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const recs = readFileSync(`${dir}/blocks.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const bucket = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';

let uploaded = 0, present = 0;
for (const r of recs) {
  if (!r.image) continue;
  if (!r.rights?.permission?.startsWith('granted')) throw new Error(`${r._id}: no granted permission, refusing to publish`);
  validateR2Key(r.image.key, 'maya_glyph_blocks');
  r.image.url = `${R2_PUBLIC}/${r.image.key}`;
  if (!apply) continue;
  try { await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: r.image.key })); present++; continue; } catch { /* not there yet */ }
  await r2.send(new PutObjectCommand({
    Bucket: bucket, Key: r.image.key, Body: readFileSync(`${dir}/img/${r.image.file}`),
    ContentType: 'image/png', CacheControl: 'public, max-age=31536000, immutable',
  }));
  uploaded++;
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const col = client.db('bookstore').collection('maya_glyph_blocks');
const now = new Date();
const ops = recs.map(({ _id, ...doc }) => ({
  updateOne: { filter: { _id }, update: { $set: { ...doc, updated_at: now }, $setOnInsert: { created_at: now } }, upsert: true },
}));
const byMon = recs.reduce((m, r) => ((m[r.monument] = (m[r.monument] || 0) + 1), m), {});
console.log(JSON.stringify(byMon));
if (apply) {
  const res = await col.bulkWrite(ops, { ordered: false });
  await col.createIndex({ monument: 1, coord: 1 });
  console.log(`r2 uploaded=${uploaded} already=${present}; mongo upserted=${res.upsertedCount} modified=${res.modifiedCount} matched=${res.matchedCount}`);
  // Read back: counts by monument, and fetch one public image.
  const agg = await col.aggregate([{ $group: { _id: '$monument', docs: { $sum: 1 }, with_image: { $sum: { $cond: [{ $ne: ['$image', null] }, 1, 0] } } } }, { $sort: { _id: 1 } }]).toArray();
  console.log('read back:', JSON.stringify(agg), 'total', await col.countDocuments());
  const one = await col.findOne({ 'image.url': { $exists: true } });
  const res2 = await fetch(one.image.url);
  const buf = Buffer.from(await res2.arrayBuffer());
  console.log(`fetched ${one.image.url}: ${res2.status} ${res2.headers.get('content-type')} ${buf.length} bytes, png=${buf.subarray(1, 4).toString() === 'PNG'}`);
} else console.log(`dry run: ${recs.length} docs, ${recs.filter((r) => r.image).length} images to R2; pass --apply to write`);
await client.close();
