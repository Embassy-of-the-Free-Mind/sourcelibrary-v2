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
//               year_min?, year_max?}  →  {rows: [{page_id, book_id, page_number, similarity}], ms, …}
//   Same contract as match_semantic (scripts/migration/apply-semantic-language-prefilter.sql) minus
//   the text columns, which the app hydrates by primary key. Filters are the RPC's predicates, on the
//   same columns (page_translations.book_language / book_year, per row), compared by exact string
//   equality: the app expands language names (expandLanguages) BEFORE the call, as it does for the RPC.
//   Threshold: similarity = 1 − cosine distance, kept when `> threshold` (the RPC's operator).
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
import { DIM, indexConfigFor, readState, writeJsonAtomic, STATE_PATH, indexPath, rowsPath, loadUsearch, RowStore, log } from './lib.mjs';

const PORT = +(process.env.VECTOR_SEARCH_PORT || 3458);
const LOCAL_PORT = +(process.env.VECTOR_SEARCH_LOCAL_PORT || 3459);
const TOKEN = process.env.VECTOR_SEARCH_TOKEN || '';
const EF = +(process.env.VECTOR_SEARCH_EF || 128);
const MAX_K = 1000;
const OVERFETCH = 4;    // first pass asks for k×4 when a filter is set
const WIDEN = 4;        // …and widens up to 4× that (two doublings) when the filter leaves < k rows
if (!TOKEN || TOKEN.length < 32) { console.error('VECTOR_SEARCH_TOKEN missing or short (expected openssl rand -hex 32)'); process.exit(2); }

const { Index } = loadUsearch();
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

/** match_semantic's WHERE clause, row for row. A NULL language or year fails every comparison but the exclude list's. */
function passes(key, f) {
  if (f.language !== null || f.languages || f.exclude) {
    const l = rows.language(key);
    if (f.language !== null && l !== f.language) return false;
    if (f.languages && (l === null || !f.languages.has(l))) return false;
    if (f.exclude && l !== null && f.exclude.has(l)) return false;
  }
  if (f.yearMin !== null || f.yearMax !== null) {
    const y = rows.yearOf(key);
    if (y === null) return false;
    if (f.yearMin !== null && y < f.yearMin) return false;
    if (f.yearMax !== null && y > f.yearMax) return false;
  }
  return true;
}

function match(f) {
  const filtered = f.language !== null || f.languages || f.exclude || f.yearMin !== null || f.yearMax !== null;
  const first = Math.min(index.size(), filtered ? f.k * OVERFETCH : f.k);
  let ask = first, out = [], rounds = 0;
  for (;;) {
    rounds++;
    const res = index.search(f.q, ask, 1);
    out = []; let belowThreshold = false;
    for (let i = 0; i < res.keys.length && out.length < f.k; i++) {
      const sim = 1 - res.distances[i];
      if (!(sim > f.threshold)) { belowThreshold = true; break; } // sorted by distance: nothing further passes
      const key = Number(res.keys[i]);
      if (!rows.alive[key] || !passes(key, f)) continue;
      const row = { page_id: rows.pageIds[key], book_id: rows.bookId(key), page_number: rows.pn[key], similarity: sim };
      if (f.withKeys) row.key = key;
      out.push(row);
    }
    if (out.length >= f.k || belowThreshold || res.keys.length < ask || ask >= first * WIDEN || ask >= index.size()) {
      return { rows: out, candidates: ask, rounds };
    }
    ask = Math.min(index.size(), ask * 2);
  }
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
  fs.renameSync(iTmp, indexPath(g)); fs.renameSync(rTmp, rowsPath(g));
  const old = state.generation;
  Object.assign(state, { generation: g, next_key: nextKey, rows: rows.live, saved_at: new Date().toISOString() });
  writeJsonAtomic(STATE_PATH, state);
  for (const p of [indexPath(old), rowsPath(old)]) try { fs.unlinkSync(p); } catch {}
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
        const r = match(f);
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
