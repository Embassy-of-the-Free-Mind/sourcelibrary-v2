// Librarian cite-by-ID (#6946) — unblind the X/Y preference judges for any arm pairs and apply the
// registered G3 (PREREGISTRATION.md).
// PRIOR ART: scripts/eval/librarian-speed-6904/score.mjs — the same unblinding and rule (two judges, a
// third on disagreement, the A-vs-A2 floor), written for the -AB and -AA pairs only; this reads the arms
// from key.json, so -BC and -CA pairs score the same way. α from lib/agreement-stats.mjs.
//
// Usage: node score-pref.mjs <judge dir> [--need-j3=<file>] [--json=<out>]
import fs from 'node:fs';
import path from 'node:path';
import { judgeReliability, reliabilityLine } from '../lib/agreement-stats.mjs';

const dir = process.argv[2];
const flag = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));

function read(pair, j) {
  const f = path.join(dir, 'out', `${pair}-${j}.json`);
  if (!fs.existsSync(f)) return null;
  const v = JSON.parse(fs.readFileSync(f, 'utf8'));
  const k = key[pair][j];
  return { win: v.verdict === 'tie' ? 'tie' : k[v.verdict], g: { [k.X]: !!v.grounding_failure_X, [k.Y]: !!v.grounding_failure_Y } };
}

const rows = [];
const disagree = [];
for (const pair of Object.keys(key).sort()) {
  const arms = [...new Set(Object.values(key[pair]).flatMap(k => [k.X, k.Y]))].sort();
  const kind = pair.slice(pair.lastIndexOf('-') + 1);
  const [j1, j2, j3] = ['J1', 'J2', 'J3'].map(j => read(pair, j));
  if (!j1 || !j2) { console.warn(`missing J1/J2 for ${pair}`); continue; }
  if (j1.win !== j2.win) disagree.push(pair);
  const final = j1.win === j2.win ? j1.win : j3?.win ?? null;
  const readers = [j1, j2, ...(j1.win !== j2.win && j3 ? [j3] : [])];
  const g = Object.fromEntries(arms.map(a => [a, readers.filter(r => r.g[a]).length * 2 > readers.length]));
  rows.push({ pair, kind, arms, j1: j1.win, j2: j2.win, j3: j3?.win ?? null, final, g, readers });
}
if (flag('need-j3')) fs.writeFileSync(flag('need-j3'), disagree.join('\n') + (disagree.length ? '\n' : ''));

const kinds = {};
for (const x of rows) {
  const t = (kinds[x.kind] ??= { n: 0, wins: {}, tie: 0, undecided: 0, onlyG: {}, bothG: 0, arms: x.arms });
  t.n++;
  if (x.final === null) t.undecided++;
  else if (x.final === 'tie') t.tie++;
  else t.wins[x.final] = (t.wins[x.final] ?? 0) + 1;
  const [a, b] = x.arms;
  if (x.g[a] && x.g[b]) t.bothG++;
  else if (x.g[a]) t.onlyG[a] = (t.onlyG[a] ?? 0) + 1;
  else if (x.g[b]) t.onlyG[b] = (t.onlyG[b] ?? 0) + 1;
}
for (const [k, t] of Object.entries(kinds)) {
  const [a, b] = t.arms;
  console.log(`${k} (n=${t.n}): ${a} ${t.wins[a] ?? 0}, ${b} ${t.wins[b] ?? 0}, tie ${t.tie}, undecided ${t.undecided}; grounding failure only-${a} ${t.onlyG[a] ?? 0}, only-${b} ${t.onlyG[b] ?? 0}, both ${t.bothG}`);
}

// G3: X's net loss against R over n, against the A-vs-A2 floor.
const aa = kinds.AA;
const floor = aa ? Math.max(Math.abs((aa.wins.A2 ?? 0) - (aa.wins.A ?? 0)) / aa.n, 1 / 8) : 1 / 8;
const g3 = {};
for (const [k, t] of Object.entries(kinds)) {
  if (k === 'AA') continue;
  // The newer arm is the one tested: B in AB, C in BC and CA.
  const x = k === 'AB' ? 'B' : 'C';
  const r = t.arms.find(a => a !== x);
  const loss = ((t.wins[r] ?? 0) - (t.wins[x] ?? 0)) / t.n;
  g3[`${x}vs${r}`] = { loss: +loss.toFixed(3), floor: +floor.toFixed(3), pass: loss <= floor && t.undecided === 0, wins: t.wins, tie: t.tie, onlyG: t.onlyG, bothG: t.bothG };
  console.log(`G3 ${x} vs ${r}: net loss ${loss.toFixed(3)} vs floor ${floor.toFixed(3)} → ${g3[`${x}vs${r}`].pass ? 'pass' : 'FAIL'}`);
}
console.log(reliabilityLine('preference (J1 vs J2)', judgeReliability(rows.map(x => [x.j1, x.j2])), 'pairs'));
console.log(reliabilityLine('grounding_failure (J1 vs J2)', judgeReliability(rows.flatMap(x => x.arms.map(a => [x.readers[0].g[a] ? 1 : 0, x.readers[1].g[a] ? 1 : 0]))), 'answers'));
console.log(`J1/J2 disagreed on ${disagree.length} of ${rows.length} pairs`);
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ kinds, floor, g3, rows }, null, 1));
