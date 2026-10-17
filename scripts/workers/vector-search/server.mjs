// Page-vector service (#6821): the ~7.6M page_translations vectors in an 8-bit HNSW held in RAM, so a
// semantic lookup costs ~ms instead of Supabase's ~1.1 s cold read of its on-disk index.
//
//   VECTOR_SEARCH_TOKEN=… node server.mjs        (systemd: infrastructure/systemd/vector-search.service)
//
// Two listeners, same handler:
//   127.0.0.1:$VECTOR_SEARCH_LOCAL_PORT (3459)    no auth; also serves /admin/* (sync-delta.mjs)
//   0.0.0.0:$VECTOR_SEARCH_PORT (3458)            Bearer $VECTOR_SEARCH_TOKEN on every route; no /admin
//
// POST /match  {vector[768], k, threshold, filter_language?, filter_languages?, filter_exclude_languages?,
//               year_min?, year_max?}  →  {rows: [{page_id, book_id, page_number, similarity}], ms, path,
//               complete, filtered_rows, candidates, rounds}
//   Same contract as match_semantic (scripts/migration/apply-semantic-language-prefilter.sql) minus
//   the text columns, which the app hydrates by primary key. Filters are the RPC's predicates, on the
//   same columns (page_translations.book_language / book_year, per row), compared by exact string
//   equality: the app expands language names (expandLanguages) BEFORE the call, as it does for the RPC.
//   Threshold: similarity = 1 − cosine distance, kept when `> threshold` (the RPC's operator).
//   Filtered queries (phase 3) — `path` says which ran:
//     exact       the filter passes ≤ EXACT_MAX rows: an int8 exact scan of exactly those rows
//                 (exact.i8, ordered by language and year; build-exact.mjs)
//     hnsw        HNSW over-fetch sized by the filter's share of the corpus, widened by the pass rate
//                 actually observed, up to MAX_ASK candidates or BUDGET_MS
//     hnsw+exact  the widening ran out with < k rows and the filter passes ≤ EXACT_FALLBACK_MAX rows
//   `complete: false` means fewer than k rows came back AND rows above the threshold may exist that
//   were not looked at — the caller should not serve that as the answer (the app falls back to the RPC).
// GET  /health {size, built_at, last_delta_at, book_map_size, …}
//
// PRIOR ART: sourcelibrary-atlas scripts/local-corpus/semantic-lib.mjs — the query path (usearch,
// i8, cos). That one memory-maps the index (`view`) and re-ranks against a separate int8 matrix; this
// loads it into RAM (`load`, so no query waits on a disk read) and filters instead of re-ranking.
// src/lib/clip.ts + scripts/workers/clip-server.mjs — the plain-HTTP-plus-token service shape.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import {
  DIM, SHARD_DIR, indexConfigFor, readState, writeJsonAtomic, STATE_PATH, indexPath, rowsPath, loadUsearch, RowStore, log,
  EXACT_VEC_PATH, EXACT_KEYS_PATH, EXACT_META_PATH, overridesPath, quantizeI8, classLang, classYear,
} from './lib.mjs';

const PORT = +(process.env.VECTOR_SEARCH_PORT || 3458);
const LOCAL_PORT = +(process.env.VECTOR_SEARCH_LOCAL_PORT || 3459);
const TOKEN = process.env.VECTOR_SEARCH_TOKEN || '';
const EF = +(process.env.VECTOR_SEARCH_EF || 128);
const MAX_K = 1000;
// Filtered path (phase 3). Measured on l7a 2026-10-17: HNSW k=1000 costs ~5 ms; the int8 exact scan
// ~0.3 µs/row on one core plus the read (scripts/eval/experiments/2026-10-17-vector-service-filtered-recall-6821.md).
const OVERFETCH = 4;    // the first HNSW ask is at least k×4 …
const MARGIN = 2;       // … and at least 2× the k / (filter's share of the corpus) the filter needs on average
const MAX_ASK = +(process.env.VECTOR_SEARCH_MAX_ASK || 16384);
const BUDGET_MS = +(process.env.VECTOR_SEARCH_BUDGET_MS || 250); // the app gives the call 400 ms; fra1 → l7a is the rest
const EXACT_MAX = +(process.env.VECTOR_SEARCH_EXACT_MAX || 300000);
const EXACT_FALLBACK_MAX = +(process.env.VECTOR_SEARCH_EXACT_FALLBACK_MAX || 600000);
const EXACT_THREADS = +(process.env.VECTOR_SEARCH_EXACT_THREADS || 8); // one query's scan splits across threads: 153K rows in 21 ms at 8, 136 ms at 1
const EXACT_CHUNK = 131072; // rows per read: 96 MB
if (!TOKEN || TOKEN.length < 32) { console.error('VECTOR_SEARCH_TOKEN missing or short (expected openssl rand -hex 32)'); process.exit(2); }

const { Index, exactSearch } = loadUsearch();
const state = readState();
if (!state) { console.error(`no ${STATE_PATH} — run bootstrap.sh first`); process.exit(3); }
// A save interrupted by a restart leaves its *.tmp files (up to 7 GB); state.json never points at them.
for (const f of fs.readdirSync(path.dirname(STATE_PATH))) if (f.endsWith('.tmp') || /\.tmp-\d+$/.test(f)) fs.unlinkSync(path.join(path.dirname(STATE_PATH), f));
let t0 = Date.now();
const index = new Index({ ...indexConfigFor(state), expansion_search: EF });
index.load(indexPath(state.generation));
log(`index gen ${state.generation}: ${index.size().toLocaleString()} vectors loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
t0 = Date.now();
const rows = await RowStore.load(rowsPath(state.generation));
log(`rows: ${rows.n.toLocaleString()} keys, ${rows.live.toLocaleString()} live, ${rows.booksLive.toLocaleString()} books in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
let nextKey = Math.max(state.next_key || 0, rows.n);

// The exact-scan file, if it was built from THIS index (a rebuild renumbers keys). Without it the
// filtered path is HNSW only, and says so in /health.
let exact = null;
const overrides = new Map(); // key → Int8Array: rows a delta added or re-embedded since the file was built
try {
  if (fs.existsSync(EXACT_META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(EXACT_META_PATH, 'utf8'));
    if (meta.index_built_at !== state.built_at) log(`exact file is for the index built ${meta.index_built_at}, not ${state.built_at}: ignored (run build-exact.mjs)`);
    else {
      const kb = fs.readFileSync(EXACT_KEYS_PATH);
      exact = {
        meta, fh: await fs.promises.open(EXACT_VEC_PATH, 'r'),
        keys: new Uint32Array(kb.buffer, kb.byteOffset, kb.length / 4),
        classes: meta.classes.map(([lang, year, start, count]) => ({ lang, year, start, count })),
      };
      const op = overridesPath(state.generation);
      if (fs.existsSync(op)) {
        const b = fs.readFileSync(op); const rec = 4 + DIM;
        for (let o = 0; o + rec <= b.length; o += rec) overrides.set(b.readUInt32LE(o), new Int8Array(b.buffer.slice(b.byteOffset + o + 4, b.byteOffset + o + rec)));
      }
      // The float32 shards, if still on disk, re-rank the int8 scan's candidates: key = shard row ordinal.
      const shardFiles = fs.existsSync(SHARD_DIR) ? fs.readdirSync(SHARD_DIR).filter((f) => /^shard-\d+\.f32$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]) : [];
      let base = 0; exact.shards = [];
      for (const f of shardFiles) {
        const n = fs.statSync(path.join(SHARD_DIR, f)).size / (DIM * 4);
        if (n > 0) exact.shards.push({ base, n, fh: await fs.promises.open(path.join(SHARD_DIR, f), 'r') });
        base += n;
      }
      if (base !== meta.rows) { for (const sh of exact.shards) await sh.fh.close(); exact.shards = []; }
      log(`exact file: ${meta.rows.toLocaleString()} rows, ${exact.classes.length} classes; ${overrides.size} overrides; float32 re-rank ${exact.shards.length ? 'on' : 'off (shards missing or changed)'}`);
    }
  }
} catch (e) { log('exact file not loaded:', e.message); exact = null; }
const loadedAt = new Date().toISOString();
let pending = 0; // changes applied since the last save

// ── /match ─────────────────────────────────────────────────────────────────────────────────────

class BadRequest extends Error {}
const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
const optInt = (v, name) => {
  if (v == null) return null;
  if (!Number.isInteger(v)) throw new BadRequest(`${name} must be an integer`);
  return v;
};

function parseMatch(b) {
  if (!b || typeof b !== 'object') throw new BadRequest('body must be a JSON object');
  const v = b.vector;
  if (!Array.isArray(v) || v.length !== DIM) throw new BadRequest(`vector must be ${DIM} numbers`);
  const q = Float32Array.from(v);
  for (let i = 0; i < DIM; i++) if (!Number.isFinite(q[i])) throw new BadRequest('vector has a non-finite value');
  const k = b.k ?? 15;
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) throw new BadRequest(`k must be an integer 1..${MAX_K}`);
  const threshold = b.threshold ?? 0.3;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) throw new BadRequest('threshold must be a number');
  for (const f of ['filter_languages', 'filter_exclude_languages']) {
    if (b[f] != null && (!Array.isArray(b[f]) || b[f].some((x) => typeof x !== 'string'))) throw new BadRequest(`${f} must be an array of strings`);
  }
  if (b.filter_language != null && typeof b.filter_language !== 'string') throw new BadRequest('filter_language must be a string');
  return {
    q, k, threshold,
    language: b.filter_language ?? null,
    // An empty array is "no filter", as in the RPC (array_length(x, 1) IS NULL).
    languages: nonEmpty(b.filter_languages) ? new Set(b.filter_languages) : null,
    exclude: nonEmpty(b.filter_exclude_languages) ? new Set(b.filter_exclude_languages) : null,
    yearMin: optInt(b.year_min, 'year_min'), yearMax: optInt(b.year_max, 'year_max'),
    withKeys: b.with_keys === true, // eval only (recall-eval.mjs): the usearch key = the shard row ordinal after a build
  };
}

/** match_semantic's WHERE clause on one (language, year). A NULL language or year fails every comparison but the exclude list's. */
function passesLY(l, y, f) {
  if (f.language !== null && l !== f.language) return false;
  if (f.languages && (l === null || !f.languages.has(l))) return false;
  if (f.exclude && l !== null && f.exclude.has(l)) return false;
  if (f.yearMin !== null || f.yearMax !== null) {
    if (y === null) return false;
    if (f.yearMin !== null && y < f.yearMin) return false;
    if (f.yearMax !== null && y > f.yearMax) return false;
  }
  return true;
}
const passes = (key, f) => passesLY(rows.language(key), rows.yearOf(key), f);
const isFiltered = (f) => f.language !== null || !!f.languages || !!f.exclude || f.yearMin !== null || f.yearMax !== null;

/** Live rows the filter passes, from the class counts: exact, and ~5K class checks rather than 7.6M row checks. */
function filteredCount(f) {
  let n = 0;
  for (const [c, cnt] of rows.classCount) if (cnt > 0 && passesLY(rows.langs[classLang(c)], classYear(c), f)) n += cnt;
  return n;
}

/** One HNSW pass of `ask` candidates. */
function hnswPass(f, ask) {
  const res = index.search(f.q, ask, 1);
  const out = []; let belowThreshold = false, inspected = 0;
  for (let i = 0; i < res.keys.length && out.length < f.k; i++) {
    const sim = 1 - res.distances[i];
    if (!(sim > f.threshold)) { belowThreshold = true; break; } // sorted by distance: nothing further passes
    inspected++;
    const key = Number(res.keys[i]);
    if (!rows.alive[key] || !passes(key, f)) continue;
    const row = { page_id: rows.pageIds[key], book_id: rows.bookId(key), page_number: rows.pn[key], similarity: sim };
    if (f.withKeys) row.key = key;
    out.push(row);
  }
  // Exhausted: fewer candidates than asked means the index has no more.
  return { out, belowThreshold, inspected, exhausted: res.keys.length < ask };
}

/** float32 cosine of the query with build row `key`, read from its shard; null when the shards are not usable. */
async function f32Sim(f, key, buf) {
  const sh = exact.shards.find((x) => key >= x.base && key < x.base + x.n);
  if (!sh) return null;
  await sh.fh.read(buf, 0, DIM * 4, (key - sh.base) * DIM * 4);
  const v = new Float32Array(buf.buffer, buf.byteOffset, DIM);
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < DIM; i++) { d += f.q[i] * v[i]; a += f.q[i] * f.q[i]; b += v[i] * v[i]; }
  return d / Math.sqrt(a * b);
}

/**
 * Top-k over every row the filter passes: an int8 cosine scan of the file's matching classes (and the
 * overrides), then the best 2k re-scored in float32 from the shards, so the threshold and the order
 * are the RPC's, not the 8-bit copy's (int8 alone: recall 0.96 against float32 on Sanskrit, 2026-10-17).
 */
// ONE scan buffer, allocated at startup, and one scan at a time. A fresh 96 MB buffer per query is
// 24K page faults charged to a slice that sits at its memory.high, and each one waits on reclaim:
// measured 2026-10-17, 390 ms to read 118 MB that way against 21 ms into a buffer already resident.
// allocUnsafeSlow: its own ArrayBuffer at offset 0 — exactSearch ignores byteOffset (recall-eval.mjs).
const scanBuf = exact ? Buffer.allocUnsafeSlow(EXACT_CHUNK * DIM).fill(0) : null;
let scanLock = Promise.resolve();
function exactScan(f) {
  const p = scanLock.then(() => exactScanLocked(f));
  scanLock = p.catch(() => {});
  return p;
}

async function exactScanLocked(f) {
  const t0 = performance.now(); let readMs = 0;
  const qi = quantizeI8(f.q);
  const want = Math.min(f.k * 2, f.k + 64);
  const SLACK = 0.01; // int8 similarity error is ~0.0005 mean; keep near-threshold rows for the re-score
  let cand = []; let scanned = 0;
  const trim = () => { cand.sort((a, b) => b.sim - a.sim); if (cand.length > want) cand.length = want; };
  // Coalesce adjacent matching classes into ranges (one language over a year range is one range).
  const ranges = [];
  for (const c of exact.classes) {
    if (c.count === 0 || !passesLY(c.lang, c.year, f)) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.end === c.start) last.end += c.count; else ranges.push({ start: c.start, end: c.start + c.count });
  }
  const buf = scanBuf;
  for (const r of ranges) {
    for (let off = r.start; off < r.end; off += EXACT_CHUNK) {
      const m = Math.min(EXACT_CHUNK, r.end - off);
      const tr = performance.now();
      const { bytesRead } = await exact.fh.read(buf, 0, m * DIM, off * DIM);
      readMs += performance.now() - tr;
      if (bytesRead !== m * DIM) throw new Error(`exact.i8 short read at row ${off}`);
      const res = exactSearch(new Int8Array(buf.buffer, 0, m * DIM), qi, DIM, Math.min(want, m), 'cos', EXACT_THREADS);
      scanned += m;
      for (let j = 0; j < res.keys.length; j++) {
        const sim = 1 - res.distances[j];
        if (!(sim > f.threshold - SLACK)) break;
        const key = exact.keys[off + Number(res.keys[j])];
        // The file is the build; the row store is now. A re-embedded row is scanned from its override.
        if (!rows.alive[key] || overrides.has(key) || !passes(key, f)) continue;
        cand.push({ key, sim });
      }
      trim();
    }
  }
  if (overrides.size) {
    const ks = [];
    for (const key of overrides.keys()) if (rows.alive[key] && passes(key, f)) ks.push(key);
    if (ks.length) {
      const data = new Int8Array(ks.length * DIM);
      ks.forEach((key, i) => data.set(overrides.get(key), i * DIM));
      const res = exactSearch(data, qi, DIM, Math.min(want, ks.length), 'cos', 1);
      for (let j = 0; j < res.keys.length; j++) cand.push({ key: ks[Number(res.keys[j])], sim: 1 - res.distances[j], override: true });
      scanned += ks.length; trim();
    }
  }
  let reranked = false; const tRe = performance.now();
  if (exact.shards.length) {
    const bufs = cand.map(() => Buffer.allocUnsafe(DIM * 4));
    const sims = await Promise.all(cand.map((c, i) => (c.override ? null : f32Sim(f, c.key, bufs[i]))));
    sims.forEach((s32, i) => { if (s32 !== null) cand[i].sim = s32; });
    cand.sort((a, b) => b.sim - a.sim); reranked = true;
  }
  const out = [];
  for (const c of cand) {
    if (out.length >= f.k) break;
    if (!(c.sim > f.threshold)) continue;
    const row = { page_id: rows.pageIds[c.key], book_id: rows.bookId(c.key), page_number: rows.pn[c.key], similarity: c.sim };
    if (f.withKeys) row.key = c.key;
    out.push(row);
  }
  const end = performance.now();
  return { rows: out, scanned, reranked, timing: { read_ms: +readMs.toFixed(1), scan_ms: +(tRe - t0 - readMs).toFixed(1), rerank_ms: +(end - tRe).toFixed(1) } };
}

async function match(f) {
  if (!isFiltered(f)) {
    const { out } = hnswPass(f, Math.min(index.size(), f.k));
    return { rows: out, path: 'hnsw', complete: true, candidates: f.k, rounds: 1 };
  }
  const t0 = performance.now();
  const count = filteredCount(f);
  if (count === 0) return { rows: [], path: 'empty', complete: true, filtered_rows: 0, candidates: 0, rounds: 0 };
  if (exact && count <= EXACT_MAX) {
    const r = await exactScan(f);
    return { rows: r.rows, path: 'exact', complete: true, filtered_rows: count, candidates: r.scanned, rounds: 1, reranked: r.reranked, exact_timing: r.timing };
  }
  // HNSW, sized by the filter's share of the corpus and then by the share it actually finds near this
  // query: those differ a lot (a Chinese page's neighbours are Chinese, whatever Latin's 31% says).
  const share = count / Math.max(1, rows.live);
  let ask = Math.min(index.size(), MAX_ASK, Math.max(f.k * OVERFETCH, Math.ceil((f.k / share) * MARGIN)));
  let rounds = 0, last;
  for (;;) {
    rounds++;
    const tr = performance.now();
    last = hnswPass(f, ask);
    const roundMs = performance.now() - tr;
    if (last.out.length >= f.k || last.belowThreshold || last.exhausted) {
      return { rows: last.out, path: 'hnsw', complete: true, filtered_rows: count, candidates: ask, rounds };
    }
    if (ask >= MAX_ASK || ask >= index.size()) break;
    const rate = last.out.length / Math.max(1, last.inspected);
    const grow = rate > 0 ? Math.min(8, Math.max(2, ((f.k / rate) * MARGIN) / ask)) : 8;
    // Search cost grows ~linearly with the ask: shrink the next round to what the budget can still
    // pay for, and stop when that is not a real widening.
    const affordable = Math.floor(ask * ((BUDGET_MS - (performance.now() - t0)) / Math.max(roundMs, 0.5)));
    const next = Math.min(index.size(), MAX_ASK, Math.ceil(ask * grow), affordable);
    if (next < ask * 1.5) break;
    ask = next;
  }
  if (exact && count <= EXACT_FALLBACK_MAX) {
    const r = await exactScan(f);
    return { rows: r.rows, path: 'hnsw+exact', complete: true, filtered_rows: count, candidates: ask + r.scanned, rounds: rounds + 1, reranked: r.reranked, exact_timing: r.timing };
  }
  return { rows: last.out, path: 'hnsw', complete: false, filtered_rows: count, candidates: ask, rounds };
}

// ── /admin (local listener only) ───────────────────────────────────────────────────────────────

let adminBusy = Promise.resolve();
const serial = (fn) => { const p = adminBusy.then(fn, fn); adminBusy = p.catch(() => {}); return p; };

/** Upsert / remove rows. Body: {upserts: [{page_id, book_id, page_number, book_language, book_year, embedding: [768]}], removes: [page_id], checkpoint?} */
function applyDelta(b) {
  let added = 0, replaced = 0, removed = 0, skipped = 0;
  const vec = new Float32Array(DIM);
  for (const r of b.upserts || []) {
    if (!r.page_id || !r.book_id || !Array.isArray(r.embedding) || r.embedding.length !== DIM) { skipped++; continue; }
    vec.set(r.embedding);
    let key = rows.pageKey.get(r.page_id);
    if (key === undefined) { key = nextKey++; added++; } else { replaced++; if (index.contains(BigInt(key))) index.remove(BigInt(key)); }
    index.add(BigInt(key), vec);
    rows.set(key, r);
    if (exact) overrides.set(key, quantizeI8(vec));
  }
  for (const pid of b.removes || []) {
    const key = rows.pageKey.get(pid);
    if (key === undefined || !rows.alive[key]) continue;
    if (index.contains(BigInt(key))) index.remove(BigInt(key));
    rows.kill(key); removed++;
  }
  if (b.checkpoint) state.checkpoint = b.checkpoint;
  state.last_delta_at = new Date().toISOString();
  pending += added + replaced + removed;
  return { added, replaced, removed, skipped, size: index.size(), live: rows.live };
}

/** Write generation g+1 (index, rows), then state.json (the commit point), then drop generation g. */
async function save() {
  if (pending === 0) return { skipped: 'no changes since the last save', generation: state.generation };
  const t = Date.now(); const g = state.generation + 1;
  const iTmp = `${indexPath(g)}.tmp`, rTmp = `${rowsPath(g)}.tmp`;
  index.save(iTmp); // synchronous: /match waits for it (a few seconds), which is why saves are nightly
  await rows.save(rTmp);
  let oTmp = null;
  if (overrides.size) { // the exact file's rows a delta replaced, so a restart still scans the new vectors
    oTmp = `${overridesPath(g)}.tmp`; const rec = 4 + DIM; const b = Buffer.alloc(overrides.size * rec); let o = 0;
    for (const [key, v] of overrides) { b.writeUInt32LE(key, o); b.set(new Uint8Array(v.buffer, v.byteOffset, DIM), o + 4); o += rec; }
    fs.writeFileSync(oTmp, b);
  }
  fs.renameSync(iTmp, indexPath(g)); fs.renameSync(rTmp, rowsPath(g)); if (oTmp) fs.renameSync(oTmp, overridesPath(g));
  const old = state.generation;
  Object.assign(state, { generation: g, next_key: nextKey, rows: rows.live, saved_at: new Date().toISOString() });
  writeJsonAtomic(STATE_PATH, state);
  for (const p of [indexPath(old), rowsPath(old), overridesPath(old)]) try { fs.unlinkSync(p); } catch {}
  pending = 0;
  return { generation: g, ms: Date.now() - t };
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────────

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new BadRequest('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new BadRequest('body is not JSON')); } });
    req.on('error', reject);
  });
}

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

function health() {
  return {
    ok: true, size: index.size(), live_rows: rows.live, book_map_size: rows.booksLive,
    built_at: state.built_at, last_delta_at: state.last_delta_at, saved_at: state.saved_at ?? null,
    checkpoint: state.checkpoint, generation: state.generation, pending_changes: pending,
    loaded_at: loadedAt, ef_search: EF, quantization: indexConfigFor(state).quantization, rss_gb: +(process.memoryUsage().rss / 1e9).toFixed(2),
    filtered: {
      exact_file: exact ? { rows: exact.meta.rows, built_at: exact.meta.built_at, overrides: overrides.size } : null,
      f32_rerank: !!exact?.shards.length,
      max_ask: MAX_ASK, budget_ms: BUDGET_MS, exact_max: EXACT_MAX, exact_fallback_max: EXACT_FALLBACK_MAX, exact_threads: EXACT_THREADS,
    },
  };
}

const authed = (req) => {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
};

function handler(local) {
  return async (req, res) => {
    const url = (req.url || '').split('?')[0];
    try {
      if (!local && !authed(req)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url === '/health') return send(res, 200, health());
      if (req.method === 'POST' && url === '/match') {
        const t = process.hrtime.bigint();
        const f = parseMatch(await readBody(req, 256 * 1024));
        const r = await match(f);
        return send(res, 200, { ...r, ms: Number(process.hrtime.bigint() - t) / 1e6 });
      }
      if (local && req.method === 'POST' && url === '/admin/apply') {
        const b = await readBody(req, 256 * 1024 * 1024);
        return send(res, 200, await serial(() => applyDelta(b)));
      }
      if (local && req.method === 'POST' && url === '/admin/save') return send(res, 200, await serial(save));
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      log('error', url, e.stack || e.message);
      return send(res, 500, { error: 'internal error' });
    }
  };
}

http.createServer(handler(true)).listen(LOCAL_PORT, '127.0.0.1', () => log(`local  http://127.0.0.1:${LOCAL_PORT}`));
http.createServer(handler(false)).listen(PORT, '0.0.0.0', () => log(`public http://0.0.0.0:${PORT} (bearer)`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log(sig, pending ? `— ${pending} unsaved changes; the next delta re-applies them from the saved checkpoint` : ''); process.exit(0); });
