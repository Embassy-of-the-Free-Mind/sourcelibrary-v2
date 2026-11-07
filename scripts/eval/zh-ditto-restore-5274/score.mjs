#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/score.mjs (hanOf with every bar form as 丨, bodyCer vs the Kanripo leaf: the
// CER here is that one, plus the table-pipe removal of lite-correct-gpu-7263/zh-pipes-side.mjs). It has no measure of the
// marks themselves, which is this test's question, and its sets and arms are its own.
/**
 * score.mjs — marks (count, placed runs) and body CER per arm, usable pages per PREREG.md. Reads $JOB_SCRATCH/w.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-ditto-restore-5274/score.mjs
 * Writes results/zh-ditto-restore-5274/{pages.jsonl.gz,score.json}.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bodyText, foldHan, bodyCer, median, wilson } from '../ground-truth-5935/lib.mjs';
import { convertPaddle, envelope } from '../../lib/paddle-zh-lane.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '../results/zh-ditto-restore-5274');
const W = path.join(process.env.JOB_SCRATCH, 'w');
const pages = JSON.parse(fs.readFileSync(path.join(W, 'pages.json'), 'utf8'));
const unTable = (t) => t.split('\n').filter((l) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l)).map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.replace(/\|/g, '\n') : l)).join('\n');
export const hanOf = (t) => foldHan(bodyText(unTable(String(t || ''))).replace(/[｜|│┃〡]/g, '丨'));
const runs = (q) => [...q.matchAll(/丨+/g)].map((m) => ({ n: m[0].length, l: q[m.index - 1] ?? '', r: q[m.index + m[0].length] ?? '' }));
const nMarks = (q) => (q.match(/丨/g) || []).length;
const noMarks = (q) => q.replace(/丨/g, '');
function placed(armQ, leafQ) {
  const A = runs(armQ), L = runs(leafQ), used = new Set(); let hit = 0;
  for (const x of L) { const i = A.findIndex((y, k) => !used.has(k) && y.n === x.n && ((x.l && y.l === x.l) || (x.r && y.r === x.r))); if (i >= 0) { used.add(i); hit++; } }
  return { leaf_runs: L.length, arm_runs: A.length, hit, recall: L.length ? hit / L.length : null, precision: A.length ? hit / A.length : null };
}
const P1 = ['P1-r2', 'P1-ia', 'P1-ia-nolayout', 'P1-up3'];
function textOf(arm, p) {
  if (arm === 'P0') return { text: fs.readFileSync(path.join(W, 'p0', `${p.slug}.txt`), 'utf8'), outcome: 'read' };
  if (P1.includes(arm)) {
    const f = path.join(W, 'p1', arm.slice(3), 'out', p.bid, `${p.pn}.txt`);
    if (!fs.existsSync(f)) return { text: '', outcome: 'no-answer', reason: 'err or missing' };
    const c = convertPaddle(fs.readFileSync(f, 'utf8'));
    return { text: envelope(c.body), outcome: 'read', raw: fs.readFileSync(f, 'utf8') };
  }
  try { const j = JSON.parse(fs.readFileSync(path.join(W, arm, `${p.slug}.json`), 'utf8')); return { text: j.text || '', outcome: j.outcome, reason: j.reason, usage: j.usage, secs: j.secs }; } catch { return { text: '', outcome: 'no-answer', reason: 'no file' }; }
}
const counter = (p) => { try { return JSON.parse(fs.readFileSync(path.join(W, 'counter', `${p.slug}.json`), 'utf8')).count?.total ?? null; } catch { return null; } };
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const ARMS = ['P0', ...P1, 'P2-r2', 'P2-ia', 'P3-ia'];
const rows = [];
for (const p of pages) {
  const leaf = p.kanripo?.text ?? null;
  const truth = leaf ? nMarks(leaf) : counter(p);
  const p0 = hanOf(textOf('P0', p).text);
  const p0Cer = leaf ? bodyCer(noMarks(p0), noMarks(leaf), { expected: [...noMarks(leaf)].length }).cer : null;
  for (const arm of ARMS) {
    const t = textOf(arm, p);
    if (t.outcome === 'no-answer' || t.outcome === 'contain') { rows.push({ slug: p.slug, set: p.set, arm, outcome: t.outcome, reason: t.reason ?? null, usable: false }); continue; }
    const q = hanOf(t.text); const n = nMarks(q);
    const r = { slug: p.slug, set: p.set, fam: p.fam, arm, outcome: t.outcome, marks: n, truth, counter: counter(p), rec: truth ? Math.min(n, truth) / truth : null, prec: n ? Math.min(n, truth ?? 0) / n : null };
    if (leaf) {
      const pl = placed(q, leaf); Object.assign(r, { run_rec: pl.recall, run_prec: pl.precision, leaf_runs: pl.leaf_runs, arm_runs: pl.arm_runs, runs_hit: pl.hit });
      r.cer = bodyCer(q, leaf, { expected: [...leaf].length }).cer;
      r.cer_nomark = bodyCer(noMarks(q), noMarks(leaf), { expected: [...noMarks(leaf)].length }).cer;
      r.yi_extra = (q.match(/一/g) || []).length - (leaf.match(/一/g) || []).length;
    }
    r.len_ratio = leaf ? [...q].length / [...leaf].length : null;
    r.usable = r.rec != null && r.rec >= 0.9 && r.prec != null && r.prec >= 0.9 && (leaf ? r.run_rec >= 0.8 && r.cer_nomark <= p0Cer + 0.005 : true);
    r.usage = t.usage ?? null; r.secs = t.secs ?? null;
    rows.push(r);
  }
}
const sum = {};
for (const arm of ARMS) for (const set of ['zero', 'keep']) {
  const R = rows.filter((r) => r.arm === arm && r.set === set); const A = R.filter((r) => r.marks != null); const L = A.filter((r) => r.cer != null);
  if (!A.length) { sum[`${arm}|${set}`] = { n: R.length, answered: 0 }; continue; }
  const tm = A.reduce((a, r) => a + (r.truth ?? 0), 0), am = A.reduce((a, r) => a + r.marks, 0), mn = A.reduce((a, r) => a + Math.min(r.marks, r.truth ?? 0), 0);
  const u = R.filter((r) => r.usable).length, w = wilson(u, R.length);
  const hit = L.reduce((a, r) => a + r.runs_hit, 0), lr = L.reduce((a, r) => a + r.leaf_runs, 0), ar = L.reduce((a, r) => a + r.arm_runs, 0);
  sum[`${arm}|${set}`] = { n: R.length, answered: A.length, outcomes: R.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}), usable: u, usable_ci: w,
    truth_marks: tm, arm_marks: am, count_recall: r3(mn / tm), count_precision: r3(am ? mn / am : null), run_recall: r3(lr ? hit / lr : null), run_precision: r3(ar ? hit / ar : null),
    cer_median: r3(median(L.map((r) => r.cer))), cer_nomark_median: r3(median(L.map((r) => r.cer_nomark))), yi_extra_mean: r3(L.reduce((a, r) => a + r.yi_extra, 0) / Math.max(1, L.length)),
    pages_zero_marks: A.filter((r) => r.marks === 0).length, pages_any_marks: A.filter((r) => r.marks > 0).length,
    median_output_tokens: median(R.map((r) => r.usage?.output ?? r.usage?.output_tokens).filter((x) => x != null)), median_secs: r3(median(R.map((r) => r.secs).filter((x) => x != null))) };
}
const cc = pages.filter((p) => p.kanripo && counter(p) != null).map((p) => ({ slug: p.slug, kanripo: nMarks(p.kanripo.text), counter: counter(p) }));
const counterCheck = { n: cc.length, exact: cc.filter((x) => x.kanripo === x.counter).length, within2: cc.filter((x) => Math.abs(x.kanripo - x.counter) <= 2).length, total_kanripo: cc.reduce((a, x) => a + x.kanripo, 0), total_counter: cc.reduce((a, x) => a + x.counter, 0), rows: cc };
fs.writeFileSync(path.join(RES, 'pages.jsonl.gz'), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
fs.writeFileSync(path.join(RES, 'score.json'), JSON.stringify({ arms: sum, counter_check: counterCheck }, null, 1));
for (const [k, v] of Object.entries(sum)) console.log(k, `n=${v.n} ans=${v.answered} usable=${v.usable}`, `count R/P ${v.count_recall}/${v.count_precision} run R/P ${v.run_recall}/${v.run_precision}`, `CER ${v.cer_median} noMark ${v.cer_nomark_median} 一+ ${v.yi_extra_mean} zero-mark pages ${v.pages_zero_marks}`, v.median_output_tokens ?? '', v.median_secs ?? '');
console.log('counter vs Kanripo', counterCheck.n, 'exact', counterCheck.exact, 'within 2', counterCheck.within2, counterCheck.total_kanripo, counterCheck.total_counter);
