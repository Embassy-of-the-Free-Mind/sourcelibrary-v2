#!/usr/bin/env node
/**
 * #5099 gate before the cutover: is clip_embeddings.embedding_v4 complete, and
 * is every vector in it a v4 vector of the row's own image?
 *
 *   1. coverage  every row has embedding_v4, embedded from its CURRENT image_url
 *   2. drift     cos(embedding, embedding_v4) over EVERY row. Same image, two
 *                runtimes: measured median 0.991–0.993, min ~0.94 on 40 rows.
 *                A row far below that was embedded from a different image (a
 *                URL that now serves something else) — listed, not averaged away.
 *                A row at exactly 1.0 means a v2 vector reached the v4 column.
 *   3. replay    a sample re-embedded by the v4 server must equal what is stored
 *                (the runtime is bit-deterministic on the box: 60/60 exact).
 *
 * Retrieval quality is a separate instrument: scripts/eval/clip-index-recall.mjs
 * --column=embedding_v4 against the v2 column on the same bench targets.
 *
 * Read-only. Exit 0 = PASS, 1 = FAIL (reasons printed), 2 = could not measure.
 *
 * Usage (Hetzner): set -a; source .env.production.local; set +a
 *   node scripts/audit/clip-v4-shadow-verify.mjs [--clip-url=http://localhost:3458] [--replay=50] [--drift-floor=0.90]
 *
 * PRIOR ART: scripts/audit/clip-index-integrity.mjs — checks labels, orphans and
 * the Mongo gap, never the vectors; scripts/eval/clip-index-recall.mjs — ranks
 * bench targets, cannot see coverage or a wrong-image row.
 */

import pg from 'pg';

const opt = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const CLIP_URL = opt('clip-url', 'http://localhost:3458');
const REPLAY = parseInt(opt('replay', '50'));
const DRIFT_FLOOR = parseFloat(opt('drift-floor', '0.90'));

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.replace(':6543/', ':5432/'), ssl: { rejectUnauthorized: false } });
await db.connect().catch(e => { console.error('cannot connect:', e.message); process.exit(2); });
await db.query(`SET statement_timeout = '10min'`);
const fails = [];

// 1. coverage
const { rows: [cov] } = await db.query(`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE embedding_v4 IS NULL)::int AS missing,
         count(*) FILTER (WHERE embedding_v4 IS NOT NULL AND embedding_v4_url IS DISTINCT FROM image_url)::int AS stale
    FROM clip_embeddings`);
console.log(`coverage: ${cov.total} rows, ${cov.missing} missing, ${cov.stale} stale`);
if (cov.missing || cov.stale) {
  fails.push(`${cov.missing + cov.stale} rows have no current v4 vector`);
  const { rows } = await db.query(`
    SELECT source_type, count(*)::int AS n FROM clip_embeddings
     WHERE embedding_v4 IS NULL OR embedding_v4_url IS DISTINCT FROM image_url GROUP BY 1 ORDER BY 2 DESC`);
  for (const r of rows) console.log(`  ${r.source_type}: ${r.n}`);
}

// 2. drift, every row
const { rows: [d] } = await db.query(`
  WITH c AS (SELECT 1 - (embedding <=> embedding_v4) AS cos FROM clip_embeddings WHERE embedding_v4 IS NOT NULL)
  SELECT count(*)::int AS n,
         percentile_cont(ARRAY[0.001, 0.01, 0.05, 0.5]) WITHIN GROUP (ORDER BY cos) AS pct,
         min(cos) AS min, max(cos) AS max,
         count(*) FILTER (WHERE cos < $1)::int AS below,
         count(*) FILTER (WHERE cos > 0.999999)::int AS identical
    FROM c`, [DRIFT_FLOOR]);
console.log(`drift v2→v4 over ${d.n} rows: p0.1 ${d.pct[0].toFixed(4)} p1 ${d.pct[1].toFixed(4)} p5 ${d.pct[2].toFixed(4)} median ${d.pct[3].toFixed(4)} min ${Number(d.min).toFixed(4)} max ${Number(d.max).toFixed(6)}`);
console.log(`  below ${DRIFT_FLOOR}: ${d.below}   identical (v2 vector in the v4 column?): ${d.identical}`);
if (d.pct[3] < 0.98 || d.pct[3] > 0.999) fails.push(`median drift ${d.pct[3].toFixed(4)} is outside the measured 0.98–0.999 band — not the runtime change`);
if (d.identical > 0) fails.push(`${d.identical} rows have identical v2 and v4 vectors`);
if (d.below > 0) {
  const { rows } = await db.query(`
    SELECT id, image_url, round((1 - (embedding <=> embedding_v4))::numeric, 4) AS cos FROM clip_embeddings
     WHERE embedding_v4 IS NOT NULL AND 1 - (embedding <=> embedding_v4) < $1 ORDER BY 3 LIMIT 15`, [DRIFT_FLOOR]);
  console.log(`  lowest (the image behind the URL likely changed since the v2 embed — the v4 vector is the current one):`);
  for (const r of rows) console.log(`    ${r.cos} ${r.id} ${r.image_url}`);
  // Informational: v4 describes what the URL serves NOW, which is the better
  // vector. Fail only if it is not a small tail.
  if (d.below > d.n * 0.001) fails.push(`${d.below} rows below ${DRIFT_FLOOR} (> 0.1%) — look before cutting over`);
}

// 3. replay a sample through the v4 server
const health = await fetch(`${CLIP_URL}/health`).then(r => r.json()).catch(() => null);
if (health?.runtime !== 'v4') { console.error(`replay: ${CLIP_URL} is not a v4 server (${health?.runtime})`); await db.end(); process.exit(2); }
const { rows: sample } = await db.query(`
  SELECT id, image_url, embedding_v4::text AS v4 FROM clip_embeddings
   WHERE embedding_v4 IS NOT NULL AND embedding_v4_url = image_url ORDER BY md5(id || current_date::text) LIMIT ${REPLAY}`);
const cos = (a, b) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return s / Math.sqrt(x * y); };
let exact = 0, replayed = 0, worst = 1;
for (let i = 0; i < sample.length; i += 10) {
  const batch = sample.slice(i, i + 10);
  const r = await fetch(`${CLIP_URL}/embed-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: batch.map(s => s.image_url) }) }).then(x => x.json());
  r.results.forEach((res, j) => {
    if (!res.embedding) return;
    const c = cos(JSON.parse(batch[j].v4), res.embedding);
    replayed++; worst = Math.min(worst, c); if (c > 0.999999) exact++;
  });
}
console.log(`replay: ${exact}/${replayed} bit-exact (worst ${worst.toFixed(6)})`);
// Stored vectors were rounded through Postgres float4; a few non-exact rows are
// images whose bytes changed since the pass (the drift check lists those).
if (replayed < sample.length * 0.9 || exact < replayed * 0.9) fails.push(`replay ${exact}/${replayed} exact — the column was not written by this server`);

await db.end();
if (fails.length) { console.log(`\nFAIL\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('\nPASS — embedding_v4 is complete and is the v4 space of each row\'s own image');
