#!/usr/bin/env node
/**
 * Supabase CPU relief (2026-05-29) — the dominant fix.
 *
 * The public USTC title search ran `... FROM ustc_editions WHERE title ILIKE $1
 * AND year BETWEEN ...` as a full Parallel Seq Scan of the 1.6M-row table:
 * 27,813 calls at a 7.2s mean, ~35% of the whole instance's DB time, 171B
 * tuples read. Root cause: the existing trigram index idx_ustc_title_trgm was
 * built on lower(title) — an EXPRESSION index — which a raw `title ILIKE`
 * filter cannot use, so the planner fell back to seq scan. (The author_1 search
 * is the same shape but fast, because idx_ustc_author1_trgm is on the raw column.)
 *
 * Fix: a gin_trgm_ops index on the RAW title column. Plan cost dropped
 * 118,399 -> 224 (~530x); EXPLAIN flips Seq Scan -> Bitmap Index Scan.
 *
 * The old lower(title) index is now dead weight on this hot path and is a future
 * drop candidate (verify nothing queries lower(title) first) — left in place here.
 *
 * Idempotent. Run on Hetzner where SUPABASE_DB_URL lives:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/add-ustc-title-trgm-index.mjs
 *
 * gotcha: pg.Client({ statement_timeout: 0 }) is a silent no-op (0 is falsy and
 * never sent), so the server default killed the CONCURRENTLY build mid-flight.
 * We SET it explicitly below. A failed CONCURRENTLY build leaves an INVALID
 * index; this script drops any such leftover before (re)building.
 */
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }
const client = new pg.Client({ connectionString: url.replace(':6543/', ':5432/') });

await client.connect();
await client.query('SET statement_timeout = 0');
await client.query('SET lock_timeout = 0');
await client.query("SET maintenance_work_mem = '512MB'");

const invalid = await client.query(`
  SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE NOT i.indisvalid AND c.relname = 'idx_ustc_title_trgm_raw'`);
if (invalid.rows.length) {
  console.log('Dropping invalid leftover idx_ustc_title_trgm_raw...');
  await client.query('DROP INDEX CONCURRENTLY IF EXISTS idx_ustc_title_trgm_raw');
}

console.log('Building idx_ustc_title_trgm_raw CONCURRENTLY (no-op if present)...');
await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ustc_title_trgm_raw
  ON public.ustc_editions USING gin (title gin_trgm_ops)`);

const v = await client.query(`
  SELECT i.indisvalid, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'idx_ustc_title_trgm_raw'`);
console.log(`idx_ustc_title_trgm_raw valid=${v.rows[0]?.indisvalid} size=${v.rows[0]?.size}`);

const plan = await client.query(`EXPLAIN SELECT sn, title, author_1, year
  FROM ustc_editions WHERE title ILIKE '%astronomia%' AND year >= 1500 AND year <= 1700 LIMIT 50`);
console.log('Plan (expect Bitmap Index Scan on idx_ustc_title_trgm_raw):');
console.log(plan.rows.map(r => '  ' + r['QUERY PLAN']).join('\n'));

await client.end();
console.log('Done.');
