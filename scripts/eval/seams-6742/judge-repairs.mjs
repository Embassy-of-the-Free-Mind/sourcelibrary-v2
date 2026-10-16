#!/usr/bin/env node
// PRIOR ART: scripts/eval/results/seam-ab-5678/JUDGE-PROMPT.md (blind source-grounded page-turn judge over lettered
// versions) — its version-blind framing and "tie" outcome are kept; this judge sees two versions of ONE stored join
// (current vs a boundary-only repair) and is run in both orders with an A/A floor, which seam-ab did not need.
/**
 * judge-repairs — blind Opus pairwise judge: current join vs repaired join, both orders, A/A floor (#6742).
 *
 *   node scripts/eval/seams-6742/judge-repairs.mjs build --out=DIR [--arms=opus,R1,R2,R3]
 *   node scripts/eval/seams-6742/judge-repairs.mjs run   --out=DIR [--conc=6]
 *
 * build: for every item in repair-set.json and every arm, apply the arm's repair to the excerpts (an invalid or null
 * repair leaves the text unchanged and is not judged — it is scored as "unchanged"). Pairs (current, repaired) go in
 * both orders; 40 A/A pairs (current, current) go in both orders. Pairs are shuffled into packets of 5.
 * run: one CLI call per packet, resumable.
 */
import fs from 'fs';
import path from 'path';
import { claudeCall, extractJson, pool, shuffle } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const PACKET = 5;

/** Apply a {tail_old, tail_new, head_old, head_new} repair to an item's English excerpts, or null if it does not apply. */
export function applyRepair(it, rep) {
  if (!rep) return null;
  let a = it.enTailA, b = it.enHeadB;
  const tOld = (rep.tail_old || '').trimEnd(), hOld = (rep.head_old || '').trimStart();
  if (tOld) { const t = a.trimEnd(); if (!t.endsWith(tOld)) return null; a = t.slice(0, t.length - tOld.length) + (rep.tail_new ?? ''); }
  if (hOld) { const h = b.trimStart(); if (!h.startsWith(hOld)) return null; b = (rep.head_new ?? '') + h.slice(hOld.length); }
  if (a === it.enTailA && b === it.enHeadB) return null;
  return { enTailA: a, enHeadB: b };
}

export const JUDGE = `You are judging English translations of historical books at ONE place only: the page turn between
source page N and source page N+1. For each PAIR below you get the SOURCE (end of page N, start of page N+1; OCR, may
be cut at "…") and two VERSIONS, P and Q, each giving the English of the end of page N and the start of page N+1.

The versions were made by different processes; you are not told which is which and must not guess. They may be
identical. Judge only the turn: read the end of N's English straight into the start of N+1's English, against the
source. The better version is the one where every source word near the turn is rendered once, on its own page,
faithfully, and the turn reads as correct English. A page ending mid-sentence where the source does is fine. A
hyphen-split word translated whole on page N, or a catchword left untranslated, is fine. If neither is better at the
turn (including when they are the same), say "tie".

For each pair, reply with:
{"pair":"<pair id>","better":"P"|"Q"|"tie","P_defect":true|false,"Q_defect":true|false,"note":"<= 20 words"}
(X_defect: that version still has a defect at the turn — an omission, duplication, words on the wrong page, invented
words, or a broken sentence.)

Reply with ONE JSON array containing one object per pair, in order, and nothing else.`;

const block = (label, v) => `--- VERSION ${label}: English, end of page N ---\n${v.enTailA}\n--- VERSION ${label}: English, start of page N+1 ---\n${v.enHeadB}`;
const pairText = (p) => `##### PAIR ${p.pair}\n--- SOURCE, end of page N ---\n${p.srcTailA}\n--- SOURCE, start of page N+1 ---\n${p.srcHeadB}\n${block('P', p.P)}\n${block('Q', p.Q)}`;

function build(out, arms) {
  const items = new Map(readJsonl(path.join(out, 'items.jsonl')).map(x => [x.id, x]));
  const set = JSON.parse(fs.readFileSync(path.join(out, 'repair-set.json'), 'utf8'));
  const ids = [...set.bad, ...set.ok];
  const reps = {
    opus: new Map(readJsonl(path.join(out, 'labels.jsonl')).filter(x => x.parsed).map(x => [x.id, x.repair])),
    ...Object.fromEntries(arms.filter(a => a !== 'opus').map(a => [a, new Map(readJsonl(path.join(out, `repair-${a}.jsonl`)).filter(x => x.parsed).map(x => [x.id, x.defect === false ? null : x.repair]))])),
  };
  const pairs = [], unchanged = [];
  const rand = makeRng(5);
  for (const id of ids) {
    const it = items.get(id);
    const cur = { enTailA: it.enTailA, enHeadB: it.enHeadB };
    for (const arm of arms) {
      const rep = reps[arm].get(id);
      const fixed = applyRepair(it, rep);
      if (!fixed) { unchanged.push({ id, arm, why: rep ? 'repair-did-not-apply' : 'no-repair' }); continue; }
      pairs.push({ item: id, arm, order: 'cur-first', P: cur, Q: fixed });
      pairs.push({ item: id, arm, order: 'rep-first', P: fixed, Q: cur });
    }
  }
  for (const id of shuffle(ids, rand).slice(0, 40)) {
    const it = items.get(id), cur = { enTailA: it.enTailA, enHeadB: it.enHeadB };
    pairs.push({ item: id, arm: 'AA', order: 'aa-1', P: cur, Q: cur });
    pairs.push({ item: id, arm: 'AA', order: 'aa-2', P: cur, Q: cur });
  }
  const sh = shuffle(pairs, rand).map((p, k) => ({ ...p, pair: `p${String(k).padStart(4, '0')}`, srcTailA: items.get(p.item).srcTailA, srcHeadB: items.get(p.item).srcHeadB }));
  const packets = [];
  for (let k = 0; k < sh.length; k += PACKET) packets.push({ packet: `k${String(k / PACKET).padStart(3, '0')}`, pairs: sh.slice(k, k + PACKET) });
  fs.writeFileSync(path.join(out, 'judge-packets.jsonl'), packets.map(x => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'judge-unchanged.jsonl'), unchanged.map(x => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'JUDGE-PROMPT.md'), '# Repair judge prompt (#6742)\n\n```\n' + JUDGE + '\n```\n');
  console.log(JSON.stringify({ pairs: sh.length, packets: packets.length, unchanged: unchanged.length, byArm: Object.fromEntries(arms.concat('AA').map(a => [a, sh.filter(p => p.arm === a).length])) }));
}

async function run(out, conc) {
  const packets = readJsonl(path.join(out, 'judge-packets.jsonl'));
  const file = path.join(out, 'judge.jsonl');
  const done = new Set(readJsonl(file).filter(x => x.parsed).map(x => x.packet));
  const todo = packets.filter(p => !done.has(p.packet));
  console.log(`${packets.length} packets, ${todo.length} to judge`);
  const res = await pool(todo, conc, async (pk) => {
    const prompt = `${JUDGE}\n\n${pk.pairs.map(pairText).join('\n\n')}\n`;
    const r = await claudeCall(prompt, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    const arr = r.cls ? null : extractJson(r.text, '[');
    const want = new Set(pk.pairs.map(p => p.pair));
    const parsed = Array.isArray(arr) && arr.filter(v => want.has(v.pair) && ['P', 'Q', 'tie'].includes(v.better)).length === pk.pairs.length;
    fs.appendFileSync(file, JSON.stringify({ packet: pk.packet, parsed, verdicts: parsed ? arr : undefined, model: r.model, cls: r.cls, secs: Math.round(r.secs), raw: parsed ? undefined : r.text.slice(0, 2000) }) + '\n');
    return { ok: parsed, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  if (cmd === 'build') build(out, arg('arms', 'opus,R1,R2,R3').split(','));
  else if (cmd === 'run') run(out, Number(arg('conc', 6))).catch(e => { console.error(e); process.exit(1); });
  else console.error('usage: build|run --out=DIR');
}
