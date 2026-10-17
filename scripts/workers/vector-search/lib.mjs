// Shared pieces of the page-vector service (#6821): paths, the Postgres client, the vector parser, and
// the row store that maps a usearch key to its page.
//
// PRIOR ART: github.com/JDerekLomas/sourcelibrary-atlas scripts/local-corpus/{pull-embeddings,build-hnsw,
// semantic-lib}.mjs — same corpus, same index settings (usearch, cos, i8, M=16, 768-d). Those keep
// {p,b,n,t} per row and map a key to a row only once, on a laptop. This service also has to FILTER
// (book_language, book_year, exactly as match_semantic does) and to replace rows in place when a page
// is re-embedded or withheld, so the row store carries language and year and a page_id → key map.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const DIM = 768;
export const ROOT = process.env.VECTOR_SEARCH_ROOT || '/data/vector-search';
export const SHARD_DIR = path.join(ROOT, 'shards');
export const INDEX_DIR = path.join(ROOT, 'index');
export const LOG_DIR = path.join(ROOT, 'logs');
export const STATE_PATH = path.join(INDEX_DIR, 'state.json');

/**
 * usearch settings. Must be identical at build and load, so build-hnsw.mjs records `quantization` in
 * state.json and the server reads it from there; `expansion_search` is a load-time choice.
 *
 * e4m3 (8-bit float), not the atlas's i8: same 917 B/row, but usearch casts a unit vector to i8 on a
 * fixed [-1, 1] scale and these 768-d components are ~±0.04, so i8 keeps ~5 levels of each. Measured
 * 2026-10-16 on 2,000 real rows, 30 queries, against exact float32 cosine: similarity error mean
 * 0.0129 (i8) vs 0.0015 (e4m3), overlap@46 0.951 vs 0.975. Search is ~2 ms either way; the build is
 * ~1.6× slower. The similarity error is what decides it: match_semantic cuts at `> 0.3` on exact
 * similarity, and the app ranks and fuses by the score.
 */
export const QUANTIZATION = process.env.VECTOR_SEARCH_QUANT || 'e4m3';
export const INDEX_CONFIG = { metric: 'cos', connectivity: 16, dimensions: DIM, quantization: QUANTIZATION, expansion_add: 128 };
export const indexConfigFor = (state) => ({ ...INDEX_CONFIG, quantization: state?.quantization || 'i8' });

export function loadUsearch() { return require('usearch'); }

export const indexPath = (gen) => path.join(INDEX_DIR, `index-${gen}.usearch`);
export const rowsPath = (gen) => path.join(INDEX_DIR, `rows-${gen}.jsonl`);

/**
 * The exact-scan file for selective filters (build-exact.mjs, phase 3 of #6821): every build-time
 * vector as int8, ordered by (book_language, book_year), so one language's rows, or one language
 * over a year range, are one contiguous read. `exact.keys` maps a file row to its usearch key;
 * `exact.json` holds the class table and the `built_at` of the index it was built from.
 * Rows a delta adds or re-embeds are not in the file: the server keeps those in RAM and saves them
 * with each generation (`overrides-<g>.bin`).
 */
export const EXACT_VEC_PATH = path.join(INDEX_DIR, 'exact.i8');
export const EXACT_KEYS_PATH = path.join(INDEX_DIR, 'exact.keys');
export const EXACT_META_PATH = path.join(INDEX_DIR, 'exact.json');
export const overridesPath = (gen) => path.join(INDEX_DIR, `overrides-${gen}.bin`);

/**
 * float32 → int8, scaled per vector so its largest component is ±127. Cosine ignores scale, so the
 * scale is not stored. Measured 2026-10-17 on 50K rows × 20 queries against float32 cosine:
 * overlap@46 0.985, similarity error mean 0.0005 (a fixed [−1, 1] scale keeps ~5 levels, lib.mjs above).
 */
export function quantizeI8(src, out = new Int8Array(DIM), srcOff = 0, outOff = 0) {
  let m = 0;
  for (let i = 0; i < DIM; i++) { const a = Math.abs(src[srcOff + i]); if (a > m) m = a; }
  const s = m > 0 ? 127 / m : 0;
  for (let i = 0; i < DIM; i++) out[outOff + i] = Math.round(src[srcOff + i] * s);
  return out;
}

/**
 * The text store (phase 4 of #6821): page_id → the RPC's text columns (translation, book_title,
 * book_author), so serve mode needs no Supabase round trip after the search (#6843: 45 rows cost
 * ~100 ms warm, 350 ms cold, against ~10 ms of search). SQLite (node:sqlite, no dependency), WAL,
 * one row per page. `u` is the row's updated_at as epoch seconds: the pull and the delta both write
 * here, and an upsert only replaces an older `u`, so the order they run in does not matter.
 * book_title/book_author are kept per ROW, not per book: they are match_semantic's per-row columns,
 * and the denormalised copy can drift within one book.
 */
export const TEXT_DIR = path.join(ROOT, 'text');
export const TEXT_DB_PATH = path.join(TEXT_DIR, 'pages.sqlite');
export const TEXT_SELECT = 'page_id, translation, book_title, book_author, extract(epoch from updated_at)::float8 AS u';

/** Open the text store for writing (pull-text.mjs, sync-delta.mjs). Returns {db, upsert(r), remove(pid), tx(fn)}. */
export function openTextStore(file = TEXT_DB_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 60000;
    CREATE TABLE IF NOT EXISTS pages (page_id TEXT PRIMARY KEY, u REAL NOT NULL, translation TEXT, book_title TEXT, book_author TEXT);
    CREATE TABLE IF NOT EXISTS pull_ck (shard INTEGER PRIMARY KEY, last TEXT NOT NULL, rows INTEGER NOT NULL, done INTEGER NOT NULL);`);
  const up = db.prepare(`INSERT INTO pages (page_id, u, translation, book_title, book_author) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (page_id) DO UPDATE SET u = excluded.u, translation = excluded.translation,
      book_title = excluded.book_title, book_author = excluded.book_author WHERE excluded.u >= pages.u`);
  const rm = db.prepare('DELETE FROM pages WHERE page_id = ?');
  return {
    db,
    upsert: (r) => up.run(r.page_id, Number(r.u), r.translation ?? null, r.book_title ?? null, r.book_author ?? null),
    remove: (pid) => rm.run(pid),
    tx: (fn) => { db.exec('BEGIN'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

/**
 * Key ranges for the pulls: page_ids are 24-hex ObjectIds; measured 2026-09-09 almost all lie in
 * 69…6a, so that band is cut into 0x10-wide ranges and the ranges feed a pool of workers (the atlas
 * edges, unchanged). The last edge is null = unbounded.
 */
export const PULL_EDGES = (() => {
  const pad = (h) => h.padEnd(24, '0');
  const e = ['', pad('68'), pad('69')];
  for (let x = 0x6910; x < 0x6b00; x += 0x10) e.push(pad(x.toString(16)));
  e.push(pad('6b'), null);
  return e;
})();

/** The pull range k with PULL_EDGES[k] < pid < PULL_EDGES[k + 1], or -1 for an id equal to an edge (no range holds it). */
export function rangeOfPageId(pid) {
  let lo = 0, hi = PULL_EDGES.length - 2;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, a = PULL_EDGES[m], b = PULL_EDGES[m + 1];
    if (pid <= a) hi = m - 1; else if (b !== null && pid >= b) lo = m + 1; else return m;
  }
  return -1;
}

/** The last reconcile's result (sync-delta.mjs --reconcile), read by freshness-check.mjs. */
export const RECONCILE_PATH = path.join(LOG_DIR, 'reconcile.json');

/**
 * Open the text store for the server's reads, or null when it does not exist. A read/write handle with
 * query_only on, not SQLITE_OPEN_READONLY: a read-only handle cannot always attach a WAL that another
 * process (the delta) is writing.
 */
export function openTextReader(file = TEXT_DB_PATH) {
  if (!fs.existsSync(file)) return null;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 2000; PRAGMA query_only = 1;');
  return { db, get: db.prepare('SELECT translation, book_title, book_author FROM pages WHERE page_id = ?') };
}

export function readState() {
  return fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : null;
}

/** tmp + rename: state.json is the commit point of a generation, so it is the one file that must never be half-written. */
export function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

/**
 * Postgres over SUPABASE_DB_URL (the transaction pooler). ~25× the PostgREST pull rate measured
 * from l7a on 2026-10-16: 5,000 rows with vectors in 1.9 s vs ~11 s per 1,000 over REST. Read-only.
 */
export async function pgClient() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL not set (run with node --env-file=/root/sourcelibrary/.env.production.local)');
  let pg;
  try { pg = require('pg'); } catch { pg = createRequire('/root/sourcelibrary/package.json')('pg'); }
  const c = new pg.Client({ connectionString: url });
  c.on('error', (e) => log('pg client error:', e.message)); // a dropped socket must fail the next query, not kill the process
  await c.connect();
  // The pooler refuses startup parameters, so the timeout is set per session.
  await c.query("SET statement_timeout = '180s'");
  return c;
}

/** pgvector text form "[a,b,…]" → Float32Array, or null if it is not DIM long. */
export function parseVector(text, out = new Float32Array(DIM)) {
  if (text == null) return null;
  const s = text.charCodeAt(0) === 91 ? text.slice(1, -1) : text;
  const parts = s.split(',');
  if (parts.length !== DIM) return null;
  for (let i = 0; i < DIM; i++) out[i] = +parts[i];
  return out;
}

/** The columns the service keeps per row. book_language/book_year are what match_semantic filters on. */
export const ROW_SELECT = 'page_id, book_id, page_number, book_language, book_year';

/** One jsonl line per key: [page_id, book_id, page_number, book_language, book_year], or `null` for a removed key. */
export const rowLine = (r) => JSON.stringify([r.page_id, r.book_id, r.page_number, r.book_language ?? null, r.book_year ?? null]);

const NULL_YEAR = -2147483648;

/** One number per (language index, year) pair: the filter planner counts rows by class, not by row. */
export const classOf = (langIdx, year) => langIdx * 4294967296 + (year - NULL_YEAR);
export const classLang = (c) => Math.floor(c / 4294967296);
export const classYear = (c) => { const y = (c % 4294967296) + NULL_YEAR; return y === NULL_YEAR ? null : y; };

/**
 * Key → page metadata, held as typed arrays (≈ 40 B per row plus the page_id strings), and
 * page_id → key for replacement. Languages and book ids are interned.
 */
export class RowStore {
  constructor(capacity = 1 << 20) {
    this.n = 0; this.live = 0;
    this.pageIds = [];
    this.pageKey = new Map();
    this.books = []; this.bookIdx = new Map(); this.bookRows = new Uint32Array(1024); this.booksLive = 0;
    this.langs = [null]; this.langIdx = new Map();
    this.classCount = new Map(); // classOf(lang, year) → live rows: an exact filtered count without a scan
    this.alloc(capacity);
  }
  alloc(cap) {
    const grow = (A, old) => { const a = new A(cap); if (old) a.set(old.subarray(0, Math.min(old.length, cap))); return a; };
    this.book = grow(Uint32Array, this.book); this.pn = grow(Int32Array, this.pn);
    this.lang = grow(Uint16Array, this.lang); this.year = grow(Int32Array, this.year);
    this.alive = grow(Uint8Array, this.alive); this.cap = cap;
  }
  internBook(id) {
    let i = this.bookIdx.get(id);
    if (i === undefined) {
      i = this.books.length; this.books.push(id); this.bookIdx.set(id, i);
      if (i >= this.bookRows.length) { const b = new Uint32Array(this.bookRows.length * 2); b.set(this.bookRows); this.bookRows = b; }
    }
    return i;
  }
  internLang(l) {
    if (l == null) return 0;
    let i = this.langIdx.get(l);
    if (i === undefined) { i = this.langs.length; if (i > 65535) throw new Error('too many distinct languages'); this.langs.push(l); this.langIdx.set(l, i); }
    return i;
  }
  /** Set key k to row r (k may be new or a re-used key of the same page). */
  set(k, r) {
    if (k >= this.cap) this.alloc(Math.max(k + 1, Math.ceil(this.cap * 1.25)));
    if (this.alive[k]) this.kill(k);
    const b = this.internBook(r.book_id);
    this.book[k] = b; this.pn[k] = r.page_number ?? 0; this.lang[k] = this.internLang(r.book_language);
    this.year[k] = r.book_year == null ? NULL_YEAR : r.book_year;
    this.alive[k] = 1; this.live++;
    const c = classOf(this.lang[k], this.year[k]); this.classCount.set(c, (this.classCount.get(c) || 0) + 1);
    if (this.bookRows[b]++ === 0) this.booksLive++;
    this.pageIds[k] = r.page_id; this.pageKey.set(r.page_id, k);
    if (k >= this.n) this.n = k + 1;
  }
  /** Mark k removed. Keeps its page_id → key entry so a later re-embed re-uses the key. */
  kill(k) {
    if (!this.alive[k]) return;
    this.alive[k] = 0; this.live--;
    const c = classOf(this.lang[k], this.year[k]); this.classCount.set(c, this.classCount.get(c) - 1);
    const b = this.book[k]; if (--this.bookRows[b] === 0) this.booksLive--;
  }
  bookId(k) { return this.books[this.book[k]]; }
  language(k) { return this.langs[this.lang[k]]; }
  yearOf(k) { return this.year[k] === NULL_YEAR ? null : this.year[k]; }

  static async load(file) {
    const s = new RowStore(1 << 22);
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let k = 0;
    for await (const line of rl) {
      if (!line) continue;
      const a = JSON.parse(line);
      if (a) s.set(k, { page_id: a[0], book_id: a[1], page_number: a[2], book_language: a[3], book_year: a[4] });
      k++;
    }
    s.n = Math.max(s.n, k);
    return s;
  }
  /** Stream to `file` (one line per key 0..n-1). Removed keys are written as `null` (a page that comes back after a restart gets a new key). */
  async save(file) {
    const out = fs.createWriteStream(file);
    const write = (s) => (out.write(s) ? null : new Promise((r) => out.once('drain', r)));
    let buf = '';
    for (let k = 0; k < this.n; k++) {
      buf += (this.alive[k]
        ? rowLine({ page_id: this.pageIds[k], book_id: this.bookId(k), page_number: this.pn[k], book_language: this.language(k), book_year: this.yearOf(k) })
        : 'null') + '\n';
      if (buf.length > 1 << 20) { const p = write(buf); buf = ''; if (p) await p; }
    }
    if (buf) out.write(buf);
    await new Promise((res, rej) => { out.end(); out.on('finish', res); out.on('error', rej); });
    const fd = fs.openSync(file, 'r'); fs.fsyncSync(fd); fs.closeSync(fd);
  }
}

export function log(...a) { console.log(new Date().toISOString(), ...a); }
