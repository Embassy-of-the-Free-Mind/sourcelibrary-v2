#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/score.mjs (the per-page scores this reads, and its mulberry32 / percentile
// bootstrap, copied); it applies Amendment 4's "better than lite" bar, not the brief's non-inferiority bar of Amendment 5.
/**
 * bar-a5.mjs — the adoption bar of PREREGISTRATION-open-engine-print-5660.md Amendment 5 (#5924, #6871 row 2).
 *
 *   node bar-a5.mjs <score.mjs --out results.json> [--out bar.json]
 * The results file must hold run 1 (P0 P1 M G O), run 2 (P0r P1r Mr Gr Or) and the comparators L and LP.
 * Per century and comparator C: pass = median N(engine) − median N(C) ≤ +0.002 AND catastrophic(engine) ≤ catastrophic(C).
 * ADOPTABLE = passes against L and LP in run 2, and in run 1.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const raw = fs.readFileSync(args[0]);
const res = JSON.parse((args[0].endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
const ENGINES = ['P0', 'P1', 'M', 'G', 'O'], COMPS = ['L', 'LP'], MARGIN = 0.002, SEED = 5924, B = 10000;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// paired bootstrap of the difference of medians: resample pages, recompute median(x) − median(y) on the same draw
function bootDiff(xs, ys) {
  const rnd = mulberry32(SEED), n = xs.length, out = [];
  for (let b = 0; b < B; b++) {
    const a = [], c = [];
    for (let i = 0; i < n; i++) { const k = Math.floor(rnd() * n); a.push(xs[k]); c.push(ys[k]); }
    out.push(median(a) - median(c));
  }
  out.sort((p, q) => p - q);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

const have = new Set(res.arms);
for (const a of [...COMPS, ...ENGINES, ...ENGINES.map((e) => `${e}r`)]) if (!have.has(a)) console.error(`missing arm ${a}`);
const out = { prereg: 'PREREGISTRATION-open-engine-print-5660.md Amendment 5', view_N: res.view_N, margin: MARGIN, cells: {} };
for (const cent of ['1600s', '1500s']) {
  const P = res.pages.filter((p) => p.century === cent);
  const cell = { n: P.length, comps: {}, engines: {} };
  for (const c of COMPS) if (have.has(c)) cell.comps[c] = { median_N: r4(median(P.map((p) => p.arms[c].N))), catastrophic: P.filter((p) => p.arms[c].catastrophic).length };
  for (const e of ENGINES) {
    const row = {};
    for (const run of ['run1', 'run2']) {
      const a = run === 'run1' ? e : `${e}r`; if (!have.has(a)) continue;
      const xs = P.map((p) => p.arms[a].N);
      const r = { arm: a, median_N: r4(median(xs)), catastrophic: P.filter((p) => p.arms[a].catastrophic).length, vs: {} };
      for (const c of COMPS) {
        if (!have.has(c)) continue;
        const ys = P.map((p) => p.arms[c].N), d = median(xs) - median(ys), ci = bootDiff(xs, ys);
        const okMed = d <= MARGIN + 1e-12, okCat = r.catastrophic <= cell.comps[c].catastrophic;
        r.vs[c] = { d_median: r4(d), ci: ci.map(r4), ci_upper_within: ci[1] <= MARGIN + 1e-12, median_ok: okMed, catastrophic_ok: okCat, passes: okMed && okCat };
      }
      r.passes_both = COMPS.every((c) => r.vs[c]?.passes);
      row[run] = r;
    }
    if (row.run1 && row.run2) {
      const a1 = P.map((p) => p.arms[e]), a2 = P.map((p) => p.arms[`${e}r`]);
      row.agreement = { median_abs_d: r4(median(a1.map((x, i) => Math.abs(x.N - a2[i].N)))), catastrophic_differ: a1.filter((x, i) => x.catastrophic !== a2[i].catastrophic).length };
    }
    row.adoptable = !!(row.run2?.passes_both && row.run1?.passes_both);
    cell.engines[e] = row;
  }
  cell.adoptable = ENGINES.filter((e) => cell.engines[e].adoptable).sort((x, y) => cell.engines[x].run2.median_N - cell.engines[y].run2.median_N);
  out.cells[cent] = cell;
}
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(out, null, 1) + '\n');
const pct = (x) => (x == null ? '' : (100 * x).toFixed(2));
for (const [cent, c] of Object.entries(out.cells)) {
  console.log(`\n${cent} (n=${c.n})  ${COMPS.map((k) => `${k} median ${pct(c.comps[k]?.median_N)}% cat ${c.comps[k]?.catastrophic}`).join(' · ')}  ADOPTABLE: ${c.adoptable.join(', ') || 'none'}`);
  console.log('engine\trun\tmedian%\tcat\tΔ vs L pt [CI]\tpass L\tΔ vs LP pt [CI]\tpass LP');
  for (const [e, row] of Object.entries(c.engines)) for (const run of ['run1', 'run2']) {
    const r = row[run]; if (!r) continue;
    const f = (k) => (r.vs[k] ? `${pct(r.vs[k].d_median)} [${pct(r.vs[k].ci[0])}, ${pct(r.vs[k].ci[1])}]` : '');
    const p = (k) => (r.vs[k] ? (r.vs[k].passes ? 'yes' : `no(${r.vs[k].median_ok ? '' : 'med'}${r.vs[k].catastrophic_ok ? '' : 'cat'})`) : '');
    console.log([e, run, pct(r.median_N), r.catastrophic, f('L'), p('L'), f('LP'), p('LP')].join('\t'));
  }
}
