#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/parse-results.py parses claude -p outputs and checks prior links, but has no
// strata, weights or controls; scripts/eval/ft-pilot-score-r5.ts scores round 5's badged × western strata.
// This scores the #7651 pre-registered sample with the estimator written in its manifest before any search.
//
//   node scripts/eval/ft-untranslated-7651-score.mjs --run $JOB_SCRATCH/run [--rejudge $JOB_SCRATCH/rejudge] \
//     --out scripts/eval/results/ft-untranslated-7651-scores.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RUN = arg('--run');
const REJ = arg('--rejudge');
const OUT = arg('--out', 'scripts/eval/results/ft-untranslated-7651-scores.json');
const m = JSON.parse(readFileSync(arg('--manifest', 'scripts/eval/results/ft-untranslated-sample-7651-manifest.json'), 'utf8'));
const V = ['no_prior_known', 'prior_exists', 'partial_only', 'not_a_single_work', 'identity_unresolved', 'already_english', 'could_not_search'];
const STRATA = Object.keys(m.strata);
const PERIODS = ['<1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];

// Last JSON object carrying a verdict in a claude -p output (a file can hold two runs).
export function parseOne(dir, id) {
  const p = join(dir, `${id}.json`);
  if (!existsSync(p)) return null;
  let best = null;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    const r = j.result || '';
    if (/hit your/i.test(r)) continue;
    const mm = r.match(/\{[\s\S]*\}/);
    if (!mm) continue;
    let o; try { o = JSON.parse(mm[0]); } catch { continue; }
    if (o.verdict) best = { ...o, _cost: j.total_cost_usd, _turns: j.num_turns };
  }
  if (best && !V.includes(best.verdict)) best.verdict_raw = best.verdict, best.verdict = 'could_not_search';
  return best;
}

function rng(seed) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const wilson = (k, n) => {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [c - h, c + h];
};
const pct = (q) => (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// Link check for every cited prior (one curl each; a 4xx/5xx/000 is reported, not silently dropped).
function status(url) {
  try { return execFileSync('curl', ['-s', '-o', '/dev/null', '-L', '-m', '20', '-A', 'Mozilla/5.0', '-w', '%{http_code}', url], { encoding: 'utf8' }).trim(); } catch { return '000'; }
}

const units = [];
const missing = [];
for (const s of m.sample) {
  const r = parseOne(RUN, s.id);
  if (!r) { missing.push(s.id); continue; }
  units.push({ ...s, r, y: r.verdict });
}
const ctl = m.controls.map((c) => ({ ...c, r: parseOne(RUN, c.id) }));

// Estimator (pre-registered): could_not_search leaves the denominator and is reported apart.
const asked = units.filter((u) => u.y !== 'could_not_search');
const strata = {};
let worksTot = Object.fromEntries(V.map((v) => [v, 0])), varTot = Object.fromEntries(V.map((v) => [v, 0]));
for (const h of STRATA) {
  const us = asked.filter((u) => u.stratum === h);
  const n = us.length, W = m.strata[h].works, B = m.strata[h].books;
  const row = { n, could_not_search: units.filter((u) => u.stratum === h && u.y === 'could_not_search').length, frame_works: W, frame_books: B };
  for (const v of V.slice(0, 6)) {
    const k = us.filter((u) => u.y === v).length;
    const p = n ? k / n : 0;
    const R = us.reduce((a, u) => a + (u.y === v ? u.work_books_in_stratum : 0), 0) / Math.max(1, us.reduce((a, u) => a + u.work_books_in_stratum, 0));
    row[v] = { k, rate: p, ci: wilson(k, n), works: W * p, books: B * R, book_rate: R };
    worksTot[v] += W * p;
    varTot[v] += (W * W * p * (1 - p) / Math.max(1, n)) * (1 - n / W);
  }
  strata[h] = row;
}
const W_ALL = STRATA.reduce((a, h) => a + m.strata[h].works, 0);
const B_ALL = STRATA.reduce((a, h) => a + m.strata[h].books, 0);

// Stratified bootstrap for book counts and period rates.
const rnd = rng(7651);
const REPS = 2000;
const byH = Object.fromEntries(STRATA.map((h) => [h, asked.filter((u) => u.stratum === h)]));
function estimate(sampleByH) {
  const o = { books: {}, works: {}, period: {} };
  for (const v of V.slice(0, 6)) { o.books[v] = 0; o.works[v] = 0; }
  const pw = Object.fromEntries(PERIODS.map((d) => [d, { w: 0, wb: 0, k: Object.fromEntries(V.slice(0, 6).map((v) => [v, 0])), kb: Object.fromEntries(V.slice(0, 6).map((v) => [v, 0])) }]));
  for (const h of STRATA) {
    const us = sampleByH[h]; const n = us.length; if (!n) continue;
    const W = m.strata[h].works, B = m.strata[h].books, msum = us.reduce((a, u) => a + u.work_books_in_stratum, 0);
    for (const v of V.slice(0, 6)) {
      o.works[v] += W * us.filter((u) => u.y === v).length / n;
      o.books[v] += B * us.reduce((a, u) => a + (u.y === v ? u.work_books_in_stratum : 0), 0) / msum;
    }
    for (const u of us) {
      const w = W / n, wb = (B / msum) * u.work_books_in_stratum, c = pw[u.period];
      c.w += w; c.wb += wb; c.k[u.y] += w; c.kb[u.y] += wb;
    }
  }
  for (const d of PERIODS) {
    const c = pw[d];
    o.period[d] = { works_frame_est: c.w, books_frame_est: c.wb };
    for (const v of V.slice(0, 6)) o.period[d][v] = { rate: c.w ? c.k[v] / c.w : null, works: c.k[v], books: c.kb[v], book_rate: c.wb ? c.kb[v] / c.wb : null };
  }
  return o;
}
const point = estimate(byH);
const boots = [];
for (let b = 0; b < REPS; b++) {
  const s = {};
  for (const h of STRATA) { const us = byH[h]; s[h] = us.map(() => us[Math.floor(rnd() * us.length)]); }
  boots.push(estimate(s));
}
const ci = (f) => { const xs = boots.map(f).filter((x) => x != null); return [pct(0.025)(xs), pct(0.975)(xs)]; };
const corpus = {};
for (const v of V.slice(0, 6)) {
  const se = Math.sqrt(varTot[v]);
  corpus[v] = {
    works: point.works[v], works_ci: [Math.max(0, point.works[v] - 1.96 * se), point.works[v] + 1.96 * se], works_rate: point.works[v] / W_ALL,
    books: point.books[v], books_ci: ci((o) => o.books[v]), books_rate: point.books[v] / B_ALL,
  };
}
const period = {};
for (const d of PERIODS) {
  const n = asked.filter((u) => u.period === d).length;
  period[d] = { n, thin: n < 10, frame_books: STRATA.reduce((a, h) => a + m.strata[h].books_by_period[d], 0) };
  for (const v of V.slice(0, 6)) {
    period[d][v] = {
      k: asked.filter((u) => u.period === d && u.y === v).length,
      rate: point.period[d][v].rate, rate_ci: ci((o) => o.period[d][v].rate),
      book_rate: point.period[d][v].book_rate, book_rate_ci: ci((o) => o.period[d][v].book_rate),
    };
  }
}

// Controls (blind): recall = found the known prior as prior_exists; partial_only reported apart.
const controls = ctl.map((c) => ({ id: c.id, title: c.title, verdict: c.r?.verdict ?? 'missing', prior: (c.r?.prior || [])[0] || null }));
const recall = { n: controls.length, prior_exists: controls.filter((c) => c.verdict === 'prior_exists').length, partial_only: controls.filter((c) => c.verdict === 'partial_only').length };
recall.rate = recall.prior_exists / recall.n; recall.ci = wilson(recall.prior_exists, recall.n);

// Re-judge agreement.
let rejudge = null;
if (REJ) {
  const pairs = m.rejudge.map((id) => ({ id, a: units.find((u) => u.id === id)?.y ?? 'missing', b: parseOne(REJ, id)?.verdict ?? 'missing' }));
  const done = pairs.filter((p) => p.a !== 'missing' && p.b !== 'missing');
  const bin = (v) => (v === 'no_prior_known' ? 'first' : 'not_first');
  rejudge = { n: done.length, exact: done.filter((p) => p.a === p.b).length, binary: done.filter((p) => bin(p.a) === bin(p.b)).length, pairs };
  rejudge.exact_rate = rejudge.exact / Math.max(1, rejudge.n); rejudge.binary_rate = rejudge.binary / Math.max(1, rejudge.n);
  // Cohen's kappa on the binary first / not-first call.
  const n = done.length, a1 = done.filter((p) => bin(p.a) === 'first').length / n, b1 = done.filter((p) => bin(p.b) === 'first').length / n;
  const pe = a1 * b1 + (1 - a1) * (1 - b1);
  rejudge.kappa_binary = n ? (rejudge.binary_rate - pe) / (1 - pe) : null;
}

// Prior links.
const links = units.filter((u) => u.y === 'prior_exists').flatMap((u) => (u.r.prior || []).filter((p) => p.url).slice(0, 1).map((p) => ({ id: u.id, url: p.url })));
for (const l of links) l.status = status(l.url);

const examples = {};
for (const v of V) {
  // Round-robin across strata so the ten examples are not all Latin.
  const pools = STRATA.map((h) => units.filter((u) => u.y === v && u.stratum === h));
  const picked = [];
  for (let i = 0; picked.length < 10 && pools.some((pl) => pl.length > i); i++) for (const pl of pools) if (pl[i] && picked.length < 10) picked.push(pl[i]);
  examples[v] = picked.map((u) => ({
    id: u.id, url: `https://sourcelibrary.org/book/${u.id}`, stratum: u.stratum, period: u.period, title: u.title.slice(0, 90),
    work: u.r.identity?.work?.slice(0, 120) ?? '', prior: (u.r.prior || [])[0] ?? null, reasoning: (u.r.reasoning || '').slice(0, 300),
  }));
}

// Sensitivity (unweighted): the no-prior share among works identified from our scan vs from the catalogue
// alone, and among single identified works (no_prior / (no_prior + prior + partial)).
const sens = {};
for (const [k, f] of [['scan', (u) => /title_page/.test(u.r.identity?.source || '')], ['catalogue_only', (u) => !/title_page/.test(u.r.identity?.source || '')]]) {
  const us = asked.filter(f); const k1 = us.filter((u) => u.y === 'no_prior_known').length;
  sens[k] = { n: us.length, no_prior: k1, rate: k1 / Math.max(1, us.length), ci: wilson(k1, us.length) };
}
for (const h of STRATA) {
  const us = asked.filter((u) => u.stratum === h && ['no_prior_known', 'prior_exists', 'partial_only'].includes(u.y));
  const k1 = us.filter((u) => u.y === 'no_prior_known').length;
  sens[`single_identified:${h}`] = { n: us.length, no_prior: k1, rate: k1 / Math.max(1, us.length), ci: wilson(k1, us.length) };
}
const identitySource = {};
for (const u of units) { const s = u.r.identity?.source || 'unknown'; identitySource[s] = (identitySource[s] || 0) + 1; }
const out = {
  issue: 7651, scored: new Date().toISOString(), parsed: units.length, missing,
  cost_usd_api_equivalent: [...units, ...ctl.filter((c) => c.r)].reduce((a, u) => a + (u.r._cost || 0), 0),
  verdict_counts: Object.fromEntries(V.map((v) => [v, units.filter((u) => u.y === v).length])),
  identity_source: identitySource,
  frame: { works: W_ALL, books: B_ALL },
  strata, corpus, period, sensitivity: sens, controls, recall, rejudge,
  links_ok: links.filter((l) => /^2|^3/.test(l.status)).length, links_n: links.length, links,
  examples,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`parsed ${units.length}/${m.sample.length} (missing ${missing.length}); verdicts ${JSON.stringify(out.verdict_counts)}; cost $${out.cost_usd_api_equivalent.toFixed(2)}`);
for (const h of STRATA) { const r = strata[h]; console.log(h.padEnd(13), `n=${r.n}`, `np=${(r.no_prior_known.rate * 100).toFixed(1)}% [${r.no_prior_known.ci.map((x) => (x * 100).toFixed(0)).join('–')}]`, `works≈${Math.round(r.no_prior_known.works)}`, `books≈${Math.round(r.no_prior_known.books)}`); }
console.log('corpus no_prior works', Math.round(corpus.no_prior_known.works), corpus.no_prior_known.works_ci.map(Math.round), 'books', Math.round(corpus.no_prior_known.books), corpus.no_prior_known.books_ci.map(Math.round));
console.log('controls', JSON.stringify(recall), 'rejudge', rejudge && JSON.stringify({ n: rejudge.n, exact: rejudge.exact, binary: rejudge.binary, kappa: rejudge.kappa_binary }));
