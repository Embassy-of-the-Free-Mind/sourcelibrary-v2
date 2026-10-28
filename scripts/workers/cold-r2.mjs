#!/usr/bin/env node
// PRIOR ART: scripts/eval/typed-refs-6012/lib.mjs putVerified() — the multipart upload + full read-back sha256
//   this follows, but it takes a FILE (a cold archive is a tar stream: writing it to the disk we are trying to
//   empty first is the failure we are fixing) and is pinned to its eval prefix and imports yauzl.
//   src/lib/storage.ts storagePut() — public image bucket, one PutObject. scripts/lib/candidate-reads.mjs —
//   small JSON objects in the same private bucket. None streams stdin. The client is built exactly as those are.
//
// Cold storage for idle job-host folders (#6223). Called by disk-steward.sh; installed beside it in /root/bin.
//   cold-r2.mjs put <key>                   stdin → R2 (multipart); prints {"key","bytes","sha256"}
//   cold-r2.mjs get <key> [--sum-to <file>] R2 → stdout; writes {"bytes","sha256"} of what it read to <file>
//   cold-r2.mjs put-json <key> <json>       a small manifest object beside the archive
//   cold-r2.mjs head <key> | rm <key>
// Bucket: sl-corpus-snapshots (private; nothing serves it publicly). Keys must start with cold/.
// The SDK is resolved from the checkout (DISK_STEWARD_SL, default /root/sourcelibrary), so this file runs from
// /root/bin, where node_modules does not exist.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SL = process.env.DISK_STEWARD_SL || '/root/sourcelibrary';
const require = createRequire(path.join(SL, 'package.json'));
const sdk = require('@aws-sdk/client-s3');
const BUCKET = process.env.COLD_R2_BUCKET || 'sl-corpus-snapshots';
const PART = 64 * 1024 * 1024;   // R2 wants every part but the last the same size
const CONCURRENCY = 4;           // parts in flight: 256 MB of buffers at most

for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[k]) { console.error(`cold-r2: ${k} is not set`); process.exit(2); }
}
const s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

const [cmd, key, ...rest] = process.argv.slice(2);
if (!key || !/^cold\/[A-Za-z0-9._~\/-]+$/.test(key) || key.includes('..')) { console.error(`cold-r2: bad key ${key}`); process.exit(2); }

async function put() {
  const h = createHash('sha256'); let bytes = 0;
  const { UploadId } = await s3.send(new sdk.CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: 'application/zstd' }));
  const parts = []; const inflight = new Set(); let n = 0;
  const send = (buf) => {
    const PartNumber = ++n;
    const p = (async () => {
      for (let attempt = 1; ; attempt++) {
        try { const r = await s3.send(new sdk.UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber, Body: buf })); parts.push({ PartNumber, ETag: r.ETag }); return; }
        catch (e) { if (attempt >= 4) throw e; await new Promise((res) => setTimeout(res, attempt * 5000)); }
      }
    })();
    inflight.add(p); all.push(p); p.finally(() => inflight.delete(p)).catch(() => {});
  };
  const all = [];  // every part, so a failure that settles between two awaits is still seen at the end
  try {
    let buf = Buffer.allocUnsafe(PART), fill = 0;
    for await (const chunk of process.stdin) {
      h.update(chunk); bytes += chunk.length;
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(PART - fill, chunk.length - off);
        chunk.copy(buf, fill, off, off + take); fill += take; off += take;
        if (fill === PART) {
          send(buf); buf = Buffer.allocUnsafe(PART); fill = 0;
          while (inflight.size >= CONCURRENCY) await Promise.race(inflight);
        }
      }
    }
    if (fill > 0 || n === 0) send(buf.subarray(0, fill));
    await Promise.all(all);
    if (parts.length !== n) throw new Error(`only ${parts.length} of ${n} parts uploaded`);
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await s3.send(new sdk.CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
  } catch (e) {
    await s3.send(new sdk.AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId })).catch(() => {});
    throw e;
  }
  console.log(JSON.stringify({ key, bytes, sha256: h.digest('hex') }));
}

async function get() {
  const i = rest.indexOf('--sum-to'); const sumTo = i >= 0 ? rest[i + 1] : null;
  const r = await s3.send(new sdk.GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of r.Body) {
    h.update(chunk); bytes += chunk.length;
    if (!process.stdout.write(chunk)) await new Promise((res) => process.stdout.once('drain', res));
  }
  await new Promise((res) => process.stdout.end(res));
  const out = JSON.stringify({ key, bytes, sha256: h.digest('hex') });
  if (sumTo) fs.writeFileSync(sumTo, out + '\n'); else console.error(out);
}

async function head() {
  try { const r = await s3.send(new sdk.HeadObjectCommand({ Bucket: BUCKET, Key: key })); console.log(JSON.stringify({ key, bytes: r.ContentLength })); }
  catch (e) { if (e?.$metadata?.httpStatus === 404 || e?.name === 'NotFound') { console.log('null'); process.exit(1); } throw e; }
}

try {
  if (cmd === 'put') await put();
  else if (cmd === 'get') await get();
  else if (cmd === 'head') await head();
  else if (cmd === 'rm') await s3.send(new sdk.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  else if (cmd === 'put-json') {
    JSON.parse(rest[0]);
    await s3.send(new sdk.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: rest[0], ContentType: 'application/json' }));
  } else { console.error(`cold-r2: unknown command ${cmd}`); process.exit(2); }
} catch (e) {
  if (e?.code === 'EPIPE') process.exit(141);
  console.error(`cold-r2 ${cmd} ${key}: ${e?.name || ''} ${e?.message || e}`); process.exit(1);
}
