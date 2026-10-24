// Librarian citation prompt A/B (#6946) — per-link labels, two judges and a third on disagreements,
// then the registered gate (PREREGISTRATION.md).
// PRIOR ART: scripts/eval/librarian-citations-6946/score.mjs reads the same judge output (one answer per
// packet, links-<tag>.json beside it) but scores each judge run on its own; this merges J1/J2/J3 into one
// label per link and compares arms. Preference and timing come from librarian-speed-6904/score.mjs and
// the run rows.
//
// Usage: node score-links.mjs <judge dir> <main.jsonl> [--need-j3=<file>] [--json=<out>]
//   --need-j3 writes the packet globs (<qid>-<arm>) where J1 and J2 differ on any link.
import fs from 'node:fs';
import path from 'node:path';

const [dir, mainFile] = process.argv.slice(2);
const flag = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const WRONG = new Set(['other', 'none']);
const LABELS = ['cited', 'other', 'none', 'wrong_fact', 'missing'];

function judged(tag, run, qid) {
  const f = path.join(dir, 'out', `${qid}-${tag}-${run}.json`);
  if (!fs.existsSync(f)) return null;
  return new Map((JSON.parse(fs.readFileSync(f, 'utf8')).links ?? []).map(l => [l.id, l]));
}

const needJ3 = [];
const perArm = {};
for (const tag of ['A', 'B', 'A2']) {
  const lf = path.join(dir, `links-${tag}.json`);
  if (!fs.existsSync(lf)) continue;
  const links = JSON.parse(fs.readFileSync(lf, 'utf8'));
  perArm[tag] = {};
  for (const [key, ls] of Object.entries(links)) {
    const qid = key.replace(/:.*/, '');
    if (ls.length === 0) { perArm[tag][qid] = []; continue; }
    const [j1, j2, j3] = ['J1', 'J2', 'J3'].map(r => judged(tag, r, qid));
    if (!j1 || !j2) { perArm[tag][qid] = null; continue; }
    let split = false;
    perArm[tag][qid] = ls.map(l => {
      const a = j1.get(l.id)?.label ?? 'unlabelled', b = j2.get(l.id)?.label ?? 'unlabelled';
      if (a === b) return { ...l, label: a, j: [a, b] };
      split = true;
      const c = j3?.get(l.id)?.label;
      // Third judge decides a split; with no third reading yet the link is undecided.
      return { ...l, label: c ?? 'undecided', j: [a, b, c] };
    });
    if (split) needJ3.push(`${qid}-${tag}`);
  }
}
if (flag('need-j3')) fs.writeFileSync(flag('need-j3'), needJ3.join('\n') + (needJ3.length ? '\n' : ''));

function tally(arm, qids) {
  const t = { answers: 0, links: 0, cited: 0, other: 0, none: 0, wrong_fact: 0, missing: 0, undecided: 0, unlabelled: 0, answersWrongPage: 0 };
  for (const q of qids) {
    const ls = perArm[arm]?.[q];
    if (!ls) continue;
    t.answers++;
    let w = false;
    for (const l of ls) { t[l.label] = (t[l.label] ?? 0) + 1; if (WRONG.has(l.label)) w = true; }
    if (w) t.answersWrongPage++;
  }
  t.links = t.cited + t.other + t.none + t.wrong_fact;
  t.wrongPage = t.other + t.none;
  t.wrongPageRate = t.links ? t.wrongPage / t.links : null;
  t.wrongFactRate = t.links ? t.wrong_fact / t.links : null;
  return t;
}

const qs = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../librarian-speed-6904/questions.json'), 'utf8'));
const all = qs.questions.map(q => q.id).filter(q => perArm.A?.[q] && perArm.B?.[q]);
const ctl = qs.aVsA.filter(q => perArm.A?.[q] && perArm.A2?.[q]);
const A = tally('A', all), B = tally('B', all), Ac = tally('A', ctl), A2 = tally('A2', ctl);
console.table({ A, B, 'A (control 8)': Ac, A2 });

// Judge agreement (J1 vs J2) over every link of every arm.
let n = 0, same = 0, binSame = 0, p1 = 0, p2 = 0;
for (const arm of Object.values(perArm)) for (const ls of Object.values(arm)) for (const l of ls ?? []) {
  const [a, b] = l.j;
  if (a === 'missing' || b === 'missing') continue;
  n++; if (a === b) same++;
  const x = WRONG.has(a), y = WRONG.has(b);
  if (x === y) binSame++; if (x) p1++; if (y) p2++;
}
const po = binSame / n, pe = (p1 / n) * (p2 / n) + (1 - p1 / n) * (1 - p2 / n);
console.log(`J1 vs J2: ${n} links, label agreement ${(same / n).toFixed(2)}, wrong-page κ ${((po - pe) / (1 - pe)).toFixed(2)}; packets needing J3: ${needJ3.length}`);

// Gate (PREREGISTRATION.md).
const rel = (x, y) => (x ? (x - y) / x : 0);
const noiseWP = Math.abs(rel(Ac.wrongPage, A2.wrongPage));
const noiseWF = Math.abs(Ac.wrongFactRate - A2.wrongFactRate);
const drop = rel(A.wrongPage, B.wrongPage);
const g1 = drop >= 0.30 + noiseWP;
const g2 = B.wrongFactRate <= A.wrongFactRate + noiseWF;
const g5 = B.cited >= 0.8 * A.cited;

// Timing: p50 time to done per arm, from the run rows.
const rows = fs.readFileSync(mainFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const t = arm => rows.filter(r => r.arm === arm && all.includes(r.id));
const timing = Object.fromEntries(['A', 'B', 'A2'].map(arm => [arm, {
  n: t(arm).length, firstP50: pct(t(arm).map(r => r.firstTextMs ?? r.doneMs), 0.5), firstP90: pct(t(arm).map(r => r.firstTextMs ?? r.doneMs), 0.9),
  doneP50: pct(t(arm).map(r => r.doneMs), 0.5), doneP90: pct(t(arm).map(r => r.doneMs), 0.9),
  cost: +t(arm).reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(3),
}]));
console.table(timing);
const g4 = timing.B.doneP50 <= 1.10 * timing.A.doneP50;
const spent = rows.reduce((s, r) => s + (r.cost ?? 0), 0);

const gate = {
  wrongPage: { A: A.wrongPage, B: B.wrongPage, drop: +drop.toFixed(3), noise: +noiseWP.toFixed(3), need: +(0.30 + noiseWP).toFixed(3), pass: g1 },
  wrongFact: { A: +A.wrongFactRate.toFixed(3), B: +B.wrongFactRate.toFixed(3), noise: +noiseWF.toFixed(3), pass: g2 },
  citedKept: { A: A.cited, B: B.cited, pass: g5 },
  doneP50: { A: timing.A.doneP50, B: timing.B.doneP50, pass: g4 },
  preference: 'librarian-speed-6904/score.mjs (registered: net loss ≤ floor, B-only grounding failures ≤ A-only)',
  turns: rows.length, spentUsd: +spent.toFixed(3),
};
console.log(JSON.stringify(gate, null, 1));
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ A, B, Ac, A2, timing, gate, perArm }, null, 1));
