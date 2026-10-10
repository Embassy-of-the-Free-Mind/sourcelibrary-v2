#!/usr/bin/env node
/**
 * export-mirror.mjs — nightly Parquet mirror of `books` (all fields) + `pages` metadata (#5189).
 *
 * PRIOR ART: scripts/export/build-corpus-snapshot.mjs — a licensee TEXT export (JSONL per
 * book, rights-filtered, pages inline); wrong shape for audits and it re-reads the text this
 * mirror exists to avoid. scripts/workers/backup-books.sh — the 04:00 mongodump of `books`,
 * which this script REUSES as its books source (zero extra Atlas egress) when it is fresh.
 * Readers go through scripts/lib/mirror.mjs.
 *
 * Writes under MIRROR_DIR (scripts/lib/mirror.mjs; the Hetzner volume, never the root disk):
 *   staging/<id>/        NDJSON.gz chunks + checkpoint.json while the export runs (resumable)
 *   snapshots/<id>/      books.parquet, pages/bucket=NN/*.parquet, manifest.json
 *   latest -> snapshots/<id>   switched atomically only after the manifest is written
 *
 * books: from /root/backups/books-latest (the daily dump) if it is < --dump-max-age-h old and
 *   its count is within 1% of Atlas's; otherwise a live _id walk. Every top-level field
 *   becomes a column; nested values are JSON.
 * pages: live _id walk, ONE BSON TYPE AT A TIME (pages._id is mixed ObjectId/string; a range
 *   query is type-bracketed, so `$gte: ObjectId(0…)` and `$gte: ''` each walk one type over the
 *   _id index). Text never crosses the wire: an aggregation stage measures ocr/translation/
 *   transliteration lengths server-side and drops the strings. Read from a secondary, zlib
 *   wire compression on (measured 2026-10-06: page metadata 0.72 MB → 0.05 MB for 408 pages).
 *
 * Checkpoint: after every chunk (atomic rename). A re-run within --resume-max-age-h resumes
 * the same snapshot from the last completed chunk; an older staging dir is discarded.
 *
 *   node --env-file=.env.production.local scripts/maintenance/export-mirror.mjs
 *   ... --collections books            (just books)
 *   ... --limit-chunks 3 --dir /tmp/m  (smoke test; never publishes over a real mirror)
 *
 * Read-only against Atlas. Needs the DuckDB CLI (see scripts/lib/mirror.mjs).
 */
import { MongoClient, ObjectId, BSON } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MIRROR_DIR as DEFAULT_DIR, MIRROR_FORMAT, PAGE_BUCKETS, bucketOf, runDuckdb, assertManifest } from '../lib/mirror.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const DIR = arg('dir', DEFAULT_DIR);
const COLLECTIONS = arg('collections', 'books,pages').split(',');
const CHUNK = Number(arg('chunk', '50000'));
const LIMIT_CHUNKS = Number(arg('limit-chunks', '0'));
const DUMP_DIR = arg('dump-dir', '/root/backups/books-latest/bookstore');
const DUMP_MAX_AGE_H = Number(arg('dump-max-age-h', '20'));
const RESUME_MAX_AGE_H = Number(arg('resume-max-age-h', '20'));
const KEEP = Number(arg('keep', '2'));
const FORCE_LIVE_BOOKS = has('live-books');
if (LIMIT_CHUNKS && DIR === DEFAULT_DIR) { console.error('--limit-chunks is a smoke test: pass --dir <scratch dir> too'); process.exit(2); }
// Readers open books AND pages from one snapshot; a partial one may not become `latest` there.
if (COLLECTIONS.join() !== 'books,pages' && DIR === DEFAULT_DIR) { console.error('--collections other than books,pages needs --dir <scratch dir>'); process.exit(2); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI unset'); process.exit(2); }

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const t0 = Date.now();

// ---- free disk guard -----------------------------------------------------------
fs.mkdirSync(DIR, { recursive: true });
const freeGb = Number(execFileSync('df', ['--output=avail', '-B1G', DIR], { encoding: 'utf8' }).split('\n')[1]);
if (freeGb < 40) { console.error(`only ${freeGb} GB free under ${DIR}; need 40`); process.exit(1); }

// ---- plain-JSON conversion (ObjectId → hex, Date → ISO, binary dropped) ----------
function plain(v) {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    switch (v._bsontype) {
      case 'ObjectId': case 'ObjectID': return v.toHexString();
      case 'Long': case 'Int32': case 'Double': return Number(v);
      case 'Decimal128': return v.toString();
      case 'Binary': return null;
      case 'UUID': return v.toHexString ? v.toHexString() : String(v);
      case 'Timestamp': return v.toString();
      case 'BSONRegExp': return `/${v.pattern}/${v.options}`;
      case 'MinKey': case 'MaxKey': case 'Code': case 'DBRef': case 'BSONSymbol': return String(v);
      default: break;
    }
    if (v instanceof RegExp) return String(v);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}
const idType = (id) => (id instanceof ObjectId || id?._bsontype === 'ObjectId') ? 'objectId' : typeof id === 'string' ? 'string' : typeof id === 'number' ? 'number' : 'other';

// ---- staging + checkpoint ------------------------------------------------------
const stagingRoot = path.join(DIR, 'staging');
fs.mkdirSync(stagingRoot, { recursive: true });
let staging = null;
let ck = null;
for (const d of fs.readdirSync(stagingRoot)) {
  const p = path.join(stagingRoot, d, 'checkpoint.json');
  if (!fs.existsSync(p)) { fs.rmSync(path.join(stagingRoot, d), { recursive: true, force: true }); continue; }
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  const ageH = (Date.now() - Date.parse(c.started_at)) / 3.6e6;
  if (!staging && ageH < RESUME_MAX_AGE_H && c.collections.join() === COLLECTIONS.join()) { staging = path.join(stagingRoot, d); ck = c; log(`resuming ${d} (${ageH.toFixed(1)} h old)`); }
  else { log(`discarding stale staging ${d}`); fs.rmSync(path.join(stagingRoot, d), { recursive: true, force: true }); }
}
// Wire bytes accumulate across resumed processes: each run adds what its own sockets received.
let wirePrior = null;
const saveCk = () => { if (wirePrior !== null) ck.wire_bytes = wirePrior + wireTotal(); const p = path.join(staging, 'checkpoint.json'); fs.writeFileSync(p + '.tmp', JSON.stringify(ck, null, 1)); fs.renameSync(p + '.tmp', p); };
if (!staging) {
  const id = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
  staging = path.join(stagingRoot, id);
  fs.mkdirSync(staging, { recursive: true });
  ck = { snapshot_id: id, started_at: new Date().toISOString(), collections: COLLECTIONS, books: null, pages: null };
  saveCk();
}

wirePrior = ck.wire_bytes || 0;

// ---- Atlas client --------------------------------------------------------------
const client = new MongoClient(process.env.MONGODB_URI, {
  appName: 'export-mirror', compressors: ['zlib'], readPreference: 'secondaryPreferred',
  maxPoolSize: 2, socketTimeoutMS: 600_000,
});
await client.connect();
const db = client.db('bookstore');

// Sockets close and reopen over an hour; accumulate per-socket maxima across the run.
const wireSeen = new Map();
function trackWire() {
  try {
    const out = execFileSync('ss', ['-tnpiH', 'state', 'established', 'dport', '=', ':27017'], { encoding: 'utf8' });
    const L = out.split('\n');
    for (let i = 0; i < L.length; i++) {
      if (!L[i].includes(`pid=${process.pid},`)) continue;
      const k = (L[i].match(/\S+:(\d+)\s+\S+:27017/) || [])[1];
      const b = Number((L[i + 1]?.match(/bytes_received:(\d+)/) || [])[1] || 0);
      wireSeen.set(k, Math.max(wireSeen.get(k) || 0, b));
    }
  } catch {}
}
const wireTotal = () => [...wireSeen.values()].reduce((a, b) => a + b, 0);

// One NDJSON.gz chunk, streamed: only the current line is ever in memory. (Holding a
// chunk of rows OOMed the heap on the oldest books, ~150 KB of BSON each, and pushed the
// whole box into the kernel OOM killer — 2026-10-06.)
class ChunkWriter {
  constructor(name) {
    this.file = path.join(staging, name);
    this.gz = zlib.createGzip({ level: 3 });
    this.out = fs.createWriteStream(this.file + '.tmp');
    this.done = new Promise((res, rej) => { this.out.on('finish', res); this.out.on('error', rej); this.gz.on('error', rej); });
    this.gz.pipe(this.out);
    this.rows = 0;
    this.rawBytes = 0;
  }
  async write(obj) {
    const line = JSON.stringify(obj) + '\n';
    this.rows++; this.rawBytes += line.length;
    if (!this.gz.write(line)) await new Promise((res) => this.gz.once('drain', res));
  }
  async close() {
    this.gz.end();
    await this.done;
    fs.renameSync(this.file + '.tmp', this.file);
    return fs.statSync(this.file).size;
  }
  async abort() {
    this.gz.end();
    await this.done.catch(() => {});
    fs.rmSync(this.file + '.tmp', { force: true });
  }
}
// A replica-set member restarting mid-walk (seen 2026-10-06: ECONNREFUSED on one node for
// minutes) must cost one chunk's retry, not the night's export.
const TRANSIENT = /Network|ServerSelection|Timeout|PoolCleared|ECONNRESET|ECONNREFUSED|not primary|NotWritablePrimary|InterruptedAtShutdown|ShutdownInProgress/i;
async function retrying(label, fn, attempts = 6) {
  for (let a = 1; ; a++) {
    try { return await fn(); } catch (e) {
      if (a >= attempts || !TRANSIENT.test(`${e.name} ${e.codeName || ''} ${e.message}`)) throw e;
      log(`${label}: ${e.name}: ${e.message.slice(0, 120)} — retry ${a}/${attempts - 1} in ${30 * a}s`);
      await new Promise((r) => setTimeout(r, 30_000 * a));
    }
  }
}
async function writeChunk(name, rows) {
  const w = new ChunkWriter(name);
  for (const r of rows) await w.write(r);
  return w.close();
}

// ---- books -----------------------------------------------------------------------
function bookRow(doc) {
  const r = plain(doc);
  r._id = doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id);
  r._id_type = idType(doc._id);
  return r;
}

async function* readDump(file) {
  // mongodump --gzip: a gzipped stream of concatenated BSON documents.
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  let buf = Buffer.alloc(0);
  for await (const part of stream) {
    buf = buf.length ? Buffer.concat([buf, part]) : part;
    let off = 0;
    while (buf.length - off >= 4) {
      const len = buf.readInt32LE(off);
      if (buf.length - off < len) break;
      yield BSON.deserialize(buf.subarray(off, off + len), { promoteValues: true });
      off += len;
    }
    buf = buf.subarray(off);
  }
  if (buf.length) throw new Error(`dump ${file}: ${buf.length} trailing bytes — truncated dump`);
}

async function exportBooks() {
  if (ck.books?.done) { log('books: already exported in this snapshot'); return; }
  if (ck.books?.types) return exportBooksLive(ck.books.live_count_at_start, true);
  for (const f of fs.readdirSync(staging)) if (f.startsWith('books-')) fs.rmSync(path.join(staging, f));
  const liveStart = await db.collection('books').estimatedDocumentCount();
  const dumpFile = path.join(DUMP_DIR, 'books.bson.gz');
  const metaFile = path.join(DUMP_DIR, 'books.metadata.json.gz');
  let source = 'live';
  let asOf = new Date().toISOString();
  if (!FORCE_LIVE_BOOKS && fs.existsSync(dumpFile) && fs.existsSync(metaFile)) {
    // metadata.json is written when the dump STARTS: that is the dump's point in time.
    const startedAt = fs.statSync(metaFile).mtime;
    const ageH = (Date.now() - startedAt.getTime()) / 3.6e6;
    if (ageH < DUMP_MAX_AGE_H) { source = 'dump'; asOf = startedAt.toISOString(); }
    else log(`books: dump is ${ageH.toFixed(1)} h old (> ${DUMP_MAX_AGE_H}); walking Atlas instead`);
  }
  ck.books = { source, as_of: asOf, live_count_at_start: liveStart, rows: 0, by_id_type: {}, chunks: 0, last: null };
  saveCk();
  log(`books: source=${source} as_of=${asOf} live=${liveStart}`);
  // Rotate by bytes, not rows: book size spans three orders of magnitude.
  const BOOK_CHUNK_BYTES = 256 * 2 ** 20;
  let w = null;
  const rotate = async () => { if (w) { await w.close(); ck.books.chunks++; w = null; } };
  if (source === 'dump') {
    for await (const doc of readDump(dumpFile)) {
      if (!w) w = new ChunkWriter(`books-dump-${String(ck.books.chunks).padStart(5, '0')}.ndjson.gz`);
      const r = bookRow(doc);
      ck.books.by_id_type[r._id_type] = (ck.books.by_id_type[r._id_type] || 0) + 1;
      ck.books.rows++;
      await w.write(r);
      if (w.rawBytes >= BOOK_CHUNK_BYTES) await rotate();
      if (LIMIT_CHUNKS && ck.books.chunks >= LIMIT_CHUNKS) break;
    }
    await rotate();
    // The dump is as of 04:00. Books changed since then (an import wave adds ~10K a day) are
    // refetched from Atlas when the changelog can vouch for the window; the dump's copies of
    // them are dropped at conversion.
    const from = new Date(Date.parse(asOf) - DELTA_MARGIN_MS).toISOString();
    const cutoff = new Date().toISOString();
    const cover = LIMIT_CHUNKS ? { ok: false, reason: 'smoke test' } : changelogCovers(from, cutoff);
    if (cover.ok) {
      const changed = await collectChangedIds('books', from, cutoff);
      await writeChunk('books-changed-ids.ndjson.gz', changed);
      const BATCH = 500;
      let fetched = 0;
      for (let b = 0; b * BATCH < changed.length; b++) {
        const ids = changed.slice(b * BATCH, (b + 1) * BATCH).map((x) => (x.it === 'objectId' ? new ObjectId(x._id) : x.it === 'number' ? Number(x._id) : x._id));
        const dw = await retrying(`books delta batch ${b}`, async () => {
          const cw = new ChunkWriter(`books-delta-${String(b).padStart(5, '0')}.ndjson.gz`);
          try {
            for await (const doc of db.collection('books').find({ _id: { $in: ids } }, { batchSize: 200 })) await cw.write(bookRow(doc));
            return cw;
          } catch (e) { await cw.abort(); throw e; }
        });
        trackWire();
        if (dw.rows) await dw.close(); else await dw.abort();
        fetched += dw.rows;
      }
      ck.books.delta = { from, cutoff, changed: changed.length, fetched };
      ck.books.as_of = cutoff;
      ck.books.source = 'dump + changelog delta';
      log(`books: dump ${ck.books.rows} + ${fetched} refetched of ${changed.length} changed since ${from}`);
    } else if (!LIMIT_CHUNKS && Math.abs(ck.books.rows - liveStart) > 0.01 * liveStart) {
      // The dump is a backup, not a manifest: unvouched and off by >1%, walk Atlas instead.
      log(`books: dump has ${ck.books.rows} vs ${liveStart} live and ${cover.reason} — falling back to a live walk`);
      for (const f of fs.readdirSync(staging)) if (f.startsWith('books-')) fs.rmSync(path.join(staging, f));
      ck.books = null; saveCk();
      FORCE_LIVE_BOOKS_FALLBACK = true;
      return exportBooksLive(liveStart);
    }
  } else {
    return exportBooksLive(liveStart);
  }
  ck.books.done = true; saveCk();
  log(`books: ${ck.books.rows} rows from ${source}`);
}
let FORCE_LIVE_BOOKS_FALLBACK = false;

async function walkTyped(collName, state, buildPipeline, toRow, chunkSize = CHUNK) {
  // One BSON type at a time; each bracket is a contiguous range of the _id index.
  const brackets = [
    ['objectId', { $gte: new ObjectId('000000000000000000000000') }, (v) => ({ $gt: new ObjectId(v) })],
    ['string', { $gte: '' }, (v) => ({ $gt: v })],
    ['number', { $gte: -Infinity }, (v) => ({ $gt: v })],
  ];
  for (const [type, first, after] of brackets) {
    const st = state.types[type] ||= { done: false, last: null, rows: 0, chunks: 0 };
    while (!st.done) {
      if (LIMIT_CHUNKS && state.chunks >= LIMIT_CHUNKS) return;
      const match = { _id: st.last === null ? first : after(st.last) };
      let lastId = null;
      const w = await retrying(`${collName} ${type} chunk ${st.chunks}`, async () => {
        const cw = new ChunkWriter(`${collName}-${type}-${String(st.chunks).padStart(5, '0')}.ndjson.gz`);
        try {
          const cursor = db.collection(collName).aggregate(buildPipeline(match), { allowDiskUse: false, maxTimeMS: 600_000, batchSize: 2000 });
          for await (const doc of cursor) { await cw.write(toRow(doc)); lastId = doc._id; }
          return cw;
        } catch (e) { await cw.abort(); throw e; }
      });
      trackWire();
      if (!w.rows) { await w.abort(); st.done = true; break; }
      const bytes = await w.close();
      const n = w.rows;
      st.last = lastId instanceof ObjectId ? lastId.toHexString() : lastId;
      st.rows += n; st.chunks++; state.chunks++; state.rows += n;
      state.staged_bytes = (state.staged_bytes || 0) + bytes;
      saveCk();
      if (n < chunkSize) st.done = true;
      if (state.chunks % 20 === 0) log(`${collName}: ${state.rows.toLocaleString()} rows (${type}), ${((Date.now() - t0) / 60000).toFixed(1)} min, wire ${(wireTotal() / 1e6).toFixed(0)} MB`);
    }
  }
  state.done = true;
}

const BOOK_LIVE_CHUNK = 5000;
async function exportBooksLive(liveStart, resume = false) {
  if (!resume) ck.books = { source: FORCE_LIVE_BOOKS_FALLBACK ? 'live (dump count mismatch)' : 'live', as_of: new Date().toISOString(), live_count_at_start: liveStart, rows: 0, chunks: 0, types: {}, by_id_type: {} };
  saveCk();
  await walkTyped('books', ck.books, (match) => [{ $match: match }, { $sort: { _id: 1 } }, { $limit: BOOK_LIVE_CHUNK }], (doc) => {
    const r = bookRow(doc);
    ck.books.by_id_type[r._id_type] = (ck.books.by_id_type[r._id_type] || 0) + 1;
    return r;
  }, BOOK_LIVE_CHUNK);
  saveCk();
  log(`books: ${ck.books.rows} rows live`);
}

// ---- pages -----------------------------------------------------------------------
const textLen = (p) => ({ $cond: [{ $eq: [{ $type: p }, 'string'] }, { $strLenBytes: p }, null] });
const PAGE_PIPELINE = (match) => [
  { $match: match },
  { $sort: { _id: 1 } },
  { $limit: CHUNK },
  {
    $addFields: {
      __ocr_bytes: textLen('$ocr.data'),
      __translation_bytes: textLen('$translation.data'),
      __transliteration_bytes: textLen('$transliteration.data'),
      __translation_langs: { $cond: [{ $eq: [{ $type: '$translations' }, 'object'] }, { $map: { input: { $objectToArray: '$translations' }, in: '$$this.k' } }, null] },
    },
  },
  // Exclusion is deliberate HERE: the mirror wants every metadata field, including ones
  // added after this script was written; only the known text payloads are dropped.
  { $project: { 'ocr.data': 0, 'translation.data': 0, 'transliteration.data': 0, translations: 0, 'translation_withheld.data': 0, 'ocr.raw': 0 } },
];
const s = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : String(v));
function pageRow(doc) {
  const d = plain(doc);
  const ocr = d.ocr && typeof d.ocr === 'object' ? d.ocr : {};
  const tr = d.translation && typeof d.translation === 'object' ? d.translation : {};
  const am = d.archive_metadata && typeof d.archive_metadata === 'object' ? d.archive_metadata : {};
  const { __ocr_bytes, __translation_bytes, __transliteration_bytes, __translation_langs, ...meta } = d;
  meta._id = undefined;
  return {
    _id: doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id),
    _id_type: idType(doc._id),
    id: s(d.id), book_id: s(d.book_id), bucket: d.book_id != null ? bucketOf(d.book_id) : 0,
    page_number: typeof d.page_number === 'number' ? d.page_number : null,
    page_type: s(d.page_type), script_type: s(d.script_type),
    created_at: s(d.created_at), updated_at: s(d.updated_at),
    photo: s(d.photo), photo_original: s(d.photo_original), archived_photo: s(d.archived_photo),
    display_photo: s(d.display_photo), cropped_photo: s(d.cropped_photo), thumbnail: s(d.thumbnail),
    thumbnail_blob: s(d.thumbnail_blob), image_thumb: s(d.image_thumb), image_display: s(d.image_display),
    image_width: typeof d.image_width === 'number' ? d.image_width : null,
    image_height: typeof d.image_height === 'number' ? d.image_height : null,
    read_count: typeof d.read_count === 'number' ? d.read_count : null,
    ocr_bytes: __ocr_bytes ?? null, ocr_model: s(ocr.model), ocr_source: s(ocr.source), ocr_language: s(ocr.language),
    ocr_updated_at: s(ocr.updated_at), ocr_batch_job_id: s(ocr.batch_job_id), ocr_content_hash: s(ocr.content_hash),
    ocr_prompt_hash: s(ocr.prompt_hash), ocr_prompt_version: s(ocr.prompt_version), ocr_pipeline: s(ocr.pipeline),
    translation_bytes: __translation_bytes ?? null, translation_model: s(tr.model), translation_source: s(tr.source),
    translation_language: s(tr.language), translation_updated_at: s(tr.updated_at), translation_content_hash: s(tr.content_hash),
    translation_prompt_hash: s(tr.prompt_hash), translation_prompt_version: s(tr.prompt_version),
    transliteration_bytes: __transliteration_bytes ?? null, translation_langs: __translation_langs ?? null,
    translation_withheld: d.translation_withheld != null,
    archived_at: s(am.archived_at), archive_bytes: typeof am.bytes === 'number' ? am.bytes : null,
    meta: JSON.stringify(meta),
  };
}
const PAGE_COLUMNS = {
  _id: 'VARCHAR', _id_type: 'VARCHAR', id: 'VARCHAR', book_id: 'VARCHAR', bucket: 'INTEGER', page_number: 'DOUBLE',
  page_type: 'VARCHAR', script_type: 'VARCHAR', created_at: 'VARCHAR', updated_at: 'VARCHAR',
  photo: 'VARCHAR', photo_original: 'VARCHAR', archived_photo: 'VARCHAR', display_photo: 'VARCHAR', cropped_photo: 'VARCHAR',
  thumbnail: 'VARCHAR', thumbnail_blob: 'VARCHAR', image_thumb: 'VARCHAR', image_display: 'VARCHAR',
  image_width: 'DOUBLE', image_height: 'DOUBLE', read_count: 'DOUBLE',
  ocr_bytes: 'BIGINT', ocr_model: 'VARCHAR', ocr_source: 'VARCHAR', ocr_language: 'VARCHAR', ocr_updated_at: 'VARCHAR',
  ocr_batch_job_id: 'VARCHAR', ocr_content_hash: 'VARCHAR', ocr_prompt_hash: 'VARCHAR', ocr_prompt_version: 'VARCHAR', ocr_pipeline: 'VARCHAR',
  translation_bytes: 'BIGINT', translation_model: 'VARCHAR', translation_source: 'VARCHAR', translation_language: 'VARCHAR',
  translation_updated_at: 'VARCHAR', translation_content_hash: 'VARCHAR', translation_prompt_hash: 'VARCHAR', translation_prompt_version: 'VARCHAR',
  transliteration_bytes: 'BIGINT', translation_langs: 'VARCHAR[]', translation_withheld: 'BOOLEAN',
  archived_at: 'VARCHAR', archive_bytes: 'DOUBLE', meta: 'VARCHAR',
};
const TS_COLUMNS = ['created_at', 'updated_at', 'ocr_updated_at', 'translation_updated_at', 'archived_at'];

// Full walk weekly (or when the changelog cannot vouch for the window); otherwise refetch
// only the pages the changelog saw change since the base snapshot's as_of.
const FULL_EVERY_DAYS = Number(arg('full-every-days', '7'));
// Covers clock skew between this box and clusterTime (seconds-truncated); both are NTP-synced.
const DELTA_MARGIN_MS = 2 * 60_000;
const CHANGELOG_DIR = path.join(DIR, 'changelog');

function planPages() {
  if (has('full')) return { mode: 'full', reason: '--full' };
  const latest = path.join(DIR, 'latest');
  if (!fs.existsSync(latest)) return { mode: 'full', reason: 'no previous snapshot' };
  const baseDir = fs.realpathSync(latest);
  const base = JSON.parse(fs.readFileSync(path.join(baseDir, 'manifest.json'), 'utf8'));
  const bp = base.collections?.pages;
  if (base.status !== 'complete' || !bp) return { mode: 'full', reason: 'previous snapshot has no pages' };
  const fullAsOf = bp.full_as_of || bp.as_of;
  if (Date.now() - Date.parse(fullAsOf) > FULL_EVERY_DAYS * 86400_000) return { mode: 'full', reason: `weekly rebuild (base full walk ${fullAsOf})` };
  const from = new Date(Date.parse(bp.as_of) - DELTA_MARGIN_MS).toISOString();
  const cutoff = new Date().toISOString();
  const cover = changelogCovers(from, cutoff);
  if (!cover.ok) return { mode: 'full', reason: cover.reason };
  return { mode: 'delta', reason: 'changelog covers the window', base_snapshot: base.snapshot_id, base_dir: baseDir, base_rows: bp.rows, from, cutoff, full_as_of: fullAsOf };
}

/** Can the changelog vouch for every change in [from, cutoff]? */
function changelogCovers(from, cutoff) {
  const statePath = path.join(CHANGELOG_DIR, 'state.json');
  if (!fs.existsSync(statePath)) return { ok: false, reason: 'no changelog' };
  const cl = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!cl.covered_since || cl.covered_since > from) return { ok: false, reason: `changelog covers only since ${cl.covered_since}` };
  const gap = (cl.gaps || []).find((g) => (g.to === null || g.to >= from) && g.from <= cutoff);
  if (gap) return { ok: false, reason: `changelog gap ${gap.from}..${gap.to} (${gap.reason})` };
  // The changelog must be alive: a stalled writer leaves no gap record, only silence.
  if (!cl.heartbeat || Date.now() - Date.parse(cl.heartbeat) > 15 * 60_000) return { ok: false, reason: `changelog heartbeat stale (${cl.heartbeat})` };
  return { ok: true };
}

async function collectChangedIds(coll, from, cutoff) {
  const ids = new Map();
  const days = fs.readdirSync(CHANGELOG_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f) && f.slice(0, 10) >= from.slice(0, 10) && f.slice(0, 10) <= cutoff.slice(0, 10)).sort();
  const { createInterface } = await import('node:readline');
  for (const f of days) {
    const rl = createInterface({ input: fs.createReadStream(path.join(CHANGELOG_DIR, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.c !== coll || e.t < from || e.t > cutoff) continue;
      ids.set(`${e.it}:${e.id}`, { _id: e.id, it: e.it });
    }
  }
  return [...ids.values()];
}

async function exportPages() {
  if (ck.pages?.done) { log('pages: already exported in this snapshot'); return; }
  if (!ck.pages) {
    const plan = planPages();
    log(`pages: plan ${plan.mode} — ${plan.reason}`);
    const live = await db.collection('pages').estimatedDocumentCount();
    if (plan.mode === 'delta') {
      const changed = await collectChangedIds('pages', plan.from, plan.cutoff);
      await writeChunk('changed-ids.ndjson.gz', changed);
      ck.pages = { mode: 'delta', plan, as_of: plan.cutoff, full_as_of: plan.full_as_of, live_count_at_start: live, changed: changed.length, rows: 0, chunks: 0, batches_done: 0 };
    } else {
      ck.pages = { mode: 'full', plan, as_of: new Date().toISOString(), live_count_at_start: live, rows: 0, chunks: 0, types: {} };
      ck.pages.full_as_of = ck.pages.as_of;
    }
    saveCk();
  }
  if (ck.pages.mode === 'delta') return exportPagesDelta();
  log(`pages: walking from ${JSON.stringify(Object.fromEntries(Object.entries(ck.pages.types).map(([k, v]) => [k, v.rows])))}; live=${ck.pages.live_count_at_start}`);
  await walkTyped('pages', ck.pages, PAGE_PIPELINE, pageRow);
  saveCk();
  log(`pages: ${ck.pages.rows} rows`);
}

async function exportPagesDelta() {
  const { createInterface } = await import('node:readline');
  const changed = [];
  const rl = createInterface({ input: fs.createReadStream(path.join(staging, 'changed-ids.ndjson.gz')).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) changed.push(JSON.parse(line));
  const BATCH = 2000;
  const batches = Math.ceil(changed.length / BATCH);
  log(`pages: delta — ${changed.length.toLocaleString()} changed ids since ${ck.pages.plan.from}, ${batches} batches, resuming at ${ck.pages.batches_done}`);
  for (let b = ck.pages.batches_done; b < batches; b++) {
    const slice = changed.slice(b * BATCH, (b + 1) * BATCH);
    const ids = slice.map((x) => (x.it === 'objectId' ? new ObjectId(x._id) : x.it === 'number' ? Number(x._id) : x._id));
    const pipe = PAGE_PIPELINE({ _id: { $in: ids } }).filter((st) => !st.$sort && !st.$limit);
    const w = await retrying(`pages delta batch ${b}`, async () => {
      const cw = new ChunkWriter(`pages-delta-${String(b).padStart(5, '0')}.ndjson.gz`);
      try {
        for await (const doc of db.collection('pages').aggregate(pipe, { maxTimeMS: 600_000, batchSize: 2000 })) await cw.write(pageRow(doc));
        return cw;
      } catch (e) { await cw.abort(); throw e; }
    });
    trackWire();
    if (w.rows) ck.pages.staged_bytes = (ck.pages.staged_bytes || 0) + await w.close();
    else await w.abort();
    ck.pages.rows += w.rows; ck.pages.chunks++; ck.pages.batches_done = b + 1;
    saveCk();
    if ((b + 1) % 50 === 0) log(`pages: delta ${b + 1}/${batches} batches, ${ck.pages.rows.toLocaleString()} rows, wire ${(wireTotal() / 1e6).toFixed(0)} MB`);
  }
  ck.pages.done = true;
  saveCk();
  log(`pages: delta fetched ${ck.pages.rows.toLocaleString()} of ${changed.length.toLocaleString()} changed ids (the rest were deleted)`);
}

// ---- run ------------------------------------------------------------------------
if (COLLECTIONS.includes('books')) await exportBooks();
if (COLLECTIONS.includes('pages')) await exportPages();
trackWire();
saveCk();
await client.close();
if (LIMIT_CHUNKS) log('smoke test: chunk limit reached, converting what was staged');
else if ((COLLECTIONS.includes('books') && !ck.books?.done) || (COLLECTIONS.includes('pages') && !ck.pages?.done)) {
  console.error('export incomplete; re-run to resume'); process.exit(1);
}

// ---- convert to Parquet ------------------------------------------------------------
const snapDir = path.join(DIR, 'snapshots', ck.snapshot_id);
fs.rmSync(snapDir, { recursive: true, force: true });
fs.mkdirSync(snapDir, { recursive: true });
const manifest = {
  format: MIRROR_FORMAT, snapshot_id: ck.snapshot_id, status: 'building',
  as_of: null, started_at: ck.started_at, finished_at: null, host: os.hostname(),
  exporter: (() => { try { return execFileSync('git', ['-C', path.dirname(new URL(import.meta.url).pathname), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
  page_buckets: PAGE_BUCKETS, collections: {},
};
const describe = (rel) => runDuckdb(`DESCRIBE SELECT * FROM read_parquet('${rel}', hive_partitioning = true)`).map((r) => ({ name: r.column_name, type: r.column_type }));
const schemaHash = (cols) => crypto.createHash('sha256').update(cols.map((c) => `${c.name}:${c.type}`).join('\n')).digest('hex').slice(0, 16);
const duBytes = (p) => Number(execFileSync('du', ['-sb', p], { encoding: 'utf8' }).split('\t')[0]);

if (COLLECTIONS.includes('books')) {
  const t = Date.now();
  const out = path.join(snapDir, 'books.parquet');
  const files = fs.readdirSync(staging).filter((f) => /^books-(dump|delta|objectId|string|number)-\d+\.ndjson\.gz$/.test(f)).map((f) => `'${path.join(staging, f)}'`);
  const src = `read_json([${files.join(', ')}], format = 'newline_delimited', maximum_depth = 1, sample_size = -1, union_by_name = true, map_inference_threshold = -1, filename = true)`;
  // With a delta, the dump's copy of every changed book is dropped (updated, or deleted).
  const where = ck.books.delta
    ? `WHERE NOT (r.filename LIKE '%/books-dump-%' AND EXISTS (SELECT 1 FROM read_json('${staging}/books-changed-ids.ndjson.gz', format = 'newline_delimited', columns = {'_id': 'VARCHAR', 'it': 'VARCHAR'}) c WHERE c._id = json_extract_string(r._id, '$') AND c.it = json_extract_string(r._id_type, '$')))`
    : '';
  // Every books column is JSON (maximum_depth = 1); the two id columns are always strings and
  // (json_extract_string, not ->>: `a = j->>'$'` parses as `(a = j)->>'$'`)
  // are what readers join on, so they are stored as VARCHAR.
  runDuckdb(`COPY (SELECT * EXCLUDE (filename) REPLACE (json_extract_string(r._id, '$') AS _id, json_extract_string(r._id_type, '$') AS _id_type) FROM ${src} r ${where}) TO '${out}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 5000)`, { memoryLimit: '6GB', threads: 2, timeoutMs: 3 * 3600_000 });
  const [{ n }] = runDuckdb(`SELECT count(*)::BIGINT AS n FROM read_parquet('${out}')`);
  const [{ dup }] = runDuckdb(`SELECT count(*)::BIGINT AS dup FROM (SELECT _id, _id_type FROM read_parquet('${out}') GROUP BY ALL HAVING count(*) > 1)`);
  const cols = describe(out);
  const byType = runDuckdb(`SELECT _id_type AS t, count(*)::BIGINT AS n FROM read_parquet('${out}') GROUP BY 1`);
  manifest.collections.books = {
    source: ck.books.source, as_of: ck.books.as_of, rows: Number(n), staged_rows: ck.books.rows, delta: ck.books.delta ?? null,
    duplicate_ids: Number(dup), live_count_at_start: ck.books.live_count_at_start, by_id_type: Object.fromEntries(byType.map((r) => [r.t, Number(r.n)])),
    columns: cols, schema_hash: schemaHash(cols), bytes_on_disk: duBytes(out), convert_s: Math.round((Date.now() - t) / 1000),
  };
  if (Number(dup) > 0) throw new Error(`books: ${dup} duplicate _id rows in the new snapshot`);
  if (!ck.books.delta && Number(n) !== ck.books.rows) throw new Error(`books: parquet has ${n} rows, staged ${ck.books.rows}`);
  log(`books.parquet: ${n} rows, ${cols.length} columns, ${(manifest.collections.books.bytes_on_disk / 1e6).toFixed(0)} MB`);
}
if (COLLECTIONS.includes('pages')) {
  const t = Date.now();
  const out = path.join(snapDir, 'pages');
  const colSpec = '{' + Object.entries(PAGE_COLUMNS).map(([k, v]) => `'${k}': '${v}'`).join(', ') + '}';
  const select = Object.keys(PAGE_COLUMNS).map((k) => TS_COLUMNS.includes(k) ? `TRY_CAST(${k} AS TIMESTAMPTZ) AS ${k}` : k === 'meta' ? `meta::JSON AS meta` : k).join(', ');
  const fresh = `SELECT ${select} FROM read_json('${staging}/pages-*.ndjson.gz', format = 'newline_delimited', columns = ${colSpec})`;
  const delta = ck.pages.mode === 'delta';
  let body = fresh;
  if (delta) {
    // Base minus every changed id (updated, replaced, or deleted), plus the refetched rows.
    const baseGlob = path.join(ck.pages.plan.base_dir, 'pages', '*', '*.parquet');
    const changedSrc = `read_json('${staging}/changed-ids.ndjson.gz', format = 'newline_delimited', columns = {'_id': 'VARCHAR', 'it': 'VARCHAR'})`;
    const baseCols = Object.keys(PAGE_COLUMNS).map((k) => `b.${k}`).join(', ');
    const hasDelta = fs.readdirSync(staging).some((f) => f.startsWith('pages-delta-'));
    body = `SELECT ${baseCols} FROM read_parquet('${baseGlob}', hive_partitioning = true) b ANTI JOIN ${changedSrc} c ON c._id = b._id AND c.it = b._id_type` + (hasDelta ? ` UNION ALL BY NAME ${fresh}` : '');
  }
  runDuckdb(`COPY (${body}) TO '${out}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (bucket), ROW_GROUP_SIZE 100000)`, { memoryLimit: '6GB', threads: 4, timeoutMs: 4 * 3600_000 });
  const [{ n }] = runDuckdb(`SELECT count(*)::BIGINT AS n FROM read_parquet('${out}/*/*.parquet', hive_partitioning = true)`);
  const [{ dup }] = runDuckdb(`SELECT count(*)::BIGINT AS dup FROM (SELECT _id, _id_type FROM read_parquet('${out}/*/*.parquet', hive_partitioning = true) GROUP BY ALL HAVING count(*) > 1)`);
  const byType = runDuckdb(`SELECT _id_type AS t, count(*)::BIGINT AS n FROM read_parquet('${out}/*/*.parquet', hive_partitioning = true) GROUP BY 1`);
  const cols = describe(`${out}/*/*.parquet`);
  manifest.collections.pages = {
    source: delta ? `delta on ${ck.pages.plan.base_snapshot}` : 'live full walk', mode: ck.pages.mode, plan_reason: ck.pages.plan?.reason,
    as_of: ck.pages.as_of, full_as_of: ck.pages.full_as_of || ck.pages.as_of,
    rows: Number(n), staged_rows: ck.pages.rows, changed_ids: ck.pages.changed ?? null, duplicate_ids: Number(dup),
    live_count_at_start: ck.pages.live_count_at_start,
    by_id_type: Object.fromEntries(byType.map((r) => [r.t, Number(r.n)])),
    columns: cols, schema_hash: schemaHash(cols), bytes_on_disk: duBytes(out), convert_s: Math.round((Date.now() - t) / 1000),
    text_fields_excluded: ['ocr.data', 'translation.data', 'transliteration.data', 'translations', 'translation_withheld.data', 'ocr.raw'],
  };
  if (Number(dup) > 0) throw new Error(`pages: ${dup} duplicate _id rows in the new snapshot`);
  if (!delta && Number(n) !== ck.pages.rows) throw new Error(`pages: parquet has ${n} rows, staged ${ck.pages.rows}`);
  log(`pages: ${n} rows (${ck.pages.mode}), ${(manifest.collections.pages.bytes_on_disk / 1e9).toFixed(2)} GB`);
}

// as_of is the OLDEST collection's point in time: no row is fresher-than-claimed.
manifest.as_of = Object.values(manifest.collections).map((c) => c.as_of).sort()[0];
manifest.finished_at = new Date().toISOString();
manifest.duration_s = Math.round((Date.now() - Date.parse(ck.started_at)) / 1000);
manifest.wire_bytes_from_atlas = ck.wire_bytes ?? null;
manifest.status = 'complete';
fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

if (LIMIT_CHUNKS) { log(`smoke test written to ${snapDir} (not published)`); process.exit(0); }

// Self-check with the readers' own contract before publishing.
assertManifest(manifest, { collections: COLLECTIONS });

// ---- publish: atomic symlink swap, prune, clear staging ------------------------------
const latest = path.join(DIR, 'latest');
fs.rmSync(latest + '.tmp', { force: true });
fs.symlinkSync(path.join('snapshots', ck.snapshot_id), latest + '.tmp');
fs.renameSync(latest + '.tmp', latest);
log(`published ${ck.snapshot_id}`);
const snaps = fs.readdirSync(path.join(DIR, 'snapshots')).sort();
for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) {
  if (old === ck.snapshot_id) continue;
  fs.rmSync(path.join(DIR, 'snapshots', old), { recursive: true, force: true });
  log(`pruned snapshot ${old}`);
}
fs.rmSync(staging, { recursive: true, force: true });
log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min; Atlas wire bytes for this snapshot: ${((ck.wire_bytes || 0) / 1e6).toFixed(0)} MB`);
