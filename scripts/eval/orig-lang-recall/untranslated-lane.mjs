#!/usr/bin/env node
/**
 * Score the original-text lane (`match_semantic_untranslated`, the partial HNSW
 * index from scripts/migration/add-untranslated-pages-index.sql) on the #5729
 * gold set: recall@10 over the 40 queries, per language, and latency.
 *
 * PRIOR ART: gemini-arm.mjs in this directory — its `--iterative-scan` and
 * `--ocr-only-rank` arms score the same lane through the SHARED index and by
 * exact scan; this scores it through the index built for it, after the tail
 * backfill. Same gold.json, same stored query vectors (q-gemini.json), so the
 * numbers line up with the experiment's table without re-embedding anything.
 *
 * A miss is reported as one of two things, because they have different fixes:
 *   - `no_vector`: the gold page has no OCR-only row with a vector (not embedded,
 *     or it has since been translated and left the lane);
 *   - `miss`: the row is in the lane and the index did not return it.
 *
 * Cost: none (stored query vectors; Postgres only).
 *
 *   node --env-file=.env.production.local scripts/eval/orig-lang-recall/untranslated-lane.mjs \
 *     --dir /root/claude-jobs/librarian-orig-5867 [--spot 5] [--out result.json]
 *
 * On the job box the #5729 work directory is gone, but the #6170 eval kept the same 40
 * query vectors (production request, `preview-plain`), so either source works:
 *   --format-queries /data/scratch/sl/claude-jobs/embed-format-eval-work/queries.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DIR = val('dir');
const FORMAT_QUERIES = val('format-queries');
if (!DIR && !FORMAT_QUERIES) { console.error('--dir (holds q-gemini.json) or --format-queries <queries.json of the #6170 eval> required'); process.exit(1); }
const SPOT = Number(val('spot') || 0);
const OUT = val('out');
const here = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
// The #6170 file holds 3072-d vectors; the first 768 are what production stores
// and queries with (`outputDimensionality: 768`), and cosine ignores the length.
const qv = FORMAT_QUERIES
  ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(FORMAT_QUERIES, 'utf8')).A['preview-plain']).map(([k, v]) => [k, v.slice(0, 768)]))
  : JSON.parse(fs.readFileSync(path.join(DIR, 'q-gemini.json'), 'utf8'));

// --spot N: N queries spread across the languages (round-robin), not the first N of one.
let queries = gold;
if (SPOT) {
  const byLang = new Map();
  for (const q of gold) { if (!byLang.has(q.lang)) byLang.set(q.lang, []); byLang.get(q.lang).push(q); }
  const lanes = [...byLang.values()];
  queries = [];
  for (let i = 0; queries.length < SPOT && i < gold.length; i++) {
    const lane = lanes[i % lanes.length];
    const q = lane[Math.floor(i / lanes.length)];
    if (q) queries.push(q);
  }
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET statement_timeout = 60000');

const per = [];
for (const q of queries) {
  const v = JSON.stringify(qv[q.qid]);
  const { rows: inLane } = await client.query(
    `SELECT 1 FROM page_translations WHERE book_id = $1 AND page_number = $2
       AND embedding IS NOT NULL AND coalesce(translation, '') = ''`, [q.book_id, q.page_number]);
  const t0 = Date.now();
  const { rows } = await client.query('SELECT book_id, page_number FROM match_semantic_untranslated($1::vector, 0.0, 10)', [v]);
  const ms = Date.now() - t0;
  const rank = rows.findIndex((r) => r.book_id === q.book_id && r.page_number === q.page_number) + 1;
  per.push({ qid: q.qid, lang: q.lang, hit: rank > 0, rank: rank || null, in_lane: inLane.length > 0, ms, returned: rows.length });
}
await client.end();

const share = (xs) => `${xs.filter((x) => x.hit).length}/${xs.length}`;
const langs = [...new Set(per.map((p) => p.lang))];
const times = per.map((p) => p.ms).sort((a, b) => a - b);
const result = {
  queries: per.length,
  recall_at_10: Number((per.filter((p) => p.hit).length / per.length).toFixed(2)),
  hits: share(per),
  in_lane: per.filter((p) => p.in_lane).length,
  recall_at_10_in_lane: share(per.filter((p) => p.in_lane)),
  by_language: Object.fromEntries(langs.map((l) => [l, share(per.filter((p) => p.lang === l))])),
  no_vector: per.filter((p) => !p.in_lane).map((p) => p.qid),
  miss: per.filter((p) => p.in_lane && !p.hit).map((p) => p.qid),
  latency_ms: { median: times[Math.floor(times.length / 2)], p90: times[Math.floor(times.length * 0.9)], max: times[times.length - 1] },
  per_query: per,
};
console.log(JSON.stringify({ ...result, per_query: undefined }, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
