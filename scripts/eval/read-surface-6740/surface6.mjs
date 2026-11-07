#!/usr/bin/env node
// #6740 read-surface, Amendment 6: the completed Box-Behnken fit. Per language and response (CER, quota cost a page,
// calls a page, wall seconds a page, filter cuts a page) the full quadratic by least squares on the 15 design runs, a
// 2,000-resample by-book bootstrap (paired: the same books for every run), the lack-of-fit F-test against the three
// centre replicates, the Bayesian surface as a cross-check, and the optimum by Amendment 6.6.
//
// PRIOR ART: fit.mjs (this directory: the Amendment 2–5 fit on the first 10 runs, calls a page as the cost, no lack of
//   fit; its imputation of unread targets and its paired δ are kept unchanged and re-implemented here because fit.mjs
//   is the record of that decision and stays as it ran); bayes.mjs (posterior and predict, used unchanged);
//   scripts/eval/agy-per-call-7503/tokens.mjs (a quota index from agy usage, 6× output, counts output + thinking twice:
//   agy's output already includes thinking, see Amendment 6.2).
//
//   node scripts/eval/read-surface-6740/surface6.mjs --work=DIR [--boot=2000] [--out=FILE] [--sensitivity]
// --sensitivity: D05, D06, D09, D10 (the low-thinking plane re-made on the default pool) replace B05, B06, B09, B10.
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { posterior, predict as bpredict } from './bayes.mjs';
import { usdOf } from './score.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work', '.'));
const B = Number(arg('boot', 2000));
const SENS = process.argv.includes('--sensitivity');
const CACHED_FULL = process.argv.includes('--cached-at-full');
// Amendment 6.8(b): --weights=FILE ({lang: {book_id: weight}}, frame.mjs) post-stratifies every run mean to the queue.
const WEIGHTS = arg('weights') ? JSON.parse(fs.readFileSync(arg('weights'), 'utf8')) : null;
const score = JSON.parse(fs.readFileSync(arg('score', path.join(WORK, 'score.json')), 'utf8'));
const MARGIN = 0.01, MIN_SAVING = 0.10;
export const LEVELS = { ppc: [1, 4, 8], edge: [1024, 1600, 2400], think: ['low', 'medium', 'high'] };
const BBD = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'C1', 'C2', 'C3'];
const SWAP = { B05: 'D05', B06: 'D06', B09: 'D09', B10: 'D10' };
export const RESPONSES = ['cer', 'usd', 'calls', 'secs', 'cuts'];

// ── least squares, the full quadratic ──
const terms = ([a, b, c]) => [1, a, b, c, a * b, a * c, b * c, a * a, b * b, c * c];
export const TERM_NAMES = ['1', 'x1', 'x2', 'x3', 'x1x2', 'x1x3', 'x2x3', 'x1²', 'x2²', 'x3²'];
function solve(A, y) {
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)), A.reduce((s, r, k) => s + r[i] * y[k], 0)]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const lsFit = (pts) => solve(pts.map((p) => terms(p.x)), pts.map((p) => p.y));
const lsPredict = (beta, x) => terms(x).reduce((s, t, i) => s + t * beta[i], 0);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs) => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1); };

// F distribution upper tail via the regularised incomplete beta (Numerical Recipes betacf).
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function lgamma(z) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b; }
export const fUpper = (F, d1, d2) => (F <= 0 ? 1 : ibeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * F)));

const grid = [];
for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) grid.push([a, b, c]);
const N = 17, axis = Array.from({ length: N }, (_, i) => -1 + (2 * i) / (N - 1));
const nameOf = (x) => `${LEVELS.ppc[x[0] + 1]} a call, ${LEVELS.edge[x[1] + 1]} px, ${LEVELS.think[x[2] + 1]}`;

const result = { fitted_at: new Date().toISOString(), amendment: 6, boot: B, sensitivity: SENS, weighted: !!WEIGHTS, cached_at_full: CACHED_FULL, margin_pp: 100 * MARGIN, min_saving: MIN_SAVING,
  cost_unit: 'US $ a 1,000 pages read, agy usage at gemini-3.8-flash list rates (input $0.75/M, cached input $0.075/M, output incl. thinking $3.75/M)',
  levels: LEVELS, term_names: TERM_NAMES, langs: {} };

for (const [lang, L] of Object.entries(score.langs)) {
  const ex = new Set(L.excluded.map((e) => e.slug));
  const all = L.runs.filter((r) => r.finished);
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const ids = BBD.map((id) => (SENS && SWAP[id] && byId[SWAP[id]] ? SWAP[id] : id));
  const missing = ids.filter((id) => !byId[id]);
  const books = [...new Set(all[0].targets.map((t) => t.book_id))].filter((b) => !all[0].targets.some((t) => t.book_id === b && ex.has(t.slug)));
  const slugOf = new Map(all[0].targets.map((t) => [t.book_id, t.slug]));
  const one = all.filter((r) => r.ppc === 1 && !r.id.startsWith('D'));
  const c1 = one.reduce((a, r) => a + r.calls, 0) / one.reduce((a, r) => a + r.pages_in_run, 0);
  // A run's mean cost for a call with recorded usage (prices its calls without usage).
  const usdOfRun = (r) => usdOf(r.tokens, { cachedAtFull: CACHED_FULL });
  const callUsd = (r) => usdOfRun(r) / Math.max(1, r.calls - (r.tokens.no_usage || 0));
  // Cost a page of the one-a-call runs at a thinking level (prices a page left unread by --no-alone).
  const u1 = Object.fromEntries(LEVELS.think.map((th) => {
    const rs = one.filter((r) => r.think === th);
    if (!rs.length) return [th, null];
    return [th, rs.reduce((a, r) => a + usdOfRun(r) + (r.tokens.no_usage || 0) * callUsd(r), 0) / rs.reduce((a, r) => a + r.pages_in_run, 0)];
  }));
  const u1Of = (th) => u1[th] ?? u1.low * (th === 'low' ? 1 : NaN);
  const secs1 = one.reduce((a, r) => a + r.secs, 0) / one.reduce((a, r) => a + r.pages_in_run, 0);
  const cerOf = (run, slug) => run.targets.find((t) => t.slug === slug);
  const solo = (run) => one.find((o) => o.edge === run.edge && o.think === run.think);
  const cell = {};
  for (const r of all) {
    cell[r.id] = {};
    const cu = callUsd(r);
    for (const b of books) {
      const slug = slugOf.get(b), t = cerOf(r, slug), bb = r.by_book[b] || { calls: 0, secs: 0, pages: r.ppc, unread: 0, tokens: { input: 0, output: 0, cache_read: 0, no_usage: 0 }, cuts: 0 };
      let cer = t?.status === 'read' ? t.cer : null, imputed = null;
      if (cer === null) {
        const s = solo(r), st = s && cerOf(s, slug);
        if (st?.status === 'read') { cer = st.cer; imputed = s.id; }
        else { const xs = one.filter((o) => !o.id.startsWith('D')).map((o) => cerOf(o, slug)).filter((x) => x?.status === 'read').map((x) => x.cer); cer = xs.length ? mean(xs) : 1; imputed = 'mean-1-a-call'; }
      }
      const usd = usdOf(bb.tokens, { cachedAtFull: CACHED_FULL }) + (bb.tokens.no_usage || 0) * cu + bb.unread * u1Of(r.think);
      cell[r.id][b] = { cer, imputed, wrong: !!t?.wrong_text, calls: bb.calls + c1 * bb.unread, usd, pages: bb.pages, secs: bb.secs + bb.unread * secs1, cuts: bb.cuts || 0 };
    }
  }
  const wOf = (b) => (WEIGHTS ? WEIGHTS[lang]?.[b] ?? 1 : 1);
  const agg = (rid, bs) => {
    const c = cell[rid]; const pages = bs.reduce((a, b) => a + wOf(b) * c[b].pages, 0), W = bs.reduce((a, b) => a + wOf(b), 0);
    const per = (k) => bs.reduce((a, b) => a + wOf(b) * c[b][k], 0) / pages;
    return { cer: bs.reduce((a, b) => a + wOf(b) * c[b].cer, 0) / W, usd: 1000 * per('usd'), calls: per('calls'), secs: per('secs'), cuts: per('cuts'), wrong: bs.filter((b) => c[b].wrong).length };
  };
  const lives = ['L1', 'L2'].filter((id) => byId[id]);
  const poolOf = (rid) => byId[rid]?.agy_home ?? null;
  const live = Object.fromEntries(lives.map((id) => [id, { pool: poolOf(id), ...agg(id, books) }]));
  const liveCer = mean(lives.map((id) => live[id].cer));
  const liveWrong = mean(lives.map((id) => live[id].wrong));
  // Same-pool live (Amendment 5): a setting judged against the live run made on the pool its plane ran on.
  const livePoolFor = (rid) => lives.find((l) => poolOf(l) === poolOf(rid)) ?? 'L2';
  const planePool = (x3) => { const rs = ids.filter((id) => byId[id] && byId[id].x3 === x3); const pools = [...new Set(rs.map(poolOf))]; return pools.length === 1 ? pools[0] : 'mixed'; };
  const liveForX = (x) => lives.find((l) => poolOf(l) === planePool(x[2])) ?? 'L2';

  // ── bootstrap: every run's aggregate on each by-book resample ──
  const rng = makeRng(6740);
  const boots = [];
  for (let i = 0; i < B; i++) { const bs = books.map(() => books[Math.floor(rng() * books.length)]); boots.push(Object.fromEntries(all.map((r) => [r.id, agg(r.id, bs)]))); }
  const point = Object.fromEntries(all.map((r) => [r.id, agg(r.id, books)]));
  const design = ids.filter((id) => byId[id]).map((id) => ({ id, x: [byId[id].x1, byId[id].x2, byId[id].x3] }));
  const complete = !missing.length;

  const fits = {};
  for (const k of RESPONSES) {
    if (design.length < 10) break;
    const fitOn = (R) => lsFit(design.map((d) => ({ x: d.x, y: R[d.id][k] })));
    const beta = fitOn(point);
    const bootBeta = boots.map(fitOn);
    // Lack of fit: residuals of the 15 run means; pure error from the centre replicates (df 2), lack of fit df 3.
    const resid = design.map((d) => point[d.id][k] - lsPredict(beta, d.x));
    const ssRes = resid.reduce((a, r) => a + r * r, 0);
    const centres = design.filter((d) => d.id.startsWith('C')).map((d) => point[d.id][k]);
    const ssPE = centres.length >= 2 ? centres.reduce((a, y) => a + (y - mean(centres)) ** 2, 0) : null;
    const dfPE = centres.length - 1, dfLOF = design.length - 10 - dfPE;
    const lof = ssPE !== null && dfLOF > 0 ? (() => { const ssLOF = Math.max(0, ssRes - ssPE); const F = ssPE > 0 ? (ssLOF / dfLOF) / (ssPE / dfPE) : Infinity; return { ss_res: ssRes, ss_pe: ssPE, ss_lof: ssLOF, df_lof: dfLOF, df_pe: dfPE, F, p: Number.isFinite(F) ? fUpper(F, dfLOF, dfPE) : 0 }; })() : null;
    const ssTot = design.reduce((a, d) => a + (point[d.id][k] - mean(design.map((e) => point[e.id][k]))) ** 2, 0);
    const coefCi = TERM_NAMES.map((n, i) => ({ term: n, b: beta[i], lo: q(bootBeta.map((bb) => bb[i]), 0.025), hi: q(bootBeta.map((bb) => bb[i]), 0.975) }));
    fits[k] = { beta, coef: coefCi, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, lof, resid: Object.fromEntries(design.map((d, i) => [d.id, resid[i]])), bootBeta };
  }

  // ── grid predictions with bootstrap intervals ──
  const liveMeanB = (R) => mean(lives.map((id) => R[id].cer));
  const settings = grid.map((x) => {
    const run = design.find((d) => d.x.join() === x.join() && !d.id.startsWith('C'))?.id ?? (x.join() === '0,0,0' ? 'C1–C3' : null);
    const s = { x, name: nameOf(x), ppc: LEVELS.ppc[x[0] + 1], edge: LEVELS.edge[x[1] + 1], think: LEVELS.think[x[2] + 1], run };
    if (!fits.cer) return s;
    const dB = fits.cer.bootBeta.map((bb, i) => lsPredict(bb, x) - liveMeanB(boots[i]));
    s.cer = lsPredict(fits.cer.beta, x); s.delta = s.cer - liveCer; s.delta_lo = q(dB, 0.025); s.delta_hi = q(dB, 0.975);
    for (const k of ['usd', 'calls', 'secs', 'cuts']) { const pb = fits[k].bootBeta.map((bb) => lsPredict(bb, x)); s[k] = lsPredict(fits[k].beta, x); s[`${k}_lo`] = q(pb, 0.025); s[`${k}_hi`] = q(pb, 0.975); }
    const lv = liveForX(x);
    s.live_ref = lv; s.live_usd = live[lv]?.usd; s.saving = 1 - s.usd / s.live_usd;
    const sb = fits.usd.bootBeta.map((bb, i) => 1 - lsPredict(bb, x) / boots[i][lv].usd);
    s.saving_lo = q(sb, 0.025); s.saving_hi = q(sb, 0.975);
    const rids = run === 'C1–C3' ? ['C1', 'C2', 'C3'].filter((id) => byId[id]) : run ? [run] : [];
    if (rids.length) {
      const m = (R) => mean(rids.map((id) => R[id].cer));
      const d = boots.map((R) => m(R) - liveMeanB(R));
      s.measured = { runs: rids, delta: m(point) - liveCer, delta_lo: q(d, 0.025), delta_hi: q(d, 0.975), usd: mean(rids.map((id) => point[id].usd)), calls: mean(rids.map((id) => point[id].calls)), wrong: Math.max(...rids.map((id) => point[id].wrong)), pool: poolOf(rids[0]) };
    }
    s.non_inferior = s.delta_hi <= MARGIN && (!s.measured || s.measured.delta_hi <= MARGIN) && (!s.measured || s.measured.wrong <= liveWrong + 1);
    return s;
  });

  // ── the Bayesian cross-check: the same 15 runs as points with their bootstrap variances, vague priors ──
  let bayes = null;
  if (fits.cer) {
    const vOf = (id, k) => variance(boots.map((R) => R[id][k]));
    const dVar = (id) => variance(boots.map((R) => R[id].cer - liveMeanB(R)));
    const pts = (k) => design.map((d) => (k === 'cer' ? { x: d.x, y: point[d.id].cer - liveCer, v: Math.max(1e-6, dVar(d.id)) } : { x: d.x, y: point[d.id][k], v: Math.max(1e-6, vOf(d.id, k)) }));
    const post = { cer: posterior(pts('cer'), { tau: 0.05, m0: 0 }), usd: posterior(pts('usd'), { tau: 50, m0: mean(lives.map((id) => live[id].usd)) }) };
    bayes = { settings: grid.map((x) => { const c = bpredict(post.cer, x), u = bpredict(post.usd, x); return { x, delta: c.mean, delta_lo: c.mean - 1.96 * c.sd, delta_hi: c.mean + 1.96 * c.sd, usd: u.mean, usd_lo: u.mean - 1.96 * u.sd, usd_hi: u.mean + 1.96 * u.sd }; }) };
    bayes.disagree = settings.map((s, i) => {
      const b = bayes.settings[i]; const why = [];
      const bNI = b.delta_hi <= MARGIN;
      if (bNI !== (s.delta_hi <= MARGIN)) why.push(`non-inferiority: least squares ${s.delta_hi <= MARGIN ? 'yes' : 'no'} (upper ${(100 * s.delta_hi).toFixed(2)} pp), Bayes ${bNI ? 'yes' : 'no'} (upper ${(100 * b.delta_hi).toFixed(2)} pp)`);
      if (b.usd < s.usd_lo || b.usd > s.usd_hi) why.push(`cost: Bayes $${b.usd.toFixed(2)} outside the least-squares interval [$${s.usd_lo.toFixed(2)}, $${s.usd_hi.toFixed(2)}]`);
      return why.length ? { x: s.x, name: s.name, why } : null;
    }).filter(Boolean);
    bayes.slices = [-1, 0, 1].map((c) => ({ x3: c, delta: axis.map((bb) => axis.map((a) => bpredict(post.cer, [a, bb, c]).mean)), usd: axis.map((bb) => axis.map((a) => bpredict(post.usd, [a, bb, c]).mean)) }));
  }

  // ── the optimum (Amendment 6.6) ──
  const ni = settings.filter((s) => s.non_inferior).sort((a, b) => a.usd - b.usd);
  const best = ni[0] || null;
  const optimum = !fits.cer ? { verdict: `design incomplete: ${missing.join(', ')} not made` }
    : !best ? { verdict: 'no setting is non-inferior to live: live stays' }
    : best.saving < MIN_SAVING ? { verdict: `the cheapest non-inferior setting saves ${(100 * best.saving).toFixed(0)} % of live's quota cost (under ${100 * MIN_SAVING} %): live stays`, setting: best }
    : { verdict: 'optimum found: confirm on queue pages', setting: best };
  const sliceOf = (k) => [-1, 0, 1].map((c) => ({ x3: c, think: LEVELS.think[c + 1], z: axis.map((bb) => axis.map((a) => lsPredict(fits[k].beta, [a, bb, c]))) }));
  // The non-inferiority upper bound on the slice grid (for the feasible region), from the bootstrap.
  const niSlice = fits.cer ? [-1, 0, 1].map((c) => ({ x3: c, hi: axis.map((bb) => axis.map((a) => q(fits.cer.bootBeta.map((beta, i) => lsPredict(beta, [a, bb, c]) - liveMeanB(boots[i])), 0.975))) })) : null;
  // Noise floor: the centre replicates and the live pair, paired by book.
  const pair = (a, b) => (point[a] && point[b] ? (() => { const d = boots.map((R) => R[a].cer - R[b].cer); return { a, b, delta: point[a].cer - point[b].cer, lo: q(d, 0.025), hi: q(d, 0.975) }; })() : null);
  const cIds = ['C1', 'C2', 'C3'].filter((id) => point[id]);
  const noise = { centre: cIds.map((id) => ({ id, cer: point[id].cer, usd: point[id].usd, calls: point[id].calls })), centre_range_pp: cIds.length > 1 ? 100 * (Math.max(...cIds.map((id) => point[id].cer)) - Math.min(...cIds.map((id) => point[id].cer))) : null,
    pairs: [['C1', 'C2'], ['C1', 'C3'], ['C2', 'C3'], ['L1', 'L2']].map(([a, b]) => pair(a, b)).filter(Boolean),
    centre_usd_range: cIds.length > 1 ? Math.max(...cIds.map((id) => point[id].usd)) - Math.min(...cIds.map((id) => point[id].usd)) : null };
  noise.band_pp = Math.max(...noise.pairs.filter((p) => p.a.startsWith('C')).map((p) => 100 * Math.max(Math.abs(p.lo), Math.abs(p.hi))), 0) || null;
  // Every run as a point (cost against accuracy, with by-book intervals).
  const runsOut = all.map((r) => {
    const R = point[r.id], d = boots.map((X) => X[r.id].cer - liveMeanB(X)), u = boots.map((X) => X[r.id].usd);
    return { id: r.id, x: [r.x1, r.x2, r.x3], ppc: r.ppc, edge: r.edge, think: r.think, pool: poolOf(r.id), live: r.live, ...R,
      delta: R.cer - liveCer, delta_lo: q(d, 0.025), delta_hi: q(d, 0.975), usd_lo: q(u, 0.025), usd_hi: q(u, 0.975),
      tokens_per_page: Object.fromEntries(['input', 'cache_read', 'output', 'thinking'].map((k) => [k, r.tokens[k] / r.pages_in_run])), no_usage: r.tokens.no_usage || 0,
      imputed: books.filter((b) => cell[r.id][b].imputed).length, unread: r.pages_unread, pages_in_run: r.pages_in_run, calls_made: r.calls, in_fit: ids.includes(r.id) };
  });
  // Pareto front over the runs (lower cost and lower CER both better).
  const front = runsOut.filter((a) => !runsOut.some((b) => b !== a && b.usd <= a.usd && b.cer <= a.cer && (b.usd < a.usd || b.cer < a.cer))).map((r) => r.id);
  result.langs[lang] = {
    books: books.length, excluded: L.excluded.map((e) => e.slug), complete, missing, design_ids: ids, c1, u1, axis,
    live: { cer: liveCer, wrong: liveWrong, runs: live }, runs: runsOut, pareto: front,
    fits: Object.fromEntries(Object.entries(fits).map(([k, f]) => [k, { coef: f.coef, r2: f.r2, lof: f.lof, resid: f.resid }])),
    settings, optimum, bayes, noise,
    slices: fits.cer ? Object.fromEntries(['cer', 'usd', 'calls', 'secs'].map((k) => [k, sliceOf(k)])) : null, ni_slice: niSlice,
  };
}

const OUT = arg('out', path.join(WORK, `surface6${SENS ? '-sensitivity' : ''}${WEIGHTS ? '-weighted' : ''}.json`));
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
const pp = (x) => (100 * x).toFixed(2);
for (const [lang, R] of Object.entries(result.langs)) {
  console.log(`\n${lang}: ${R.books} books; design ${R.complete ? 'complete' : `INCOMPLETE (${R.missing.join(',')})`}; live CER ${pp(R.live.cer)} %; cost a page of one-a-call runs: ${Object.entries(R.u1).map(([k, v]) => `${k} $${v === null ? '-' : (1000 * v).toFixed(2)}`).join(', ')} a 1k`);
  for (const r of R.runs) console.log(`  ${r.id.padEnd(4)} ${String(r.pool).padEnd(16)} ${r.ppc} ${String(r.edge ?? 'srv').padEnd(4)} ${r.think.padEnd(6)} CER ${pp(r.cer)} δ ${pp(r.delta)} [${pp(r.delta_lo)}, ${pp(r.delta_hi)}]  $/1k ${r.usd.toFixed(2)} [${r.usd_lo.toFixed(2)}, ${r.usd_hi.toFixed(2)}]  calls ${r.calls.toFixed(3)}  s ${r.secs.toFixed(1)}  cuts ${r.cuts.toFixed(3)}  out/p ${Math.round(r.tokens_per_page.output)} th/p ${Math.round(r.tokens_per_page.thinking)}${r.no_usage ? ` nousage ${r.no_usage}` : ''}`);
  for (const [k, f] of Object.entries(R.fits)) console.log(`  fit ${k}: R² ${f.r2?.toFixed(3)}  LOF ${f.lof ? `F(${f.lof.df_lof},${f.lof.df_pe}) = ${f.lof.F.toFixed(2)}, p ${f.lof.p.toFixed(3)}` : '-'}`);
  for (const s of R.settings.filter((x) => x.usd !== undefined).sort((a, b) => a.usd - b.usd).slice(0, 10)) console.log(`   ${s.name.padEnd(28)} ${s.run ?? '-'} δ ${pp(s.delta)} [${pp(s.delta_lo)}, ${pp(s.delta_hi)}] $/1k ${s.usd.toFixed(2)} [${s.usd_lo.toFixed(2)}, ${s.usd_hi.toFixed(2)}] saving ${(100 * s.saving).toFixed(0)} % vs ${s.live_ref}${s.non_inferior ? ' NI' : ''}`);
  console.log('  optimum:', R.optimum.verdict, R.optimum.setting ? R.optimum.setting.name : '');
  if (R.bayes) console.log(`  Bayes disagrees at ${R.bayes.disagree.length}: ${R.bayes.disagree.map((d) => `${d.name} (${d.why.join('; ')})`).join(' | ')}`);
}
