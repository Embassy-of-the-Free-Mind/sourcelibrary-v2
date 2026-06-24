#!/usr/bin/env node
/**
 * Supabase CPU relief (2026-05-29). Two operational changes:
 *
 * 1. Materialize get_sl_progress(). It was a STABLE SQL function recomputing a
 *    full books_catalog aggregation (GROUP BY language, GROUP BY century, totals)
 *    on EVERY call — ~143K calls in the pg_stat_statements window, 126ms each.
 *    The public /census and /about/progress pages call it on each load. We move
 *    the computation into a single-row matview (sl_progress_mv) refreshed hourly
 *    by pg_cron, and rewrite the function to read that one row (sub-ms). The
 *    JSON shape is preserved EXACTLY (copied from the live function body), so no
 *    app change is needed. This script verifies matview == function output
 *    before swapping the function — it aborts the swap if they differ.
 *
 * 2. Tune over-frequent matview refresh crons. dashboard_usage (built from the
 *    4.7M-row gemini_usage table) and coverage_stats_mv were both refreshing
 *    every 5 min; dashboard_usage alone took ~8s each = ~38 CPU-min/day. Usage
 *    and coverage stats tolerate hourly. pipeline_velocity is left at 5 min
 *    (negligible cost, benefits from freshness for pipeline monitoring).
 *
 * Context: the dominant CPU driver (a ustc_editions title seq scan, ~35% of DB
 * time) was already fixed separately via idx_ustc_title_trgm_raw.
 *
 * Idempotent. Run on Hetzner where SUPABASE_DB_URL lives:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/materialize-sl-progress-and-tune-cron.mjs
 */
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }
// Direct port (not the :6543 pooler) so DDL / CONCURRENTLY behave.
const client = new pg.Client({ connectionString: url.replace(':6543/', ':5432/') });

// The live get_sl_progress() body, verbatim. Used both as the matview definition
// and (post-swap) replaced by a thin read. Keep this in sync if the metric ever changes.
const AGG_SQL = `
  WITH by_lang AS (
    SELECT language,
      count(*) AS total,
      count(*) FILTER (WHERE pages_translated > 0) AS translated,
      count(*) FILTER (WHERE translation_pct >= 90) AS over_90,
      count(*) FILTER (WHERE is_first_translation) AS first_trans
    FROM books_catalog
    WHERE pages_count > 0 AND language IS NOT NULL
    GROUP BY language
    ORDER BY count(*) DESC
    LIMIT 20
  ),
  by_century AS (
    SELECT
      (floor(year::numeric / 100) * 100)::int AS century_start,
      count(*) AS total,
      count(*) FILTER (WHERE pages_translated > 0 AND language != 'English') AS translated_by_sl,
      count(*) FILTER (WHERE translation_pct >= 90) AS over_90,
      count(*) FILTER (WHERE is_first_translation) AS first_trans
    FROM books_catalog
    WHERE pages_count > 0 AND year IS NOT NULL
    GROUP BY floor(year::numeric / 100) * 100
    ORDER BY floor(year::numeric / 100) * 100
  ),
  totals AS (
    SELECT
      count(*) AS total_books,
      count(*) FILTER (WHERE pages_translated > 0 AND language != 'English' AND language IS NOT NULL) AS translated_by_sl,
      count(*) FILTER (WHERE pages_translated > 0 AND language = 'English') AS english_digitized,
      count(*) FILTER (WHERE translation_pct >= 90 AND language != 'English' AND language IS NOT NULL) AS over_90_translated,
      count(*) FILTER (WHERE is_first_translation AND language != 'English') AS first_translations
    FROM books_catalog
    WHERE pages_count > 0
  )
  SELECT json_build_object(
    'totals', (SELECT row_to_json(t) FROM totals t),
    'by_language', (SELECT json_agg(row_to_json(l)) FROM by_lang l),
    'by_century', (SELECT json_agg(row_to_json(c)) FROM by_century c)
  )`;

await client.connect();
await client.query('SET statement_timeout = 0');
await client.query('SET lock_timeout = 0');

// 0) Snapshot the CURRENT live function output (the source of truth to match).
const before = (await client.query('SELECT get_sl_progress() AS d')).rows[0].d;
console.log('Captured live get_sl_progress() output. totals:', JSON.stringify(before.totals));

// 1) (Re)create the single-row matview from the same aggregation.
await client.query('DROP MATERIALIZED VIEW IF EXISTS public.sl_progress_mv');
await client.query(`CREATE MATERIALIZED VIEW public.sl_progress_mv AS
  SELECT 1 AS id, (${AGG_SQL}) AS data`);
await client.query('CREATE UNIQUE INDEX sl_progress_mv_id ON public.sl_progress_mv (id)');
console.log('Created sl_progress_mv (single row + unique index for CONCURRENTLY refresh).');

// 2) Verify the matview matches the live function output EXACTLY before swapping.
const mv = (await client.query('SELECT data FROM public.sl_progress_mv WHERE id = 1')).rows[0].data;
const eq = JSON.stringify(mv) === JSON.stringify(before);
if (!eq) {
  console.error('ABORT: matview output != live function output. Not swapping the function.');
  console.error('matview totals:', JSON.stringify(mv.totals));
  await client.query('DROP MATERIALIZED VIEW IF EXISTS public.sl_progress_mv');
  await client.end();
  process.exit(1);
}
console.log('Verified: sl_progress_mv matches live get_sl_progress() byte-for-byte.');

// 3) Swap the function to a thin read of the matview (same return type/shape).
await client.query(`
  CREATE OR REPLACE FUNCTION public.get_sl_progress()
  RETURNS json LANGUAGE sql STABLE AS $fn$
    SELECT data FROM public.sl_progress_mv WHERE id = 1
  $fn$`);
const after = (await client.query('SELECT get_sl_progress() AS d')).rows[0].d;
console.log('Swapped get_sl_progress() to read matview. post-swap matches:',
  JSON.stringify(after) === JSON.stringify(before));

// 4) Schedule the hourly refresh (idempotent: cron.schedule upserts by jobname).
await client.query(`SELECT cron.schedule('refresh-sl-progress', '13 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.sl_progress_mv')`);
console.log("Scheduled cron 'refresh-sl-progress' at minute 13 hourly.");

// 5) Slow the over-frequent refreshes from every-5-min to hourly (staggered minutes).
const tune = async (match, schedule) => {
  const r = await client.query(
    `SELECT cron.alter_job(jobid, schedule => $1) , jobid, command
     FROM cron.job WHERE command ILIKE $2`, [schedule, match]);
  for (const row of r.rows) console.log(`  altered job ${row.jobid} -> '${schedule}'  (${row.command.replace(/\s+/g,' ').slice(0,50)})`);
};
await tune('%dashboard_usage%', '17 * * * *');
await tune('%coverage_stats_mv%', '23 * * * *');

console.log('\n=== resulting cron schedule ===');
console.table((await client.query(
  `SELECT jobid, schedule, active, left(regexp_replace(command,'\\s+',' ','g'),48) AS command
   FROM cron.job ORDER BY jobid`)).rows);

await client.end();
console.log('Done.');
