/**
 * PRIOR ART: rerank-eval.mts in this directory — the same re-rank over the 12K-page
 * #6173 pilot pool, where every shelf is the same size. scripts/eval/librarian-search/
 * variants.mjs runs the Librarian's hybrid search live but scores recall of expected
 * books, not the spread of traditions. Neither shows what the re-rank has to work with
 * in production: the 40 nearest of 5.2M translated pages.
 *
 * live-spread — the 25 pilot concept queries through the production code path
 * (conceptPageSearch → match_semantic), counting tradition families by `books.tradition`:
 *   pool      families among the 40 candidates the RPC returns (the re-rank's ceiling)
 *   off / on  families in the first ten, before and after the re-rank
 * Any page counts: nobody judged these pages for relevance. A query whose RPC call
 * times out (anon role, 3 s) is retried, then reported as failed.
 *
 * Cost: 25 query embeddings (a fraction of a cent, metered by the app's own path).
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/live-spread.mts [--json results/<date>-live.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conceptPageSearch } from '../../../src/lib/search/concept-search';
import { GLOBAL_SCOPE } from '../../../src/lib/tenant-search-scope';
import { traditionFamily } from '../../../src/lib/search/diversity';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const gold = JSON.parse(fs.readFileSync(path.join(here, '../embed-granularity/gold.json'), 'utf8')).queries;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

async function run(query: string, limit: number, diversity: 'off' | 'tradition') {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await conceptPageSearch(query, limit, { scope: GLOBAL_SCOPE, diversity }); } catch { /* cold index: the repeat call is warm */ }
  }
  return null;
}
const fams = (rows: { tradition?: string[] }[]) => {
  const c: Record<string, number> = {};
  for (const r of rows) { const f = traditionFamily(r.tradition) ?? 'unlabelled'; c[f] = (c[f] || 0) + 1; }
  return c;
};

const per: any[] = [];
for (const q of gold) {
  const pool = await run(q.query, 40, 'off');
  const on = await run(q.query, 10, 'tradition');
  if (!pool || !on) { per.push({ qid: q.qid, query: q.query, failed: true }); console.log(`FAILED ${q.query}`); continue; }
  const off10 = fams(pool.rows.slice(0, 10)), on10 = fams(on.rows), pool40 = fams(pool.rows);
  const row = {
    qid: q.qid, query: q.query, candidates: pool.rows.length,
    pool_families: Object.keys(pool40).length, off_families: Object.keys(off10).length, on_families: Object.keys(on10).length,
    off_top_share: Math.max(...Object.values(off10)) / 10, on_top_share: Math.max(...Object.values(on10)) / Math.max(1, on.rows.length),
    off_books: new Set(pool.rows.slice(0, 10).map((r) => r.book_id)).size, on_books: new Set(on.rows.map((r) => r.book_id)).size,
    moved: on.rows.filter((r) => !pool.rows.slice(0, 10).some((p) => p.page_id === r.page_id)).length,
    off10, on10, pool40,
  };
  per.push(row);
  console.log(`${row.off_families} → ${row.on_families} families (pool ${row.pool_families}, ${row.candidates} rows) | ${q.query}`);
}
const ok = per.filter((p) => !p.failed);
const summary = {
  date: new Date().toISOString().slice(0, 10), queries: per.length, answered: ok.length,
  pool_families: +mean(ok.map((p) => p.pool_families)).toFixed(2),
  off_families: +mean(ok.map((p) => p.off_families)).toFixed(2), on_families: +mean(ok.map((p) => p.on_families)).toFixed(2),
  off_top_share: +mean(ok.map((p) => p.off_top_share)).toFixed(2), on_top_share: +mean(ok.map((p) => p.on_top_share)).toFixed(2),
  off_books: +mean(ok.map((p) => p.off_books)).toFixed(1), on_books: +mean(ok.map((p) => p.on_books)).toFixed(1),
  one_family_pool: ok.filter((p) => p.pool_families === 1).length,
  one_family_off: ok.filter((p) => p.off_families === 1).length, one_family_on: ok.filter((p) => p.on_families === 1).length,
  rows_moved_into_top10: +mean(ok.map((p) => p.moved)).toFixed(1),
};
console.log(JSON.stringify(summary, null, 1));
if (OUT) fs.writeFileSync(path.resolve(here, OUT), JSON.stringify({ ...summary, per_query: per }, null, 1) + '\n');
process.exit(0);
