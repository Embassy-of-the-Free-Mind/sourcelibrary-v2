/**
 * Librarian speed A/B (#6904) — unblind the judges and apply the registered rule.
 *
 * PRIOR ART: scripts/eval/agentic-qa-6182/score.py scores a different task's
 * X/Y verdicts; this applies PREREGISTRATION.md's rule (two judges, a third on
 * disagreement, A-vs-A floor) and uses lib/agreement-stats.mjs for α and
 * lib/paired-stats.mjs for the sign test.
 *
 * Usage: node scripts/eval/librarian-speed-6904/score.mjs <judge dir> [--need-j3=<file>]
 *   --need-j3 writes the pairs whose J1 and J2 verdicts differ (input for judge-driver.sh J3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeReliability, reliabilityLine } from '../lib/agreement-stats.mjs';
import { binomTwoSided } from '../lib/paired-stats.mjs';

const dir = process.argv[2];
const needJ3 = process.argv.find(a => a.startsWith('--need-j3='))?.slice(10);
const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));

function read(pair, j) {
  const f = path.join(dir, 'out', `${pair}-${j}.json`);
  if (!fs.existsSync(f)) return null;
  const v = JSON.parse(fs.readFileSync(f, 'utf8'));
  const k = key[pair][j];
  // Unblind: verdict as the winning ARM ('left' = A, 'right' = B or A2), grounding per arm.
  const win = v.verdict === 'tie' ? 'tie' : k[v.verdict];
  const g = { [k.X]: !!v.grounding_failure_X, [k.Y]: !!v.grounding_failure_Y };
  const why = { [k.X]: v.x_failures, [k.Y]: v.y_failures };
  return { win, g, why, reason: v.reason };
}

const rows = [];
const disagree = [];
for (const pair of Object.keys(key).sort()) {
  const other = pair.endsWith('-AB') ? 'B' : 'A2';
  const j1 = read(pair, 'J1');
  const j2 = read(pair, 'J2');
  const j3 = read(pair, 'J3');
  if (!j1 || !j2) { console.warn(`missing J1/J2 for ${pair}`); continue; }
  let final = j1.win === j2.win ? j1.win : j3?.win ?? null;
  if (j1.win !== j2.win) disagree.push(pair);
  const readers = [j1, j2, ...(j1.win !== j2.win && j3 ? [j3] : [])];
  const maj = arm => readers.filter(r => r.g[arm]).length * 2 > readers.length;
  rows.push({ pair, other, j1: j1.win, j2: j2.win, j3: j3?.win ?? null, final, gA: maj('A'), gO: maj(other), readers });
}

if (needJ3) fs.writeFileSync(needJ3, disagree.join('\n') + (disagree.length ? '\n' : ''));

function tally(kind) {
  const r = rows.filter(x => x.pair.endsWith(kind));
  const other = kind === '-AB' ? 'B' : 'A2';
  const t = { n: r.length, A: 0, other: 0, tie: 0, undecided: 0, onlyA: 0, onlyOther: 0, both: 0 };
  for (const x of r) {
    if (x.final === null) t.undecided++;
    else if (x.final === 'tie') t.tie++;
    else if (x.final === 'A') t.A++;
    else t.other++;
    if (x.gA && !x.gO) t.onlyA++;
    else if (!x.gA && x.gO) t.onlyOther++;
    else if (x.gA && x.gO) t.both++;
  }
  return { ...t, otherName: other };
}

const ab = tally('-AB');
const aa = tally('-AA');
console.log(`B vs A (n=${ab.n}): B wins ${ab.other}, A wins ${ab.A}, ties ${ab.tie}, undecided ${ab.undecided}`);
console.log(`  grounding failure: only A ${ab.onlyA}, only B ${ab.onlyOther}, both ${ab.both}`);
console.log(`A2 vs A (n=${aa.n}): A2 wins ${aa.other}, A wins ${aa.A}, ties ${aa.tie}, undecided ${aa.undecided}`);
console.log(`  grounding failure: only A ${aa.onlyA}, only A2 ${aa.onlyOther}, both ${aa.both}`);

// Registered rule.
const N = Math.max(Math.abs(aa.other - aa.A) / aa.n, 1 / 8);
const L = (ab.A - ab.other) / ab.n;
const decisive = ab.A + ab.other;
const p = decisive ? binomTwoSided(Math.min(ab.A, ab.other), decisive) : 1;
const groundingOk = ab.onlyOther <= ab.onlyA;
console.log(`noise floor N = ${N.toFixed(3)}; B net loss L = ${L.toFixed(3)} → ${L <= N ? 'within' : 'OUTSIDE'} the floor`);
console.log(`two-sided sign test on ${decisive} decisive pairs: p = ${p.toFixed(3)} (reported, not part of the rule)`);
console.log(`grounding: B-only ${ab.onlyOther} vs A-only ${ab.onlyA} → ${groundingOk ? 'ok' : 'FAILS'}`);
console.log(`QUALITY GATE: ${L <= N && groundingOk && ab.undecided === 0 ? 'PASS' : 'FAIL'}`);

// Judge agreement (eval-design §2): α on the preference and on the grounding flags, J1 vs J2.
const prefUnits = rows.map(x => [x.j1, x.j2]);
const gUnits = rows.flatMap(x => [x.readers[0].g, x.readers[1].g].length ? ['A', x.other].map(arm => [x.readers[0].g[arm], x.readers[1].g[arm]]) : []);
console.log(reliabilityLine('preference (J1 vs J2)', judgeReliability(prefUnits), 'pairs'));
console.log(reliabilityLine('grounding_failure (J1 vs J2)', judgeReliability(gUnits.map(u => u.map(v => (v ? 1 : 0)))), 'answers'));
console.log(`J1/J2 disagreed on ${disagree.length} of ${rows.length} pairs${disagree.length ? `: ${disagree.join(' ')}` : ''}`);

fs.writeFileSync(path.join(dir, 'scored.json'), JSON.stringify({ ab, aa, N, L, p, groundingOk, rows }, null, 2));
