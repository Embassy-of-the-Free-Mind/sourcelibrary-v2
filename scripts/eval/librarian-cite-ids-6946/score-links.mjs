// Librarian cite-by-ID A/B/C (#6946) — per-link labels, two judges and a third on disagreements, then
// the registered gate (PREREGISTRATION.md) for B vs A, C vs A and C vs B.
// PRIOR ART: scripts/eval/librarian-cite-prompt-6946/score-links.mjs — the same J1/J2/J3 merge and gate
// for arms A/B/A2 only; this takes a third arm, gates each arm against a named reference, and adds the
// cite-ID accounting (IDs rendered/dropped, page links written by hand) and the cost per turn.
//
// Usage: node score-links.mjs <judge dir> <main.jsonl> [--need-j3=<file>] [--json=<out>] [--pref=<scored-pref.json>]
import fs from 'node:fs';
import path from 'node:path';

const [dir, mainFile] = process.argv.slice(2);
const flag = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const WRONG = new Set(['other', 'none']);
const TAGS = ['A', 'B', 'C', 'A2'];

function judged(tag, run, qid) {
  const f = path.join(dir, 'out', `${qid}-${tag}-${run}.json`);
  if (!fs.existsSync(f)) return null;
  return new Map((JSON.parse(fs.readFileSync(f, 'utf8')).links ?? []).map(l => [l.id, l]));
}

const needJ3 = [];
const perArm = {};
for (const tag of TAGS) {
  const lf = path.join(dir, `links-${tag}.json`);
  if (!fs.existsSync(lf)) continue;
  perArm[tag] = {};
  for (const [key, ls] of Object.entries(JSON.parse(fs.readFileSync(lf, 'utf8')))) {
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
  t.wrongPageRate = t.links ? +(t.wrongPage / t.links).toFixed(3) : null;
  t.wrongFactRate = t.links ? +(t.wrong_fact / t.links).toFixed(3) : null;
  return t;
}

const qs = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../librarian-speed-6904/questions.json'), 'utf8'));
const all = qs.questions.map(q => q.id).filter(q => ['A', 'B', 'C'].every(a => perArm[a]?.[q]));
const ctl = qs.aVsA.filter(q => perArm.A?.[q] && perArm.A2?.[q]);
const T = { A: tally('A', all), B: tally('B', all), C: tally('C', all), 'A (control)': tally('A', ctl), A2: tally('A2', ctl) };
console.log(`${all.length} questions with all three arms judged; ${ctl.length} control questions`);
console.table(T);

let n = 0, same = 0, binSame = 0, p1 = 0, p2 = 0;
for (const arm of Object.values(perArm)) for (const ls of Object.values(arm)) for (const l of ls ?? []) {
  const [a, b] = l.j;
  if (a === 'missing' || b === 'missing') continue;
  n++; if (a === b) same++;
  const x = WRONG.has(a), y = WRONG.has(b);
  if (x === y) binSame++; if (x) p1++; if (y) p2++;
}
const po = binSame / n, pe = (p1 / n) * (p2 / n) + (1 - p1 / n) * (1 - p2 / n);
const kappa = +((po - pe) / (1 - pe)).toFixed(2);
console.log(`J1 vs J2: ${n} links, label agreement ${(same / n).toFixed(2)}, wrong-page κ ${kappa}; answers needing J3: ${needJ3.length}`);

// Timing, cost, tokens and cite-ID accounting per arm, from the run rows.
const rows = fs.readFileSync(mainFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const pageLinks = s => [...(s ?? '').matchAll(/\]\(https:\/\/sourcelibrary\.org(?:\/es)?\/book\/[a-z0-9-]+(?:\/page-number\/|\?page=)\d+\)/g)].length;
const stats = arm => {
  const rs = rows.filter(r => r.arm === arm && (arm === 'A2' ? ctl : all).includes(r.id));
  const sum = f => rs.reduce((s, r) => s + (f(r) ?? 0), 0);
  return {
    n: rs.length,
    firstP50: pct(rs.map(r => r.firstTextMs ?? r.doneMs), 0.5), firstP90: pct(rs.map(r => r.firstTextMs ?? r.doneMs), 0.9),
    doneP50: pct(rs.map(r => r.doneMs), 0.5), doneP90: pct(rs.map(r => r.doneMs), 0.9),
    usdPerTurn: +(sum(r => r.cost) / rs.length).toFixed(4),
    promptTokP50: pct(rs.map(r => r.usage?.promptTokens ?? 0), 0.5), promptTokMean: Math.round(sum(r => r.usage?.promptTokens) / rs.length),
    thinkTokMean: Math.round(sum(r => r.usage?.thinkingTokens) / rs.length), rounds: +(sum(r => r.usage?.rounds) / rs.length).toFixed(2),
    idsRendered: sum(r => r.usage?.citeIds?.rendered), idsDropped: sum(r => r.usage?.citeIds?.dropped),
    // Page links in the raw text that no ID produced: the model wrote them by hand.
    handLinks: sum(r => (r.usage?.citeIds ? Math.max(0, pageLinks(r.raw) - r.usage.citeIds.rendered) : 0)),
  };
};
const timing = Object.fromEntries(TAGS.map(a => [a, stats(a)]));
console.table(timing);

// Gate (PREREGISTRATION.md).
const rel = (r, x) => (r ? (r - x) / r : 0);
const noiseWP = Math.abs(rel(T['A (control)'].wrongPage, T.A2.wrongPage));
const noiseWF = Math.abs(T['A (control)'].wrongFactRate - T.A2.wrongFactRate);
const pref = flag('pref') && fs.existsSync(flag('pref')) ? JSON.parse(fs.readFileSync(flag('pref'), 'utf8')).g3 : {};
function gate(x, r, { withTime = true } = {}) {
  const X = T[x], R = T[r];
  const drop = rel(R.wrongPage, X.wrongPage);
  const g = {
    G1: { [r]: R.wrongPage, [x]: X.wrongPage, drop: +drop.toFixed(3), need: +(0.40 + noiseWP).toFixed(3), pass: drop >= 0.40 + noiseWP },
    G2: { [r]: R.wrongFactRate, [x]: X.wrongFactRate, noise: +noiseWF.toFixed(3), pass: X.wrongFactRate <= R.wrongFactRate + noiseWF },
    G3: pref[`${x}vs${r}`] ?? { pass: null, note: 'preference not scored' },
    G6: { [r]: R.cited, [x]: X.cited, pass: X.cited >= 0.8 * R.cited },
  };
  if (withTime) g.G4 = { [r]: timing[r].doneP50, [x]: timing[x].doneP50, ratio: +(timing[x].doneP50 / timing[r].doneP50).toFixed(2), pass: timing[x].doneP50 <= 1.15 * timing[r].doneP50 };
  g.pass = Object.values(g).every(v => v.pass === true);
  return g;
}
const gates = { BvsA: gate('B', 'A'), CvsA: gate('C', 'A'), CvsB: gate('C', 'B', { withTime: false }) };
const spent = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
console.log(JSON.stringify({ noise: { wrongPage: +noiseWP.toFixed(3), wrongFact: +noiseWF.toFixed(3) }, gates, turns: rows.length, spentUsd: +spent.toFixed(3) }, null, 1));
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ T, kappa, timing, gates, perArm }, null, 1));
