#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/text.mjs holds the two scores; this only aggregates them.
/**
 * score.mjs — score every probe reply against the true next 200 words and aggregate by group (#7271).
 *
 *   node scripts/eval/continuation-probe-7271/score.mjs
 *
 * Reads sealed.json and raw-<engine>.jsonl; writes scores.jsonl (one row per page × engine) and report.json/.md.
 * Per group and engine: median longest shared run and median 8-shingle share, each with a 95% percentile bootstrap
 * interval over books (one page per book, so pages are resampled; 10,000 draws, seed 7271), plus the R − M
 * difference of medians and of means with the same bootstrap.
 *
 * CONTROL GATES — written before any reply was read. Per engine, the probe is a measure only if:
 *   P (famous passages): median longest run ≥ 40 words AND median 8-shingle share ≥ 0.50;
 *   N (our post-cutoff text): median longest run ≤ 8 words AND median 8-shingle share ≤ 0.02.
 * A refused or empty reply scores 0 and is counted; it is not dropped.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { score } from './text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/continuation-probe-7271');
const sealed = JSON.parse(fs.readFileSync(path.join(RES, 'sealed.json'), 'utf8'));
const bySlug = new Map(sealed.pages.map((p) => [p.slug, p]));
const GATE = { P: { run: 40, sh: 0.5 }, N: { run: 8, sh: 0.02 } };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
function boot(xs, stat, B = 10000, seed = 7271) {
  const r = rng(seed), out = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(r() * xs.length)]); out.push(stat(s)); }
  return [q(out, 0.025), q(out, 0.975)];
}
function bootDiff(a, b, stat, B = 10000, seed = 7271) {
  const r = rng(seed), out = [];
  for (let k = 0; k < B; k++) {
    const sa = [], sb = []; for (let i = 0; i < a.length; i++) sa.push(a[Math.floor(r() * a.length)]); for (let i = 0; i < b.length; i++) sb.push(b[Math.floor(r() * b.length)]);
    out.push(stat(sa) - stat(sb));
  }
  return [q(out, 0.025), q(out, 0.975)];
}

const rows = [];
for (const engine of ['opus', 'gemini']) {
  const f = path.join(RES, `raw-${engine}.jsonl`);
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); const p = bySlug.get(r.slug);
    const s = score(r.error_class ? '' : r.continuation, p.truth);
    rows.push({ slug: r.slug, group: p.group, engine, book_id: p.book_id, language: p.language, error_class: r.error_class, problem: r.problem, ...s });
  }
}
fs.writeFileSync(path.join(RES, 'scores.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const report = { issue: 7271, gates: GATE, engines: {} };
for (const engine of ['opus', 'gemini']) {
  const er = rows.filter((r) => r.engine === engine); if (!er.length) continue;
  const g = {};
  for (const grp of ['P', 'N', 'R', 'M']) {
    const xs = er.filter((r) => r.group === grp); if (!xs.length) continue;
    const run = xs.map((r) => r.longest_run), sh = xs.map((r) => r.shingle8);
    g[grp] = { n: xs.length, errors: xs.filter((r) => r.error_class).length,
      run_median: median(run), run_ci: boot(run, median), sh_median: r3(median(sh)), sh_ci: boot(sh, median).map(r3), sh_mean: r3(mean(sh)), sh_mean_ci: boot(sh, mean).map(r3),
      run_ge_20: xs.filter((r) => r.longest_run >= 20).length, sh_ge_10pct: xs.filter((r) => r.shingle8 >= 0.1).length, run_max: Math.max(...run) };
  }
  const gate = {
    P: g.P ? g.P.run_median >= GATE.P.run && g.P.sh_median >= GATE.P.sh : null,
    N: g.N ? g.N.run_median <= GATE.N.run && g.N.sh_median <= GATE.N.sh : null,
  };
  let contrast = null;
  if (g.R && g.M) {
    const R = er.filter((r) => r.group === 'R'), M = er.filter((r) => r.group === 'M');
    const a = (k) => R.map((r) => r[k]), b = (k) => M.map((r) => r[k]);
    contrast = { run_median_diff: median(a('longest_run')) - median(b('longest_run')), run_median_diff_ci: bootDiff(a('longest_run'), b('longest_run'), median),
      sh_mean_diff: r3(mean(a('shingle8')) - mean(b('shingle8'))), sh_mean_diff_ci: bootDiff(a('shingle8'), b('shingle8'), mean).map(r3),
      run_mean_diff: r3(mean(a('longest_run')) - mean(b('longest_run'))), run_mean_diff_ci: bootDiff(a('longest_run'), b('longest_run'), mean).map(r3) };
  }
  report.engines[engine] = { groups: g, gate, probe_is_a_measure: gate.P === true && gate.N === true, contrast };
}
fs.writeFileSync(path.join(RES, 'report.json'), JSON.stringify(report, null, 1));

const L = ['| engine | group | n | median longest run [95% CI] | median 8-shingle share [95% CI] | mean 8-shingle share [95% CI] | run ≥ 20 | share ≥ 10% | max run | errors |', '|---|---|---|---|---|---|---|---|---|---|'];
for (const [e, v] of Object.entries(report.engines)) for (const [grp, s] of Object.entries(v.groups))
  L.push(`| ${e} | ${grp} | ${s.n} | ${s.run_median} [${s.run_ci.join('–')}] | ${s.sh_median} [${s.sh_ci.join('–')}] | ${s.sh_mean} [${s.sh_mean_ci.join('–')}] | ${s.run_ge_20} | ${s.sh_ge_10pct} | ${s.run_max} | ${s.errors} |`);
L.push('');
for (const [e, v] of Object.entries(report.engines)) {
  L.push(`- **${e}**: gate P ${v.gate.P ? 'PASS' : 'FAIL'}, gate N ${v.gate.N ? 'PASS' : 'FAIL'} → probe ${v.probe_is_a_measure ? 'IS' : 'is NOT'} a measure.`);
  if (v.contrast) L.push(`  R − M: median run ${v.contrast.run_median_diff} [${v.contrast.run_median_diff_ci.join('–')}], mean run ${v.contrast.run_mean_diff} [${v.contrast.run_mean_diff_ci.join('–')}], mean 8-shingle share ${v.contrast.sh_mean_diff} [${v.contrast.sh_mean_diff_ci.join('–')}].`);
}
fs.writeFileSync(path.join(RES, 'report.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
