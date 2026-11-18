#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/paddle-correct-6561/score.mjs ("flag signals": Kanripo dice and a 3.8 Flash-low second read,
 * each against Paddle's CER on its own Kanripo leaf). This scores the same question for Paddle disagreeing with itself
 * under other settings. Rules fixed in PREREG.md before the GPU ran.
 *
 *   node score.mjs [DIR]   (DIR = the task's lane dir; default /root/jobs/paddle-self-agree-6871) → DIR/results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { bodyText, foldHan, bodyCer } from '../ground-truth-5935/lib.mjs';
import { cer } from '../zh-skqs-5568-kanripo.mjs';
import { convertPaddle } from '../../lib/paddle-zh-lane.mjs';

// the transcription between the sentinels (copied from paddle-correct-6561/score.mjs, whose module runs on import)
function extract(row) {
  const t = String(row?.text || '');
  if (!t.trim()) return { status: 'did-not-read', text: '' };
  const m = t.match(/===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)(?:\n?===END===|$)/);
  return m ? { status: 'ok', text: m[1] } : { status: 'no-sentinel', text: t };
}
const J = process.argv[2] || '/root/jobs/paddle-self-agree-6871';
const MATERIAL = 0.05, FLAG = 0.05;   // a page is wrong above 5% CER vs its own leaf (#6388: no "material" page was at or under 5%)
const DITTO = /[｜|│┃]/g;
const hanOf = (t) => foldHan(bodyText(t).replace(DITTO, '丨'));
const readArm = (a, x) => { const f = path.join(J, a, 'out', x.bid, `${x.uid}.txt`); return fs.existsSync(f) ? convertPaddle(fs.readFileSync(f, 'utf8')).body : null; };
const dis = (a, b) => (a == null || b == null ? null : (cer(a, b) + cer(b, a)) / 2);   // symmetric, Han only

const rows = JSON.parse(fs.readFileSync(path.join(J, 'draw.json'), 'utf8')).map((x) => {
  const t = Object.fromEntries(['P', 'R', 'L', 'S'].map((a) => [a, readArm(a, x)]));
  if (t.P == null) return { ...x, missing: true };
  const h = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v == null ? null : hanOf(v)]));
  const truth = bodyCer(h.P, x.leaf, { expected: [...x.leaf].length }).cer;
  const fl = x.flashlow ? extract({ text: x.flashlow }) : null;
  const s = { dR: dis(h.P, h.R), dL: dis(h.P, h.L), dS: dis(h.P, h.S), dFlash: fl?.text ? dis(h.P, hanOf(fl.text)) : null };
  s.dMax = s.dL == null || s.dS == null ? null : Math.max(s.dL, s.dS);
  s.negDice = x.lane_dice == null ? null : 1 - x.lane_dice;
  return { uid: x.uid, stratum: x.stratum, truth, wrong: truth > MATERIAL, ...s, han: [...h.P].length };
});

const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(v.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; } return num / Math.sqrt(da * db); };
const auroc = (score, y) => { const pos = score.filter((_, i) => y[i]), neg = score.filter((_, i) => !y[i]); if (!pos.length || !neg.length) return null; let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0; return w / (pos.length * neg.length); };
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function evalSet(name, set, signals) {
  const out = { set: name, n: set.length, wrong: set.filter((x) => x.wrong).length, signals: {} };
  for (const k of signals) {
    const s = set.filter((x) => x[k] != null);
    const flagged = s.filter((x) => x[k] >= FLAG);
    out.signals[k] = { n: s.length, spearman: r3(spearman(s.map((x) => x[k]), s.map((x) => x.truth))), auroc: r3(auroc(s.map((x) => x[k]), s.map((x) => x.wrong))),
      flagged: flagged.length, precision: flagged.length ? r3(flagged.filter((x) => x.wrong).length / flagged.length) : null,
      recall: s.some((x) => x.wrong) ? r3(flagged.filter((x) => x.wrong).length / s.filter((x) => x.wrong).length) : null };
  }
  return out;
}
const ok = rows.filter((x) => !x.missing);
const SIG = ['dMax', 'dL', 'dS', 'dR', 'negDice'];
const res = {
  rule: PREREG_RULE(), missing: rows.filter((x) => x.missing).map((x) => x.uid),
  sets: [evalSet('R (random)', ok.filter((x) => x.stratum === 'R'), SIG), evalSet('R+L', ok.filter((x) => x.stratum !== 'F'), SIG),
    evalSet('F (has Flash-low)', ok.filter((x) => x.stratum === 'F'), [...SIG, 'dFlash'])],
  rows: ok.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v]))),
};
const RL = res.sets[1].signals.dMax, F = res.sets[2].signals;
res.verdict = {
  usable_flag: RL.auroc != null && RL.auroc >= 0.75 && RL.spearman >= 0.5,
  matches_flash: F.dMax.auroc != null && F.dFlash.auroc != null && F.dMax.auroc >= F.dFlash.auroc - 0.05,
};
fs.writeFileSync(path.join(J, 'results.json'), JSON.stringify(res, null, 1));
for (const s of res.sets) { console.log(`\n${s.set}: n ${s.n}, wrong (CER > 5%) ${s.wrong}`); for (const [k, v] of Object.entries(s.signals)) console.log(`  ${k.padEnd(7)} rho ${v.spearman}  AUROC ${v.auroc}  flagged ${v.flagged}  P ${v.precision}  R ${v.recall}`); }
console.log('\nverdict', JSON.stringify(res.verdict), res.missing.length ? `missing ${res.missing.length}` : '');
function PREREG_RULE() { return 'PREREG.md: primary signal dMax = max(dis(P,L), dis(P,S)); usable if AUROC >= 0.75 and Spearman >= 0.5 on R+L; matches Flash-low if AUROC(dMax) >= AUROC(dFlash) - 0.05 on F'; }
