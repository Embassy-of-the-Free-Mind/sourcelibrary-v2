#!/usr/bin/env node
// The statistics behind /research/quality that the source runs did not compute: chance-corrected
// agreement for the judge, a threshold-free AUC and a held-out precision/recall for the two-read
// screen, Wilson intervals on the small counts, and the reader panel's sample-size table.
//
// PRIOR ART: translation-corpus-audit/score.mjs (the audit's own estimate and raw agreement — reused
// as is, not recomputed); two-read-garble-5313.mjs (the screen's in-sample sweep — its scores.jsonl
// is the input here); lib/paired-stats.mjs (bootstrap, no kappa/Wilson — those are in the new
// lib/agreement-stats.mjs). Nothing here calls a model or a database; it reads committed files only.
//
//   node scripts/eval/quality-paper-stats.mjs
// Writes scripts/eval/results/quality-paper-stats-2026-10-01/report.json and report.md.

import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from './lib/paired-stats.mjs';
import { wilson, nForHalfWidth, binaryAgreement, weightedKappa, aucLowerIsPositive, bootstrapItems } from './lib/agreement-stats.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const AUDIT = path.join(ROOT, 'results/translation-corpus-audit-2026-09-30');
const TWO_READ = path.join(ROOT, 'results/two-read-garble-5313-2026-09-30');
const OUT = path.join(ROOT, 'results/quality-paper-stats-2026-10-01');
const SEED = 20261001;

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const r3 = (x) => Math.round(x * 1000) / 1000;
const ci3 = ([a, b]) => [r3(a), r3(b)];

// ── 1. The judge: Opus vs Sonnet, and Opus vs itself ──────────────────────────────
const manifest = Object.fromEntries(readJsonl(path.join(AUDIT, 'manifest.jsonl')).map((m) => [m.id, m]));
function verdicts(judge) {
  const d = path.join(AUDIT, 'verdicts', judge);
  const out = {};
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(d, f))) out[v.id] = v;
  return out;
}
const opus = verdicts('opus'), sonnet = verdicts('sonnet');
const sound = (f) => f >= 4; // the audit's and the panel's cut: 4–5 sound, 1–3 defective

function judgePairs(pairs) {
  const rng = makeRng(SEED);
  const bin = (s) => binaryAgreement(s.map(([a, b]) => [sound(a), sound(b)]));
  const b = bin(pairs);
  return {
    n: pairs.length,
    exact: r3(pairs.filter(([a, b]) => a === b).length / pairs.length),
    weighted_kappa_quadratic: r3(weightedKappa(pairs)),
    weighted_kappa_quadratic_ci: ci3(bootstrapItems(pairs, (s) => weightedKappa(s), rng)),
    sound_vs_defective: {
      observed: r3(b.observed), kappa: r3(b.kappa), ac1: r3(b.ac1),
      kappa_ci: ci3(bootstrapItems(pairs, (s) => bin(s).kappa, rng)),
      ac1_ci: ci3(bootstrapItems(pairs, (s) => bin(s).ac1, rng)),
      share_sound_first: r3(b.positive_a), share_sound_second: r3(b.positive_b),
    },
  };
}
const interJudge = judgePairs(Object.keys(sonnet).filter((id) => manifest[id]?.kind === 'main' && opus[id]).map((id) => [opus[id].fidelity, sonnet[id].fidelity]));
const mainByPage = Object.fromEntries(Object.values(manifest).filter((m) => m.kind === 'main').map((m) => [m.page_id, m.id]));
const repeatPairs = Object.values(manifest).filter((m) => m.kind === 'repeat' && opus[m.id] && opus[mainByPage[m.page_id]])
  .map((m) => [opus[mainByPage[m.page_id]].fidelity, opus[m.id].fidelity]);
const repeat = judgePairs(repeatPairs);

// ── 2. The two-read screen: AUC (no threshold) and a held-out precision/recall ───
// Same pages and label as report.json's sweep: served text vs one fresh read, label = the judge's garble flag.
const scores = readJsonl(path.join(TWO_READ, 'scores.jsonl'));
const GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
function screen(kind) {
  const R = scores.filter((s) => s.kind === kind && s.judged && typeof s.garbled === 'boolean');
  const rng = makeRng(SEED);
  const auc = (rows) => aucLowerIsPositive(rows, (r) => r.ratio, (r) => r.garbled);
  const at = (rows, t) => {
    const tp = rows.filter((r) => r.ratio < t && r.garbled).length;
    return { tp, flagged: rows.filter((r) => r.ratio < t).length, pos: rows.filter((r) => r.garbled).length };
  };
  const f1 = (rows, t) => { const { tp, flagged, pos } = at(rows, t); return tp ? (2 * tp) / (flagged + pos) : 0; };
  // Repeated two-fold cross-validation: choose the threshold on one half (max F1), score it on the other.
  const prec = [], rec = [];
  for (let rep = 0; rep < 500; rep++) {
    const sh = R.map((r) => [rng(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    const h = Math.floor(sh.length / 2);
    for (const [train, test] of [[sh.slice(0, h), sh.slice(h)], [sh.slice(h), sh.slice(0, h)]]) {
      const t = GRID.reduce((best, g) => (f1(train, g) > f1(train, best) ? g : best), GRID[0]);
      const { tp, flagged, pos } = at(test, t);
      if (flagged && pos) { prec.push(tp / flagged); rec.push(tp / pos); }
    }
  }
  const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const inSample = at(R, 0.7);
  const k = binaryAgreement(R.map((r) => [r.ratio < 0.7, r.garbled]));
  return {
    pages: R.length, garbled: R.filter((r) => r.garbled).length,
    auc: r3(auc(R)), auc_ci: ci3(bootstrapItems(R, auc, rng)),
    in_sample_at_0_7: { precision: r3(inSample.tp / inSample.flagged), recall: r3(inSample.tp / inSample.pos), kappa: r3(k.kappa) },
    held_out_median: { precision: r3(med(prec)), recall: r3(med(rec)), note: 'threshold chosen on a random half by F1 over ' + GRID.join('/') + ', scored on the other half; median of 1,000 folds' },
  };
}
const screens = { lite: screen('pilot:served-vs-L'), flash: screen('pilot:served-vs-F') };

// ── 3. Wilson intervals for the small counts quoted on the page ────────────────────
// Counts are from the cited sources, not recomputed: experiment 5313 (leaf signature),
// eye-notes.md (20 pages read against their scans), report.md (controls).
const COUNTS = {
  leaf_signature_known_cases: { k: 6, n: 6, what: 'wrong-leaf pages known before the screen ran (#5311) that carry the signature; a seventh was found by it' },
  leaf_signature_flagged_were_wrong_leaf: { k: 7, n: 7, what: 'pages carrying the signature that proved, by eye, to show the wrong leaf' },
  leaf_signature_right_leaf_clear: { k: 258, n: 258, what: 'by-eye right-leaf pages with three usable reads that do NOT carry the signature' },
  wrong_leaf_in_eye_sample: { k: 2, n: 20, what: 'audited pages whose scan, read by a model, is a different page from the one transcribed' },
  judge_flags_confirmed: { k: 20, n: 21, what: 'defects the judge flagged that the model read of the scan confirmed (one unverifiable, none rejected)' },
  control_swap: { k: 15, n: 15, what: 'swapped translations rated 2 or lower' },
  control_drop: { k: 15, n: 15, what: 'translations with the middle third removed flagged as omission' },
  control_repeat_exact: { k: 11, n: 15, what: 'repeat items given the identical rating' },
};
const intervals = Object.fromEntries(Object.entries(COUNTS).map(([key, c]) => [key, { ...c, p: r3(c.k / c.n), ci: ci3(wilson(c.k, c.n)) }]));

// ── 4. Reader panel: how many answers each reported figure needs ─────────────────────
// Month 0 pool: the audit's main pages. The judge called 4–5 "sound", 1–3 "defective".
const mainVerdicts = Object.values(manifest).filter((m) => m.kind === 'main' && opus[m.id]).map((m) => opus[m.id]);
const defectiveShare = mainVerdicts.filter((v) => !sound(v.fidelity)).length / mainVerdicts.length;
const plan = [];
for (const h of [0.15, 0.10, 0.075, 0.05]) {
  for (const p of [0.9, 0.7, 0.5]) plan.push({ half_width: h, expected_agreement: p, answers_in_stratum: nForHalfWidth(p, h) });
}
const panel = {
  month0_pages: mainVerdicts.length,
  month0_defective: mainVerdicts.filter((v) => !sound(v.fidelity)).length,
  defective_share: r3(defectiveShare),
  answers_per_stratum: plan,
  random_order_total_for_40_defective: Math.ceil(40 / defectiveShare),
  note: 'answers_in_stratum = smallest n whose 95% Wilson interval has the given half-width at the expected agreement. Under random order, defective pages arrive at defective_share of answers.',
};

// ── Write ─────────────────────────────────────────────────────────────────────────
const report = { generated: '2026-10-01', seed: SEED, sources: { audit: path.relative(ROOT, AUDIT), two_read: path.relative(ROOT, TWO_READ) }, judge: { opus_vs_sonnet: interJudge, opus_vs_itself: repeat }, screen: screens, intervals, panel };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');

const pc = (x) => `${(x * 100).toFixed(1)}%`;
const ci = ([a, b]) => `${pc(a)}–${pc(b)}`;
let md = `# Statistics behind /research/quality — ${report.generated}\n\nGenerated by \`scripts/eval/quality-paper-stats.mjs\` from committed files only (seed ${SEED}). Measures here are agreement and screening statistics, not accuracy (eval-design §2).\n\n`;
md += `## The judge\n| pair | n | exact | weighted κ (quadratic) | sound/defective: observed | κ | AC1 |\n|---|---:|---:|---|---:|---|---|\n`;
for (const [name, j] of [['Opus vs Sonnet', interJudge], ['Opus vs itself (repeat control)', repeat]]) {
  md += `| ${name} | ${j.n} | ${pc(j.exact)} | ${j.weighted_kappa_quadratic} (${j.weighted_kappa_quadratic_ci.join('–')}) | ${pc(j.sound_vs_defective.observed)} | ${j.sound_vs_defective.kappa} (${j.sound_vs_defective.kappa_ci.join('–')}) | ${j.sound_vs_defective.ac1} (${j.sound_vs_defective.ac1_ci.join('–')}) |\n`;
}
md += `\nOpus called ${pc(interJudge.sound_vs_defective.share_sound_first)} of the shared pages sound, Sonnet ${pc(interJudge.sound_vs_defective.share_sound_second)}.\n\n`;
md += `## The two-read screen (label: the judge's garble flag)\n| fresh read | pages | garbled | AUC (95% CI) | in-sample @0.7 P / R | held-out P / R | κ @0.7 |\n|---|---:|---:|---|---|---|---:|\n`;
for (const [name, s] of Object.entries(screens)) md += `| ${name} | ${s.pages} | ${s.garbled} | ${s.auc} (${s.auc_ci.join('–')}) | ${pc(s.in_sample_at_0_7.precision)} / ${pc(s.in_sample_at_0_7.recall)} | ${pc(s.held_out_median.precision)} / ${pc(s.held_out_median.recall)} | ${s.in_sample_at_0_7.kappa} |\n`;
md += `\nHeld out: ${screens.lite.held_out_median.note}.\n\n## Wilson intervals on small counts\n| count | k/n | 95% CI | what |\n|---|---:|---|---|\n`;
for (const [key, c] of Object.entries(intervals)) md += `| ${key} | ${c.k}/${c.n} | ${ci(c.ci)} | ${c.what} |\n`;
md += `\n## Reader panel sample sizes\nMonth 0: ${panel.month0_pages} judged pages, ${panel.month0_defective} called defective (${pc(panel.defective_share)}). Under random order, 40 answers on defective pages take about ${panel.random_order_total_for_40_defective} answers in all.\n\n| ±half-width | agreement 90% | 70% | 50% |\n|---|---:|---:|---:|\n`;
for (const h of [0.15, 0.10, 0.075, 0.05]) md += `| ±${h * 100} pp | ${plan.filter((r) => r.half_width === h).map((r) => r.answers_in_stratum).join(' | ')} |\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);
