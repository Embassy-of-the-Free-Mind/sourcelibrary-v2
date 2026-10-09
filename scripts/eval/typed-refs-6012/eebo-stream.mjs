#!/usr/bin/env node
// #6012 step 2, EEBO-TCP: the TCP's own bulk package is one 13.3 GB zip of a Dropbox folder, larger than
// this box's disk headroom. It is streamed straight into the private R2 bucket (multipart, sha256 taken
// in flight), then read back in full to prove the hash. Nothing touches the local disk.
//
// PRIOR ART: lib.mjs putVerified (needs a local file); #5488's join-tcp.js fetched single texts from the
// Phase I GitHub organisation, which has no Phase II.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/typed-refs-6012/eebo-stream.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET, keyOf, head, sha256Remote, UA, argOf } from './lib.mjs';

const URL_ = 'https://www.dropbox.com/sh/pfx619wnjdck2lj/AAAeQjd_dv29oPymNoKJWfEYa?dl=1';
const key = keyOf('raw/eebo-tcp/eebo_all.zip');
const OUT = argOf('out', '/data/scratch/sl/typed-refs-6012/eebo/raw.json');
const PART = 64 * 1024 * 1024;

if (await head(key) && !process.argv.includes('--force')) { console.log('already there:', key); process.exit(0); }
const res = await fetch(URL_, { headers: { 'user-agent': UA }, redirect: 'follow' });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const expected = Number(res.headers.get('content-length') || res.headers.get('original-content-length') || 0);
console.log('streaming', expected, 'bytes');
const { UploadId } = await r2().send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: 'application/zip',
  Metadata: { issue: '6012', source_url: URL_, retrieved_at: new Date().toISOString() } }));
const h = createHash('sha256'); const Parts = []; let bytes = 0, n = 1, buf = [], have = 0;
const send = async (b) => { const r = await r2().send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber: n, Body: b })); Parts.push({ PartNumber: n++, ETag: r.ETag }); if (n % 10 === 0) console.log('part', n - 1, (bytes / 1e9).toFixed(2), 'GB'); };
try {
  for await (const chunk of res.body) {
    h.update(chunk); bytes += chunk.length; buf.push(chunk); have += chunk.length;
    if (have >= PART) { const all = Buffer.concat(buf); await send(all.subarray(0, PART)); const rest = all.subarray(PART); buf = rest.length ? [Buffer.from(rest)] : []; have = rest.length; }
  }
  if (have) await send(Buffer.concat(buf));
  if (expected && bytes !== expected) throw new Error(`short read: ${bytes} of ${expected}`);
  await r2().send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts } }));
} catch (e) { await r2().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId })).catch(() => {}); throw e; }
const sha = h.digest('hex');
console.log('uploaded', bytes, sha, '— reading back');
const back = await sha256Remote(key);
if (back.sha256 !== sha || back.bytes !== bytes) throw new Error(`read-back mismatch ${back.sha256}/${back.bytes}`);
fs.writeFileSync(OUT, JSON.stringify({ key, bytes, sha256: sha, source_url: URL_, retrieved_at: new Date().toISOString(), verified: 'full read-back' }, null, 1));
console.log('verified', key);
