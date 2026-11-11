#!/usr/bin/env node
// PRIOR ART: scripts/eval/engine-wave1-6011/analyze.mjs — the wave-1/2 summary (1 − median CER, page bootstrap of the
// median, bootCI); it reads its own wave's outputs only. This scores wave 2's Latin set with the new arms beside
// the committed engines, on the pages every wave-2 Latin engine aligned (wave 2's shared-page rule). #6011.
//   node scripts/eval/build-ocr-pareto.mjs --dump-rows=$JOB_SCRATCH/w/rows.json
//   node scripts/eval/benchmark-score.mjs --root=$JOB_SCRATCH/bench --out=$JOB_SCRATCH/scored
//   node scripts/eval/cheap-vlm-latin-6011/panel.mjs
// Latin panel: wave-2's 158-page most-pages set; shared pages = every wave-2 Latin engine aligned (wave 2's rule),
// then each engine scored as 1 − median CER with a page bootstrap of the median (engine-wave1-6011/analyze.mjs bootCI).
import fs from 'fs';
import { readBenchmarkRows } from '../lib/benchmark-rows.mjs';
import { readFailure } from '../../lib/read-failure.mjs';
const J = process.env.JOB_SCRATCH;
const S = new Set(JSON.parse(fs.readFileSync('/root/engine-wave2-6011/sets.json', 'utf8')).latin.pages);
const { rows } = readBenchmarkRows(`${J}/scored`);
const committed = JSON.parse(fs.readFileSync(`${J}/w/rows.json`, 'utf8')).latin;
const W2 = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'claude-sonnet-5-5', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'deepseek-ocr'];
const NEW = ['glm-5.3-flash', 'glm-5.3-flash-zai', 'qwen3.7-flash'];
const cell = new Map(); // page|engine -> {cer|null, aligned, fail}
for (const r of rows) {
  const page = `${r.stratum}|${r.slug}`; if (!S.has(page) || !r.referenced) continue;
  const fail = readFailure({ text: null, extracted: null, finishReason: r.finish_reason, cli: false, error: null, refused: r.refused, refusalSource: r.refusal_inferred ? 'inferred' : null, contentChars: r.content_chars });
  cell.set(`${page}|${r.engine}`, { cer: r.cer == null ? null : Math.min(1, r.cer), aligned: !!r.aligned && r.cer != null, fail: fail?.kind || null, src: 'rescore', loop: r.loop ?? null, row: r });
}
// Flash's EEBO texts are not on this box: take its committed cell (the chart's own scoring).
for (const c of committed) if (S.has(c.page) && !cell.has(`${c.page}|${c.engine}`) && W2.includes(c.engine))
  cell.set(`${c.page}|${c.engine}`, { cer: c.cer, aligned: c.cer != null && c.cer < 1, fail: c.failure, src: 'committed' });
const pages = [...S].filter(p => W2.every(e => cell.get(`${p}|${e}`)?.aligned && !cell.get(`${p}|${e}`)?.fail));
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let seed = 6011; const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const boot = xs => { const m = []; for (let b = 0; b < 2000; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); m.push(median(s)); } m.sort((a, b) => a - b); return [m[50], m[1949]]; };
const r3 = x => Math.round(x * 1000) / 1000;
const out = { n_set: S.size, n_shared: pages.length, engines: {} };
for (const e of [...W2, ...NEW]) {
  const cs = pages.map(p => cell.get(`${p}|${e}`));
  // a new arm's unaligned read is text it produced for the page: a scored 100% error (the chart's rule); a failed read is counted, not scored
  const cer = cs.filter(c => c && !c.fail).map(c => (c.aligned ? c.cer : 1));
  const ci = boot(cer);
  out.engines[e] = { n: cer.length, failed: cs.filter(c => c?.fail).length, unaligned: cs.filter(c => c && !c.fail && !c.aligned).length, catastrophic: cer.filter(x => x > 0.5).length,
    accuracy: r3(1 - median(cer)), ci95: [r3(1 - ci[1]), r3(1 - ci[0])], mean_accuracy: r3(1 - cer.reduce((a, b) => a + b, 0) / cer.length),
    loops: cs.filter(c => c?.row?.loop || c?.row?.looped).length };
}
// paired vs Flash: median per-page difference (new − Flash CER, negative = better), page bootstrap
for (const e of NEW) { const d = pages.map(p => { const a = cell.get(`${p}|${e}`), f = cell.get(`${p}|gemini-3-flash-preview`); return (a.aligned ? a.cer : 1) - f.cer; }); const ci = boot(d);
  out.engines[e].vs_flash = { wins: d.filter(x => x < 0).length, losses: d.filter(x => x > 0).length, median_dcer: r3(median(d)), ci95: [r3(ci[0]), r3(ci[1])] }; }
out.pages = pages;
fs.writeFileSync(`${J}/w/panel.json`, JSON.stringify(out, null, 1));
for (const [e, v] of Object.entries(out.engines)) console.log(e.padEnd(26), JSON.stringify({ ...v }));
console.log('shared', pages.length, 'committed cells used', [...cell.values()].filter(c => c.src === 'committed').length);
