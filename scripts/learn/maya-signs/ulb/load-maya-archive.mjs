#!/usr/bin/env node
// Upload the ULB Bonn archive images and upsert one doc per ULB record into `maya_archive` (#6985).
// PRIOR ART: ../load-maya-signs.mjs — same rule: only images whose rights record a GRANTED licence go to
// the public bucket; anything else is recorded without an image.
// Input: the output dir of build.py (archive.jsonl + img/). Idempotent (hash-keyed R2 keys, upsert by _id).
//   node --env-file=.env.production.local scripts/learn/maya-signs/ulb/load-maya-archive.mjs <out-dir> [--apply]
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { validateR2Key } from '../../../lib/r2-key.mjs';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('usage: load-maya-archive.mjs <out-dir> [--apply]'); process.exit(2); }
const apply = flag === '--apply';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const recs = readFileSync(`${dir}/archive.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const bucket = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';

let uploaded = 0, present = 0, withheld = 0;
for (const r of recs) {
  if (!r.image) continue;
  if (!r.rights?.permission?.startsWith('granted')) { delete r.image; withheld++; continue; }
  validateR2Key(r.image.key, 'maya_archive');
  r.image.url = `${R2_PUBLIC}/${r.image.key}`;
  if (!apply) continue;
  try { await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: r.image.key })); present++; continue; } catch { /* not there yet */ }
  await r2.send(new PutObjectCommand({
    Bucket: bucket, Key: r.image.key, Body: readFileSync(`${dir}/img/${r.image.file}`),
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
  }));
  uploaded++;
}

console.log(JSON.stringify(recs.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {})));
if (!apply) {
  console.log(`dry run: ${recs.length} docs, ${recs.filter((r) => r.image?.url).length} images to R2, ${withheld} withheld; pass --apply to write`);
  process.exit(0);
}
const client = await MongoClient.connect(process.env.MONGODB_URI);
const col = client.db('bookstore').collection('maya_archive');
const now = new Date();
const res = await col.bulkWrite(recs.map(({ _id, ...doc }) => ({
  updateOne: { filter: { _id }, update: { $set: { ...doc, updated_at: now }, $setOnInsert: { created_at: now } }, upsert: true },
})), { ordered: false });
await col.createIndex({ kind: 1, title: 1 });
await col.createIndex({ artifact: 1 });
console.log(`r2 uploaded=${uploaded} already=${present} withheld=${withheld}; mongo upserted=${res.upsertedCount} modified=${res.modifiedCount}; total docs=${await col.countDocuments()}`);
await client.close();
