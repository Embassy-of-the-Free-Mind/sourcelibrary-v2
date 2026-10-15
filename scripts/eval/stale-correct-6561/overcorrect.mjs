#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/score.mjs (scoreText: Kanripo CER of a reading via bodyCer with the
// leaf's own length as `expected`, ditto marks folded; reused here byte for byte). It does not fit as is: it scores the
// experiment's fixed sets and arms from their scratch files, not a run.mjs out.jsonl against an align.mjs leaf file.
//
// #6561 item 1, the over-correction half of the pilot gate: on pages whose OWN Kanripo leaf is trusted (align.mjs
// leaf 'own', i.e. qa_screen screened at dice >= 0.6; leaf >= 20 Han), Kanripo CER of the Paddle reading (before) and
// of the Opus correction (after). A page is "made worse" when after - before > 0.5 pt (0.005).
// Gate: made worse on at most 10% of the scored pages.
//
// Usage: node overcorrect.mjs <out.json> <dir:align.jsonl>...   (each dir holds pages.jsonl + out.jsonl from run.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { bodyText, foldHan, bodyCer, median, mean, wilson } from '../ground-truth-5935/lib.mjs';

const [, , OUT, ...PAIRS] = process.argv;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const DITTO = /[｜|│┃]/g;
const hanOf = (t) => foldHan(bodyText(t).replace(DITTO, '丨'));
const scoreText = (text, leaf) => +bodyCer(hanOf(text), leaf, { expected: [...leaf].length }).cer.toFixed(4);
const WORSE = 0.005, GATE = 0.10;

const rows = [];
let notCorrected = 0, noLeaf = 0;
for (const pair of PAIRS) {
  const [dir, alignF] = pair.split(':');
  const pages = readJsonl(path.join(dir, 'pages.jsonl'));
  const ok = new Map(readJsonl(path.join(dir, 'out.jsonl')).filter((r) => r.outcome === 'ok').map((r) => [r.page_id, r]));
  const al = new Map(readJsonl(alignF).map((a) => [a.key, a]));
  for (const p of pages) {
    const a = al.get(p.pid);
    if (!(a?.status === 'aligned' && a.leaf === 'own' && [...(a.kanripo_text || '')].length >= 20)) { noLeaf++; continue; }
    const o = ok.get(p.pid);
    if (!o) { notCorrected++; continue; }
    const before = scoreText(p.paddle, a.kanripo_text), after = scoreText(o.text, a.kanripo_text);
    rows.push({ set: path.basename(dir), pid: p.pid, bid: p.bid, pn: p.pn, ref_pb: a.ref_pb, own_dice: a.own_dice, stale_cer: p.cer, layout: o.layout, before, after, delta: +(after - before).toFixed(4), worse: after - before > WORSE, link: `https://sourcelibrary.org/book/${p.bid}?page=${p.pn}` });
  }
}
const n = rows.length, worse = rows.filter((r) => r.worse).length, better = rows.filter((r) => r.delta < -WORSE).length;
const [lo, hi] = wilson(worse, n);
const summary = {
  computed_at: new Date().toISOString(), scored: n, no_trusted_own_leaf: noLeaf, not_corrected: notCorrected,
  made_worse_gt_0_5pt: worse, made_better_gt_0_5pt: better, worse_rate: n ? +(worse / n).toFixed(4) : null, worse_wilson95: [+lo.toFixed(4), +hi.toFixed(4)],
  median_cer_before: median(rows.map((r) => r.before)), median_cer_after: median(rows.map((r) => r.after)),
  mean_cer_before: mean(rows.map((r) => r.before)), mean_cer_after: mean(rows.map((r) => r.after)),
  by_set: Object.fromEntries([...new Set(rows.map((r) => r.set))].map((s) => { const xs = rows.filter((r) => r.set === s); return [s, { scored: xs.length, worse: xs.filter((r) => r.worse).length, median_before: median(xs.map((r) => r.before)), median_after: median(xs.map((r) => r.after)) }]; })),
  gate: { rule: `made worse by > 0.5 pt on <= ${GATE * 100}% of scored pages`, pass: n > 0 && worse / n <= GATE },
};
fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
