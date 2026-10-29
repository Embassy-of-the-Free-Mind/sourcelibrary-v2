#!/usr/bin/env node
/**
 * Cold copy of R2 (and the restic repo) to an archive-class bucket — Scaleway
 * Glacier for EFM/BPH, AWS S3 Glacier Deep Archive for the rest — one tar per
 * book, with a manifest beside each tar (#7708).
 *
 * PRIOR ART: scripts/maintenance/build-preservation-manifest.mjs — lists a
 * book's objects across the eleven prefix conventions and records size + ETag,
 * but moves no bytes ("the deliverable even if no bytes ever move"). This is the
 * script that moves them. BOOK_PREFIXES below is that script's list.
 *
 * WHY: 21.7 TB of page images had exactly one copy, in R2. Tier-0 masters (BPH
 * `archive/` JP2s, Kloss/IDP `books/`, `uploads/`) exist nowhere else. Deep
 * Archive is a different company from Cloudflare and Hetzner, ~$1/TB-month.
 *
 * WHY TAR PER BOOK: Deep Archive bills per request ($0.05 per 1,000 PUTs) and
 * keeps ~40 KB of overhead per object. 14M page images as 14M objects would
 * cost more in requests than a year of storage; one tar per book prefix keeps
 * it in the tens of thousands. A restore is per book anyway.
 *
 * LAYOUT in the cold bucket
 *   r2/<prefix>/<bookId>.tar                 every object under R2 `<prefix>/<bookId>/`
 *   r2/<prefix>/_flat[-<filter>]/<hh>.tar    objects directly under a flat prefix (artwork/), hash-sharded
 *   restic/<dir>.tar                         the restic repo on Hetzner, per pack directory
 *   bph_works/<YYYY-MM-DD>.tar               export of the BPH catalogue (backup-bph-catalog.mjs)
 *   <any>.tar.manifest.json                  STANDARD class, readable without a restore:
 *       { dest, source, tar_bytes, tar_sha256, fingerprint,
 *         objects: [{ key, size, etag, last_modified, sha256, tar_offset }] }
 * Tar members are named by their full source key. Plain POSIX ustar (+pax for
 * long names), so `tar -x` restores it with no tooling of ours.
 *
 * RESUMABLE + AUDITABLE
 *   A JSONL ledger (--ledger) gets one line per unit: done / empty / failed.
 *   A unit is skipped when the ledger, or else the manifest already in the bucket,
 *   carries the same FINGERPRINT — sha256 over the sorted "key size etag" of the
 *   source listing. A book that gained or changed a page is re-sent; nothing in
 *   the cold bucket is ever deleted by this script.
 *   Each object is read with If-Match on its listed ETag, its MD5 is checked
 *   against a non-multipart ETag, and its SHA-256 goes in the manifest. After
 *   upload the tar is HEADed: size must match and StorageClass must be the target's.
 *   The bucket has Object Lock (governance, 10 years); this script never deletes.
 *
 * GROUPS, in the order #7708 asks for (`--group all` runs them in this order):
 *   efm-archive    R2 archive/ — the BPH JP2 partner masters
 *   efm-books      every other prefix of books with image_source.provider = 'bph'
 *   efm-bph-works  a fresh bph_works export, tarred, plus R2 bph-backups/ and bph-editor-help/
 *   masters        books/ uploads/ page-masters/ masters/ and artwork/ *-full*
 *   restic         the restic repository (Hetzner Object Storage)
 *   rest           every other R2 prefix (units already sent above are skipped)
 *
 * USAGE (from the repo root; R2 + Mongo from .env.production.local)
 *   node --env-file=.env.production.local scripts/maintenance/cold-copy-r2.mjs --group efm-archive --estimate
 *   … --group efm-books --dry-run --limit 3 --out /root/jobs/cold-copy/dry   (writes tars locally, no AWS)
 *   … --group efm-archive --apply [--concurrency 4] [--limit N] [--units archive/<id>/,…]
 * Flags: --ledger <jsonl> (default /root/jobs/cold-copy/ledger.jsonl)
 *        --concurrency N (units in parallel, default 4) --prefetch N (GETs ahead per unit, default 16)
 *        --target scw|aws  per-group default: efm-* and restic → scw, masters and rest → aws.
 *          efm-* refuses aws (the BPH agreement: partner masters stay with an EU company).
 *          scw → /root/.config/cold-scw.env, aws → /root/.config/cold-aws.env (--cold-env overrides):
 *          AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, COLD_BUCKET, and optionally
 *          COLD_ENDPOINT (Scaleway) and COLD_STORAGE_CLASS (default DEEP_ARCHIVE; Scaleway: GLACIER).
 *          Read from the FILE, never the process env: restic-hetzner.env exports AWS_* for a
 *          different store.
 *        --restic-env <file> (default /root/.config/restic-hetzner.env)
 *
 * Read-only on R2, Mongo, Supabase and the restic repo. Writes only to the cold
 * bucket, the ledger, and --out.
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync,
  readdirSync, statSync, rmSync, mkdtempSync } from 'fs';
import { dirname, join, relative } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const GROUP = arg('--group');
const MODE = has('--apply') ? 'apply' : has('--dry-run') ? 'dry-run' : has('--estimate') ? 'estimate' : null;
const LIMIT = parseInt(arg('--limit', '0')) || 0;
const CONC = parseInt(arg('--concurrency', MODE === 'estimate' ? '24' : '4')) || 4;
const ONLY_UNITS = arg('--units') ? new Set(arg('--units').split(',')) : null;
const LEDGER = arg('--ledger', '/root/jobs/cold-copy/ledger.jsonl');
const OUT = arg('--out', '/root/jobs/cold-copy/dry');
// Where each group goes (Derek, #7708, 2026-10-29): EFM/BPH material and the
// database/text backups to Scaleway Glacier (an EU company — the BPH agreement);
// the ~21 TB of re-fetchable images to AWS Deep Archive. EFM never goes to AWS.
const TARGET_ENV = { scw: '/root/.config/cold-scw.env', aws: '/root/.config/cold-aws.env' };
const DEFAULT_TARGET = { 'efm-archive': 'scw', 'efm-books': 'scw', 'efm-bph-works': 'scw', restic: 'scw', masters: 'aws', rest: 'aws' };
const TARGET_ARG = arg('--target');
const COLD_ENV_ARG = arg('--cold-env');
const RESTIC_ENV = arg('--restic-env', '/root/.config/restic-hetzner.env');
const PART = 64 * 1024 * 1024;           // multipart part size
const FLAT_SHARD_MIN = 5000;             // flat prefixes above this are split into 64 hash shards
const ORDER = ['efm-archive', 'efm-books', 'efm-bph-works', 'masters', 'restic', 'rest'];
if (!GROUP || !(GROUP === 'all' || ORDER.includes(GROUP)) || !MODE || (TARGET_ARG && !TARGET_ENV[TARGET_ARG])) {
  console.error(`usage: cold-copy-r2.mjs --group <${ORDER.join('|')}|all> --estimate|--dry-run|--apply [--target scw|aws] [--limit N] [--units a,b] [--concurrency N]`);
  process.exit(2);
}
function targetFor(group) {
  const t = TARGET_ARG || DEFAULT_TARGET[group];
  if (group.startsWith('efm-') && t !== 'scw') throw new Error(`${group} goes to Scaleway only (BPH agreement, #7708) — not ${t}`);
  return t;
}

// ── clients ──────────────────────────────────────────────────────────────────
function readEnvFile(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const R2 = {
  label: 'r2',
  bucket: process.env.R2_BUCKET_NAME,
  client: new S3Client({
    region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  }),
};
if (!R2.bucket || !process.env.R2_ACCOUNT_ID) { console.error('R2_* env missing — run with --env-file=.env.production.local'); process.exit(2); }

let RESTIC = null;
function resticSource() {
  if (RESTIC) return RESTIC;
  const e = readEnvFile(RESTIC_ENV);
  const u = new URL(e.RESTIC_REPOSITORY.replace(/^s3:/, ''));
  const [bucket, ...rest] = u.pathname.replace(/^\//, '').split('/');
  RESTIC = {
    label: 'restic', bucket, root: rest.filter(Boolean).join('/'),
    client: new S3Client({
      region: e.AWS_DEFAULT_REGION || 'us-east-1', endpoint: u.origin, forcePathStyle: true,
      credentials: { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY },
    }),
  };
  return RESTIC;
}

const COLDS = {};
let TARGET = null; // set per group by runGroup()
function coldDest() {
  if (COLDS[TARGET]) return COLDS[TARGET];
  const file = COLD_ENV_ARG || TARGET_ENV[TARGET];
  if (!existsSync(file)) throw new Error(`${file} not found — the ${TARGET} cold bucket and its key do not exist yet (#7708)`);
  const e = readEnvFile(file);
  for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'COLD_BUCKET', 'AWS_REGION']) {
    if (!e[k]) throw new Error(`${file} lacks ${k}`);
  }
  COLDS[TARGET] = {
    target: TARGET, bucket: e.COLD_BUCKET, storageClass: e.COLD_STORAGE_CLASS || 'DEEP_ARCHIVE',
    client: new S3Client({
      region: e.AWS_REGION, ...(e.COLD_ENDPOINT ? { endpoint: e.COLD_ENDPOINT } : {}),
      credentials: { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY },
    }),
  };
  return COLDS[TARGET];
}

// ── listing ──────────────────────────────────────────────────────────────────
async function listAll(src, prefix, delimiter) {
  const objects = [], prefixes = [];
  let token;
  do {
    const r = await src.client.send(new ListObjectsV2Command({ Bucket: src.bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token }));
    for (const o of r.Contents || []) objects.push({ key: o.Key, size: o.Size, etag: o.ETag, last_modified: o.LastModified?.toISOString() });
    for (const p of r.CommonPrefixes || []) prefixes.push(p.Prefix);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return { objects, prefixes };
}

// Array.push(...xs) overflows the stack past ~100K items (archived/ has ~500K book folders).
const pushAll = (arr, xs) => { for (const x of xs) arr.push(x); return arr; };
const shardOf = (key) => (parseInt(createHash('md5').update(key).digest('hex').slice(0, 2), 16) % 64).toString(16).padStart(2, '0');

/**
 * Units under one source prefix: one per first-level "directory" (a book), plus
 * hash shards for objects directly under the prefix. `filter` keeps a subset of
 * flat keys and labels the shard path so two filtered passes never share a key.
 */
async function unitsUnder(src, prefix, { filter = null, flatLabel = '_flat', destRoot = src.label, rootPrefix = '' } = {}) {
  const { objects, prefixes } = await listAll(src, prefix, '/');
  const units = prefixes.map((p) => ({
    id: p, src, dest: `${destRoot}/${p.slice(rootPrefix.length).replace(/\/$/, '')}.tar`,
    list: async () => (await listAll(src, p)).objects,
  }));
  const flat = filter ? objects.filter((o) => filter(o.key)) : objects;
  if (flat.length) {
    const base = `${destRoot}/${prefix.slice(rootPrefix.length)}${flatLabel}`;
    if (flat.length <= FLAT_SHARD_MIN) {
      units.push({ id: `${prefix}${flatLabel}`, src, dest: `${base}.tar`, list: async () => flat });
    } else {
      const shards = new Map();
      for (const o of flat) { const s = shardOf(o.key); if (!shards.has(s)) shards.set(s, []); shards.get(s).push(o); }
      for (const [s, objs] of [...shards].sort()) units.push({ id: `${prefix}${flatLabel}/${s}`, src, dest: `${base}/${s}.tar`, list: async () => objs });
    }
  }
  return units;
}

// Mirrors build-preservation-manifest.mjs BOOK_PREFIXES (archive/ is its own group).
const BOOK_PREFIXES = ['archived/', 'pages/', 'books/', 'cropped/', 'gallery/', 'thumbnails/', 'deepzoom/', 'uploads/', 'enhanced/', 'page-masters/', 'masters/'];
const MASTER_PREFIXES = ['books/', 'uploads/', 'page-masters/', 'masters/'];
// Whole R2 prefixes that are EFM/BPH material: they go to Scaleway with the EFM groups, never to AWS.
const EFM_PREFIXES = ['archive/', 'bph-backups/', 'bph-editor-help/'];
const isFull = (k) => /-full\.[a-z0-9]+$/i.test(k);

let BPH_IDS = null;
async function bphBookIds() {
  if (BPH_IDS) return BPH_IDS;
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  try {
    const ids = new Set();
    for (const coll of ['books', 'deleted_books']) {
      const cur = c.db(process.env.MONGODB_DB || 'bookstore').collection(coll)
        .find({ 'image_source.provider': 'bph' }, { projection: { id: 1 } });
      // R2 keys use the book's `id`; 16K books have a re-minted `_id`, so take both.
      for await (const b of cur) { if (b.id) ids.add(String(b.id)); ids.add(String(b._id)); }
    }
    BPH_IDS = [...ids].sort();
    return BPH_IDS;
  } finally { await c.close(); }
}

async function unitsFor(group) {
  if (group === 'efm-archive') return unitsUnder(R2, 'archive/');
  if (group === 'efm-books') {
    const ids = await bphBookIds();
    return ids.flatMap((id) => BOOK_PREFIXES.map((p) => ({
      id: `${p}${id}/`, src: R2, dest: `r2/${p}${id}.tar`, list: async () => (await listAll(R2, `${p}${id}/`)).objects,
    })));
  }
  if (group === 'efm-bph-works') {
    const day = new Date().toISOString().slice(0, 10);
    let dir = null;
    const ensure = () => {
      if (dir) return dir;
      dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bph-works-'));
      execFileSync('node', [new URL('./backup-bph-catalog.mjs', import.meta.url).pathname, '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
      return dir;
    };
    const r2 = [];
    for (const p of EFM_PREFIXES.filter((x) => x !== 'archive/')) pushAll(r2, await unitsUnder(R2, p));
    return [...r2, {
      id: `bph_works/${day}`, src: { label: 'local' }, dest: `bph_works/${day}.tar`, local: true,
      list: async () => {
        const d = ensure();
        return readdirSync(d).sort().map((f) => {
          const st = statSync(join(d, f));
          return { key: `bph_works/${day}/${f}`, size: st.size, etag: '', last_modified: st.mtime.toISOString(), path: join(d, f) };
        });
      },
      cleanup: () => dir && rmSync(dir, { recursive: true, force: true }),
    }];
  }
  if (group === 'masters') {
    const out = [];
    for (const p of MASTER_PREFIXES) pushAll(out, await unitsUnder(R2, p));
    // artwork/ is flat; its -full images are masters, the rest are derived (they go in `rest`).
    pushAll(out, await unitsUnder(R2, 'artwork/', { filter: isFull, flatLabel: '_flat-full' }));
    return out;
  }
  if (group === 'restic') {
    const s = resticSource();
    const root = s.root ? `${s.root}/` : '';
    const top = await listAll(s, root, '/');
    const out = [];
    const flat = top.objects;
    if (flat.length) out.push({ id: `${root}_top`, src: s, dest: 'restic/_top.tar', list: async () => flat });
    for (const p of top.prefixes) {
      if (p === `${root}data/`) pushAll(out, await unitsUnder(s, p, { destRoot: 'restic', rootPrefix: root }));
      else out.push({ id: p, src: s, dest: `restic/${p.slice(root.length).replace(/\/$/, '')}.tar`, list: async () => (await listAll(s, p)).objects });
    }
    return out;
  }
  if (group === 'rest') {
    const top = await listAll(R2, '', '/');
    const out = [];
    for (const p of top.prefixes) {
      if (EFM_PREFIXES.includes(p) || MASTER_PREFIXES.includes(p)) continue; // whole prefix sent by an earlier group
      if (p === 'artwork/') pushAll(out, await unitsUnder(R2, p, { filter: (k) => !isFull(k), flatLabel: '_flat-other' }));
      else pushAll(out, await unitsUnder(R2, p));
    }
    if (top.objects.length) out.push({ id: '_root', src: R2, dest: 'r2/_root.tar', list: async () => top.objects });
    return out;
  }
  throw new Error(`unknown group ${group}`);
}

// ── tar (POSIX ustar + pax for long names / big sizes) ───────────────────────
function octal(n, len) { return n.toString(8).padStart(len - 1, '0') + '\0'; }
function rawHeader(name, size, mtime, type) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write(octal(0o644, 8), 100); h.write(octal(0, 8), 108); h.write(octal(0, 8), 116);
  h.write(size < 8 ** 11 ? octal(size, 12) : octal(0, 12), 124);
  h.write(octal(Math.floor(mtime / 1000), 12), 136);
  h.write('        ', 148); h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
function tarHeader(name, size, mtime) {
  const needPax = Buffer.byteLength(name) > 100 || size >= 8 ** 11;
  if (!needPax) return rawHeader(name, size, mtime, '0');
  const rec = (k, v) => { const body = ` ${k}=${v}\n`; let len = Buffer.byteLength(body) + 1; while (String(len).length + Buffer.byteLength(body) !== len) len++; return `${len}${body}`; };
  const pax = Buffer.from(rec('path', name) + (size >= 8 ** 11 ? rec('size', String(size)) : ''));
  const shortName = 'PaxHeaders/' + createHash('md5').update(name).digest('hex');
  return Buffer.concat([rawHeader(shortName, pax.length, mtime, 'x'), pax, pad(pax.length), rawHeader(name.slice(0, 100), size, mtime, '0')]);
}

// ── sinks: a local file (dry-run) or an S3 multipart upload (apply) ──────────
class FileSink {
  constructor(path) { mkdirSync(dirname(path), { recursive: true }); this.ws = createWriteStream(path); }
  async write(buf) { if (!this.ws.write(buf)) await new Promise((r) => this.ws.once('drain', r)); }
  async finish() { await new Promise((r, j) => this.ws.end((e) => (e ? j(e) : r()))); }
  async abort() { this.ws.destroy(); }
}
class S3Sink {
  constructor(dest, key) { this.d = dest; this.key = key; this.chunks = []; this.len = 0; this.parts = []; this.inflight = []; this.uploadId = null; }
  async write(buf) {
    this.chunks.push(buf); this.len += buf.length;
    while (this.len >= PART) await this.flushPart(false);
  }
  async flushPart(last) {
    const all = Buffer.concat(this.chunks);
    const body = last ? all : all.subarray(0, PART);
    const rest = last ? Buffer.alloc(0) : all.subarray(PART);
    this.chunks = rest.length ? [rest] : []; this.len = rest.length;
    if (!this.uploadId) {
      const r = await this.d.client.send(new CreateMultipartUploadCommand({ Bucket: this.d.bucket, Key: this.key, StorageClass: this.d.storageClass, ChecksumAlgorithm: 'CRC32', ContentType: 'application/x-tar' }));
      this.uploadId = r.UploadId;
    }
    const n = this.parts.length + 1;
    const p = this.d.client.send(new UploadPartCommand({ Bucket: this.d.bucket, Key: this.key, UploadId: this.uploadId, PartNumber: n, Body: body, ChecksumAlgorithm: 'CRC32' }))
      .then((r) => { this.parts[n - 1] = { PartNumber: n, ETag: r.ETag, ChecksumCRC32: r.ChecksumCRC32 }; });
    this.parts.push(null);
    this.inflight.push(p);
    if (this.inflight.length >= 2) await this.inflight.shift();
  }
  async finish() {
    if (!this.uploadId) {
      // Small tar: one PUT (the SDK adds a CRC32, which an Object Lock bucket requires).
      await this.d.client.send(new PutObjectCommand({ Bucket: this.d.bucket, Key: this.key, Body: Buffer.concat(this.chunks), StorageClass: this.d.storageClass, ContentType: 'application/x-tar' }));
      return;
    }
    if (this.len) await this.flushPart(true);
    await Promise.all(this.inflight);
    await this.d.client.send(new CompleteMultipartUploadCommand({ Bucket: this.d.bucket, Key: this.key, UploadId: this.uploadId, MultipartUpload: { Parts: this.parts } }));
  }
  async abort() {
    await Promise.allSettled(this.inflight);
    if (this.uploadId) await this.d.client.send(new AbortMultipartUploadCommand({ Bucket: this.d.bucket, Key: this.key, UploadId: this.uploadId })).catch(() => {});
  }
}

// ── one unit ─────────────────────────────────────────────────────────────────
const fingerprintOf = (objs) => createHash('sha256').update(objs.map((o) => `${o.key} ${o.size} ${o.etag}`).join('\n')).digest('hex');

async function openObject(unit, o) {
  if (unit.local) return createReadStream(o.path);
  const r = await unit.src.client.send(new GetObjectCommand({ Bucket: unit.src.bucket, Key: o.key, IfMatch: o.etag }));
  if (r.ContentLength !== undefined && r.ContentLength !== o.size) throw new Error(`${o.key}: listed ${o.size} bytes, GET says ${r.ContentLength}`);
  return r.Body;
}

// Parallel GETs per unit. Total R2 fetches in flight ≈ concurrency × prefetch; on
// gex45's 1 Gbit link 6×16 starved the long-RTT Postgres/Mongo dump streams (#7708).
const PREFETCH = parseInt(arg('--prefetch', '16')) || 16;
const PREFETCH_MAX = 32 * 1024 * 1024;
async function fetchBuffer(unit, o) {
  for (let attempt = 1; ; attempt++) {
    try {
      const parts = [];
      for await (const c of await openObject(unit, o)) parts.push(c);
      return Buffer.concat(parts);
    } catch (e) {
      // A changed object (412 on If-Match) is not transient: the unit fails and is re-listed next run.
      if (attempt >= 4 || e.$metadata?.httpStatusCode === 412) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function sendUnit(unit, objs, fingerprint) {
  const sink = MODE === 'apply' ? new S3Sink(coldDest(), unit.dest) : new FileSink(join(OUT, unit.dest));
  const tarHash = createHash('sha256');
  let offset = 0;
  const put = async (buf) => { tarHash.update(buf); offset += buf.length; await sink.write(buf); };
  const manifest = [];
  // One GET at a time ran at ~0.7 MB/s (per-request latency, not bandwidth), so
  // small objects are fetched PREFETCH ahead into memory, with retries; objects
  // over PREFETCH_MAX stream straight through instead.
  const window = new Map();
  let ahead = 0;
  const fill = (i) => {
    for (; ahead < objs.length && ahead < i + PREFETCH; ahead++) {
      const o = objs[ahead];
      window.set(ahead, o.size > PREFETCH_MAX ? Promise.resolve(null) : fetchBuffer(unit, o).catch((e) => e));
    }
  };
  try {
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      fill(i);
      const got = await window.get(i); window.delete(i);
      if (got instanceof Error) throw got;
      const mtime = o.last_modified ? Date.parse(o.last_modified) : Date.now();
      await put(tarHeader(o.key, o.size, mtime));
      const at = offset;
      const sha = createHash('sha256'), md5 = createHash('md5');
      let n = 0;
      for await (const chunk of got ? [got] : await openObject(unit, o)) { sha.update(chunk); md5.update(chunk); n += chunk.length; await put(chunk); }
      if (n !== o.size) throw new Error(`${o.key}: read ${n} bytes, listed ${o.size}`);
      const etag = (o.etag || '').replace(/"/g, '');
      const md5hex = md5.digest('hex');
      if (etag && !etag.includes('-') && etag !== md5hex) throw new Error(`${o.key}: MD5 ${md5hex} != ETag ${etag}`);
      await put(pad(o.size));
      manifest.push({ key: o.key, size: o.size, etag: etag || md5hex, last_modified: o.last_modified, sha256: sha.digest('hex'), tar_offset: at });
    }
    await put(Buffer.alloc(1024));
    await sink.finish();
  } catch (e) { await sink.abort(); throw e; }
  const doc = {
    version: 1, dest: unit.dest, unit: unit.id, created: new Date().toISOString(),
    source: { store: unit.src.label, bucket: unit.src.bucket ?? null }, target: TARGET,
    tar_bytes: offset, tar_sha256: tarHash.digest('hex'), fingerprint,
    objects: manifest,
  };
  const body = JSON.stringify(doc);
  if (MODE === 'apply') {
    const d = coldDest();
    await d.client.send(new PutObjectCommand({ Bucket: d.bucket, Key: `${unit.dest}.manifest.json`, Body: body, ContentType: 'application/json', StorageClass: 'STANDARD' }));
    const h = await d.client.send(new HeadObjectCommand({ Bucket: d.bucket, Key: unit.dest }));
    if (h.ContentLength !== offset) throw new Error(`${unit.dest}: uploaded ${offset} bytes, HEAD says ${h.ContentLength}`);
    if (h.StorageClass !== d.storageClass) throw new Error(`${unit.dest}: StorageClass ${h.StorageClass}, expected ${d.storageClass}`);
  } else {
    await new Promise((r, j) => createWriteStream(join(OUT, `${unit.dest}.manifest.json`)).end(body, (e) => (e ? j(e) : r())));
  }
  return doc;
}

/** Already in the cold bucket with this exact listing? (the ledger may be lost) */
async function remoteHas(unit, fingerprint) {
  const d = coldDest();
  try {
    const r = await d.client.send(new GetObjectCommand({ Bucket: d.bucket, Key: `${unit.dest}.manifest.json` }));
    const m = JSON.parse(await r.Body.transformToString());
    if (m.fingerprint !== fingerprint) return false;
    const h = await d.client.send(new HeadObjectCommand({ Bucket: d.bucket, Key: unit.dest }));
    return h.ContentLength === m.tar_bytes ? m : false;
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

// ── ledger ───────────────────────────────────────────────────────────────────
const ledger = new Map();
if (MODE === 'apply' && existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line) continue;
    try { const e = JSON.parse(line); if (e.status === 'done') ledger.set(`${e.target}:${e.dest}`, e); } catch {}
  }
}
function record(entry) {
  if (MODE !== 'apply') return;
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), target: TARGET, ...entry }) + '\n');
}

// ── run ──────────────────────────────────────────────────────────────────────
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
const gb = (b) => (b / 1e9).toFixed(2);

async function runGroup(group) {
  const t0 = Date.now();
  TARGET = targetFor(group);
  let units = await unitsFor(group);
  if (ONLY_UNITS) units = units.filter((u) => ONLY_UNITS.has(u.id));
  if (TARGET !== 'scw') {
    // `masters` and `rest` walk whole prefixes, which include BPH books' folders.
    // Those went to Scaleway with efm-books; they must not reach AWS (#7708).
    const bph = new Set(await bphBookIds());
    const before = units.length;
    units = units.filter((u) => !(u.src === R2 && bph.has(u.id.split('/')[1])));
    if (before !== units.length) console.log(`[${group}] ${before - units.length} BPH book units held back from ${TARGET}`);
  }
  console.log(`[${group}] ${units.length} candidate units (${MODE}, target ${TARGET})`);
  const st = { units: units.length, nonempty: 0, objects: 0, bytes: 0, sent: 0, skipped: 0, failed: 0, sent_bytes: 0, requests: 0, largest: 0 };
  let sentCount = 0;
  await pool(units, CONC, async (u) => {
    if (LIMIT && MODE !== 'estimate' && sentCount >= LIMIT) return;
    let objs;
    try {
      objs = (await u.list()).sort((a, b) => (a.key < b.key ? -1 : 1));
    } catch (e) { st.failed++; console.log(`  FAIL list ${u.id}: ${e.message}`); record({ group, unit: u.id, dest: u.dest, status: 'failed', error: `list: ${e.message}` }); return; }
    if (!objs.length) { u.cleanup?.(); return; }
    const bytes = objs.reduce((a, o) => a + o.size, 0);
    const tarBytes = objs.reduce((a, o) => a + 512 + o.size + ((512 - (o.size % 512)) % 512), 1024);
    st.nonempty++; st.objects += objs.length; st.bytes += bytes; st.largest = Math.max(st.largest, tarBytes);
    // Requests one tar costs: a single PUT, or create + parts + complete; plus the manifest PUT.
    st.requests += (tarBytes < PART ? 1 : 2 + Math.ceil(tarBytes / PART)) + 1;
    if (MODE === 'estimate') return;
    if (LIMIT && sentCount >= LIMIT) return;
    const fingerprint = fingerprintOf(objs);
    if (MODE === 'apply') {
      if (ledger.get(`${TARGET}:${u.dest}`)?.fingerprint === fingerprint) { st.skipped++; u.cleanup?.(); return; }
      const m = await remoteHas(u, fingerprint).catch((e) => { console.log(`  WARN manifest check ${u.dest}: ${e.message}`); return false; });
      if (m) { st.skipped++; record({ group, unit: u.id, dest: u.dest, status: 'done', objects: objs.length, bytes, tar_bytes: m.tar_bytes, tar_sha256: m.tar_sha256, fingerprint, note: 'found in bucket' }); u.cleanup?.(); return; }
    }
    if (LIMIT && sentCount >= LIMIT) return; // re-check: workers interleave across the awaits above
    sentCount++;
    try {
      const t = Date.now();
      const doc = await sendUnit(u, objs, fingerprint);
      st.sent++; st.sent_bytes += doc.tar_bytes;
      record({ group, unit: u.id, dest: u.dest, status: 'done', objects: objs.length, bytes, tar_bytes: doc.tar_bytes, tar_sha256: doc.tar_sha256, fingerprint });
      console.log(`  ok ${u.dest} ${objs.length} objs ${gb(doc.tar_bytes)} GB ${((Date.now() - t) / 1000).toFixed(0)}s`);
    } catch (e) {
      st.failed++;
      console.log(`  FAIL ${u.dest}: ${e.message}`);
      record({ group, unit: u.id, dest: u.dest, status: 'failed', objects: objs.length, bytes, fingerprint, error: e.message });
    } finally { u.cleanup?.(); }
  });
  st.seconds = Math.round((Date.now() - t0) / 1000);
  // Deep Archive: $0.05 per 1,000 requests; ~$0.99 per TB-month; 40 KB overhead per object.
  st.est_request_usd = +(st.requests * 0.05 / 1000).toFixed(2);
  st.est_storage_usd_month = +(((st.bytes + st.nonempty * 2 * 40e3) / 1e12) * 0.99).toFixed(2);
  console.log(`[${group}] ${JSON.stringify({ ...st, gb: gb(st.bytes) })}`);
  return st;
}

const groups = GROUP === 'all' ? ORDER : [GROUP];
const summary = {};
let failed = 0;
for (const g of groups) { summary[g] = await runGroup(g); failed += summary[g].failed; }
if (groups.length > 1) console.log(JSON.stringify({ summary }));
process.exit(failed ? 1 : 0);
