/**
 * mirror.mjs — read the nightly Parquet mirror of `books` + `pages` metadata with DuckDB (#5189).
 *
 * PRIOR ART: none fits — searched scripts/lib for mirror/snapshot/warehouse/export/checkpoint
 * and `git grep -il 'duckdb|parquet'` (only /dataset types mention Parquet).
 * scripts/export/build-corpus-snapshot.mjs is a licensee text export (JSONL per book, text
 * inline), not a queryable metadata mirror; scripts/lib/mongo.mjs is the live client this
 * module exists to keep scans off.
 *
 * WHY: a corpus-wide audit that walks Atlas from Hetzner pays Internet egress on every byte
 * returned, and each audit sees a different moment of the data. The mirror is written once a
 * night by scripts/maintenance/export-mirror.mjs; every reader sees the same snapshot.
 *
 * WHAT IT IS NOT FOR — read live Mongo instead:
 *   - anything on a request path;
 *   - a writer's pre-write check (dedup gates, "is it already done?" before spending);
 *   - anything that cannot tolerate up to ~36 h of staleness.
 *
 * Layout under MIRROR_DIR (default /mnt/HC_Volume_105839809/mirror, the Hetzner volume —
 * never the 93%-full root disk):
 *   latest -> snapshots/<id>          atomic symlink, switched only after the manifest is written
 *   snapshots/<id>/manifest.json      counts, snapshot time, per-collection schema + schema_hash
 *   snapshots/<id>/books.parquet      every top-level field; nested objects as JSON
 *   snapshots/<id>/pages/bucket=NN/*.parquet   metadata only (no ocr/translation text;
 *                                              *_bytes columns carry the text lengths)
 *
 * Usage:
 *   import { openMirror } from '../lib/mirror.mjs';
 *   const m = openMirror();                       // throws if stale/incomplete/missing
 *   const rows = m.query(`SELECT count(*) AS n FROM books WHERE visible AND pages_count > 0`);
 *   console.log(m.describe());                    // "mirror 2026-10-07T0420Z (13.2 h old)"
 *
 * Needs the DuckDB CLI on PATH (`duckdb`, https://github.com/duckdb/duckdb/releases; on
 * Hetzner: /usr/local/bin/duckdb, linux-arm64 build). DuckDB makes no network calls for
 * local Parquet; set DUCKDB_BIN to override the binary.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import path from 'node:path';

export const MIRROR_DIR = process.env.SL_MIRROR_DIR || '/mnt/HC_Volume_105839809/mirror';
export const MAX_AGE_HOURS = 36;
export const PAGE_BUCKETS = 64;
export const MIRROR_FORMAT = 1;

/** Partition of a page row: crc32(book_id) mod 64. Stable across DuckDB versions, unlike hash(). */
export function bucketOf(bookId) {
  return crc32(Buffer.from(String(bookId))) % PAGE_BUCKETS;
}

export function duckdbBin() {
  return process.env.DUCKDB_BIN || 'duckdb';
}

/**
 * Run SQL through the DuckDB CLI and return the last statement's rows as objects.
 * `prelude` statements (views, settings) run first in the same in-memory database.
 */
export function runDuckdb(sql, { prelude = [], memoryLimit = '3GB', threads = 4, tempDir, timeoutMs = 30 * 60_000 } = {}) {
  const tmp = tempDir || path.join(MIRROR_DIR, 'duckdb-tmp');
  mkdirSync(tmp, { recursive: true });
  const settings = [
    `SET memory_limit='${memoryLimit}'`,
    `SET threads=${threads}`,
    `SET temp_directory='${tmp}'`,
    `SET preserve_insertion_order=false`,
  ];
  const script = [...settings, ...prelude, sql].map((s) => s.trim().replace(/;\s*$/, '') + ';').join('\n');
  const out = execFileSync(duckdbBin(), ['-json', '-bail', ':memory:'], {
    input: script, encoding: 'utf8', maxBuffer: 1 << 30, timeout: timeoutMs,
  });
  // -json prints one array per row-returning statement; the caller's SQL is the last one.
  const arrays = out.trim() ? out.trim().split(/\n(?=\[)/) : [];
  if (!arrays.length) return [];
  return JSON.parse(arrays[arrays.length - 1]);
}

function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  if (!existsSync(p)) throw new Error(`mirror: no manifest at ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Assert a manifest is usable: complete, fresh, counts plausible, required columns present.
 * Exported so the exporter's self-check and every reader apply the same contract.
 */
export function assertManifest(manifest, { maxAgeHours = MAX_AGE_HOURS, collections = ['books', 'pages'], columns = {} } = {}) {
  if (manifest.status !== 'complete') throw new Error(`mirror ${manifest.snapshot_id}: status ${manifest.status}, not complete`);
  if (manifest.format !== MIRROR_FORMAT) throw new Error(`mirror ${manifest.snapshot_id}: format ${manifest.format}, this reader expects ${MIRROR_FORMAT}`);
  const ageH = (Date.now() - Date.parse(manifest.as_of)) / 3.6e6;
  if (!(ageH <= maxAgeHours)) throw new Error(`mirror ${manifest.snapshot_id}: data as of ${manifest.as_of} is ${ageH.toFixed(1)} h old (limit ${maxAgeHours} h) — the nightly export has not succeeded; check /var/log/sourcelibrary/export-mirror.log`);
  for (const c of collections) {
    const m = manifest.collections?.[c];
    if (!m) throw new Error(`mirror ${manifest.snapshot_id}: collection ${c} missing`);
    // A row count is not an integrity check, but a short one is a certain failure:
    // the export must have read at least 99% of what Atlas counted when it started.
    if (!(m.rows > 0) || !(m.rows >= 0.99 * m.live_count_at_start)) {
      throw new Error(`mirror ${manifest.snapshot_id}: ${c} has ${m.rows} rows vs ${m.live_count_at_start} live at start`);
    }
    const have = new Set((m.columns || []).map((x) => x.name));
    const missing = (columns[c] || []).filter((x) => !have.has(x));
    if (missing.length) throw new Error(`mirror ${manifest.snapshot_id}: ${c} lacks column(s) ${missing.join(', ')}`);
  }
  return ageH;
}

/**
 * Open the latest snapshot. Throws (never falls back to Atlas) if it is missing, incomplete,
 * or older than maxAgeHours — a reader that silently fell back would put the scan back on the
 * wire, and one that silently read a week-old snapshot would report old news as current.
 */
export function openMirror({ maxAgeHours = MAX_AGE_HOURS, collections = ['books', 'pages'], columns = {}, dir = MIRROR_DIR } = {}) {
  const latest = path.join(dir, 'latest');
  if (!existsSync(latest)) throw new Error(`mirror: ${latest} does not exist — run scripts/maintenance/export-mirror.mjs (or pass --live to read Atlas)`);
  const snapDir = realpathSync(latest);
  const manifest = readManifest(snapDir);
  const ageHours = assertManifest(manifest, { maxAgeHours, collections, columns });
  const paths = {
    books: path.join(snapDir, 'books.parquet'),
    pages: path.join(snapDir, 'pages', '*', '*.parquet'),
  };
  const views = [];
  if (collections.includes('books')) views.push(`CREATE VIEW books AS SELECT * FROM read_parquet('${paths.books}')`);
  if (collections.includes('pages')) views.push(`CREATE VIEW pages AS SELECT * FROM read_parquet('${paths.pages}', hive_partitioning = true)`);
  return {
    manifest,
    ageHours,
    dir: snapDir,
    paths,
    describe: () => `mirror ${manifest.snapshot_id} (as of ${manifest.as_of}, ${ageHours.toFixed(1)} h old)`,
    /** Rows of the last statement as plain objects. Views `books` and `pages` are defined. */
    query: (sql, opts = {}) => runDuckdb(sql, { ...opts, prelude: [...views, ...(opts.prelude || [])] }),
  };
}
