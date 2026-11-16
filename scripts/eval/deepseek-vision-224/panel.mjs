#!/usr/bin/env node
// PRIOR ART: scripts/eval/cheap-vlm-latin-6011/panel.mjs — this is that panel generalised from the Latin set to all eight wave-2 sets
// (same cells, same unaligned-is-100%-error and failed-read-not-scored rules, same page bootstrap of the median, seed 6011), one arm only. #224.
//   node scripts/eval/build-ocr-pareto.mjs --dump-rows=$JOB_SCRATCH/w/rows.json
//   node scripts/eval/benchmark-score.mjs --root=$JOB_SCRATCH/bench --refs-dir=$JOB_SCRATCH/refs --out=$JOB_SCRATCH/scored2   (refs = repo refs + the unpacked Chinese cohort bundle)
//   SYRIAC_IMAGES=$JOB_SCRATCH/bench SYRIAC_SCORE_OUT=$JOB_SCRATCH/syr/syriac-gt-score.json python3 score-syriac-retest.py   (R pointed at the GT text)
//   node scripts/eval/deepseek-vision-224/panel.mjs
// Shared pages per set: every engine that has a committed or re-scored cell on >= 90% of the set's pages, EXCEPT the antigravity-cli arms
// (a subscription route, not a chart reader), aligned and not failed. Each engine is then scored on the shared pages it has a cell for.
import fs from 'fs';
import { readBenchmarkRows } from '../lib/benchmark-rows.mjs';
import { readFailure } from '../../lib/read-failure.mjs';
const J = process.env.JOB_SCRATCH;
// #218: PANEL_ENGINE / PANEL_SCORED / PANEL_SYR / PANEL_OUT put another arm on the same panel; unset, the #224 run is unchanged.
const NEWENG = process.env.PANEL_ENGINE || 'deepseek-v4-1-flash';
const sets = JSON.parse(fs.readFileSync('/root/engine-wave2-6011/sets.json', 'utf8'));
const { rows } = readBenchmarkRows(process.env.PANEL_SCORED || `${J}/scored2`);
const committed = JSON.parse(fs.readFileSync(`${J}/w/rows.json`, 'utf8'));
const syr = JSON.parse(fs.readFileSync(process.env.PANEL_SYR || `${J}/syr/syriac-gt-score.json`, 'utf8'))['syriac-gt'];
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let seed = 6011; const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const boot = xs => { if (xs.length < 5) return [NaN, NaN]; const m = []; for (let b = 0; b < 2000; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); m.push(median(s)); } m.sort((a, b) => a - b); return [m[50], m[1949]]; };
const r3 = x => Math.round(x * 1000) / 1000;
const resc = new Map(); // page|engine -> cell
for (const r of rows) {
  if (!r.referenced) continue;
  const fail = readFailure({ text: null, extracted: null, finishReason: r.finish_reason, cli: false, error: null, refused: r.refused, refusalSource: r.refusal_inferred ? 'inferred' : null, contentChars: r.content_chars });
  resc.set(`${r.stratum}|${r.slug}|${r.engine}`, { cer: r.cer == null ? null : Math.min(1, r.cer), aligned: !!r.aligned && r.cer != null, fail: fail?.kind || null, src: 'rescore' });
}
const rescoredEngines = new Map(); for (const k of resc.keys()) { const [a, b, ...e] = k.split('|'); const pg = `${a}|${b}`; (rescoredEngines.get(pg) || rescoredEngines.set(pg, []).get(pg)).push(e.join('|')); }
const out = { arm: NEWENG, sets: {} };
const perPage = [];
for (const [set, s] of Object.entries(sets)) {
  const P = s.pages; const cell = new Map();
  for (const p of P) for (const e of new Set([NEWENG, ...(committed[set] || []).filter(c => c.page === p).map(c => c.engine), ...(rescoredEngines.get(p) || [])])) {
    let c;
    if (set === 'syriac' && e === NEWENG) { const x = syr.pages?.[p.split('|')[1]]?.[e] ?? syr.rows?.[p.split('|')[1]]?.[e]; c = x && x.cer_n2 != null ? { cer: Math.min(1, x.cer_n2), aligned: true, fail: null, src: 'syriac-gt' } : undefined; }
    else c = resc.get(`${p}|${e}`);
    if (!c) { const k = (committed[set] || []).find(z => z.page === p && z.engine === e); if (k) c = { cer: k.cer, aligned: k.cer != null && k.cer < 1, fail: k.failure, src: 'committed' }; }
    if (c) cell.set(`${p}|${e}`, c);
  }
  const cov = {}; for (const k of cell.keys()) { const e = k.split('|').slice(2).join('|'); cov[e] = (cov[e] || 0) + 1; }
  // Shared-page engines: the wave-2 readers and the two Gemini baselines, where they read at least half the set.
  const SHARE = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'claude-sonnet-5-5', 'claude-opus-5-5', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'deepseek-ocr'];
  const full = Object.keys(cov).filter(e => SHARE.includes(e) && cov[e] >= 0.5 * P.length);
  // The new arm is NOT in the rule: its unaligned read is a scored 100% error on a page the others aligned (the chart's rule, as in 6011).
  // Armenian (5 pages) and Syriac (40) are the two sets where a committed CER of 1 is a real scored result (a clamped, looped or unplaceable read:
  // wave 2 reports every Syriac engine at CER >= 0.5 on all 40 pages), so the strict rule would leave 0 shared pages. There a cell that exists and did not fail is shared.
  const RELAXED = ['armenian', 'syriac'].includes(set);
  // PANEL_ARM_PAGES=1 (#218): an arm run on a seeded part of a set is compared on the pages it was asked to read.
  const asked = process.env.PANEL_ARM_PAGES === '1' ? P.filter(p => cell.has(`${p}|${NEWENG}`)) : P;
  const pages = asked.filter(p => full.every(e => { const c = cell.get(`${p}|${e}`); return RELAXED ? !!c && !c.fail : c?.aligned && !c?.fail; }));
  const val = (p, e) => { const c = cell.get(`${p}|${e}`); return !c || c.fail ? undefined : (c.aligned ? c.cer : (RELAXED && c.cer != null ? c.cer : 1)); };
  const engines = {};
  for (const e of Object.keys(cov)) {
    const cs = pages.map(p => cell.get(`${p}|${e}`)); const v = pages.map(p => val(p, e)).filter(x => x !== undefined);
    if (v.length < 0.9 * pages.length && !(process.env.PANEL_VS || '').split(',').includes(e) && !(process.env.PANEL_VS && e === NEWENG)) continue; // a PANEL_VS baseline is kept on the shared pages it has, with its own n
    const ci = boot(v);
    engines[e] = { n: v.length, failed: cs.filter(c => c?.fail).length, unaligned: cs.filter(c => c && !c.fail && !c.aligned).length, accuracy: r3(1 - median(v)), ci95: [r3(1 - ci[1]), r3(1 - ci[0])], mean_accuracy: r3(1 - v.reduce((a, b) => a + b, 0) / v.length), cat_gt_0_5: v.filter(x => x > 0.5).length };
  }
  const dvs = e => { const d = pages.map(p => { const a = val(p, NEWENG), f = val(p, e); return a === undefined || f === undefined ? undefined : a - f; }).filter(x => x !== undefined); if (!d.length) return null; const ci = boot(d); return { n: d.length, worse: d.filter(x => x > 0).length, better: d.filter(x => x < 0).length, median_dcer: r3(median(d)), ci95: [r3(ci[0]), r3(ci[1])] }; };
  const flash = 'gemini-3-flash-preview';
  if (engines[NEWENG]) { if (engines[flash]) engines[NEWENG].vs_flash = dvs(flash); if (engines['deepseek-ocr']) engines[NEWENG].vs_deepseek_ocr = dvs('deepseek-ocr');
    for (const b of (process.env.PANEL_VS || '').split(',').filter(Boolean)) if (engines[b]) (engines[NEWENG].vs ||= {})[b] = dvs(b); }
  const best = Object.entries(engines).filter(([e, x]) => e !== NEWENG && x.n >= 0.9 * pages.length).sort((a, b) => b[1].accuracy - a[1].accuracy)[0];
  out.sets[set] = { n_set: P.length, n_shared: pages.length, shared_rule_engines: full, failed_ds: P.filter(p => cell.get(`${p}|${NEWENG}`)?.fail).length, best: best ? { engine: best[0], ...best[1] } : null, engines, pages, ds_cells_missing: P.filter(p => !cell.get(`${p}|${NEWENG}`)).length };
  for (const p of P) { const c = cell.get(`${p}|${NEWENG}`); if (c) perPage.push({ set, page: p, cer: c.aligned ? c.cer : 1, aligned: c.aligned, fail: c.fail }); }
}
out.worst10 = [...perPage].sort((a, b) => b.cer - a.cer).slice(0, 10);
const OUT = process.env.PANEL_OUT || `${J}/w`;
fs.writeFileSync(`${OUT}/panel.json`, JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/perpage.json`, JSON.stringify(perPage));
for (const [set, v] of Object.entries(out.sets)) {
  const d = v.engines[NEWENG]; const f = v.engines['gemini-3-flash-preview'], o = v.engines['deepseek-ocr'];
  console.log(set.padEnd(20), `n=${v.n_shared}/${v.n_set}`, 'DS', d ? `${d.accuracy} [${d.ci95}] fail ${d.failed} unal ${d.unaligned} vsFlash ${JSON.stringify(d.vs_flash)}` : 'none', '| best', v.best ? `${v.best.engine} ${v.best.accuracy}` : '-', '| flash', f?.accuracy, '| dsocr', o?.accuracy, '| missing', v.ds_cells_missing);
}
