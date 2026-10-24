#!/usr/bin/env node
// Upload the sign images and upsert one Mongo doc per glyph into `maya_signs` (#6903, #6921).
// Input: the output dir of build.py (signs.jsonl + img/). Idempotent: keys carry the image hash,
// docs upsert by _id. Dry run by default; --apply writes.
// Only images whose rights record a GRANTED permission go to R2 (public bucket). The rest are stored
// inside the Mongo doc (image.data) and get no public URL until their authors are asked.
//   node --env-file=.env.production.local scripts/learn/maya-signs/load-maya-signs.mjs <out-dir> [--apply]
import { readFileSync } from 'node:fs';
import { MongoClient, Binary } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { validateR2Key } from '../../lib/r2-key.mjs';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('usage: load-maya-signs.mjs <out-dir> [--apply]'); process.exit(2); }
const apply = flag === '--apply';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const recs = readFileSync(`${dir}/signs.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const bucket = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';

let uploaded = 0, present = 0;
for (const r of recs) {
  if (!r.image) continue;
  if (!r.rights.permission.startsWith('granted')) {
    r.image.data = new Binary(readFileSync(`${dir}/img/${r.image.file}`));
    delete r.image.key;
    continue;
  }
  validateR2Key(r.image.key, 'maya_signs');
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
const col = client.db('bookstore').collection('maya_signs');
const now = new Date();
const ops = recs.map(({ _id, ...doc }) => ({
  updateOne: { filter: { _id }, update: { $set: { ...doc, updated_at: now }, $setOnInsert: { created_at: now } }, upsert: true },
}));
const bySrc = recs.reduce((m, r) => ((m[`${r.source}/${r.kind}`] = (m[`${r.source}/${r.kind}`] || 0) + 1), m), {});
console.log(JSON.stringify(bySrc));
if (apply) {
  const res = await col.bulkWrite(ops, { ordered: false });
  await col.createIndex({ source: 1, kind: 1, value: 1 });
  await col.createIndex({ kind: 1, consonant: 1, vowel: 1 });
  console.log(`r2 uploaded=${uploaded} already=${present}; mongo upserted=${res.upsertedCount} modified=${res.modifiedCount} matched=${res.matchedCount}; total docs=${await col.countDocuments()}`);
} else console.log(`dry run: ${recs.length} docs, ${recs.filter((r) => r.image?.url).length} to R2, ${recs.filter((r) => r.image?.data).length} stored in Mongo; pass --apply to write`);
await client.close();
