/**
 * PRIOR ART: scripts/eval/orig-lang-recall/untranslated-lane.mjs (#6151) — recall@10 of
 * `match_semantic_untranslated` ALONE, by SQL, on the 40 #5729 queries. It cannot say what
 * a reader gets, because the app fuses that lane with the English one and holds it to
 * three rows a screen (src/lib/search/concept-search.ts).
 *
 * untranslated-fused — the 40 #5729 queries through the app's own path, lane switched on
 * for this process only. Per query: where the gold page lands in the fused list
 * (recall@10 and @20), against the English lane alone (today). Run it once the index is
 * live; until then every query reports the lane as `unavailable` and the script says so.
 *
 * Cost: 40 query embeddings.
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/untranslated-fused.mts [--json results/<date>-untranslated-fused.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SEARCH_UNTRANSLATED_LANE = 'on';
const { conceptPageSearch } = await import('../../../src/lib/search/concept-search');
const { GLOBAL_SCOPE } = await import('../../../src/lib/tenant-search-scope');

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const gold = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries;

const per: any[] = [];
for (const q of gold) {
  let res = null;
  for (let attempt = 0; attempt < 5 && !res; attempt++) {
    try { res = await conceptPageSearch(q.query, 20, { scope: GLOBAL_SCOPE, diversity: 'off' }); } catch { /* cold index */ }
  }
  if (!res) { per.push({ qid: q.qid, lang: q.lang, failed: true }); continue; }
  const rank = res.rows.findIndex((r) => r.book_id === q.book_id && r.page_number === q.page_number) + 1;
  const bookRank = res.rows.findIndex((r) => r.book_id === q.book_id) + 1;
  per.push({ qid: q.qid, lang: q.lang, lane: res.lanes.untranslated, rank: rank || null, book_rank: bookRank || null, original_rows: res.rows.filter((r) => r.text_lane === 'original').length, empty_snippets: res.rows.filter((r) => !r.snippet).length });
}
const ok = per.filter((p) => !p.failed);
const lanes = [...new Set(ok.map((p) => p.lane))];
const share = (k: number) => `${ok.filter((p) => p.rank && p.rank <= k).length}/${ok.length}`;
const summary = {
  queries: per.length, answered: ok.length, lane_state: lanes,
  page_in_top10: share(10), page_in_top20: share(20),
  book_in_top10: `${ok.filter((p) => p.book_rank && p.book_rank <= 10).length}/${ok.length}`,
  by_language_top20: Object.fromEntries([...new Set(ok.map((p) => p.lang))].map((l) => [l, `${ok.filter((p) => p.lang === l && p.rank).length}/${ok.filter((p) => p.lang === l).length}`])),
  mean_original_rows_in_20: +(ok.reduce((s, p) => s + p.original_rows, 0) / (ok.length || 1)).toFixed(1),
  rows_with_no_snippet: ok.reduce((s, p) => s + p.empty_snippets, 0),
};
console.log(JSON.stringify(summary, null, 1));
if (!lanes.includes('ok')) console.log('\nThe original-text lane did not answer (see lane_state): `unavailable` means match_semantic_untranslated is not deployed or this process has no service-role key. The numbers above are the English lane alone.');
if (OUT) fs.writeFileSync(path.resolve(here, OUT), JSON.stringify({ ...summary, per_query: per }, null, 1) + '\n');
process.exit(0);
