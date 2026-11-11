#!/usr/bin/env node
// PRIOR ART: the Clef runs of 2026-11-11 (scores cached per page, /root/jobs/clef-almeida) used the same
// labelled pages and the same metric; --model folds those cached scores in as extra columns for comparison.
/**
 * Score every detector in detectors.mjs against every taxonomy class on the snapshot (snapshot.mjs).
 *   node scripts/eval/defect-detectors/run.mjs --snapshot /root/jobs/defect-detectors/snapshot.jsonl
 *        [--model name=cache.jsonl[:question]]... [--out scripts/eval/results/defect-detectors-YYYY-MM-DD]
 * Metric: AUC of the detector's score, reported pages of a class vs. same-book controls; 95% interval from
 * a bootstrap that resamples BOOKS (pages of one book are not independent). Also precision at the score
 * cut that flags 10% of pages, for the class's own target detector. Writes summary.json and table.md (no text).
 */
import fs from 'node:fs';
import { DETECTORS } from './detectors.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const SNAP = opt('--snapshot', '/root/jobs/defect-detectors/snapshot.jsonl');
const OUT = opt('--out', `scripts/eval/results/defect-detectors-${new Date().toISOString().slice(0, 10)}`);
const models = args.flatMap((a, i) => (a === '--model' ? [args[i + 1]] : []));

const lines = fs.readFileSync(SNAP, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const books = new Map(lines.filter((l) => l.kind === 'book').map((b) => [b.book_id, b]));
const SINCE = opt('--unchanged-since', null);  // e.g. 2026-10-10: keep only pages not rewritten after the report
const rows = lines.filter((l) => l.kind === 'page' && (!SINCE || !l.page.changed || l.page.changed < SINCE));
const S = {};
for (const d of DETECTORS) S[d.name] = new Map(rows.map((r) => [r.key, d.score(r, books.get(r.book_id))]));
for (const m of models) {  // name=path[:question]; per page max over sentence rows
  const [name, rest] = m.split('='); const [file, q] = rest.split(':');
  const mp = new Map();
  for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l); const v = q ? j.answers[q] : Math.max(...Object.values(j.answers));
    mp.set(j.key, Math.max(mp.get(j.key) ?? -Infinity, v));
  }
  S[name] = mp;
}
const names = Object.keys(S);
const classOf = (c) => c.split('/')[0];
const classes = [...new Set(rows.flatMap((r) => r.classes.map(classOf)))];
const auc = (p, n) => { if (!p.length || !n.length) return null; let s = 0; for (const a of p) for (const b of n) s += a > b ? 1 : a === b ? 0.5 : 0; return s / p.length / n.length; };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function scoreClass(c, name) {
  const pos = rows.filter((r) => r.classes.some((x) => classOf(x) === c) && S[name].has(r.key));
  const bks = new Set(pos.map((r) => r.book_id));
  const neg = rows.filter((r) => r.label === 0 && bks.has(r.book_id) && S[name].has(r.key));
  const a = auc(pos.map((r) => S[name].get(r.key)), neg.map((r) => S[name].get(r.key)));
  if (a == null) return null;
  const B = [...bks], xs = [];
  for (let i = 0; i < 400; i++) {
    const pick = Array.from(B, () => B[Math.floor(rnd() * B.length)]);
    const P = pick.flatMap((b) => pos.filter((r) => r.book_id === b)), N = pick.flatMap((b) => neg.filter((r) => r.book_id === b));
    const v = auc(P.map((r) => S[name].get(r.key)), N.map((r) => S[name].get(r.key))); if (v != null) xs.push(v);
  }
  xs.sort((x, y) => x - y);
  return { n: pos.length, books: bks.size, ctrl: neg.length, auc: +a.toFixed(3), lo: +(xs[Math.floor(xs.length * 0.025)] ?? NaN).toFixed(2), hi: +(xs[Math.floor(xs.length * 0.975)] ?? NaN).toFixed(2) };
}
const summary = { unchanged_since: SINCE, snapshot_pages: rows.length, reported: rows.filter((r) => r.label).length, controls: rows.filter((r) => !r.label).length, detectors: names, classes: {} };
for (const c of classes.sort()) { summary.classes[c] = {}; for (const n of names) summary.classes[c][n] = scoreClass(c, n); }
// Target pairs: each detector on its own classes, plus flag rate and precision at a 10% flag rate over all pages.
summary.targets = [];
for (const d of DETECTORS) for (const c of d.classes) {
  const r = summary.classes[c]?.[d.name]; if (!r) continue;
  const all = rows.map((x) => S[d.name].get(x.key)).sort((a, b) => b - a), cut = all[Math.floor(all.length * 0.1)];
  const fl = rows.filter((x) => S[d.name].get(x.key) > cut || (S[d.name].get(x.key) === cut && cut > 0));
  const hit = fl.filter((x) => x.classes.some((y) => classOf(y) === c)).length;
  summary.targets.push({ detector: d.name, class: c, ...r, flagged: fl.length, flagged_hits: hit, nonzero: rows.filter((x) => S[d.name].get(x.key) > 0).length });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
const fmt = (r) => (r ? `${r.auc.toFixed(2)} (${r.lo}–${r.hi})` : '·');
let md = (SINCE ? `Pages not rewritten since ${SINCE}. ` : '') + `Reported ${summary.reported} pages vs ${summary.controls} same-book controls. AUC (95% book-bootstrap). Classes with ≥3 reported pages.\n\n`;
md += `| class | n | ${names.join(' | ')} |\n|---|---|${names.map(() => '---').join('|')}|\n`;
for (const c of Object.keys(summary.classes)) { const any = Object.values(summary.classes[c]).find(Boolean); if (!any || any.n < 3) continue; md += `| ${c} | ${any.n} | ${names.map((n) => fmt(summary.classes[c][n])).join(' | ')} |\n`; }
md += `\nTarget pairs:\n\n| detector | class | n | AUC | 95% | pages flagged (>0) |\n|---|---|---|---|---|---|\n`;
for (const t of summary.targets) md += `| ${t.detector} | ${t.class} | ${t.n} | ${t.auc.toFixed(2)} | ${t.lo}–${t.hi} | ${t.nonzero} |\n`;
fs.writeFileSync(`${OUT}/table.md`, md);
console.log(md);
