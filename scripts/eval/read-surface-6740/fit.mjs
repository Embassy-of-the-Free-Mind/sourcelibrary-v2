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
  if (design.length < 10) { result.langs[lang] = { status: `only ${design.length} design runs finished: no fit`, runs: runs.map((r) => ({ id: r.id, ...agg(r.id, books) })) }; continue; }
  const point = surfaces(books);
  const rng = makeRng(6740);
  const boots = [];
  for (let i = 0; i < B; i++) { const bs = books.map(() => books[Math.floor(rng() * books.length)]); boots.push({ s: surfaces(bs), bs }); }
  // Per grid setting: predicted CER, δ vs live with its bootstrap bound, calls, seconds.
  const settings = grid.map((x) => {
    const d = boots.map(({ s }) => predict(s.cer, x) - s.live);
    return { x, ppc: LEVELS.ppc[x[0] + 1], edge: LEVELS.edge[x[1] + 1], think: LEVELS.think[x[2] + 1],
      cer: predict(point.cer, x), delta: predict(point.cer, x) - point.live, delta_lo: q(d, 0.025), delta_hi: q(d, 0.975),
      calls: predict(point.calls, x), calls_lo: q(boots.map(({ s }) => predict(s.calls, x)), 0.025), calls_hi: q(boots.map(({ s }) => predict(s.calls, x)), 0.975),
      secs: predict(point.secs, x), run: design.find((r) => r.x1 === x[0] && r.x2 === x[1] && r.x3 === x[2])?.id ?? null };
  });
  const liveAgg = lives.length ? lives.map((r) => ({ id: r.id, ...agg(r.id, books) })) : [];
  const liveCalls = liveAgg.length ? mean(liveAgg.map((r) => r.calls)) : null;
  const liveWrong = liveAgg.length ? mean(liveAgg.map((r) => r.wrong)) : 0;
  for (const s of settings) {
    const ran = s.run && agg(s.run, books);
    s.wrong = ran ? ran.wrong : null;
    s.non_inferior = s.delta_hi <= MARGIN && (s.wrong === null || s.wrong <= liveWrong + 1);
  }
  const nonInf = settings.filter((s) => s.non_inferior).sort((a, b) => (Math.abs(a.calls - b.calls) > 0.02 ? a.calls - b.calls : a.secs - b.secs) || (Math.abs(a.x[0]) + Math.abs(a.x[1] - 1) + Math.abs(a.x[2] + 1)) - (Math.abs(b.x[0]) + Math.abs(b.x[1] - 1) + Math.abs(b.x[2] + 1)));
  const best = nonInf[0] || null;
  const saving = best && liveCalls ? 1 - best.calls / liveCalls : null;
  const optimum = !best ? { verdict: 'no setting is non-inferior to live: nothing switches' }
    : saving < MIN_SAVING ? { verdict: `the cheapest non-inferior setting saves ${(100 * saving).toFixed(0)} % of live's calls (< ${100 * MIN_SAVING} %): nothing switches`, setting: best, saving }
    : { verdict: 'optimum found: confirm on queue pages', setting: best, saving };
  // Noise floor: the A-vs-A spread of the centre runs and of the two live runs, paired bootstrap by book.
  const pair = (a, b) => { if (!cell[a] || !cell[b]) return null; const d = boots.map(({ bs }) => agg(a, bs).cer - agg(b, bs).cer); return { a, b, delta: agg(a, books).cer - agg(b, books).cer, lo: q(d, 0.025), hi: q(d, 0.975) }; };
  const centres = design.filter((r) => r.id.startsWith('C')).map((r) => r.id);
  const centreCers = centres.map((c) => agg(c, books).cer);
  const noise = {
    centre_runs: centres.map((c, i) => ({ id: c, cer: centreCers[i] })),
    centre_range: centreCers.length ? Math.max(...centreCers) - Math.min(...centreCers) : null,
    centre_pairs: [['C1', 'C2'], ['C1', 'C3'], ['C2', 'C3']].map(([a, b]) => pair(a, b)).filter(Boolean),
    live_pair: pair('L1', 'L2'),
  };
  noise.band = Math.max(noise.centre_range ?? 0, ...noise.centre_pairs.map((p) => Math.max(Math.abs(p.lo), Math.abs(p.hi))));
  // Slices for the contour plots: x1 (pages a call) × x2 (long edge) at each thinking level, 25 × 25 coded points.
  const N = 25, axis = Array.from({ length: N }, (_, i) => -1 + (2 * i) / (N - 1));
  const slices = [-1, 0, 1].map((c) => ({ x3: c, think: LEVELS.think[c + 1],
    cer: axis.map((b) => axis.map((a) => predict(point.cer, [a, b, c]))), calls: axis.map((b) => axis.map((a) => predict(point.calls, [a, b, c]))) }));
  result.langs[lang] = {
    books: books.length, excluded: L.excluded, faces: L.faces, c1, axis,
    runs: runs.map((r) => ({ id: r.id, x: [r.x1, r.x2, r.x3], ppc: r.ppc, edge: r.edge, think: r.think, live: r.live, phase: r.phase, ...agg(r.id, books),
      imputed: books.filter((b) => cell[r.id][b].imputed).length, unread: r.pages_unread, calls_made: r.calls, pages_in_run: r.pages_in_run, tokens: r.tokens })),
    coef: { cer: point.cer, calls: point.calls, secs: point.secs },
    coef_ci: { cer: point.cer.map((_, i) => [q(boots.map(({ s }) => s.cer[i]), 0.025), q(boots.map(({ s }) => s.cer[i]), 0.975)]) },
    live: { cer: point.live, calls: liveCalls, wrong: liveWrong, runs: liveAgg },
    settings, optimum, noise, slices,
  };
}
const OUT = arg('out', path.join(WORK, 'surface.json'));
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const [lang, R] of Object.entries(result.langs)) {
  if (R.status) { console.log(lang, R.status); continue; }
  console.log(`\n${lang}: ${R.books} books; c1 ${R.c1.toFixed(2)}; live CER ${(100 * R.live.cer).toFixed(2)}% calls ${R.live.calls?.toFixed(3)}; noise band ${(100 * R.noise.band).toFixed(2)} pp`);
  for (const r of R.runs) console.log(`  ${r.id.padEnd(4)} ${String(r.ppc).padStart(1)} ${String(r.edge ?? 'srv').padEnd(4)} ${r.think.padEnd(6)} CER ${(100 * r.cer).toFixed(2)}%  calls/page ${r.calls.toFixed(3)}  s/page ${r.secs.toFixed(1)}  wrong ${r.wrong}  imputed ${r.imputed}`);
  console.log('  coef CER (pp):', R.coef.cer.map((b, i) => `${TERM_NAMES[i]} ${(100 * b).toFixed(2)}`).join(', '));
  console.log('  optimum:', R.optimum.verdict, R.optimum.setting ? `${R.optimum.setting.ppc}/${R.optimum.setting.edge}/${R.optimum.setting.think} calls ${R.optimum.setting.calls.toFixed(3)} δ ${(100 * R.optimum.setting.delta).toFixed(2)} [${(100 * R.optimum.setting.delta_lo).toFixed(2)}, ${(100 * R.optimum.setting.delta_hi).toFixed(2)}] pp` : '');
}
if (arg('data')) {
  // The admin page's data: everything but per-book rows (no reference text is in any of it).
  const routes = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'routes-7701.json'), 'utf8')).routes;
  const lean = { ...result, prereg_commit: 'fdadfab', experiment: 'scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md', routes,
    langs: Object.fromEntries(Object.entries(result.langs).map(([k, v]) => [k, { ...v, faces: undefined, face_counts: Object.values(v.faces || {}).reduce((m, f) => ({ ...m, [f]: (m[f] || 0) + 1 }), {}), coef_ci: undefined }])) };
  fs.writeFileSync(path.resolve(arg('data')), JSON.stringify(lean));
}
