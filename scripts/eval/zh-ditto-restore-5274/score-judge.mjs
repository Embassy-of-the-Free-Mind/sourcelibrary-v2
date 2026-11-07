#!/usr/bin/env node
// PRIOR ART: scripts/eval/flash-reread-5924/w-score.mjs (the counts of a three-text blind reader, tied to that job's packets
// and its Latin bars). Same counts here, unblinded through key.json, with the swap controls and the sign test.
/**
 * score-judge.mjs [judge dir name ...] — misleading/flawed/sound per arm, pairwise preference, swap controls.
 * Reads $JOB_SCRATCH/w/<dir>; writes results/zh-ditto-restore-5274/judge-<dir>.json (with the per-page verdicts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../ground-truth-5935/lib.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = path.join(process.env.JOB_SCRATCH, 'w');
const signP = (a, b) => { const n = a + b, k = Math.min(a, b); let c = 1, s = 0; for (let i = 0; i <= k; i++) { s += c; c = c * (n - i) / (i + 1); } return Math.min(1, 2 * s / 2 ** n); };
for (const dir of process.argv.slice(2).length ? process.argv.slice(2) : ['judge', 'judge2']) {
  const key = JSON.parse(fs.readFileSync(path.join(W, dir, 'key.json'), 'utf8'));
  const rows = [], out = { arms: {}, pairs: {}, swaps: [], no_answer: [] };
  for (const [uid, k] of Object.entries(key)) {
    const v = JSON.parse(fs.readFileSync(path.join(W, dir, `${uid}.json`), 'utf8')).verdict;
    if (!v) { out.no_answer.push(uid); continue; }
    const labels = Object.keys(k.labels);
    const by = Object.fromEntries(labels.map((l) => [k.labels[l], v[l]]));
    if (k.swap) { const sw = by[k.swap.arm]; out.swaps.push({ uid, arm: k.swap.arm, verdict: sw?.verdict, not_this_leaf: sw?.not_this_leaf ?? null, others: labels.filter((l) => k.labels[l] !== k.swap.arm).map((l) => `${k.labels[l]}:${v[l]?.verdict}`) }); continue; }
    const set = uid.startsWith('keep') ? 'keep' : 'zero';
    rows.push({ uid, set, verdicts: Object.fromEntries(Object.entries(by).map(([a, x]) => [a, x?.verdict])), why: v.why, defects: Object.fromEntries(Object.entries(by).map(([a, x]) => [a, (x?.defects || []).slice(0, 5)])) });
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const pk = `${labels[i]}${labels[j]}`, a = k.labels[labels[i]], b = k.labels[labels[j]]; const name = [a, b].sort().join(' vs ');
      const pr = v[pk]?.prefer; const win = pr === labels[i] ? a : pr === labels[j] ? b : 'tie';
      out.pairs[set] ??= {}; out.pairs[set][name] ??= { tie: 0 }; out.pairs[set][name][win] = (out.pairs[set][name][win] || 0) + 1;
    }
  }
  for (const set of ['zero', 'keep']) for (const a of Object.keys(rows[0].verdicts)) {
    const R = rows.filter((r) => r.set === set); const c = { n: R.length, misleading: 0, flawed: 0, sound: 0 };
    for (const r of R) c[r.verdicts[a]] = (c[r.verdicts[a]] || 0) + 1;
    c.misleading_ci = wilson(c.misleading, c.n); out.arms[`${a}|${set}`] = c;
  }
  for (const set of Object.keys(out.pairs)) for (const [name, x] of Object.entries(out.pairs[set])) { const [a, b] = name.split(' vs '); x.p_sign = +signP(x[a] || 0, x[b] || 0).toFixed(5); }
  out.pages = rows;
  fs.writeFileSync(path.join(HERE, `../results/zh-ditto-restore-5274/judge-${dir}.json`), JSON.stringify(out, null, 1));
  console.log(dir, JSON.stringify(out.arms)); console.log(JSON.stringify(out.pairs)); console.log(out.swaps.map((s) => `${s.uid.slice(0, 5)} ${s.arm} → ${s.verdict}/${s.not_this_leaf}`).join('; '), 'no answer', out.no_answer);
}
