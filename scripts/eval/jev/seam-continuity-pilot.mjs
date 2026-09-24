#!/usr/bin/env node
// PRIOR ART: scripts/eval/jev/instruction-page-pilot.py (branch docs/jev-pilot, PR #5006) — the Jev call
// shape (gateway URL, OIDC bearer, {model, state, questions:{k:{type:'noul',instructions}}} → answers[k].noul)
// is copied from it. It does not fit as-is: it screens single pages for a topic; this asks a PAIRED
// continuity question over the blinded junction packet of scripts/eval/translation-batch-shadow-judge.mjs
// and scores agreement against the eight Sonnet judges' verdicts already on disk. Also checked:
// scripts/eval/jev/jevlib.py (same call, Python), scripts/eval/lib/paired-stats.mjs (stats, imported).
/**
 * seam-continuity-pilot — can Jev (TypeSafe System One, typed yes/no probabilities, ~$0.04/M input
 * tokens, 0.2 s) stand in for a Claude judge on the page-break continuity question?
 *
 * Calibration set: today's blinded packet (48 junctions: 32 lane-vs-production, 16 same-lane A/A)
 * and the merged verdicts of eight independent Sonnet judges (LEFT/RIGHT/TIE). Jev never sees the
 * key or the verdicts. Per junction, four noul questions:
 *   side_L, side_R   — one call per side: "this junction reads as one translator continuing…"
 *   pair_L, pair_R   — one call with both sides: "LEFT continues better than RIGHT" / the reverse
 * Report: agreement with the judges (3-class with a tie band, and LEFT/RIGHT among decided), Cohen's
 * kappa, AUC of the paired margin, and Jev's behaviour on the A/A pairs (it should split ~evenly).
 *
 *   VERCEL_OIDC_TOKEN from `npx vercel env pull <file> --environment=development --yes`
 *   node --env-file=<that file> scripts/eval/jev/seam-continuity-pilot.mjs [--tie=0.10] [--limit=N]
 *
 * Writes scripts/eval/results/jev-seam-continuity-pilot-<date>.json. Spend: ~200 calls, about a cent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { binomTwoSided } from '../lib/paired-stats.mjs';

const R = new URL('../results/', import.meta.url).pathname;
const TOK = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!TOK) { console.error('need VERCEL_OIDC_TOKEN (vercel env pull) or AI_GATEWAY_API_KEY'); process.exit(1); }
const args = process.argv.slice(2);
const arg = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const TIE = Number(arg('tie', '0.10'));
const LIMIT = Number(arg('limit', '1000'));

const QUESTION = 'The passage shows the end of one page and the start of the next page of a translation, separated by a page-break marker. It reads as ONE translator continuing across the page break: a sentence carried across the break is picked up correctly, the same names and the same terms are used on both sides, and the register does not change.';
const PAIR_L = 'LEFT and RIGHT are two translations of the same page break (end of one page, start of the next). LEFT reads as one translator continuing across the break — a carried sentence picked up correctly, same names, same terms, same register — MORE convincingly than RIGHT does.';
const PAIR_R = PAIR_L.replace('LEFT reads', 'RIGHT reads').replace('than RIGHT does', 'than LEFT does');

async function jev(state, questions) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev', state: state.slice(0, 12000), questions }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 800 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return { p: Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul])), tokens: j.usage?.input_tokens ?? 0, usd: Number(j.provider_metadata?.gateway?.marketCost ?? 0) };
  }
  throw new Error('jev: gave up after 4 attempts');
}

const packet = fs.readFileSync(path.join(R, 'translation-batch-shadow-judge-packet.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const key = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(R, 'translation-batch-shadow-judge-key.json'), 'utf8')).key.map((k) => [k.id, k]));
const verdicts = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(R, 'translation-batch-shadow-judge-verdicts.json'), 'utf8')).map((v) => [v.id, String(v.verdict).toUpperCase()]));

const rows = [];
let tokens = 0, usd = 0;
for (const e of packet.slice(0, LIMIT)) {
  const [l, r, pair] = await Promise.all([
    jev(e.left, { c: { type: 'noul', instructions: QUESTION } }),
    jev(e.right, { c: { type: 'noul', instructions: QUESTION } }),
    jev(`LEFT:\n${e.left}\n\n=====\n\nRIGHT:\n${e.right}`, { L: { type: 'noul', instructions: PAIR_L }, R: { type: 'noul', instructions: PAIR_R } }),
  ]);
  tokens += l.tokens + r.tokens + pair.tokens; usd += l.usd + r.usd + pair.usd;
  const sideMargin = l.p.c - r.p.c, pairMargin = pair.p.L - pair.p.R;
  const call = (m) => (Math.abs(m) < TIE ? 'TIE' : m > 0 ? 'LEFT' : 'RIGHT');
  rows.push({ id: e.id, language: e.language, pair: key[e.id].pair, s1_repaired: key[e.id].s1_repaired, judge: verdicts[e.id] ?? null,
    side_L: +l.p.c.toFixed(3), side_R: +r.p.c.toFixed(3), pair_L: +pair.p.L.toFixed(3), pair_R: +pair.p.R.toFixed(3),
    jev_side: call(sideMargin), jev_pair: call(pairMargin), side_margin: +sideMargin.toFixed(3), pair_margin: +pairMargin.toFixed(3) });
  process.stdout.write(`\r${rows.length}/${Math.min(packet.length, LIMIT)} junctions, ${tokens} tokens, $${usd.toFixed(4)}   `);
}
console.log();

// ── agreement ──────────────────────────────────────────────────────────────
const judged = rows.filter((r) => r.judge);
function agreement(field) {
  const n = judged.length; let exact = 0;
  const conf = {}; for (const r of judged) { conf[`${r.judge}|${r[field]}`] = (conf[`${r.judge}|${r[field]}`] || 0) + 1; if (r.judge === r[field]) exact++; }
  // Cohen's kappa over 3 classes
  const classes = ['LEFT', 'RIGHT', 'TIE'];
  const pj = Object.fromEntries(classes.map((c) => [c, judged.filter((r) => r.judge === c).length / n]));
  const pv = Object.fromEntries(classes.map((c) => [c, judged.filter((r) => r[field] === c).length / n]));
  const pe = classes.reduce((s, c) => s + pj[c] * pv[c], 0), po = exact / n;
  const decided = judged.filter((r) => r.judge !== 'TIE' && r[field] !== 'TIE');
  const sameSide = decided.filter((r) => r.judge === r[field]).length;
  return { n, exact_agreement: +(po).toFixed(3), kappa: +((po - pe) / (1 - pe)).toFixed(3), both_decided: decided.length, same_side_of_decided: sameSide, same_side_rate: decided.length ? +(sameSide / decided.length).toFixed(3) : null, confusion: conf };
}
// AUC of a margin for predicting judge LEFT (vs RIGHT) among judge-decided junctions
function auc(field) {
  const d = judged.filter((r) => r.judge !== 'TIE'); const pos = d.filter((r) => r.judge === 'LEFT'), neg = d.filter((r) => r.judge === 'RIGHT');
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const p of pos) for (const q of neg) s += p[field] > q[field] ? 1 : p[field] === q[field] ? 0.5 : 0;
  return { auc: +(s / (pos.length * neg.length)).toFixed(3), left: pos.length, right: neg.length };
}
const aa = rows.filter((r) => r.pair === 'S1/S2');
const aaSummary = { n: aa.length, jev_pair_ties: aa.filter((r) => r.jev_pair === 'TIE').length, jev_pair_left: aa.filter((r) => r.jev_pair === 'LEFT').length, jev_pair_right: aa.filter((r) => r.jev_pair === 'RIGHT').length, mean_abs_pair_margin: +(aa.reduce((s, r) => s + Math.abs(r.pair_margin), 0) / Math.max(1, aa.length)).toFixed(3) };
// Jev's own verdict on the experiment, by arm (unblinded with the key, after the fact)
function armView(field) {
  const out = {};
  for (const label of ['S1/P', 'S1/S2']) {
    const rs = rows.filter((r) => r.pair === label && (label !== 'S1/P' || r.s1_repaired !== false));
    const win = { S1: 0, other: 0, TIE: 0 };
    for (const r of rs) { const v = r[field]; if (v === 'TIE') win.TIE++; else { const arm = v === 'LEFT' ? key[r.id].left : key[r.id].right; if (arm === 'S1') win.S1++; else win.other++; } }
    out[label] = win;
  }
  return out;
}
const report = { date: new Date().toISOString().slice(0, 10), tie_band: TIE, junctions: rows.length, tokens, usd: +usd.toFixed(4), agreement_pair: agreement('jev_pair'), agreement_side: agreement('jev_side'), auc_pair_margin: auc('pair_margin'), auc_side_margin: auc('side_margin'), aa_pairs: aaSummary, jev_by_arm_pair: armView('jev_pair'), rows };
fs.writeFileSync(path.join(R, `jev-seam-continuity-pilot-${report.date}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 1));
console.log(`\nA/A control: Jev pair verdicts on the same lane twice — ties ${aaSummary.jev_pair_ties}, LEFT ${aaSummary.jev_pair_left}, RIGHT ${aaSummary.jev_pair_right} (binomial p of the split ${aa.length ? binomTwoSided(Math.min(aaSummary.jev_pair_left, aaSummary.jev_pair_right), aaSummary.jev_pair_left + aaSummary.jev_pair_right).toFixed(3) : '-'})`);
