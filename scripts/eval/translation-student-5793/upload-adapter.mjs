#!/usr/bin/env node
// PRIOR ART: scripts/archive-artwork-originals.mjs (the plain S3Client → R2 put used across scripts/). Model weights
// have no home in R2 yet; this puts one adapter tarball under an unlisted key and checks whether the public image
// host will serve it (the bucket is fronted by images.sourcelibrary.org, so "private" must be checked, not assumed).
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local upload-adapter.mjs <adapter.tar.gz>
 * Prints the key and whether https://images.sourcelibrary.org/<key> answers.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error('usage: upload-adapter.mjs <adapter.tar.gz>');
const body = fs.readFileSync(file);
const sha = crypto.createHash('sha256').update(body).digest('hex');
const key = `private/models/translation-student-5793/${sha.slice(0, 16)}/adapter-qwen3-8b-lora.tar.gz`;
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: 'application/gzip',
  Metadata: { sha256: sha, issue: '5793', base: 'Qwen/Qwen3-8B' } }));
const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
const pub = await fetch(`https://images.sourcelibrary.org/${key}`, { method: 'HEAD' }).then((r) => r.status).catch((e) => `error ${e.message}`);
console.log(JSON.stringify({ bucket: process.env.R2_BUCKET_NAME, key, bytes: head.ContentLength, sha256: sha, public_host_status: pub }, null, 1));
