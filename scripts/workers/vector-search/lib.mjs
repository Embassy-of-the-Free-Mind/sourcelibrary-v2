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
    if (this.bookRows[b]++ === 0) this.booksLive++;
    this.pageIds[k] = r.page_id; this.pageKey.set(r.page_id, k);
    if (k >= this.n) this.n = k + 1;
  }
  /** Mark k removed. Keeps its page_id → key entry so a later re-embed re-uses the key. */
  kill(k) {
    if (!this.alive[k]) return;
    this.alive[k] = 0; this.live--;
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
