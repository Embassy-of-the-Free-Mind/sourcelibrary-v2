#!/usr/bin/env node
// PRIOR ART: see archive-run.sh. One PutObject of a run archive to the R2 bucket; the key is validated with
// scripts/lib/r2-key.mjs like every other R2 write, and is ft-search-runs/<batch>.tgz (not a page image key).
//   node scripts/ft-search/archive-upload.mjs <file> <key>      # needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { validateR2Key } from '../lib/r2-key.mjs';

const [file, key] = process.argv.slice(2);
if (!file || !key) { console.error('usage: archive-upload.mjs <file> <key>'); process.exit(1); }
validateR2Key(key, 'ft-search archive');
if (!/^ft-search-runs\/[^/]+\.tgz$/.test(key)) { console.error(`refusing key outside ft-search-runs/: ${key}`); process.exit(1); }
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) { console.error('R2 env not set'); process.exit(2); }
const client = new S3Client({ region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
const Bucket = (process.env.R2_BUCKET_NAME || 'sourcelibrary-images').trim();
const Body = readFileSync(file);
await client.send(new PutObjectCommand({ Bucket, Key: key, Body, ContentType: 'application/gzip' }));
console.log(`uploaded ${Body.length} bytes to ${Bucket}/${key}`);
