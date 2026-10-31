#!/usr/bin/env node
// #6740 read-surface: fit the preregistered quadratic response surfaces (CER, agy calls a page, wall seconds a page) per
// language, with a by-book bootstrap, find the optimum by the preregistered rule, and write the data the admin page draws.
//
// PRIOR ART: scripts/eval/lib/paired-stats.mjs (paired bootstrap and makeRng, used here) and lib/pareto-stats.mjs
//   (cost-vs-accuracy frontier of whole routes, no factors); scripts/eval/estimator/fit_prior.py (a hierarchical prior
//   over route cells, not a response surface). Nothing in the repo fits a factorial design.
//
//   node scripts/eval/read-surface-6740/fit.mjs --work=DIR [--boot=2000] [--out=FILE] [--data=src/data/…json]
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { posterior, predict as bpredict, estimateA0, rankNext } from './bayes.mjs';
import { DESIGN as DESIGN_RUNS } from './run.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work', '.'));
const B = Number(arg('boot', 2000));
const score = JSON.parse(fs.readFileSync(path.join(WORK, 'score.json'), 'utf8'));
const MARGIN = 0.01;            // 1.0 pp CER, preregistered (eval-design §10.2 card 1)
const MIN_SAVING = 0.10;        // under 10 % fewer calls than live: nothing switches
const LEVELS = { ppc: [1, 4, 8], edge: [1024, 1600, 2400], think: ['low', 'medium', 'high'] };

// ── least squares for the full quadratic in three coded factors ──
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
const fit = (pts) => solve(pts.map((p) => terms(p.x)), pts.map((p) => p.y));
const predict = (beta, x) => terms(x).reduce((s, t, i) => s + t * beta[i], 0);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const result = { fitted_at: new Date().toISOString(), boot: B, margin_pp: 100 * MARGIN, min_saving: MIN_SAVING, levels: LEVELS, term_names: TERM_NAMES, langs: {} };
for (const [lang, L] of Object.entries(score.langs)) {
  const ex = new Set(L.excluded.map((e) => e.slug));
  const runs = L.runs.filter((r) => r.finished);
  const books = [...new Set(runs[0]?.targets.map((t) => t.book_id) || [])].filter((b) => !runs[0].targets.some((t) => t.book_id === b && ex.has(t.slug)));
  const one = runs.filter((r) => r.ppc === 1);
  // c1: the language's measured calls a page over its 1-a-call runs (prices a page left unread by --no-alone).
  const c1 = one.length ? one.reduce((a, r) => a + r.calls, 0) / one.reduce((a, r) => a + r.pages_in_run, 0) : 1;
  // Per run, per book: the target's CER (imputed for an unread target, as preregistered) and its calls / seconds / pages.
  const perPage = new Map();   // book_id -> slug
  for (const t of runs[0]?.targets || []) perPage.set(t.book_id, t.slug);
  const cerOf = (run, slug) => run.targets.find((t) => t.slug === slug);
  const solo = (run) => one.find((o) => o.edge === run.edge && o.think === run.think);
  const cell = {};   // run id -> book -> {cer, imputed, wrong, calls, pages, secs}
  for (const r of runs) {
    cell[r.id] = {};
    for (const b of books) {
      const slug = perPage.get(b), t = cerOf(r, slug), bb = r.by_book[b] || { calls: 0, secs: 0, pages: r.ppc, unread: 0 };
      let cer = t?.status === 'read' ? t.cer : null, imputed = null;
      if (cer === null) {
        const s = solo(r);
        const st = s && cerOf(s, slug);
        if (st?.status === 'read') { cer = st.cer; imputed = s.id; }
        else { const xs = one.map((o) => cerOf(o, slug)).filter((x) => x?.status === 'read').map((x) => x.cer); cer = xs.length ? mean(xs) : 1; imputed = 'mean-1-a-call'; }
      }
      cell[r.id][b] = { cer, imputed, wrong: !!t?.wrong_text, calls: bb.calls + c1 * bb.unread, pages: bb.pages, secs: bb.secs + (bb.unread ? bb.unread * (one.length ? one.reduce((a, o) => a + o.secs, 0) / one.reduce((a, o) => a + o.pages_in_run, 0) : 30) : 0), thinking: bb.thinking || 0 };
    }
  }
  const agg = (rid, bs) => {
    const c = cell[rid];
    const cer = mean(bs.map((b) => c[b].cer));
    const pages = bs.reduce((a, b) => a + c[b].pages, 0);
    return { cer, calls: bs.reduce((a, b) => a + c[b].calls, 0) / pages, secs: bs.reduce((a, b) => a + c[b].secs, 0) / pages, wrong: bs.filter((b) => c[b].wrong).length };
  };
  const design = runs.filter((r) => !r.live);
  const lives = runs.filter((r) => r.live);
  const grid = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) grid.push([a, b, c]);
  const surfaces = (bs) => {
    const pts = design.map((r) => ({ x: [r.x1, r.x2, r.x3], ...agg(r.id, bs) }));
    return { cer: fit(pts.map((p) => ({ x: p.x, y: p.cer }))), calls: fit(pts.map((p) => ({ x: p.x, y: p.calls }))), secs: fit(pts.map((p) => ({ x: p.x, y: p.secs }))), live: lives.length ? mean(lives.map((r) => agg(r.id, bs).cer)) : null };
  };
  const liveAgg = lives.length ? lives.map((r) => ({ id: r.id, ...agg(r.id, books) })) : [];
  const liveCalls = liveAgg.length ? mean(liveAgg.map((r) => r.calls)) : null;
  const liveCer = liveAgg.length ? mean(liveAgg.map((r) => r.cer)) : null;
  const liveWrong = liveAgg.length ? mean(liveAgg.map((r) => r.wrong)) : 0;
  // By-book bootstrap: the variance of every run's means (the Bayesian fit's noise), the noise floor, the LS fit.
  const rng = makeRng(6740);
  const boots = [];
  for (let i = 0; i < B; i++) { const bs = books.map(() => books[Math.floor(rng() * books.length)]); boots.push({ bs, runs: Object.fromEntries(runs.map((r) => [r.id, agg(r.id, bs)])) }); }
  const variance = (xs) => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1); };
  const varOf = (rid, key) => variance(boots.map((b) => b.runs[rid][key]));
  const liveVar = (key) => (lives.length ? variance(boots.map((b) => mean(lives.map((r) => b.runs[r.id][key])))) : 0);
  // ── the Bayesian surface (Amendment 2): design runs + power-prior points ──
  const VFLOOR = { cer: 1e-6, calls: 1e-4 };
  // CER enters as the PAIRED difference from live (every run reads the same books; eval-design §7): its by-book
  // bootstrap variance is the paired one, far below a run mean's own. Calls enter as run means.
  const liveMeanOf = (R, key) => mean(lives.map((r) => R[r.id][key]));
  const dVar = (rid) => variance(boots.map((b) => b.runs[rid].cer - liveMeanOf(b.runs, 'cer')));
  const designPts = (key) => design.map((r) => key === 'cer'
    ? { x: [r.x1, r.x2, r.x3], y: agg(r.id, books).cer - liveCer, v: Math.max(VFLOOR.cer, dVar(r.id)) }
    : { x: [r.x1, r.x2, r.x3], y: agg(r.id, books)[key], v: Math.max(VFLOOR[key], varOf(r.id, key)) });
  const medianV = (key) => { const vs = designPts(key).map((p) => p.v).sort((a, b) => a - b); return vs.length ? vs[vs.length >> 1] : VFLOOR[key]; };
  // Prior points. CER: earlier plain reads at (1 a call, served, low), one point per prompt version (prior-score.mjs);
  // a singleton's variance is the design's between-book variance of a run mean scaled to its books. Calls: #7701's
  // measured read@4 / read@8 on queue pages; variance: the live runs' bootstrap variance scaled to 30 books.
  const pp = fs.existsSync(path.join(WORK, 'prior', 'points.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'prior', 'points.json'), 'utf8')).points.filter((p) => p.lang === lang) : [];
  const bookVar = (key) => medianV(key) * books.length;   // the variance of one book's value
  // A prior CER point is unpaired with live: its difference carries both variances.
  const priorCer = pp.map((p) => ({ x: [-1, 1, -1], y: p.cer - (liveCer ?? 0), v: (p.v ?? bookVar('cer') / p.books) + (lives.length ? liveVar('cer') : 0), cer: p.cer, label: `${p.prompt} (${p.books} books)` }));
  const routes = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'routes-7701.json'), 'utf8')).routes.filter((r) => r.lang === lang && /^read@[48]\b/.test(r.route) && !/correct/.test(r.route));
  const priorCalls = routes.map((r) => ({ x: [r.route.startsWith('read@8') ? 1 : 0, 1, -1], y: r.calls, v: Math.max(VFLOOR.calls, (lives.length ? liveVar('calls') : medianV('calls')) * books.length / r.n), label: `${r.route} (#7701, ${r.n} pages)` }));
  // a0 by empirical Bayes where an earlier and a new result share a setting.
  const pool = (pts) => { if (!pts.length) return null; const w = pts.map((p) => 1 / p.v); const W = w.reduce((a, b) => a + b, 0); return { y: pts.reduce((a, p, i) => a + w[i] * p.y, 0) / W, v: 1 / W }; };
  const b05 = design.find((r) => r.id === 'B05');
  const pc = pool(priorCer.map((p) => ({ ...p, y: p.cer }))), pr4 = pool(priorCalls.filter((p) => p.x[0] === 0));
  const a0 = {
    cer: pc && b05 ? { ...estimateA0([{ y0: pc.y, v0: pc.v, y1: agg('B05', books).cer, v1: varOf('B05', 'cer') }]), against: 'B05 (1 a call, 1,600 px, low): no earlier read at the centre or live setting' } : { a0: null, why: 'no prior CER point or no B05' },
    calls: pr4 && lives.length ? { ...estimateA0([{ y0: pr4.y, v0: pr4.v, y1: liveCalls, v1: liveVar('calls') }]), against: 'the live runs (4 a call, served, low)' } : { a0: null, why: 'no earlier read@4 or no live run' },
  };
  const scaled = (pts, a) => (a ? pts.map((p) => ({ ...p, v: p.v / a })) : []);
  const TAU = { cer: 0.05, calls: 1 };
  const M0 = { cer: 0, calls: liveCalls ?? 0.5 };   // CER is a difference from live: centred on no difference
  const PRIOR = { cer: scaled(priorCer, a0.cer.a0), calls: scaled(priorCalls, a0.calls.a0) };
  const postOf = (key, withDesign) => posterior([...PRIOR[key], ...(withDesign ? designPts(key) : [])], { tau: TAU[key], m0: M0[key] });
  const post = { cer: postOf('cer', true), calls: postOf('calls', true) };
  const priorOnly = { cer: postOf('cer', false), calls: postOf('calls', false) };
  const settings = grid.map((x) => {
    const c = bpredict(post.cer, x), k = bpredict(post.calls, x), sd = c.sd;
    const pc0 = bpredict(priorOnly.cer, x), pk0 = bpredict(priorOnly.calls, x);
    return { x, ppc: LEVELS.ppc[x[0] + 1], edge: LEVELS.edge[x[1] + 1], think: LEVELS.think[x[2] + 1],
      cer: liveCer + c.mean, cer_sd: c.sd, delta: c.mean, delta_lo: c.mean - 1.96 * sd, delta_hi: c.mean + 1.96 * sd,
      calls: k.mean, calls_lo: k.mean - 1.96 * k.sd, calls_hi: k.mean + 1.96 * k.sd, secs: null,
      prior_cer: liveCer + pc0.mean, prior_cer_sd: pc0.sd, prior_calls: pk0.mean, prior_calls_sd: pk0.sd,
      run: design.find((r) => r.x1 === x[0] && r.x2 === x[1] && r.x3 === x[2])?.id ?? null };
  });
  for (const s of settings) {
    const ran = s.run && agg(s.run, books);
    s.wrong = ran ? ran.wrong : null;
    if (ran) {
      s.secs = ran.secs;
      // A setting that was run is also judged on its own paired difference from live (by-book bootstrap): the
      // quadratic can smooth over a run it does not fit, and the run is the direct evidence. Both must pass.
      const d = boots.map((b) => b.runs[s.run].cer - liveMeanOf(b.runs, 'cer'));
      s.measured = { delta: ran.cer - liveCer, delta_lo: q(d, 0.025), delta_hi: q(d, 0.975), calls: ran.calls };
    }
    s.non_inferior = liveCer !== null && s.delta_hi <= MARGIN && (!s.measured || s.measured.delta_hi <= MARGIN) && (s.wrong === null || s.wrong <= liveWrong + 1);
  }
  const nonInf = settings.filter((s) => s.non_inferior).sort((a, b) => (Math.abs(a.calls - b.calls) > 0.02 ? a.calls - b.calls : (a.secs ?? 1e9) - (b.secs ?? 1e9)) || (Math.abs(a.x[0]) + Math.abs(a.x[1] - 1) + Math.abs(a.x[2] + 1)) - (Math.abs(b.x[0]) + Math.abs(b.x[1] - 1) + Math.abs(b.x[2] + 1)));
  // The pool check (preregistered: "L1 vs L2 is also the pool-vs-pool check"): live calls a page differ by agy account
  // (filter cuts), so a run setting's saving is judged against the live run made on the SAME pool.
  const poolOf = (rid) => { try { return JSON.parse(fs.readFileSync(path.join(WORK, 'runs', lang, rid, 'run.json'), 'utf8')).agy_home; } catch { return null; } };
  for (const s of settings) if (s.run) {
    const pl = poolOf(s.run), same = liveAgg.filter((l) => poolOf(l.id) === pl);
    s.pool = pl; s.live_same_pool = same.length ? { runs: same.map((l) => l.id), calls: mean(same.map((l) => l.calls)) } : null;
  }
  const savingOf = (st) => (st.measured && st.live_same_pool ? 1 - st.measured.calls / st.live_same_pool.calls : liveCalls ? 1 - st.calls / liveCalls : null);
  nonInf.sort((a, b) => (savingOf(b) ?? -9) - (savingOf(a) ?? -9));
  const best = nonInf[0] || null;
  const saving = best ? savingOf(best) : null;
  const optimum = !best ? { verdict: 'no setting is shown non-inferior to live: nothing switches' }
    : saving < MIN_SAVING ? { verdict: `no setting that is non-inferior to live is at least ${100 * MIN_SAVING} % cheaper (the cheapest saves ${(100 * saving).toFixed(0)} %): nothing switches`, setting: saving > 0 ? best : undefined, saving }
    : { verdict: 'optimum found: confirm on queue pages', setting: best, saving };
  // Sequential design: is every cheap-end setting that would save ≥ 10 % decided? which runs next?
  const cheap = settings.filter((s) => s.x[0] >= 0);
  const open = cheap.filter((s) => liveCalls !== null && s.calls <= 0.9 * liveCalls && !(s.delta_hi <= MARGIN || s.delta_lo > MARGIN));
  const doneIds = new Set(runs.map((r) => r.id));
  // Amendment 3: any grid setting not yet run is a candidate (named by its design id where it has one).
  const ranX = new Set(design.map((r) => [r.x1, r.x2, r.x3].join()));
  const remaining = grid.filter((x) => !ranX.has(x.join())).map((x) => ({ id: DESIGN_RUNS.find((d) => [d.x1, d.x2, d.x3].join() === x.join() && !d.id.startsWith('C'))?.id ?? `(${LEVELS.ppc[x[0] + 1]}, ${LEVELS.edge[x[1] + 1]}, ${LEVELS.think[x[2] + 1]})`, x }));
  const next = rankNext(post.cer, remaining, cheap.map((s) => s.x), null, mean(design.map((r) => Math.max(VFLOOR.cer, dVar(r.id))))).map((r) => ({ id: r.id, x: r.x, gain_pp2: 1e4 * r.gain }));
  // Noise floor: the A-vs-A spread of the centre runs and of the two live runs, paired bootstrap by book.
  const pair = (a, b) => { if (!cell[a] || !cell[b]) return null; const d = boots.map(({ runs: R }) => R[a].cer - R[b].cer); return { a, b, delta: agg(a, books).cer - agg(b, books).cer, lo: q(d, 0.025), hi: q(d, 0.975) }; };
  const centres = design.filter((r) => r.id.startsWith('C')).map((r) => r.id);
  const centreCers = centres.map((c) => agg(c, books).cer);
  const noise = {
    centre_runs: centres.map((c, i) => ({ id: c, cer: centreCers[i] })),
    centre_range: centreCers.length ? Math.max(...centreCers) - Math.min(...centreCers) : null,
    centre_pairs: [['C1', 'C2'], ['C1', 'C3'], ['C2', 'C3']].map(([a, b]) => pair(a, b)).filter(Boolean),
    live_pair: pair('L1', 'L2'),
  };
  // Amendment 3: with fewer than two clean centre runs, the A-vs-A pair is the two live runs (L1 James, L2 default pool).
  noise.from = noise.centre_pairs.length ? 'centre runs' : 'live runs L1 vs L2';
  noise.band = noise.centre_pairs.length ? Math.max(noise.centre_range ?? 0, ...noise.centre_pairs.map((p) => Math.max(Math.abs(p.lo), Math.abs(p.hi))))
    : noise.live_pair ? Math.max(Math.abs(noise.live_pair.lo), Math.abs(noise.live_pair.hi)) : null;
  // The preregistered least-squares fit with its bootstrap, beside the posterior, where 10 or more runs exist.
  let ls = null;
  if (design.length >= 10) {
    const lsFit = (R) => { const pts = design.map((r) => ({ x: [r.x1, r.x2, r.x3], ...R[r.id] })); return { cer: fit(pts.map((p) => ({ x: p.x, y: p.cer }))), calls: fit(pts.map((p) => ({ x: p.x, y: p.calls }))), live: lives.length ? mean(lives.map((r) => R[r.id].cer)) : null }; };
    const P0 = lsFit(Object.fromEntries(runs.map((r) => [r.id, agg(r.id, books)])));
    const LB = boots.map((b) => lsFit(b.runs));
    ls = { coef: P0, settings: grid.map((x) => { const d = LB.map((s) => predict(s.cer, x) - s.live); return { x, cer: predict(P0.cer, x), delta: predict(P0.cer, x) - P0.live, delta_lo: q(d, 0.025), delta_hi: q(d, 0.975), calls: predict(P0.calls, x) }; }) };
  }
  // Slices for the contour plots: x1 (pages a call) × x2 (long edge) at each thinking level, 25 × 25 coded points.
  const N = 17, axis = Array.from({ length: N }, (_, i) => -1 + (2 * i) / (N - 1));
  const sliceOf = (P) => [-1, 0, 1].map((c) => ({ x3: c, think: LEVELS.think[c + 1],
    cer: axis.map((b) => axis.map((a) => liveCer + bpredict(P.cer, [a, b, c]).mean)), calls: axis.map((b) => axis.map((a) => bpredict(P.calls, [a, b, c]).mean)),
    cer_sd: axis.map((b) => axis.map((a) => bpredict(P.cer, [a, b, c]).sd)) }));
  result.langs[lang] = {
    books: books.length, excluded: L.excluded, faces: L.faces, c1, axis,
    runs: runs.map((r) => ({ id: r.id, x: [r.x1, r.x2, r.x3], ppc: r.ppc, edge: r.edge, think: r.think, live: r.live, phase: r.phase, ...agg(r.id, books), cer_sd: Math.sqrt(varOf(r.id, 'cer')),
      imputed: books.filter((b) => cell[r.id][b].imputed).length, unread: r.pages_unread, calls_made: r.calls, pages_in_run: r.pages_in_run, tokens: r.tokens })),
    prior: { cer: priorCer, calls: priorCalls, a0, tau: TAU },
    coef: { cer: post.cer.mean, calls: post.calls.mean },
    live: { cer: liveCer, calls: liveCalls, wrong: liveWrong, runs: liveAgg },
    settings, optimum, noise, ls,
    sequential: { open: open.map((s) => ({ x: s.x, delta: s.delta, delta_lo: s.delta_lo, delta_hi: s.delta_hi, calls: s.calls })), decided: open.length === 0 && liveCalls !== null, next, remaining: remaining.map((r) => r.id) },
    slices: sliceOf(post), prior_slices: sliceOf(priorOnly),
  };
}
const OUT = arg('out', path.join(WORK, 'surface.json'));
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const [lang, R] of Object.entries(result.langs)) {
  console.log(`\n${lang}: ${R.books} books; c1 ${R.c1.toFixed(2)}; live CER ${R.live.cer === null ? '-' : (100 * R.live.cer).toFixed(2) + '%'} calls ${R.live.calls?.toFixed(3) ?? '-'}; noise band ${(100 * R.noise.band).toFixed(2)} pp; a0 cer ${R.prior.a0.cer.a0} calls ${R.prior.a0.calls.a0}`);
  for (const r of R.runs) console.log(`  ${r.id.padEnd(4)} [${R.settings.find((x) => x.run === r.id)?.pool ?? (r.live ? 'live' : '')}] ${String(r.ppc).padStart(1)} ${String(r.edge ?? 'srv').padEnd(4)} ${r.think.padEnd(6)} CER ${(100 * r.cer).toFixed(2)}% ±${(100 * r.cer_sd).toFixed(2)}  calls/page ${r.calls.toFixed(3)}  s/page ${r.secs.toFixed(1)}  wrong ${r.wrong}  imputed ${r.imputed}`);
  for (const s of R.settings.filter((x) => x.x[0] >= 0)) console.log(`   ${s.ppc}/${s.edge}/${s.think.padEnd(6)} ${s.run ?? '  - '} CER ${(100 * s.cer).toFixed(2)}% δ ${(100 * s.delta).toFixed(2)} [${(100 * s.delta_lo).toFixed(2)}, ${(100 * s.delta_hi).toFixed(2)}]${s.measured ? ` measured ${(100 * s.measured.delta).toFixed(2)} [${(100 * s.measured.delta_lo).toFixed(2)}, ${(100 * s.measured.delta_hi).toFixed(2)}]` : ''} calls ${s.calls.toFixed(3)}${s.non_inferior ? ' NI' : ''}`);
  console.log('  optimum:', R.optimum.verdict, R.optimum.setting ? `${R.optimum.setting.ppc}/${R.optimum.setting.edge}/${R.optimum.setting.think}` : '');
  console.log(`  sequential: ${R.sequential.decided ? 'DECIDED' : `${R.sequential.open.length} cheap settings open`}; next: ${R.sequential.next.slice(0, 4).map((n) => `${n.id} (${n.gain_pp2.toFixed(3)})`).join(', ')}`);
}
if (arg('data')) {
  // The admin page's data: everything but per-book rows (no reference text is in any of it).
  const routes = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'routes-7701.json'), 'utf8')).routes;
  const lean = { ...result, prereg_commit: 'fdadfab', experiment: 'scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md', routes,
    langs: Object.fromEntries(Object.entries(result.langs).map(([k, v]) => [k, { ...v, faces: undefined, face_counts: Object.values(v.faces || {}).reduce((m, f) => ({ ...m, [f]: (m[f] || 0) + 1 }), {}), coef_ci: undefined }])) };
  // Four significant figures are more than any chart or table here prints; it keeps the page's data small.
  fs.writeFileSync(path.resolve(arg('data')), JSON.stringify(lean, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(4)) : k === 'cer_sd' && Array.isArray(v) ? undefined : v)));
}
