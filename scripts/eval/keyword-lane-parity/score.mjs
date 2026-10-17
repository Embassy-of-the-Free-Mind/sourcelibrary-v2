// Score a parity.harness.ts run (#6852): recall of the Atlas page lane by the keyword service, per
// stratum, and the lane's time on each side.
//   node scripts/eval/keyword-lane-parity/score.mjs <parity.jsonl> [--md]
//
// Every comparison is on book:page keys after the Atlas side is confined to LIVE books (visible,
// pages_count > 0, not hidden): the route drops the rest at its join, so they never reach a reader.
// The service returns live books only.
//   recall@20     |Atlas main top-20 ∩ service main top-20| / |Atlas main top-20|
//   recall@25     the same over the lane's whole main list (k = 25)
//   lane recall   the lane's whole page list (main + name-variant pages + roll-up pages), as sets
//   books@30      the roll-up's 30 most-evidenced live books (Atlas) found among the service's 30
//   top-1         the Atlas first page is somewhere in the service's main list
//   books@20      the distinct books of Atlas's main top 20 found among the books of the service's main list:
//                 the route shows a book once (page rows of a book already listed are skipped, then rows
//                 collapse by work), so which BOOKS the lane names is what a reader sees; page-level
//                 recall also counts which of a book's near-tied pages each engine put first
// Queries where the Atlas side has no live page are counted, not scored.
// Time: Atlas = the lane's sequence as the harness ran it from this box (expansion, main + variant +
// count in parallel, liveness check, best page per book); service = the name expansion (which stays in
// the app) + HTTP round trip + the hydration find serve mode adds. prod = the stage_ms.page values the
// production log holds for the same queries (Vercel fra1 → Atlas), one median per query.
//
// PRIOR ART: scripts/eval/search-recall/run.mjs scores /api/search responses for book recall against
// expected books; here the reference is another engine's ranked list, not a hand-made expectation.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: score.mjs <parity.jsonl> [--md]'); process.exit(2); }
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const k = (x) => `${x[0]}:${x[1]}`;
const recall = (a, b, n = Infinity) => { const A = a.slice(0, n); if (!A.length) return null; const B = new Set(b.slice(0, n)); return A.filter((x) => B.has(x)).length / A.length; };
const q = (xs, p) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const mean = (xs) => { const s = xs.filter((x) => x != null); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const median = (xs) => q(xs, 0.5);

const scored = rows.map((r) => {
  const live = new Set(r.live_atlas_books);
  const L = (xs) => xs.filter((x) => live.has(x[0])).map(k);
  const aMain = L(r.atlas.main), aLane = L([...r.atlas.main, ...r.atlas.variants, ...r.atlas.extra]);
  const aBooks = r.atlas.counts.map((c) => c[0]);
  const out = { stratum: r.stratum, q: r.q, atlas_n: aMain.length, error: r.svc.error || null };
  out.atlas_ms = r.atlas.ms.total;
  out.prod_ms = median(r.prod_page_ms || []);
  if (r.svc.error) return out;
  const sMain = r.svc.main.map(k), sLane = [...r.svc.main, ...r.svc.variants, ...r.svc.extra].map(k);
  const sBooks = r.svc.counts.map((c) => c[0]);
  Object.assign(out, {
    r20: recall(aMain, sMain, 20), r25: recall(aMain, sMain, 25), lane: recall(aLane, sLane),
    books30: r.terms && aBooks.length ? recall(aBooks, sBooks, 30) : null,
    top1: aMain.length ? (sMain.includes(aMain[0]) ? 1 : 0) : null,
    books20: (() => { const ab = [...new Set(aMain.slice(0, 20).map((x) => x.split(':')[0]))]; if (!ab.length) return null; const sb = new Set(sMain.map((x) => x.split(':')[0])); return ab.filter((b) => sb.has(b)).length / ab.length; })(),
    svc_server_ms: r.svc.server_ms, svc_http_ms: r.svc.http_ms, hydrate_ms: r.svc.hydrate_ms,
    svc_lane_ms: r.atlas.ms.expand + r.svc.http_ms + (r.svc.hydrate_ms || 0),
    svc_n: sMain.length, fuzzy: !!r.svc.fuzzy,
  });
  return out;
});

const strata = ['all', ...new Set(scored.map((s) => s.stratum))];
const table = strata.map((st) => {
  const xs = scored.filter((s) => st === 'all' || s.stratum === st);
  const ok = xs.filter((s) => !s.error && s.atlas_n > 0);
  return {
    stratum: st, n: xs.length, scored: ok.length, empty_atlas: xs.filter((s) => s.atlas_n === 0).length, errors: xs.filter((s) => s.error).length,
    r20: mean(ok.map((s) => s.r20)), r20_p10: q(ok.map((s) => s.r20), 0.1), r25: mean(ok.map((s) => s.r25)), lane: mean(ok.map((s) => s.lane)),
    books30: mean(ok.map((s) => s.books30)), top1: mean(ok.map((s) => s.top1)), books20: mean(ok.map((s) => s.books20)),
    atlas_p50: q(xs.map((s) => s.atlas_ms), 0.5), atlas_p90: q(xs.map((s) => s.atlas_ms), 0.9),
    prod_p50: q(xs.map((s) => s.prod_ms), 0.5), prod_p90: q(xs.map((s) => s.prod_ms), 0.9),
    svc_p50: q(ok.map((s) => s.svc_server_ms), 0.5), svc_p90: q(ok.map((s) => s.svc_server_ms), 0.9), svc_p99: q(ok.map((s) => s.svc_server_ms), 0.99), svc_max: q(ok.map((s) => s.svc_server_ms), 1),
    lane_p50: q(ok.map((s) => s.svc_lane_ms), 0.5), lane_p90: q(ok.map((s) => s.svc_lane_ms), 0.9),
  };
});

const f = (x, d = 3) => (x == null ? '—' : typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : String(x));
if (process.argv.includes('--md')) {
  console.log('| stratum | n | scored | recall@20 | p10 | recall@25 | books@20 | lane recall | roll-up books@30 | top-1 | Atlas lane p50 / p90 ms | prod page p50 / p90 ms | svc server p50 / p90 / p99 / max ms | serve lane p50 / p90 ms |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of table) console.log(`| ${t.stratum} | ${t.n} | ${t.scored} | ${f(t.r20)} | ${f(t.r20_p10, 2)} | ${f(t.r25)} | ${f(t.books20)} | ${f(t.lane)} | ${f(t.books30)} | ${f(t.top1, 2)} | ${f(t.atlas_p50)} / ${f(t.atlas_p90)} | ${f(t.prod_p50)} / ${f(t.prod_p90)} | ${f(t.svc_p50)} / ${f(t.svc_p90)} / ${f(t.svc_p99)} / ${f(t.svc_max)} | ${f(t.lane_p50)} / ${f(t.lane_p90)} |`);
} else {
  console.table(table.map((t) => Object.fromEntries(Object.entries(t).map(([a, b]) => [a, typeof b === 'number' && !Number.isInteger(b) ? +b.toFixed(3) : b]))));
}
// The worst queries, for reading by eye (stratum, recall@20, the service's MATCH is in the jsonl).
const worst = scored.filter((s) => s.r20 != null).sort((a, b) => a.r20 - b.r20).slice(0, 15);
console.error('\nlowest recall@20:');
for (const s of worst) console.error(`  ${s.stratum.padEnd(9)} r20=${f(s.r20, 2)} lane=${f(s.lane, 2)} atlas_n=${s.atlas_n} svc_ms=${s.svc_server_ms}  ${JSON.stringify(s.q).slice(0, 70)}`);
const slow = scored.filter((s) => s.svc_server_ms != null).sort((a, b) => b.svc_server_ms - a.svc_server_ms).slice(0, 10);
console.error('\nslowest service queries:');
for (const s of slow) console.error(`  ${String(s.svc_server_ms).padStart(6)} ms  ${s.stratum.padEnd(9)} ${JSON.stringify(s.q).slice(0, 70)}`);
