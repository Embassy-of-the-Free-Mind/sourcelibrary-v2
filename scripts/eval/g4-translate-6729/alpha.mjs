// PRIOR ART: scripts/eval/lib/agreement-stats.mjs (judgeReliability / reliabilityLine, PR #6730) and
// scripts/eval/lib/paired-stats.mjs (makeRng). This only exposes them to score.py: stdin JSON
// {name: {level, units: [{cluster, values}]}}, stdout JSON {name: {...judgeReliability, line}}.
import { judgeReliability, reliabilityLine } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const d = JSON.parse(await new Promise((res) => { let s = ''; process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => res(s)); }));
const out = {};
for (const [name, { level, units, unit }] of Object.entries(d)) {
  const r = judgeReliability(units, { level, rng: makeRng(6729), iters: 2000 });
  out[name] = { ...r, line: reliabilityLine(name, r, unit || 'units') };
}
process.stdout.write(JSON.stringify(out));
