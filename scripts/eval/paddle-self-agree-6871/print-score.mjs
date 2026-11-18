#!/usr/bin/env node
// Stage 2 scorer (PREREG-print.md): Opus verdicts by group, the three pass rules, the flag rate.
//   node print-score.mjs [DIR]  → DIR/results.json
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../ground-truth-5935/lib.mjs';

const DIR = process.argv[2] || '/root/jobs/paddle-self-agree-6871/print';
const key = JSON.parse(fs.readFileSync(path.join(DIR, 'judge/key.json'), 'utf8'));
const reads = new Map(fs.readFileSync(path.join(DIR, 'judge/opus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.json).map((r) => [r.uid, r.json]));
const flags = JSON.parse(fs.readFileSync(path.join(DIR, 'flags.json'), 'utf8')).filter((p) => p.d != null);
const bad = (v) => v === 'material' || v === 'unusable';
const groups = {};
for (const [uid, k] of Object.entries(key)) {
  const j = reads.get(uid); if (!j) continue;
  const g = groups[k.group] ||= { n: 0, clean: 0, minor: 0, material: 0, unusable: 0, bad: 0, caught: 0 };
  g.n++; g[j.verdict] = (g[j.verdict] || 0) + 1; if (bad(j.verdict)) g.bad++;
  if (k.planted) {
    const listed = (j.errors || []).map((e) => `${e.transcription || ''}|${e.page || ''}`).join(' ');
    const hits = k.planted.filter((p) => [...p.text].slice(0, 3).some((c) => listed.includes(c)) || (p.kind === 'delete' && listed.includes(p.text.slice(0, 2))));
    if (bad(j.verdict) || hits.length === k.planted.length) g.caught++;
  }
}
const F = groups.flagged || { n: 0, bad: 0 }, U = groups.unflagged || { n: 0, bad: 0 }, C = groups.control || { n: 0, caught: 0 };
const rF = F.n ? F.bad / F.n : null, rU = U.n ? U.bad / U.n : null;
const res = {
  flag_rate: { pages: flags.length, flagged: flags.filter((p) => p.d >= 0.05).length },
  drift_median: (() => { const s = flags.map((p) => p.drift).filter((x) => x != null).sort((a, b) => a - b); return s[s.length >> 1]; })(),
  groups, wilson: { flagged: F.n ? wilson(F.bad, F.n) : null, unflagged: U.n ? wilson(U.bad, U.n) : null },
  pass: { flagged_half_bad: rF != null && rF >= 0.5, ratio_2x: rF != null && rU != null && (rU === 0 ? rF > 0 : rF / rU >= 2), controls_all: C.n > 0 && C.caught === C.n },
  missing: Object.keys(key).filter((u) => !reads.has(u)),
};
res.pass.all = res.pass.flagged_half_bad && res.pass.ratio_2x && res.pass.controls_all;
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
