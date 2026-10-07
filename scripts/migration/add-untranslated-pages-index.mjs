#!/usr/bin/env node
/**
 * Apply add-untranslated-pages-index.sql: the partial HNSW index over
 * page_translations rows with no English, and match_semantic_untranslated (#5729).
 *
 * PRIOR ART: add-page-translations-withheld.mjs (applies a page_translations
 * migration from its .sql) — it runs plain DDL in one session; this one needs
 * CREATE INDEX CONCURRENTLY, which cannot run in a transaction block or through
 * the transaction pooler, and a disk check before a multi-GB build.
 *
 *   --check   measure only: Supabase disk headroom against the index estimate
 *   --apply   check, then build the index (CONCURRENTLY, direct session on 5432),
 *             then create the RPC and EXPLAIN that the planner uses the index
 *   --out F   write the summary as JSON to F
 *
 * Exit: 0 ok · 1 error · 3 NOT ENOUGH DISK (nothing was changed).
 *
 * Headroom rule: free bytes on the database volume must be at least
 * 2 × the estimated index + 10 GiB. The factor covers the index itself plus
 * the WAL and build temp written while it is built; the 10 GiB keeps the
 * volume clear of Supabase's 90%-full read-only/auto-resize line for the
 * other writers sharing it. Disk comes from the project's own Prometheus
 * endpoint (/customer/v1/privileged/metrics, service-role basic auth); if it
 * cannot be read the check FAILS — an unreadable meter is not room.
 *
 *   node --env-file=.env.production.local scripts/migration/add-untranslated-pages-index.mjs --check
 *   node --env-file=.env.production.local scripts/migration/add-untranslated-pages-index.mjs --apply --out /tmp/idx.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = args.find((_, i, a) => a[i - 1] === '--out');
const INDEX = 'idx_pt_embedding_untranslated_hnsw';
const SHARED_INDEX = 'idx_pt_embedding_hnsw';
const GiB = 1024 ** 3;

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'add-untranslated-pages-index.sql'), 'utf8');
const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION');
const indexSql = sql.slice(sql.indexOf('CREATE INDEX CONCURRENTLY'), fnStart).trim();
const fnSql = sql.slice(fnStart).trim();

const summary = { started_at: new Date().toISOString() };
const done = (code) => {
  summary.finished_at = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
  process.exit(code);
};

async function diskBytes() {
  const url = `${process.env.SUPABASE_URL.trim()}/customer/v1/privileged/metrics`;
  const auth = Buffer.from(`service_role:${process.env.SUPABASE_SERVICE_ROLE_KEY.trim()}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  const text = await res.text();
  const pick = (name) => {
    const line = text.split('\n').find((l) => l.startsWith(name) && l.includes('mountpoint="/data"'));
    if (!line) throw new Error(`metric ${name} for /data not found`);
    return Number(line.trim().split(/\s+/).pop());
  };
  return { size: pick('node_filesystem_size_bytes'), avail: pick('node_filesystem_avail_bytes') };
}

function directClient() {
  const u = new URL(process.env.SUPABASE_DB_URL);
  u.port = '5432'; // session, not the transaction pooler: CONCURRENTLY needs one backend throughout
  return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
}

const c = directClient();
await c.connect();
try {
  await c.query('SET statement_timeout = 0');

  // ── Estimate ──────────────────────────────────────────────────────────
  const { rows: [sh] } = await c.query(
    `SELECT pg_relation_size($1::regclass) AS bytes,
            (SELECT reltuples FROM pg_class WHERE relname = 'page_translations') AS table_rows`, [SHARED_INDEX]);
  const { rows: [smp] } = await c.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE embedding IS NOT NULL) AS vec,
            count(*) FILTER (WHERE embedding IS NOT NULL AND coalesce(translation, '') = '') AS lane
       FROM page_translations TABLESAMPLE SYSTEM (1) REPEATABLE (5729)`);
  const total = Math.max(1, Number(smp.total));
  const laneFrac = Number(smp.lane) / Math.max(1, Number(smp.vec));
  const vecRowsEst = Number(sh.table_rows) * (Number(smp.vec) / total);
  const laneRowsEst = Math.round(Number(sh.table_rows) * (Number(smp.lane) / total));
  // The shared index holds only rows with a vector, so that is its per-row cost.
  const bytesPerRow = Number(sh.bytes) / Math.max(1, vecRowsEst);
  const estBytes = Math.round(laneRowsEst * bytesPerRow);
  const disk = await diskBytes();
  const needBytes = 2 * estBytes + 10 * GiB;
  Object.assign(summary, {
    lane_rows_est: laneRowsEst,
    lane_share_of_vectors: Number(laneFrac.toFixed(4)),
    est_index_gb: Number((estBytes / GiB).toFixed(1)),
    disk_size_gb: Number((disk.size / GiB).toFixed(1)),
    disk_avail_gb: Number((disk.avail / GiB).toFixed(1)),
    need_gb: Number((needBytes / GiB).toFixed(1)),
    room: disk.avail >= needBytes,
  });
  console.log(`[index] lane ≈ ${laneRowsEst.toLocaleString()} rows → ≈ ${summary.est_index_gb} GB; disk ${summary.disk_avail_gb} GB free of ${summary.disk_size_gb} GB; need ${summary.need_gb} GB → ${summary.room ? 'ROOM' : 'NOT ENOUGH DISK'}`);
  if (!summary.room) done(3);
  if (!APPLY) done(0);

  // ── Build ─────────────────────────────────────────────────────────────
  const { rows: existing } = await c.query(
    `SELECT i.indisvalid FROM pg_class r JOIN pg_index i ON i.indexrelid = r.oid WHERE r.relname = $1`, [INDEX]);
  if (existing.length && !existing[0].indisvalid) {
    // A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep forever.
    console.log(`[index] ${INDEX} exists but is INVALID (an interrupted build) — dropping it and rebuilding.`);
    await c.query(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  }
  if (existing.length && existing[0].indisvalid) {
    console.log(`[index] ${INDEX} already exists and is valid — not rebuilding.`);
    summary.built = false;
  } else {
    await c.query(`SET maintenance_work_mem = '1GB'`);
    const t0 = Date.now();
    const watcher = directClient();
    await watcher.connect();
    const tick = setInterval(async () => {
      try {
        const { rows } = await watcher.query(
          `SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total FROM pg_stat_progress_create_index WHERE relid = 'page_translations'::regclass`);
        const p = rows[0];
        if (p) console.log(`[index] ${Math.round((Date.now() - t0) / 60000)} min · ${p.phase} · blocks ${p.blocks_done}/${p.blocks_total} · tuples ${p.tuples_done}/${p.tuples_total}`);
      } catch (e) { console.log(`[index] progress read failed: ${e.message}`); }
    }, 10 * 60 * 1000);
    console.log(`[index] building ${INDEX} CONCURRENTLY (hours; writers keep running) …`);
    try {
      await c.query(indexSql);
    } finally {
      clearInterval(tick);
      await watcher.end().catch(() => {});
    }
    summary.built = true;
    summary.build_minutes = Math.round((Date.now() - t0) / 60000);
  }
  const { rows: [after] } = await c.query(
    `SELECT pg_relation_size($1::regclass) AS bytes, i.indisvalid FROM pg_class r JOIN pg_index i ON i.indexrelid = r.oid WHERE r.relname = $1`, [INDEX]);
  summary.index_gb = Number((Number(after.bytes) / GiB).toFixed(2));
  summary.index_valid = after.indisvalid;
  if (!after.indisvalid) throw new Error(`${INDEX} is INVALID after the build`);

  // ── RPC ───────────────────────────────────────────────────────────────
  await c.query(fnSql);

  // ── The planner must actually choose it (a partial index it cannot prove is just disk) ──
  const { rows: [probe] } = await c.query(
    `SELECT embedding::text AS v FROM page_translations WHERE embedding IS NOT NULL AND coalesce(translation, '') = '' LIMIT 1`);
  const { rows: plan } = await c.query(
    `EXPLAIN SELECT page_id FROM page_translations p
      WHERE p.embedding IS NOT NULL AND coalesce(p.translation, '') = ''
      ORDER BY p.embedding <=> $1::vector LIMIT 10`, [probe.v]);
  const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
  summary.planner_uses_index = planText.includes(INDEX);
  console.log(planText);
  const t1 = Date.now();
  const { rows: hits } = await c.query(`SELECT * FROM match_semantic_untranslated($1::vector, 0.0, 10)`, [probe.v]);
  summary.rpc_probe = { rows: hits.length, ms: Date.now() - t1, top_similarity: hits[0]?.similarity ?? null };
  if (!summary.planner_uses_index || hits.length === 0) throw new Error('planner does not use the index, or the RPC returned nothing');
  done(0);
} catch (e) {
  summary.error = e.message;
  console.error(`[index] FAILED: ${e.message}`);
  done(1);
} finally {
  await c.end().catch(() => {});
}
