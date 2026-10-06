#!/usr/bin/env node
/**
 * Delete Vercel Blob objects that are VERIFIED byte-identical in R2 (#3645).
 *
 * PRIOR ART: scripts/maintenance/verify-blob-residue-in-r2.mjs — the gate; it
 * never deletes and compares SIZE only. This script consumes its
 * `safe-to-delete.tsv` and adds the content check it lacks.
 * scripts/maintenance/restore-blob-only-page-images.mjs (#4030) — restores the
 * Blob-only objects a live page references; that is the precondition for this one.
 *
 * Equal size is not equal bytes. Before deleting each object this script
 * re-reads BOTH sides at delete time and requires:
 *
 *   Blob ETag (= MD5 of the content, measured 2026-10-06 by hashing a download)
 *     === R2 ETag (= MD5 for a single-part upload; multipart ETags are refused)
 *   and equal Content-Length on both sides.
 *
 * Anything else is skipped and logged as `skip:<reason>`. Never deleted:
 * objects of deleted books, pages past pages_count, size mismatches. None of
 * those are in `safe-to-delete.tsv`, and the R2 re-check would refuse them anyway.
 *
 * Every deleted object gets one ledger line:
 *   blob_key  r2_key  md5  bytes  iso_time
 *
 * Usage (on Hetzner, from the repo root):
 *   node --env-file=.env.production.local scripts/maintenance/delete-verified-blob-residue.mjs \
 *     --safe <dir>/safe-to-delete.tsv --ledger <dir>/ledger.tsv [--batch 50000] [--limit N] [--apply]
 *
 * Dry run by default: it verifies and reports, and deletes nothing. Resumable:
 * keys already in the ledger are skipped.
 */

import { del } from '@vercel/blob';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { appendFileSync, existsSync, readFileSync, createReadStream } from 'fs';
import readline from 'readline';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SAFE = arg('--safe');
const LEDGER = arg('--ledger');
const BATCH = Math.min(parseInt(arg('--batch', '50000'), 10), 50000);
const LIMIT = parseInt(arg('--limit', '0'), 10) || Infinity;
const APPLY = process.argv.includes('--apply');
const CONCURRENCY = parseInt(arg('--concurrency', '32'), 10);
// The store's public base URL, e.g. https://<store>.public.blob.vercel-storage.com
const BLOB_BASE = arg('--blob-base', 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com');

if (!SAFE || !LEDGER) { console.error('need --safe and --ledger'); process.exit(1); }

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const unq = (e) => (e || '').replace(/"/g, '');

async function retry(fn, n = 5) {
  for (let a = 0; ; a++) {
    try { return await fn(); } catch (e) { if (a >= n) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** a)); }
  }
}

async function verify(key) {
  const url = `${BLOB_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const b = await retry(async () => {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`blob HEAD ${r.status}`);
    return { etag: unq(r.headers.get('etag')), size: Number(r.headers.get('content-length')) };
  });
  if (!b) return { ok: false, why: 'blob-gone' };
  let o;
  try {
    o = await retry(() => r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })));
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404) return { ok: false, why: 'r2-missing' };
    throw e;
  }
  const re = unq(o.ETag);
  if (re.includes('-')) return { ok: false, why: 'r2-multipart-etag' };
  if (!/^[0-9a-f]{32}$/.test(b.etag)) return { ok: false, why: 'blob-etag-not-md5' };
  if (o.ContentLength !== b.size) return { ok: false, why: 'size-differs' };
  if (re !== b.etag) return { ok: false, why: 'md5-differs' };
  return { ok: true, url, md5: re, size: b.size };
}

async function main() {
  const done = new Set();
  if (existsSync(LEDGER)) for (const l of readFileSync(LEDGER, 'utf8').split('\n')) if (l) done.add(l.split('\t')[0]);
  log(`${APPLY ? 'APPLY' : 'DRY RUN'} safe=${SAFE} ledger=${LEDGER} (${done.size} already deleted) batch=${BATCH}`);

  const rl = readline.createInterface({ input: createReadStream(SAFE) });
  let queue = [], seen = 0, deleted = 0, bytes = 0, batchNo = 0;
  const skips = {};

  async function flush() {
    if (!queue.length) return;
    batchNo++;
    const verified = [];
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const res = await Promise.all(queue.slice(i, i + CONCURRENCY).map(async (k) => ({ k, v: await verify(k) })));
      for (const { k, v } of res) {
        if (v.ok) verified.push({ k, ...v });
        else { skips[v.why] = (skips[v.why] || 0) + 1; appendFileSync(`${LEDGER}.skips`, `${k}\tskip:${v.why}\n`); }
      }
    }
    if (APPLY) {
      for (let i = 0; i < verified.length; i += 500) {
        const chunk = verified.slice(i, i + 500);
        await retry(() => del(chunk.map(x => x.url)));
        const t = new Date().toISOString();
        appendFileSync(LEDGER, chunk.map(x => `${x.k}\t${x.k}\t${x.md5}\t${x.size}\t${t}\n`).join(''));
        deleted += chunk.length; bytes += chunk.reduce((s, x) => s + x.size, 0);
      }
    } else {
      deleted += verified.length; bytes += verified.reduce((s, x) => s + x.size, 0);
    }
    log(`batch ${batchNo}: ${queue.length} checked, ${verified.length} ${APPLY ? 'deleted' : 'would delete'}; ` +
        `total ${deleted.toLocaleString()} (${(bytes / 1e9).toFixed(1)} GB); skips ${JSON.stringify(skips)}`);
    queue = [];
  }

  for await (const line of rl) {
    if (!line) continue;
    const key = line.split('\t')[0];
    if (done.has(key)) continue;
    if (key.startsWith('archived/undefined/')) { skips.undefined = (skips.undefined || 0) + 1; continue; }
    queue.push(key); seen++;
    if (queue.length >= BATCH) await flush();
    if (seen >= LIMIT) break;
  }
  await flush();
  log(`done: ${deleted.toLocaleString()} ${APPLY ? 'deleted' : 'verifiable'} (${(bytes / 1e9).toFixed(1)} GB); skips ${JSON.stringify(skips)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
