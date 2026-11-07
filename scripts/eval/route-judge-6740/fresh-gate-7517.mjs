#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/router-table/build.py gate() — the router rule this applies, unchanged (P(acc >=
// acc_best - 0.05) >= 0.9, wrong text <= the best route's rate + 2%), but build.py prices and priors every cell of the
// table from v1/v2; this answers one question on the judge's own pages with flat priors, and counts a read Gemini's
// filter cut (never written) as a page the route did not deliver, which build.py has no notion of.
/**
 * #7517: may a FRESH 3.8 Flash-low read (agy, second account) replace Flash-Lite Batch on the German, French and
 * Latin lite cells? Reads a route-judge DIR (judge.mjs score has run) and, for the cells judged there before, the
 * router-tests score for lite>agy-flash-low on the same pages.
 *
 *   node scripts/eval/route-judge-6740/fresh-gate-7517.mjs --out=DIR [--prior=<router-tests DIR>]
 *
 * Routes per cell, every one over the cell's n drawn pages (one per book):
 *   lite                  the stored Flash-Lite draft
 *   lite>agy-flash-low    Flash-low correcting it (router tests 2026-10-26, or this run for latin-lite)
 *   fresh                 Flash-low reading the image alone; a cut or failed read counts as NOT accepted
 *   fresh|lite            what a lane would serve: the fresh read where it was delivered, the lite draft where not
 *                         (the lane hands the page back to Batch)
 * Posterior Beta(1 + k, 1 + n - k), 40,000 draws, seed 7517. Writes DIR/fresh-gate.json; prints a table.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out'));
const PRIOR = arg('prior') ?? 'scripts/eval/route-judge-6740/results/router-tests-2026-10-26';
const RULE = { within: 0.05, p: 0.9, wrong_text_max: 0.02, draws: 40000 };
const J = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
// DIR/verdicts-opus.jsonl, or the committed .gz beside it
const jsonl = (f) => { const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : fs.existsSync(`${f}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${f}.gz`)).toString('utf8') : ''; return t.split('\n').filter(Boolean).map((l) => JSON.parse(l)); };

const sample = J(OUT, 'sample.json'), key = J(OUT, 'key.json');
const V = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const prior = fs.existsSync(path.join(PRIOR, 'score.json')) ? J(PRIOR, 'score.json') : null;
const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');

// Beta draws by the gamma ratio (Marsaglia-Tsang), seeded.
function betaDraws(a, b, n, rnd) {
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (k) => {
    if (k < 1) return gamma(k + 1) * rnd() ** (1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
  };
  return Array.from({ length: n }, () => { const x = gamma(a), y = gamma(b); return x / (x + y); });
}
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];

const report = { rule: RULE, generated_at: new Date().toISOString(), cells: {} };
for (const [cell, cs] of Object.entries(sample.cells)) {
  if (!cs.correctors?.['agy-flash-low']?.fresh) continue;
  const n = cs.pages.length;
  const item = (route, pid) => { const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === pid); return k && V.get(k.judged_as); };
  const skipped = J(OUT, 'packet-skipped.json').filter((s) => s.cell === cell && s.route === 'agy-flash-low');
  const routes = {};
  const tally = (get) => { let k = 0, w = 0, judged = 0; for (const p of cs.pages) { const v = get(p.page_id); if (!v) continue; judged++; if (v.accept) k++; if (wt(v)) w++; } return { k, w, judged }; };
  routes.lite = { ...tally((pid) => item('lite', pid)), n };
  if (cs.routes.includes('lite>agy-flash-low')) routes['lite>agy-flash-low'] = { ...tally((pid) => item('lite>agy-flash-low', pid)), n, source: 'this run' };
  else if (prior?.cells?.[cell]?.routes?.['lite>agy-flash-low']) {
    const r = prior.cells[cell].routes['lite>agy-flash-low'];
    const [k, nn] = r.accept.split('/').map(Number);
    routes['lite>agy-flash-low'] = { k, w: Number(r.wrong_text_pages.split('/')[0]), judged: nn, n: nn, source: `${PRIOR}/score.json (same pages)` };
  }
  const fresh = tally((pid) => item('agy-flash-low', pid));
  routes.fresh = { ...fresh, n, delivered: fresh.judged, not_delivered: n - fresh.judged, why_not: Object.entries(skipped.reduce((o, s) => ({ ...o, [s.why]: (o[s.why] ?? 0) + 1 }), {})) };
  routes['fresh|lite'] = { ...tally((pid) => item('agy-flash-low', pid) ?? item('lite', pid)), n };
  // on the delivered pages only: the fresh read against lite, same pages
  const del = cs.pages.filter((p) => item('agy-flash-low', p.page_id) && item('lite', p.page_id));
  const onDelivered = { pages: del.length, fresh: del.filter((p) => item('agy-flash-low', p.page_id).accept).length, lite: del.filter((p) => item('lite', p.page_id).accept).length,
    fresh_wrong_text: del.filter((p) => wt(item('agy-flash-low', p.page_id))).length, lite_wrong_text: del.filter((p) => wt(item('lite', p.page_id))).length };
  // A cell whose reads or judgements did not happen is NOT MEASURED, never a pass on empty posteriors.
  if (!routes.lite.judged || !fresh.judged && !skipped.length) {
    report.cells[cell] = { lang: cs.lang, n, not_measured: `judged: lite ${routes.lite.judged}, fresh ${fresh.judged}; fresh reads cut or failed ${skipped.length}` };
    console.log(`\n${cell} (${cs.lang}): NOT MEASURED (${report.cells[cell].not_measured})`);
    continue;
  }
  const rnd = makeRng(7517);
  for (const r of Object.values(routes)) { r.d = betaDraws(1 + r.k, 1 + r.n - r.k, RULE.draws, rnd); r.mean = r.d.reduce((a, b) => a + b, 0) / r.d.length; r.ci90 = [q(r.d, 0.05), q(r.d, 0.95)].map((x) => +x.toFixed(2)); }
  const [bestId, best] = Object.entries(routes).sort((a, b) => b[1].mean - a[1].mean)[0];
  const verdict = {};
  for (const [id, r] of Object.entries(routes)) {
    const pWithin = r.d.filter((u, i) => u >= best.d[i] - RULE.within).length / RULE.draws;
    const wtOk = r.w / r.n <= best.w / best.n + RULE.wrong_text_max;
    verdict[id] = { p_within: +pWithin.toFixed(3), wrong_text_ok: wtOk, passes: pWithin >= RULE.p && wtOk };
  }
  for (const r of Object.values(routes)) delete r.d;
  report.cells[cell] = { lang: cs.lang, n, best: bestId, routes, verdict, on_delivered: onDelivered };
  console.log(`\n${cell} (${cs.lang}, n=${n}; best ${bestId})`);
  for (const [id, r] of Object.entries(routes)) console.log(`  ${id.padEnd(20)} accept ${r.k}/${r.n} [${r.ci90.join(', ')}]  wrong text ${r.w}/${r.n}${r.delivered != null ? `  delivered ${r.delivered}/${r.n}` : ''}  P(within ${RULE.within})=${verdict[id].p_within} wt ${verdict[id].wrong_text_ok ? 'ok' : 'FAIL'} → ${verdict[id].passes ? 'PASS' : 'fail'}`);
  console.log(`  on the ${onDelivered.pages} delivered pages: fresh ${onDelivered.fresh}, lite ${onDelivered.lite} accepted; wrong text fresh ${onDelivered.fresh_wrong_text}, lite ${onDelivered.lite_wrong_text}`);
}
fs.writeFileSync(path.join(OUT, 'fresh-gate.json'), JSON.stringify(report, null, 1));
