#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/score.mjs — recall@10 / MRR for one
 * gold page per query with Wilson intervals; no graded judgments, no
 * per-tradition measure. scripts/eval/lib/paired-stats.mjs supplies the seeded
 * RNG used for the paired bootstrap here.
 *
 * Scores the #6173 arms. Relevant = a gold passage, or a page a judge graded 2.
 * Measures and the bar are in README.md and were committed before this ran.
 *
 *   node scripts/eval/embed-granularity/score.mjs --dir DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, loadPool } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const DIR = arg('--dir');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = loadPool(DIR);
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const rankings = JSON.parse(fs.readFileSync(path.join(DIR, 'rankings.json'), 'utf8'));
const judged = {};
for (const f of fs.readdirSync(DIR).filter((x) => /^judge-\d+\.json$/.test(x))) Object.assign(judged, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const arms = Object.keys(rankings[gold[0].qid]).filter((k) => !k.startsWith('_'));

const per = {}; // arm -> measure -> [per query]
const M = ['rel_trad@10', 'rel_trad@10_lenient', 'P@10', 'gold_trad@10', 'gold_R@10', 'gold_R@50', 'trad@10', 'books@10', 'top_trad_share@10'];
for (const arm of arms) per[arm] = Object.fromEntries(M.map((m) => [m, []]));
const detail = {};
let unjudged = 0;
for (const q of gold) {
  const g = new Map(q.passages.map((p) => [p.i, p.tradition]));
  const j = judged[q.qid] || {};
  detail[q.qid] = {};
  for (const arm of arms) {
    const top10 = rankings[q.qid][arm].slice(0, 10);
    const relTrad = new Set(); let rel = 0; const lenTrad = new Set();
    const rows = top10.map((i) => {
      let t = null; let grade;
      if (g.has(i)) { grade = 'gold'; t = g.get(i); } else if (j[i]) { grade = j[i].g; if (grade === 2) t = j[i].t; } else { grade = null; unjudged++; }
      if (t) { rel++; if (t !== 'other') relTrad.add(t); }
      // Sensitivity: grade 1 (touches the idea) also counts, under the shelf label.
      if (t || grade === 1) { const lt = t || labels[pool[i].book_id]; if (lt !== 'other') lenTrad.add(lt); }
      return { i, grade, t: t || labels[pool[i].book_id] };
    });
    const goldTop10 = new Set(top10.filter((i) => g.has(i)).map((i) => g.get(i)));
    const shelf = top10.map((i) => labels[pool[i].book_id]);
    const counts = {}; for (const t of shelf) counts[t] = (counts[t] || 0) + 1;
    const top50 = new Set(rankings[q.qid][arm].slice(0, 50));
    const m = per[arm];
    m['rel_trad@10'].push(relTrad.size);
    m['rel_trad@10_lenient'].push(lenTrad.size);
    m['P@10'].push(rel / 10);
    m['gold_trad@10'].push(goldTop10.size / q.traditions.length);
    m['gold_R@10'].push(top10.filter((i) => g.has(i)).length / q.passages.length);
    m['gold_R@50'].push(q.passages.filter((p) => top50.has(p.i)).length / q.passages.length);
    m['trad@10'].push(new Set(shelf.filter((t) => t !== 'other')).size);
    m['books@10'].push(new Set(top10.map((i) => pool[i].book_id)).size);
    m['top_trad_share@10'].push(Math.max(...Object.values(counts)) / 10);
    detail[q.qid][arm] = rows;
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const rng = makeRng(6173);
function pairedCI(x, y, B = 10000) {
  const d = x.map((v, k) => v - y[k]); const n = d.length; const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let k = 0; k < n; k++) s += d[Math.floor(rng() * n)]; out.push(s / n); }
  out.sort((p, q) => p - q);
  return { diff: mean(d), lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)], wins: d.filter((v) => v > 0).length, losses: d.filter((v) => v < 0).length };
}
const f = (x, n = 2) => x.toFixed(n);
console.log(`queries ${gold.length}; unjudged top-10 slots ${unjudged}`);
console.log(`| arm | ${M.join(' | ')} |\n|---|${M.map(() => '---').join('|')}|`);
for (const arm of arms) console.log(`| ${arm} | ${M.map((m) => f(mean(per[arm][m]))).join(' | ')} |`);
const pairs = [['b', 'a'], ['c', 'a'], ['ac_rrf', 'a'], ['a_book1', 'a'], ['a_mmr', 'a'], ['a_quota', 'a'], ['e_rr', 'a'], ['e_rrf', 'a'], ['c_quota', 'c'], ['ac_quota', 'ac_rrf'], ['c', 'e_rr'], ['b', 'e_rr'], ['ac_rrf', 'e_rr'], ['c_quota', 'a_quota'], ['c_quota', 'e_rr'], ['a_quota', 'e_rr'], ['c', 'a_mmr'], ['c', 'a_book1'], ['ac_rrf', 'a_mmr'], ['c_quota', 'a_mmr'], ['ac_quota', 'a'], ['c_quota', 'a'], ...(arms.includes('b0') ? [['b0', 'a'], ['b', 'b0']] : [])];
const cmp = [];
console.log('\n| pair | measure | diff | 95% CI | wins/losses |\n|---|---|---|---|---|');
for (const [x, y] of pairs) for (const m of ['rel_trad@10', 'P@10', 'gold_trad@10']) {
  const r = pairedCI(per[x][m], per[y][m]);
  cmp.push({ x, y, measure: m, ...r });
  console.log(`| ${x} − ${y} | ${m} | ${r.diff >= 0 ? '+' : ''}${f(r.diff)} | [${f(r.lo)}, ${f(r.hi)}] | ${r.wins}/${r.losses} |`);
}
// Which traditions reach the top 10 with a relevant page, and how often.
const TR = ['greek-roman', 'christian', 'hermetic-esoteric', 'jewish-kabbalistic', 'islamic-sufi', 'hindu-indic', 'buddhist', 'chinese-daoist-confucian'];
console.log(`\nqueries (of ${gold.length}) with a relevant top-10 page from each tradition\n| arm | ${TR.join(' | ')} | queries with <=1 tradition |\n|---|${TR.map(() => '---').join('|')}|---|`);
const byTrad = {};
for (const arm of arms) {
  byTrad[arm] = Object.fromEntries(TR.map((t) => [t, gold.filter((q) => detail[q.qid][arm].some((r) => (r.grade === 'gold' || r.grade === 2) && r.t === t)).length]));
  console.log(`| ${arm} | ${TR.map((t) => byTrad[arm][t]).join(' | ')} | ${per[arm]['rel_trad@10'].filter((v) => v <= 1).length} |`);
}
console.log(`gold holds each tradition for: ${TR.map((t) => `${t} ${gold.filter((q) => q.traditions.includes(t)).length}`).join(', ')}`);
console.log('\nper query rel_trad@10 (a / b / c / c_quota / e_rr) and P@10 (a / c)');
for (const [k, q] of gold.entries()) console.log(`${q.qid} | ${['a', 'b', 'c', 'c_quota', 'e_rr'].map((a) => per[a]['rel_trad@10'][k]).join(' / ')} | ${f(per.a['P@10'][k], 1)} / ${f(per.c['P@10'][k], 1)} | ${q.query}`);
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', '2026-10-07-score.json'), JSON.stringify({ arms, measures: M, means: Object.fromEntries(arms.map((a) => [a, Object.fromEntries(M.map((m) => [m, Number(mean(per[a][m]).toFixed(4))]))])), comparisons: cmp, by_tradition: byTrad, per_query: Object.fromEntries(gold.map((q, k) => [q.qid, Object.fromEntries(arms.map((a) => [a, Object.fromEntries(M.map((m) => [m, per[a][m][k]]))]))])), top10: detail }));
fs.writeFileSync(path.join(here, 'results', 'judgments.json'), JSON.stringify(judged));
