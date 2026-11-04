#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/bake-provenance-mark.mjs — does not fit: it decides "already done"
 * from a HEAD on a tag most marked files do not have, skips every page whose master is its display
 * (the class that is now growing), regenerates at 2000px (#4406: 2x the bytes), and fetches from
 * institutions when R2 has no master.
 *
 * backfill-display-marks — give every visible page's display image the provenance mark (#4406, #2651).
 *
 * THE RULES (Derek, 2026-11-04). R2 has no version history here, so an overwrite is final.
 *   1. Clean originals survive, always. A display object is overwritten only after its regenerate
 *      source, another R2 object, has just been read successfully and has been shown to be the same
 *      page (aspect ratio and perceptual hash against the display it replaces).
 *   2. An object that any other pointer also names (archived_photo, photo, photo_original,
 *      cropped_photo, enhanced_photo) is a source, not a variant. It is never written. The mark goes
 *      to a sibling key, pages/<book>/<name>-marked.jpg, and only display_photo moves. Reversible.
 *   3. A page with no R2 source other than its display is skipped and counted (`no-master`). No
 *      marking in place, ever. No fetching from an institution, ever.
 *   4. A display the reader never loads (a cropped_photo page, a variant of another image) is skipped
 *      and counted (`not-served-to-reader`): a mark there costs a PUT and protects nothing.
 *   5. Already marked is skipped: an sl-v5 or sl-v6 tag, our EXIF, or the detector. A marked file with
 *      a low z is left alone and counted (`weak`). Rewriting those is a separate decision.
 *
 * SIZE. An ordinary page goes through generateDisplayVariants (min(1200, native)), the shared path;
 * see the width history on #4406. An overwritten split page keeps the width its display has now (the
 * split scripts chose it) and goes through markDisplay. Neither grows an overwritten object noticeably.
 * A sibling is always min(1200, native), split or not: it is a NEW object, and at the 2000px its source
 * can have it averaged 859 KB in the pilot against ~250 KB at 1200. Its bytes are in the plan's estimate.
 *
 * THE HASH LEDGER (#8150 slice 10 reads this, so the format is a contract). One row per object
 * written, NDJSON, gzip, append-only; nothing is added to the page doc (field-sprawl.md).
 *   R2:   provenance-ledger/<YYYY-MM-DD>/<run>/shard-<i>-of-<n>-<seq>.ndjson.gz
 *         provenance-ledger/<YYYY-MM-DD>/<run>/shard-<i>-of-<n>.MANIFEST.sha256
 *         The manifest is `sha256sum` format, one line per closed ledger file, rewritten as each closes.
 *   Row:  { v: 1, page_id, book_id, page_number,
 *           key            the display key the reader was served before this write
 *           target_key     the key written (differs from key for a sibling)
 *           source_key     the clean R2 object the mark was regenerated from
 *           class          'overwrite' | 'sibling'
 *           sha256_before  of the bytes at `key` before the write
 *           sha256_after   of the bytes written to target_key
 *           phash_after    64-bit dHash of the written image, 16 hex chars (scripts/lib/dhash.mjs),
 *                          so a re-encoded copy can still be matched
 *           phash_distance dHash distance from the old display, 0-64; null when there was no comparison
 *           z_after        detector z on the written bytes
 *           width, height  of the written image
 *           mark           'sl-v6' (the weakest nudge that reads back); writer 'backfill-4406'; at  ISO time }
 *
 * COST. A page already marked is one GET ($0.36/M). An unmarked page is two GETs and a PUT ($5.22/M).
 * A sibling reuses the display it just read, so one GET and a PUT, plus its stored bytes. --plan
 * prices the run from a census and per-book probes. --budget-usd is a hard stop, split over shards.
 *
 * Usage (from a checkout of main, with the env file):
 *   ... --plan --out=DIR [--workers=8] [--probes=2]     census + probes + estimate; writes nothing to R2
 *   ... --book=ID[,ID] --out=DIR [--apply] [--save-images=DIR]        pilot; dry run without --apply
 *   ... --out=DIR --shard=I/N --budget-usd=30 --apply [--concurrency=3]        one shard of the run
 *   ... --out=DIR --status                                    pages, spend, rate and ETA over all shards
 * Restartable: finished books are in DIR/done-<i>-of-<n>.txt, and a repeat read skips by tag.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { Agent as HttpsAgent } from 'https';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { detectWatermark } from '../lib/provenance-mark.mjs';
import { computeDHash } from '../lib/dhash.mjs';
import { assertBookScopedKey, validateR2Key } from '../lib/r2-key.mjs';
import { READER_DISPLAY_FIELDS, readerServesDisplay } from '../lib/reader-display.mjs';
import { generateDisplayVariants, markDisplay } from '../workers/lib/display-image.mjs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const has = (n) => process.argv.includes(`--${n}`);

const APPLY = has('apply');
const OUT = arg('out', null);
const BOOKS = arg('book', null)?.split(',').filter(Boolean) || null;
const SAVE_IMAGES = arg('save-images', null);
const [SHARD, SHARDS] = (arg('shard', '0/1')).split('/').map(Number);
const BUDGET = Number(arg('budget-usd', 0));
const CONCURRENCY = Number(arg('concurrency', 3));
const WORKERS = Number(arg('workers', 8));
const PROBES = Number(arg('probes', 2));

const MARK = 'sl-v6';
const ALREADY_MARKED_TAG = /^sl-v[56]$/;
const WRITER = 'backfill-4406';
const PHASH_MAX = 14;     // of 64. The same page after a resize and the mark sits well inside this (pilot, #4406).
const ASPECT_TOLERANCE = 0.03;
const SOURCE_MIN_RATIO = 0.9;   // a "master" narrower than this share of its target would cost the reader sharpness
const LEDGER_ROWS = 100000;
const COST = { get: 0.36 / 1e6, put: 4.5 / 1e6, gbMonth: 0.015 };

const KEY = process.env.PROVENANCE_SECRET_KEY;
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_BASE = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const keyOf = (u) => (typeof u === 'string' && u.startsWith(`${R2_BASE}/`) ? u.slice(R2_BASE.length + 1).split('?')[0] : null);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const r2 = new S3Client({
  region: 'auto', maxAttempts: 3,
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || '').trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: Math.max(16, CONCURRENCY * 4) }),
    connectionTimeout: 8000, requestTimeout: 90000,
  }),
});

// ---- R2, with one shared back-off so a 429 slows the whole process, not one request --------------
const spend = { gets: 0, puts: 0, throttled: 0 };
let pauseMs = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function send(cmd) {
  for (let attempt = 0; ; attempt++) {
    if (pauseMs) await sleep(pauseMs);
    try {
      const out = await r2.send(cmd);
      if (pauseMs) pauseMs = pauseMs < 500 ? 0 : Math.floor(pauseMs * 0.8);
      return out;
    } catch (e) {
      const status = e?.$metadata?.httpStatusCode;
      if ((status === 429 || status === 503 || e?.name === 'SlowDown') && attempt < 8) {
        spend.throttled++;
        pauseMs = Math.min(60000, Math.max(1000, pauseMs * 2));
        continue;
      }
      throw e;
    }
  }
}
async function readObject(key, { unlessTagged = false } = {}) {
  spend.gets++;
  const o = await send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const meta = o.Metadata || {};
  if (unlessTagged && ALREADY_MARKED_TAG.test(meta.provenance || '')) { o.Body.destroy?.(); return { tagged: true, meta }; }
  const chunks = [];
  for await (const c of o.Body) chunks.push(c);
  return { buf: Buffer.concat(chunks), meta, etag: o.ETag, cacheControl: o.CacheControl };
}

// ---- classification from the page doc alone -------------------------------------------------------
const POINTERS = ['archived_photo', 'photo', 'photo_original', 'cropped_photo', 'enhanced_photo'];
export const PAGE_PROJECTION = { ...READER_DISPLAY_FIELDS, book_id: 1, id: 1, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, crop: 1, image_width: 1, image_height: 1, display_width: 1, display_height: 1 };

/** The reader's source order (getPageSource), narrowed to R2 objects of this book that are not the display. */
function sourceKeys(p, displayKey) {
  const order = [p.cropped_photo, p.split_from_spread ? p.photo : null, p.enhanced_photo, p.archived_photo, p.photo_original, p.photo];
  const out = [];
  for (const u of order) {
    const k = keyOf(u);
    if (k && k !== displayKey && k.includes(p.book_id) && !out.includes(k) && !k.startsWith('pages/undefined')) out.push(k);
  }
  return out;
}

/** What a page's pointers allow, before any byte is read. */
function classify(p) {
  if (!(p.page_number > 0)) return { cls: 'not-a-reader-page' };
  if (!p.display_photo) return { cls: 'no-display' };
  const displayKey = keyOf(p.display_photo);
  if (!displayKey) return { cls: 'display-not-on-r2' };
  if (!displayKey.startsWith('pages/') || !displayKey.includes(p.book_id)) return { cls: 'display-foreign-key', displayKey };
  if (!readerServesDisplay(p)) return { cls: 'not-served-to-reader', displayKey };
  if (POINTERS.some((f) => keyOf(p[f]) === displayKey)) {
    return { cls: 'sibling', displayKey, targetKey: displayKey.replace(/\.jpe?g$/i, '') + '-marked.jpg' };
  }
  const sources = sourceKeys(p, displayKey);
  if (sources.length === 0) return { cls: 'no-master', displayKey };
  return { cls: 'overwrite', displayKey, targetKey: displayKey, sources };
}

// ---- one page ---------------------------------------------------------------------------------------
const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/** Is this display already ours? Tag first (no bytes), then EXIF and the detector on the bytes. */
async function markState(buf, meta, bookId) {
  const exif = meta.exif ? meta.exif.toString('latin1') : '';
  const det = await detectWatermark(buf, { editionId: bookId, key: KEY });
  if (det.present) return { marked: true, state: 'detected', det };
  if (exif.includes('[edition ')) return { marked: true, state: 'weak', det };
  return { marked: false, state: 'unmarked', det };
}

/** Regenerate from a source that has just been read, or say why not. Never touches the source. */
async function regenerate(p, cls, displayBuf, displayMeta, oldHash, tally) {
  const ids = { bookId: p.book_id, pageNumber: p.page_number };
  if (cls.cls === 'sibling') {
    // The object at the display key IS the clean copy. It was just read, and is not written to.
    const { display } = await generateDisplayVariants(displayBuf, ids);
    return { out: display, sourceKey: cls.displayKey, distance: null };
  }
  const split = Boolean(p.split_from_spread || p.crop || p.cropped_photo);
  const oldAspect = displayMeta.width / displayMeta.height;
  let reason = 'no-master-read';
  for (const sourceKey of cls.sources) {
    let src;
    try { src = await readObject(sourceKey); } catch { reason = 'source-unreadable'; continue; }
    let sm;
    try { sm = await sharp(src.buf, { failOn: 'none' }).metadata(); } catch { reason = 'source-undecodable'; continue; }
    // A split page's archived_photo can be the whole spread; a poisoned pointer can be another page.
    if (Math.abs(sm.width / sm.height - oldAspect) / oldAspect > ASPECT_TOLERANCE) { reason = 'source-other-shape'; continue; }
    if (hamming(await computeDHash(src.buf), oldHash) > PHASH_MAX) { reason = 'source-other-image'; continue; }
    const wanted = split ? displayMeta.width : Math.min(1200, displayMeta.width);
    if (sm.width < wanted * SOURCE_MIN_RATIO) { reason = 'source-too-small'; continue; }
    let out;
    if (split) {
      const sized = sm.width > displayMeta.width
        ? await sharp(src.buf, { failOn: 'none' }).resize({ width: displayMeta.width }).jpeg({ quality: 85 }).toBuffer()
        : src.buf;
      out = await markDisplay(sized, ids);
    } else {
      ({ display: out } = await generateDisplayVariants(src.buf, ids));
    }
    return { out, sourceKey, distance: hamming(await computeDHash(out), oldHash) };
  }
  tally(reason);
  return null;
}

async function processPage(p, ctx) {
  const cls = classify(p);
  ctx.tally(cls.cls);
  if (cls.cls !== 'overwrite' && cls.cls !== 'sibling') return;

  let cur;
  try { cur = await readObject(cls.displayKey, { unlessTagged: true }); }
  catch (e) { ctx.tally(e?.$metadata?.httpStatusCode === 404 ? 'display-missing' : 'display-read-error'); return; }
  if (cur.tagged) { ctx.tally('skip:tag'); return; }

  let meta;
  try { meta = await sharp(cur.buf, { failOn: 'none' }).metadata(); } catch { ctx.tally('display-undecodable'); return; }
  const state = await markState(cur.buf, meta, p.book_id);
  if (state.marked) { ctx.tally(`skip:${state.state}`); return; }
  ctx.tally(`unmarked:${cls.cls}`);
  if (!APPLY && !SAVE_IMAGES) return;

  const oldHash = await computeDHash(cur.buf);
  const regen = await regenerate(p, cls, cur.buf, meta, oldHash, (r) => ctx.tally(`refused:${r}`));
  if (!regen) return;

  const om = await sharp(regen.out, { failOn: 'none' }).metadata();
  const after = await detectWatermark(regen.out, { editionId: p.book_id, key: KEY });
  // generateDisplayVariants downgrades quietly when the key is missing; a run must not.
  if (!om.exif?.toString('latin1').includes('[edition ')) throw new Error(`no keyed mark on output for ${cls.targetKey}`);

  if (SAVE_IMAGES) {
    const base = path.join(SAVE_IMAGES, `${p.book_id}-${String(p.page_number).padStart(4, '0')}`);
    fs.mkdirSync(SAVE_IMAGES, { recursive: true });
    fs.writeFileSync(`${base}-before.jpg`, cur.buf);
    fs.writeFileSync(`${base}-after.jpg`, regen.out);
  }
  ctx.rows?.push({ page: p.page_number, cls: cls.cls, w0: meta.width, h0: meta.height, kb0: cur.buf.length >> 10, w1: om.width, h1: om.height, kb1: regen.out.length >> 10, img: [p.image_width, p.image_height], disp: [p.display_width, p.display_height], z0: state.det.z, z1: after.z, pairs: after.pairs, dist: regen.distance, src: regen.sourceKey.split('/').slice(0, 1)[0] });
  if (!APPLY) { ctx.tally(`would-write:${cls.cls}`); return; }

  assertBookScopedKey(cls.targetKey, p.book_id, 'backfill-display-marks');
  // A repoint the reader rejects serves the unmarked master through the proxy (the pilot's first 70, #4406).
  if (cls.cls === 'sibling' && !readerServesDisplay({ ...p, display_photo: `${R2_BASE}/${cls.targetKey}` })) throw new Error(`reader would not serve ${cls.targetKey}`);
  spend.puts++;
  // If-Match: a writer that replaced this object since the read wins; its bytes are newer than ours.
  const conditional = cls.cls === 'overwrite' && cur.etag ? { IfMatch: cur.etag } : {};
  try {
    await send(new PutObjectCommand({
      Bucket: BUCKET, Key: cls.targetKey, Body: regen.out, ContentType: 'image/jpeg',
      CacheControl: cur.cacheControl || 'public, max-age=604800, s-maxage=604800',
      Metadata: { provenance: MARK, provenance_writer: WRITER },
      ...conditional,
    }));
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 412) { ctx.tally('refused:changed-since-read'); return; }
    throw e;
  }

  const set = {};
  if (cls.cls === 'sibling') Object.assign(set, { display_photo: `${R2_BASE}/${cls.targetKey}`, display_width: om.width, display_height: om.height });
  else if ((p.display_width && p.display_width !== om.width) || (p.display_height && p.display_height !== om.height)) Object.assign(set, { display_width: om.width, display_height: om.height });
  if (Object.keys(set).length) await ctx.pages.updateOne({ _id: p._id, display_photo: p.display_photo }, { $set: set });

  ctx.tally(`wrote:${cls.cls}`);
  ctx.bytes.written += regen.out.length;
  if (cls.cls === 'sibling') ctx.bytes.added += regen.out.length;
  ctx.ledger?.add({
    v: 1, page_id: p.id || String(p._id), book_id: p.book_id, page_number: p.page_number,
    key: cls.displayKey, target_key: cls.targetKey, source_key: regen.sourceKey, class: cls.cls,
    sha256_before: sha256(cur.buf), sha256_after: sha256(regen.out),
    phash_after: await computeDHash(regen.out), phash_distance: regen.distance,
    z_after: after.z, width: om.width, height: om.height,
    mark: MARK, writer: WRITER, at: new Date().toISOString(),
  });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---- ledger ----------------------------------------------------------------------------------------
class Ledger {
  constructor(dir, run, shard, shards) {
    Object.assign(this, { dir, shard, shards, rows: [], seq: 0, closed: [] });
    this.day = run.slice(0, 10);
    this.run = run;
    this.prefix = `provenance-ledger/${this.day}/${run}`;
    fs.mkdirSync(dir, { recursive: true });
    this.name = () => `shard-${shard}-of-${shards}-${String(this.seq).padStart(5, '0')}.ndjson.gz`;
    const old = path.join(dir, `manifest-${shard}-of-${shards}.txt`);
    if (fs.existsSync(old)) {
      this.closed = fs.readFileSync(old, 'utf8').split('\n').filter(Boolean);
      this.seq = this.closed.length;
    }
    // A restart resumes the local gzip: each flush is its own member, so an append stays one valid file.
    this.count = 0;
  }
  add(row) {
    this.rows.push(JSON.stringify(row));
    // These rows cannot be rebuilt: once an object is overwritten, a restart skips it by tag.
    if (this.rows.length >= 20) this.flush();
  }
  flush() {
    if (!this.rows.length) return;
    fs.appendFileSync(path.join(this.dir, this.name()), zlib.gzipSync(`${this.rows.join('\n')}\n`));
    this.count += this.rows.length;
    this.rows = [];
  }
  async close() {
    this.flush();
    const f = path.join(this.dir, this.name());
    if (!fs.existsSync(f)) return;
    const body = fs.readFileSync(f);
    const key = `${this.prefix}/${this.name()}`;
    validateR2Key(key, 'backfill-display-marks ledger');
    await send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/gzip' }));
    this.closed.push(`${sha256(body)}  ${this.name()}`);
    const list = `${this.closed.join('\n')}\n`;
    fs.writeFileSync(path.join(this.dir, `manifest-${this.shard}-of-${this.shards}.txt`), list);
    await send(new PutObjectCommand({ Bucket: BUCKET, Key: `${this.prefix}/shard-${this.shard}-of-${this.shards}.MANIFEST.sha256`, Body: list, ContentType: 'text/plain' }));
    fs.unlinkSync(f);   // on R2 with its hash in the manifest; 5M rows would otherwise sit on a small shared disk
    this.seq++;
    this.count = 0;
  }
  async rotateIfFull() { if (this.count + this.rows.length >= LEDGER_ROWS) await this.close(); }
}

// ---- plan ------------------------------------------------------------------------------------------
async function plan(db) {
  const live = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).toArray();
  console.log(`visible books ${live.length}, pages_count sum ${live.reduce((s, b) => s + b.pages_count, 0)}`);
  const pages = db.collection('pages');
  const rows = [];
  const total = {};
  const probed = {};
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  let done = 0;
  await pool(live.sort(() => Math.random() - 0.5), WORKERS, async (b) => {
    const docs = await pages.find({ book_id: b.id }, { projection: PAGE_PROJECTION }).toArray();
    const by = {};
    const workable = [];
    for (const p of docs) {
      const c = classify(p);
      bump(by, c.cls); bump(total, c.cls);
      if (c.cls === 'overwrite' || c.cls === 'sibling') workable.push([p, c]);
    }
    // Probe the display only: tag, EXIF, detector. Two reads a book is $0.05 over the corpus.
    const probes = { n: 0, unmarked: 0 };
    for (let i = 0; i < PROBES && workable.length; i++) {
      const [p, c] = workable[Math.floor(Math.random() * workable.length)];
      try {
        const cur = await readObject(c.displayKey, { unlessTagged: true });
        let unmarked = false;
        if (!cur.tagged) {
          const m = await sharp(cur.buf, { failOn: 'none' }).metadata();
          unmarked = !(await markState(cur.buf, m, p.book_id)).marked;
        }
        probes.n++;
        if (unmarked) probes.unmarked++;
        bump(probed, `${c.cls}:${unmarked ? 'unmarked' : 'marked'}`);
      } catch { /* a probe that cannot read says nothing */ }
    }
    rows.push({ id: b.id, docs: docs.length, by, probes });
    if (++done % 5000 === 0) console.log(`  ${done}/${live.length} books, ${spend.gets} reads`);
  });
  // Unmarked first: books whose probes were unmarked, largest share first; books with no probe last.
  rows.sort((a, b) => (b.probes.n ? b.probes.unmarked / b.probes.n : -1) - (a.probes.n ? a.probes.unmarked / a.probes.n : -1));
  const f = path.join(OUT, 'plan.ndjson.gz');
  fs.writeFileSync(f, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n')));

  // Page-weighted estimate: a book's share of unmarked pages, from its own probes.
  let estOverwrite = 0, estSibling = 0, workablePages = 0, unprobed = 0;
  for (const r of rows) {
    const share = r.probes.n ? r.probes.unmarked / r.probes.n : 0;
    if (!r.probes.n) unprobed += (r.by.overwrite || 0) + (r.by.sibling || 0);
    estOverwrite += (r.by.overwrite || 0) * share;
    estSibling += (r.by.sibling || 0) * share;
    workablePages += (r.by.overwrite || 0) + (r.by.sibling || 0);
  }
  const reads = workablePages + estOverwrite;              // every display once, + one master per overwrite
  const puts = estOverwrite + estSibling;
  const oneTime = reads * COST.get + puts * COST.put;
  const SIBLING_KB = 450;   // measured on the pilot's 70 at 1200px, median 456 (#4406)
  const addedGb = (estSibling * SIBLING_KB) / 1048576;
  const report = {
    at: new Date().toISOString(), books: live.length, pagesDocs: rows.reduce((s, r) => s + r.docs, 0), classes: total, probes: probed, unprobed,
    estimate: { unmarkedOverwrite: Math.round(estOverwrite), unmarkedSibling: Math.round(estSibling), reads: Math.round(reads), puts: Math.round(puts), oneTimeUsd: +oneTime.toFixed(2), addedGb: +addedGb.toFixed(1), addedUsdPerMonth: +(addedGb * COST.gbMonth).toFixed(2) },
  };
  fs.writeFileSync(path.join(OUT, 'plan-report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

// ---- status ----------------------------------------------------------------------------------------
function status() {
  const files = fs.readdirSync(OUT).filter((f) => /^progress-\d+-of-\d+\.json$/.test(f));
  const sum = { books: 0, pages: 0, gets: 0, puts: 0, throttled: 0, addedBytes: 0, tally: {} };
  const started = [];
  const ages = [];
  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    sum.books += p.books; sum.pages += p.pages; sum.gets += p.gets; sum.puts += p.puts; sum.throttled += p.throttled; sum.addedBytes += p.addedBytes;
    for (const [k, v] of Object.entries(p.tally)) sum.tally[k] = (sum.tally[k] || 0) + v;
    started.push(Date.parse(p.startedAt));
    ages.push((Date.now() - Date.parse(p.at)) / 60000);
  }
  if (!files.length) { console.log('no progress files'); return; }
  const usd = sum.gets * COST.get + sum.puts * COST.put;
  const hours = (Date.now() - Math.min(...started)) / 36e5;
  let eta = '';
  const reportFile = path.join(OUT, 'plan-report.json');
  if (fs.existsSync(reportFile) && sum.puts) {
    const est = JSON.parse(fs.readFileSync(reportFile, 'utf8')).estimate;
    const left = Math.max(0, est.puts - sum.puts);
    eta = `  ETA ~${(left / (sum.puts / hours) / 24).toFixed(1)} days (${left} writes left of ~${est.puts})`;
  }
  console.log(`shards ${files.length}, newest update ${Math.min(...ages).toFixed(1)} min ago, oldest ${Math.max(...ages).toFixed(1)} min ago`);
  console.log(`books ${sum.books}, pages seen ${sum.pages}, written ${sum.puts}, ${(sum.puts / hours / 3600).toFixed(1)} writes/s over ${hours.toFixed(1)} h, $${usd.toFixed(2)} so far, +${(sum.addedBytes / 2 ** 30).toFixed(1)} GB new objects, ${sum.throttled} throttled${eta}`);
  console.log(JSON.stringify(sum.tally, null, 1));
}

// ---- run -------------------------------------------------------------------------------------------
async function run(db) {
  const tallyO = {};
  const pages = db.collection('pages');
  const tag = `${SHARD}-of-${SHARDS}`;
  const bytes = { written: 0, added: 0 };
  let order;
  if (BOOKS) order = BOOKS;
  else {
    const rows = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'plan.ndjson.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    order = rows.filter((r) => parseInt(crypto.createHash('md5').update(r.id).digest('hex').slice(0, 8), 16) % SHARDS === SHARD).map((r) => r.id);
  }
  const doneFile = OUT ? path.join(OUT, `done-${tag}.txt`) : null;
  const done = new Set(doneFile && fs.existsSync(doneFile) && !BOOKS ? fs.readFileSync(doneFile, 'utf8').split('\n') : []);
  const progressFile = OUT ? path.join(OUT, `progress-${tag}.json`) : null;
  const prior = progressFile && fs.existsSync(progressFile) && !BOOKS ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : null;
  if (prior) { Object.assign(spend, { gets: prior.gets, puts: prior.puts, throttled: prior.throttled }); Object.assign(tallyO, prior.tally); bytes.added = prior.addedBytes; }
  const state = { books: prior?.books || 0, pagesSeen: prior?.pages || 0, startedAt: prior?.startedAt || new Date().toISOString() };

  const run = arg('run', '2026-11-04-backfill-4406');
  const ledger = APPLY ? new Ledger(path.join(OUT, 'ledger'), run, SHARD, SHARDS) : null;
  process.on('exit', () => ledger?.flush());
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(143));
  const shardBudget = BUDGET / SHARDS;
  const spent = () => spend.gets * COST.get + spend.puts * COST.put;
  const save = () => {
    if (!progressFile) return;
    fs.writeFileSync(`${progressFile}.tmp`, JSON.stringify({ at: new Date().toISOString(), startedAt: state.startedAt, shard: tag, books: state.books, pages: state.pagesSeen, gets: spend.gets, puts: spend.puts, throttled: spend.throttled, addedBytes: bytes.added, tally: tallyO }));
    fs.renameSync(`${progressFile}.tmp`, progressFile);
  };

  let lastSave = Date.now();
  const rows = BOOKS ? [] : null;
  const ctx = { pages, ledger, bytes, rows, tally: (k) => { tallyO[k] = (tallyO[k] || 0) + 1; } };
  for (const id of order) {
    if (done.has(id)) continue;
    if (BUDGET && spent() >= shardBudget) {
      console.log(`[${tag}] budget reached: $${spent().toFixed(2)} of $${shardBudget.toFixed(2)}`);
      fs.writeFileSync(path.join(OUT, `stopped-${tag}.txt`), `budget ${new Date().toISOString()}\n`);
      break;
    }
    const docs = await pages.find({ book_id: id }, { projection: PAGE_PROJECTION }).toArray();
    await pool(docs, CONCURRENCY, async (p) => {
      await processPage(p, ctx).catch((e) => { ctx.tally(`error:${e.name}`); console.warn(`[${tag}] ${id} p${p.page_number}: ${e.message}`); });
      // A heartbeat per page, not per book: the watchdog restarts a shard whose file stops moving, and one large book can outlast its window.
      if (Date.now() - lastSave > 60000) { lastSave = Date.now(); save(); }
    });
    state.books++;
    state.pagesSeen += docs.length;
    if (doneFile && !BOOKS) fs.appendFileSync(doneFile, `${id}\n`);
    ledger?.flush();
    if (ledger) await ledger.rotateIfFull();
    save();
    console.log(`[${tag}] ${new Date().toISOString().slice(0, 19)} ${state.books} books ${state.pagesSeen} pages ${spend.puts} writes $${spent().toFixed(2)} pause ${pauseMs}`);
  }
  if (ledger) await ledger.close();
  save();
  if (BOOKS) for (const r of rows) console.log(JSON.stringify(r));
  console.log(`[${tag}] done. ${JSON.stringify(tallyO)}`);
  if (!BOOKS && OUT) fs.writeFileSync(path.join(OUT, `finished-${tag}.txt`), `${new Date().toISOString()}\n`);
}

async function main() {
  if (has('status')) return status();
  if (!OUT && !BOOKS) throw new Error('--out=DIR is required');
  if (!KEY) throw new Error('PROVENANCE_SECRET_KEY is not set: refusing, a run without it would write unkeyed marks');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!process.env.R2_ACCESS_KEY_ID) throw new Error('R2 credentials are not set');
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  if (APPLY && !OUT) throw new Error('--apply needs --out for the ledger');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, maxPoolSize: Math.max(4, WORKERS) });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try { if (has('plan')) await plan(db); else await run(db); } finally { await client.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
