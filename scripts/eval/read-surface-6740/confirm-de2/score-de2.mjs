#!/usr/bin/env node
// #6740 read-surface, German confirmation 2: the RELATIVE rule of confirm-de2/RULE.md, post-stratified to the frame,
// with per-era and per-face splits.
//
// PRIOR ART: ../confirm.mjs score (the router's absolute rule and the paired Dirichlet gate, used for confirmations 1
//   and the Latin one; its helpers are re-implemented here because confirm.mjs score writes the absolute decision).
//   This adds clause (b) (paired wrong-text counts), clause (c) (quota cost a accepted page), frame weights and strata.
//
//   node scripts/eval/read-surface-6740/confirm-de2/score-de2.mjs --out=DIR [--frame=confirm-de2/frame.json]
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../../lib/paired-stats.mjs';
import { scorePlant } from '../../lib/plant-ocr-errors.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out'));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const CELL = 'de-surface2', A = 'agy-flash-low@4', O = 'agy-flash-low@8';
const RATE = { input: 0.75e-6, cached: 0.075e-6, output: 3.75e-6 };
const usdOf = (u) => (u ? ((u.input || 0) - (u.cache_read || 0)) * RATE.input + (u.cache_read || 0) * RATE.cached + (u.output || 0) * RATE.output : 0);
const slug = (r) => r.replace(/[^a-z0-9]+/gi, '_');

const S = J('sample.json').cells[CELL], pages = S.pages, key = J('key.json'), W = J('written.json')[CELL];
const V = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const vOf = (route, id) => { const k = key.find((x) => x.route === route && x.kind === 'item' && x.page_id === id); return k ? V.get(k.judged_as) ?? null : null; };
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? '';
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const inv = (v) => (v?.defects || []).some((d) => /^I\d/.test(cls(d)) || /wrong[- ]?(leaf|page)|invent/i.test(`${d.what ?? ''} ${d.class ?? ''}`));

// Frame weights: cell share in the frame ÷ cell share in the sample (era from frame.json books; face within era from the
// RULE's assumed shares, quota.json). A cell with no sampled book has no weight (its share is reported as uncovered).
const quota = J('quota.json'), frame = JSON.parse(fs.readFileSync(arg('frame', path.join(HERE, 'frame.json')), 'utf8'));
const cellOf = (p) => `${p.era}|${p.script_face}`;
const n = pages.length, sampleShare = {}; for (const p of pages) sampleShare[cellOf(p)] = (sampleShare[cellOf(p)] || 0) + 1 / n;
const covered = Object.keys(sampleShare).reduce((a, c) => a + (quota.shares[c] || 0), 0);
const wOf = (p) => (quota.shares[cellOf(p)] / covered) / sampleShare[cellOf(p)];

function routeRows(route) {
  return pages.map((p) => { const w = W[route]?.[p.page_id], v = w?.text ? vOf(route, p.page_id) : null;
    return { ...p, written: !!w?.text, judged: !!v, accept: !!v?.accept, wt: wt(v), inv: inv(v), fidelity: v?.fidelity ?? null, why: w?.why ?? null,
      wrong_text: (v?.defects || []).filter((d) => d.severity === 'wrong_text').map((d) => `${d.class}: ${String(d.quote).slice(0, 80)} — ${d.what ?? ''}`.slice(0, 220)) }; });
}
function cost(route) {
  const d = path.join(OUT, 'corr', CELL, slug(route));
  const bc = jsonl(path.join(d, 'calls.jsonl'));
  const metas = fs.readdirSync(d).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  const usd = bc.reduce((t, c) => t + (c.usage || []).reduce((a, u) => a + usdOf(u), 0), 0) + metas.filter((m) => !m.call_id).reduce((t, m) => t + (m.usage || []).reduce((a, u) => a + usdOf(u), 0), 0);
  const calls = bc.reduce((t, c) => t + (c.calls ?? 1), 0) + metas.filter((m) => !m.call_id).reduce((t, m) => t + (m.calls ?? 1), 0);
  return { usd, calls, pages_read: metas.length, usd_per_1k_pages: 1000 * usd / Math.max(1, metas.length), calls_per_page: calls / Math.max(1, metas.length) };
}
function gamma(rnd) { const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const g = (a) => { if (a < 1) return g(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } }; return g; }
/** Dirichlet(1 + weighted counts): P(acc_O ≥ acc_A − 0.08). Weighted counts are the frame-weighted sums (sum of weights = pairs). */
function pairedP(c, seed) { const g = gamma(makeRng(seed)); let hit = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const x = [c.both, c.o_only, c.a_only, c.neither].map((v) => g(1 + v)); const t = x.reduce((a, b) => a + b); if ((x[1] - x[2]) / t >= -0.08) hit++; } return +(hit / N).toFixed(3); }
function betaP(k, n2, seed) { const g = gamma(makeRng(seed)); let hit = 0; const N = 40000; for (let i = 0; i < N; i++) { const a = g(1 + k), b = g(1 + n2 - k); if (a / (a + b) >= 0.8) hit++; } return +(hit / N).toFixed(3); }
const wilson = (k, n2) => { if (!n2) return [null, null]; const z = 1.96, p = k / n2, d = 1 + z * z / n2, c = p + z * z / (2 * n2), h = z * Math.sqrt(p * (1 - p) / n2 + z * z / (4 * n2 * n2)); return [+((c - h) / d).toFixed(3), +((c + h) / d).toFixed(3)]; };

const RA = routeRows(A), RO = routeRows(O);
const pairs = RA.map((a, i) => [a, RO[i]]).filter(([a, o]) => a.written && a.judged && o.written && o.judged);
function tally(ps, weighted) {
  const w = (p) => (weighted ? wOf(p) : 1);
  const sum = (f) => ps.reduce((t, [a, o]) => t + (f(a, o) ? w(a) : 0), 0);
  return { n: ps.length, books: ps.length, both: sum((a, o) => a.accept && o.accept), o_only: sum((a, o) => o.accept && !a.accept), a_only: sum((a, o) => a.accept && !o.accept), neither: sum((a, o) => !a.accept && !o.accept),
    wt_a: sum((a) => a.wt), wt_o: sum((a, o) => o.wt), inv_o: sum((a, o) => o.inv), acc_a: sum((a) => a.accept), acc_o: sum((a, o) => o.accept), w: ps.reduce((t, [a]) => t + w(a), 0) };
}
const CA = cost(A), CO = cost(O);
// Cost a accepted page: the route's cost a page read ÷ its accepted share of the drawn pages (weighted for the decision).
const accShare = (R, weighted) => { const w = (p) => (weighted ? wOf(p) : 1); return R.reduce((t, r) => t + (r.accept ? w(r) : 0), 0) / R.reduce((t, r) => t + w(r), 0); };
const out = { scored_at: new Date().toISOString(), rule: 'confirm-de2/RULE.md (relative; committed before any read)', judge: 'claude-opus-5-5 (claude -p, login derek@sourcelibrary.org after this box\'s account was over its pace), route-judge-6740 judgePrompt, blind, shuffled',
  n_drawn: pages.length, frame_covered_share: +covered.toFixed(3), weights: Object.fromEntries(Object.keys(sampleShare).map((c) => [c, { frame_share: +(quota.shares[c] / covered).toFixed(4), sample_share: +sampleShare[c].toFixed(4), weight: +((quota.shares[c] / covered) / sampleShare[c]).toFixed(3) }])) };
for (const weighted of [true, false]) {
  const t = tally(pairs, weighted), seed = weighted ? 6741 : 6742;
  const sa = accShare(RA, weighted), so = accShare(RO, weighted);
  const cpaA = CA.usd_per_1k_pages / sa, cpaO = CO.usd_per_1k_pages / so;
  const cl = { a: pairedP(t, seed) >= 0.9, b: t.wt_o <= t.wt_a && t.inv_o === 0, c: cpaO <= 0.9 * cpaA };
  out[weighted ? 'weighted' : 'unweighted'] = { paired: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +(+v).toFixed(2)])), p_o_within_008: pairedP(t, seed),
    accepted_share_of_drawn: { [A]: +sa.toFixed(3), [O]: +so.toFixed(3) }, usd_per_1k_accepted: { [A]: +cpaA.toFixed(2), [O]: +cpaO.toFixed(2) }, saving: +(1 - cpaO / cpaA).toFixed(3), clauses: cl, passes: cl.a && cl.b && cl.c };
}
// Absolute bar, reported (unweighted, written pages).
const abs = (R) => { const wr = R.filter((r) => r.written && r.judged), k = wr.filter((r) => r.accept).length; return { written: `${k}/${wr.length}`, wrong_text: `${wr.filter((r) => r.wt).length}/${wr.length}`, invented: wr.filter((r) => r.inv).length, p_acc_ge_080: betaP(k, wr.length, 77), passes_absolute: wr.filter((r) => r.wt).length / Math.max(1, wr.length) <= 0.04 && betaP(k, wr.length, 77) >= 0.9 }; };
out.absolute_reported = { [A]: abs(RA), [O]: abs(RO) };
out.cost = { [A]: CA, [O]: CO };
// Strata: by era, by face, by cell; any stratum where O does worse than A is named.
const strat = (keyf) => { const g = {}; for (const pr of pairs) (g[keyf(pr[0])] ||= []).push(pr);
  return Object.fromEntries(Object.entries(g).map(([k, ps]) => { const t = tally(ps, false); return [k, { books: ps.length, both: t.both, o_only: t.o_only, a_only: t.a_only, neither: t.neither, wt_a: t.wt_a, wt_o: t.wt_o,
    acc_a: `${t.acc_a}/${ps.length}`, acc_o: `${t.acc_o}/${ps.length}`, acc_a_ci: wilson(t.acc_a, ps.length), acc_o_ci: wilson(t.acc_o, ps.length), o_worse: t.a_only > t.o_only || t.wt_o > t.wt_a }]; })); };
out.by_era = strat((p) => p.era); out.by_face = strat((p) => p.script_face); out.by_cell = strat(cellOf);
out.o_worse_strata = [...Object.entries(out.by_era), ...Object.entries(out.by_face), ...Object.entries(out.by_cell)].filter(([, v]) => v.o_worse).map(([k]) => k);
out.not_written = { [A]: RA.filter((r) => !r.written).map((r) => ({ page_id: r.page_id, why: r.why })), [O]: RO.filter((r) => !r.written).map((r) => ({ page_id: r.page_id, why: r.why })) };
out.wrong_text_pages = { [A]: RA.filter((r) => r.wt || r.inv).map((r) => ({ page_id: r.page_id, era: r.era, face: r.script_face, defects: r.wrong_text })), [O]: RO.filter((r) => r.wt || r.inv).map((r) => ({ page_id: r.page_id, era: r.era, face: r.script_face, defects: r.wrong_text })) };
const pl = key.filter((k) => k.kind === 'planted').map((k) => { const v = V.get(k.judged_as); return { route: k.route, kind: k.plant.kind, judged: !!v, ...(v ? scorePlant(v, k.plant) : { caught: false }) }; });
const wp = key.filter((k) => k.kind === 'wrong_page').map((k) => { const v = V.get(k.judged_as); return { route: k.route, refused: !!v && !v.accept && Number(v.fidelity) <= 2 }; });
out.controls = { planted: pl, planted_caught: `${pl.filter((x) => x.caught).length}/${pl.length}`, wrong_page: wp, wrong_page_refused: `${wp.filter((x) => x.refused).length}/${wp.length}`, voided: pl.length >= 2 && pl.every((x) => !x.caught) };
out.decision = { passes: out.weighted.passes && !out.controls.voided && wp.filter((x) => x.route === O).every((x) => x.refused), decided_by: 'weighted (post-stratified to the frame)', unweighted_agrees: out.weighted.passes === out.unweighted.passes };
fs.writeFileSync(path.join(OUT, 'score-de2.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ weighted: out.weighted, unweighted: { p: out.unweighted.p_o_within_008, clauses: out.unweighted.clauses, saving: out.unweighted.saving }, absolute: out.absolute_reported, controls: { planted: out.controls.planted_caught, wrong_page: out.controls.wrong_page_refused }, worse: out.o_worse_strata, decision: out.decision }, null, 1));
