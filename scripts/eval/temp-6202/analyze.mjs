#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused. report.mjs there joins score.mjs results into rows and per-arm tables for lever arms; scripts/eval/routing-eval applies margin-v1 to catastrophic-page rates between two engines. Neither applies a margin rule to fidelity AND reversals of temperature draws against an A-vs-A floor, resolves merged identical draws, or scores a best-of-3 pick. Every score here comes from score.mjs output.
/** Apply #6202's preregistered rule to the judged temperature arms: floors, paired bootstrap contrasts vs T1a, BO3 pick / oracle, T0-vs-T1 transfer. Writes summary.json + rows.jsonl. $0. */
//   node scripts/eval/temp-6202/analyze.mjs [--work /data/scratch/sl/temp-6202] [--out scripts/eval/results/temp-6202-2026-10]
import fs from 'node:fs';
import path from 'node:path';
import { makeRng, mean } from '../lib/paired-stats.mjs';
import { readJsonl, itemId, sha16 } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202');
const OUT = opt('out', 'scripts/eval/results/temp-6202-2026-10');
const MODELS = ['lite', 'flash'].filter((m) => fs.existsSync(path.join(WORK, `results-${m}.json`)));
const DRAWS = ['T1a', 'T1b', 'T1c', 'T02a', 'T02b', 'T0a', 'T0b'];
const FID_MARGIN = 0.15; const REV_MARGIN = 0.10; const ITERS = 4000; const SEED = 6202;
const r2 = (x) => (x == null ? null : +x.toFixed(2)); const r3 = (x) => (x == null ? null : +x.toFixed(3));

const recs = readJsonl(path.join(WORK, 'records.jsonl'));
const meta = Object.fromEntries(recs.map((r) => [`${r.book_id}_${r.page_number}`, { set: r.set, lang: r.lang, pid: itemId(r), prod: JSON.parse(fs.readFileSync(path.join(WORK, 'requests', `${r.book_id}_${r.page_number}.json`), 'utf8')).production_model.includes('lite') ? 'lite' : 'flash' }]));
const armFile = (m, a, id) => { const f = path.join(WORK, 'arms', `${m}-${a}`, `${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

// page[m][id] = { arm: { fid, rev, om, j: [f1, f2], cost, identicalTo } }
const page = {}; const gate = {}; const agreement = {}; const dropped = {}; const rows = [];
for (const m of MODELS) {
  const res = JSON.parse(fs.readFileSync(path.join(WORK, `results-${m}.json`), 'utf8'));
  const { aliases, dropped: dr } = JSON.parse(fs.readFileSync(path.join(WORK, `aliases-${m}.json`), 'utf8'));
  gate[m] = { pass: res.gate.pass, forced: !!res.gate.forced, by_judge: Object.fromEntries(Object.entries(res.gate.by_judge).map(([j, g]) => [j, { ...g.summary, pass: g.pass }])) };
  agreement[m] = res.agreement; dropped[m] = dr;
  const pp = Object.fromEntries(res.per_page.map((p) => [p.id, p]));
  page[m] = {};
  for (const [id, al] of Object.entries(aliases)) {
    const p = pp[meta[id].pid]; if (!p) continue;
    const o = {};
    for (const a of DRAWS) {
      const z = p.arms[al[a]]; const js = Object.values(z?.by_judge || {}).filter(Boolean);
      if (!z || z.fidelity == null || !js.length) continue;
      const af = armFile(m, a, id) || armFile(m, al[a], id);
      o[a] = { fid: z.fidelity, rev: js.some((x) => x.reversal) ? 1 : 0, rev_both: js.length > 1 && js.every((x) => x.reversal) ? 1 : 0, om: js.some((x) => x.omission) ? 1 : 0, j: js.map((x) => x.fidelity), cost: armFile(m, a, id)?.cost_usd ?? 0, merged_into: al[a] === a ? null : al[a], sha: af ? sha16(af.text) : null, out_tokens: af?.outputTokens ?? null };
    }
    if (DRAWS.some((a) => !o[a])) { (dropped[m] ||= []).push({ id, set: meta[id].set, missing: ['judge verdict'] }); continue; }
    const pf = path.join(WORK, 'picks', m, `${id}.json`); const pk = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : null;
    if (pk) {
      const three = ['T1a', 'T1b', 'T1c'];
      o.BO3 = { ...o[pk.pick_arm], cost: three.reduce((s, a) => s + o[a].cost, 0) + (pk.cost_usd || 0), picked: pk.pick_arm, fallback: !!pk.fallback };
      const best = [...three].sort((x, y) => (o[y].fid - o[x].fid) || (o[x].rev - o[y].rev))[0]; const worst = [...three].sort((x, y) => (o[x].fid - o[y].fid) || (o[y].rev - o[x].rev))[0];
      o.ORACLE = { ...o[best], picked: best }; o.WORST3 = { ...o[worst], picked: worst };
      o.MEAN3 = { fid: mean(three.map((a) => o[a].fid)), rev: mean(three.map((a) => o[a].rev)), om: mean(three.map((a) => o[a].om)), cost: mean(three.map((a) => o[a].cost)) };
    }
    page[m][id] = o;
    for (const a of [...DRAWS, 'BO3']) if (o[a]) rows.push({ id, set: meta[id].set, lang: meta[id].lang, production_model: meta[id].prod, model: m, arm: a, temperature: a.startsWith('T02') ? 0.2 : a.startsWith('T0') ? 0 : 1, fidelity: o[a].fid, fidelity_by_judge: o[a].j, reversal: !!o[a].rev, reversal_both_judges: !!o[a].rev_both, omission: !!o[a].om, same_text_as: o[a].merged_into || undefined, picked: o[a].picked, text_sha16: o[a].sha, cost_usd_realtime: r3(o[a].cost) && +o[a].cost.toFixed(5) });
  }
}

// ── statistics ─────────────────────────────────────────────────────────────────────────────────────────────
const rng = makeRng(SEED);
const bootMean = (xs) => { if (xs.length < 2) return [null, null]; const ms = []; for (let i = 0; i < ITERS; i++) { let s = 0; for (let j = 0; j < xs.length; j++) s += xs[Math.floor(rng() * xs.length)]; ms.push(s / xs.length); } ms.sort((a, b) => a - b); return [ms[Math.floor(ITERS * 0.025)], ms[Math.floor(ITERS * 0.975)]]; };
const est = (xs, scale = 1) => { const [lo, hi] = bootMean(xs); return { n: xs.length, mean: r3(mean(xs) * scale), ci: [r3(lo * scale), r3(hi * scale)] }; };
const sign = (ds) => { const up = ds.filter((d) => d > 0).length; const dn = ds.filter((d) => d < 0).length; return { up, down: dn, tie: ds.length - up - dn }; };

/** cells: [{ id, o }] where o is the page's arm map (one model, or the production-routed model per page) */
function pool(cells) {
  const col = (a, k) => cells.map((c) => c.o[a][k]);
  const has = (a) => cells.length && cells.every((c) => c.o[a]);
  const arms = {};
  for (const a of [...DRAWS, 'BO3', 'ORACLE', 'WORST3', 'MEAN3']) if (has(a)) arms[a] = { fidelity: est(col(a, 'fid')), reversals_per_100: est(col(a, 'rev'), 100), omission_per_100: r2(100 * mean(col(a, 'om'))), share_fid_ge4: r3(mean(col(a, 'fid').map((x) => (x >= 4 ? 1 : 0)))), cost_per_page_realtime: +mean(col(a, 'cost')).toFixed(5) };
  if (!has('T1a') || !has('T1b')) return { n: cells.length, arms };
  const d = (a, b, k) => cells.map((c) => c.o[a][k] - c.o[b][k]);
  const floor = { fid: Math.abs(mean(d('T1b', 'T1a', 'fid'))), rev: Math.abs(mean(d('T1b', 'T1a', 'rev'))), fid_signed: est(d('T1b', 'T1a', 'fid')), rev_signed_per_100: est(d('T1b', 'T1a', 'rev'), 100) };
  const contrast = (dF, dR) => {
    const F = est(dF); const R = est(dR);
    const beatsFid = F.mean > floor.fid && F.ci[0] > 0 && R.ci[1] <= REV_MARGIN;
    const beatsRev = -R.mean > floor.rev && R.ci[1] < 0 && F.ci[0] >= -FID_MARGIN;
    const notWorse = F.ci[0] >= -FID_MARGIN && R.ci[1] <= REV_MARGIN;
    return { d_fidelity: F, d_reversals_per_100: { n: R.n, mean: r2(R.mean * 100), ci: R.ci.map((x) => r2(x * 100)) }, pages: sign(dF), beats_production: beatsFid || beatsRev, by: beatsFid ? 'fidelity' : beatsRev ? 'reversals' : null, not_worse: notWorse };
  };
  const vs = {};
  for (const a of ['T1b', 'T02a', 'T0a', 'BO3', 'ORACLE']) if (has(a)) vs[`${a}-T1a`] = contrast(d(a, 'T1a', 'fid'), d(a, 'T1a', 'rev'));
  const two = (x, y, k) => cells.map((c) => (c.o[`${x}a`][k] + c.o[`${x}b`][k]) / 2 - (c.o[`${y}a`][k] + c.o[`${y}b`][k]) / 2);
  for (const t of ['T02', 'T0']) if (has(`${t}a`) && has(`${t}b`)) {
    const c = contrast(two(t, 'T1', 'fid'), two(t, 'T1', 'rev')); vs[`${t}mean-T1mean`] = c;
    const first = vs[`${t}a-T1a`]; first.two_draw_agrees = Math.sign(first.d_fidelity.mean) === Math.sign(c.d_fidelity.mean) || Math.abs(c.d_fidelity.mean) < 0.02;
    c.transfers = c.d_fidelity.ci[0] >= -FID_MARGIN && c.d_fidelity.ci[1] <= FID_MARGIN && c.d_reversals_per_100.ci[0] >= -100 * REV_MARGIN && c.d_reversals_per_100.ci[1] <= 100 * REV_MARGIN;
  }
  if (has('BO3') && has('MEAN3')) vs['BO3-MEAN3 (picker lift)'] = contrast(d('BO3', 'MEAN3', 'fid'), d('BO3', 'MEAN3', 'rev'));
  const movement = {};
  for (const t of ['T1', 'T02', 'T0']) if (has(`${t}a`) && has(`${t}b`)) movement[t] = { pages_moving_ge1: cells.filter((c) => Math.abs(c.o[`${t}a`].fid - c.o[`${t}b`].fid) >= 1).length, share: r3(mean(cells.map((c) => (Math.abs(c.o[`${t}a`].fid - c.o[`${t}b`].fid) >= 1 ? 1 : 0)))), byte_identical: cells.filter((c) => c.o[`${t}a`].sha === c.o[`${t}b`].sha).length, mean_abs_diff: r3(mean(cells.map((c) => Math.abs(c.o[`${t}a`].fid - c.o[`${t}b`].fid)))), reversal_flips: cells.filter((c) => c.o[`${t}a`].rev !== c.o[`${t}b`].rev).length };
  const picks = has('BO3') ? { picked: cells.reduce((a, c) => { a[c.o.BO3.picked] = (a[c.o.BO3.picked] || 0) + 1; return a; }, {}), picked_a_top_draw: cells.filter((c) => c.o.BO3.fid === c.o.ORACLE.fid).length, picked_a_bottom_draw_when_they_differ: cells.filter((c) => c.o.ORACLE.fid !== c.o.WORST3.fid && c.o.BO3.fid === c.o.WORST3.fid).length, pages_where_draws_differ: cells.filter((c) => c.o.ORACLE.fid !== c.o.WORST3.fid).length, fallback: cells.filter((c) => c.o.BO3.fallback).length } : null;
  return { n: cells.length, floor: { fidelity: r3(floor.fid), reversals_per_100: r2(floor.rev * 100), T1b_minus_T1a_fidelity: floor.fid_signed, T1b_minus_T1a_reversals_per_100: floor.rev_signed_per_100 }, arms, vs, movement, picks };
}

const SETS = ['tengyur', 't4', 'latin'];
const summary = { generated: new Date().toISOString(), rule: { seed: SEED, resamples: ITERS, fid_margin: FID_MARGIN, rev_margin: REV_MARGIN }, judges: 'two blind Opus judges (claude -p --model opus, subscription), translation-vs-reference harness unchanged', gate, agreement, dropped, by_model: {}, production_routed: {}, transfer: {} };
for (const m of MODELS) {
  const cells = Object.entries(page[m]).map(([id, o]) => ({ id, o }));
  summary.by_model[m] = { all: pool(cells), ...Object.fromEntries(SETS.map((s) => [s, pool(cells.filter((c) => meta[c.id].set === s))])) };
}
if (MODELS.length === 2) {
  const both = Object.keys(page.lite).filter((id) => page.flash[id]);
  const routed = both.map((id) => ({ id, o: page[meta[id].prod][id] }));
  summary.production_routed = { n_flash_pages: routed.filter((c) => meta[c.id].prod === 'flash').length, n_lite_pages: routed.filter((c) => meta[c.id].prod === 'lite').length, all: pool(routed), ...Object.fromEntries(SETS.map((s) => [s, pool(routed.filter((c) => meta[c.id].set === s))])) };
  // (c) does the Flash − Lite gap measured at temperature 0 equal the gap at temperature 1?
  const gap = (t, k) => both.map((id) => (page.flash[id][`${t}a`][k] + page.flash[id][`${t}b`][k]) / 2 - (page.lite[id][`${t}a`][k] + page.lite[id][`${t}b`][k]) / 2);
  const g1 = gap('T1', 'fid'); const g0 = gap('T0', 'fid'); const g02 = gap('T02', 'fid');
  summary.transfer = { n: both.length, flash_minus_lite_fidelity: { at_T1: est(g1), at_T02: est(g02), at_T0: est(g0) }, gap_T0_minus_gap_T1: est(g0.map((x, i) => x - g1[i])), gap_T02_minus_gap_T1: est(g02.map((x, i) => x - g1[i])),
    flash_minus_lite_reversals_per_100: { at_T1: est(gap('T1', 'rev'), 100), at_T0: est(gap('T0', 'rev'), 100) } };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ── print ──────────────────────────────────────────────────────────────────────────────────────────────────
const f = (e) => `${e.mean} [${e.ci[0]}, ${e.ci[1]}]`;
const show = (name, p) => {
  if (!p?.floor) { console.log(`\n## ${name}: n ${p?.n ?? 0}`); return; }
  console.log(`\n## ${name}: n ${p.n}; floor fid ${p.floor.fidelity} (T1b−T1a ${f(p.floor.T1b_minus_T1a_fidelity)}), rev ${p.floor.reversals_per_100}/100`);
  for (const [a, v] of Object.entries(p.arms)) console.log(`  ${a.padEnd(7)} fid ${f(v.fidelity)}  rev/100 ${f(v.reversals_per_100)}  ≥4 ${v.share_fid_ge4}  om/100 ${v.omission_per_100}  $/pg ${v.cost_per_page_realtime}`);
  for (const [k, v] of Object.entries(p.vs)) console.log(`  ${k.padEnd(24)} Δfid ${f(v.d_fidelity)}  Δrev/100 ${f(v.d_reversals_per_100)}  pages +${v.pages.up}/−${v.pages.down}/=${v.pages.tie}  beats:${v.beats_production ? v.by : 'no'}  not_worse:${v.not_worse}${v.transfers != null ? `  transfers:${v.transfers}` : ''}${v.two_draw_agrees != null ? `  two_draw_agrees:${v.two_draw_agrees}` : ''}`);
  console.log(`  movement ${JSON.stringify(p.movement)}`); if (p.picks) console.log(`  picks ${JSON.stringify(p.picks)}`);
};
console.log(`gate ${JSON.stringify(Object.fromEntries(Object.entries(gate).map(([m, g]) => [m, g.pass])))}; dropped ${JSON.stringify(Object.fromEntries(Object.entries(dropped).map(([m, d]) => [m, d.length])))}; rows ${rows.length}`);
for (const m of MODELS) for (const s of ['all', ...SETS]) show(`${m} / ${s}`, summary.by_model[m][s]);
if (summary.production_routed.all) for (const s of ['all', ...SETS]) show(`production-routed / ${s}`, summary.production_routed[s]);
if (summary.transfer.n) console.log(`\ntransfer ${JSON.stringify(summary.transfer)}`);
