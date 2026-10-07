#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/librarian-search/metrics.mjs — recallAtK / MRR over
 * {book_slug, page-range} expectations from a live search; here the ranking is
 * computed locally over stored vectors and the relevant set is one pool index,
 * so the matcher there does not apply. Intervals come from
 * scripts/eval/lib/agreement-stats.mjs (`wilson`), not re-implemented.
 *
 * score — recall@10 per arm for the #5729 test. Ranks the pool by cosine for
 * each query and reports page-level recall@10 (Wilson 95%), MRR and per-language
 * recall, over:
 *   full    — every pool page the arm has a vector for
 *   shared  — pool pages with a stored Gemini vector; queries whose gold has one
 *   subpool — the fixed bge-m3 sub-pool (gold pages + seeded random others)
 * plus the production global lane (global-gemini.json from gemini-arm.mjs).
 *
 *   node scripts/eval/orig-lang-recall/score.mjs --dir D --write-subset 3000   # once, before bge-m3
 *   node scripts/eval/orig-lang-recall/score.mjs --dir D [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const DIR = arg('--dir');
const K = 10;
const here = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const pool = fs.readFileSync(path.join(DIR, 'pool.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const key = (b, p) => `${b}:${p}`;
const poolIndex = new Map(pool.map((r, i) => [key(r.book_id, r.page_number), i]));
for (const q of gold) {
  q.i = poolIndex.get(key(q.book_id, q.page_number));
  if (q.i === undefined) throw new Error(`${q.qid}: gold page not in pool`);
}

const subsetFile = path.join(DIR, 'subset.json');
if (args.includes('--write-subset')) {
  const n = Number(arg('--write-subset'));
  const goldIdx = new Set(gold.map((q) => q.i));
  const rest = pool.map((_, i) => i).filter((i) => !goldIdx.has(i));
  const rng = makeRng(5729);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const subset = [...goldIdx, ...rest.slice(0, n - goldIdx.size)].sort((a, b) => a - b);
  fs.writeFileSync(subsetFile, JSON.stringify(subset));
  console.log(`sub-pool: ${subset.length} pages → ${subsetFile}`);
  process.exit(0);
}

// `gemini` = the vectors production stores; `gemini-full` = those plus the
// pool pages embedded by gemini-arm.mjs --fill-pool (the lane once the
// OCR-only tail is embedded).
function loadArm(name) {
  const base = name === 'gemini-full' ? 'gemini' : name;
  const files = [path.join(DIR, `vec-${base}.jsonl`), ...(name === 'gemini-full' ? [path.join(DIR, 'vec-gemini-fill.jsonl')] : [])];
  const qf = path.join(DIR, `q-${base}.json`);
  if (!files.every((f) => fs.existsSync(f)) || !fs.existsSync(qf)) return null;
  const vecs = new Map();
  for (const f of files) for (const l of fs.readFileSync(f, 'utf8').trim().split('\n')) { if (l) { const { i, v } = JSON.parse(l); vecs.set(i, v); } }
  return { name, vecs, q: JSON.parse(fs.readFileSync(qf, 'utf8')) };
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Rank of the gold page among `candidates` (1-based), or null if the arm has no vector for it. */
function rankOf(arm, q, candidates) {
  const g = arm.vecs.get(q.i);
  if (!g) return null;
  const qv = arm.q[q.qid];
  const gs = dot(qv, g);
  let better = 0;
  for (const i of candidates) { if (i !== q.i) { const v = arm.vecs.get(i); if (v && dot(qv, v) > gs) better++; } }
  return better + 1;
}

function summarise(ranks) {
  const scored = ranks.filter((r) => r.rank !== null);
  const hits = scored.filter((r) => r.rank <= K).length;
  const [lo, hi] = wilson(hits, scored.length);
  const mrr = scored.reduce((s, r) => s + 1 / r.rank, 0) / (scored.length || 1);
  const byLang = {};
  for (const lang of ['Latin', 'German', 'French', 'Chinese']) {
    const l = scored.filter((r) => r.lang === lang);
    byLang[lang] = { n: l.length, hits: l.filter((r) => r.rank <= K).length };
  }
  return { n: scored.length, hits, recall: hits / (scored.length || 1), ci: [lo, hi], mrr, byLang };
}

const arms = ['gemini', 'gemini-full', 'e5-base', 'bge-m3'].map(loadArm).filter(Boolean);
const gem = arms.find((a) => a.name === 'gemini');
const subset = fs.existsSync(subsetFile) ? JSON.parse(fs.readFileSync(subsetFile, 'utf8')) : null;
const all = pool.map((_, i) => i);
const views = {
  full: { candidates: all, queries: gold },
  shared: gem ? { candidates: all.filter((i) => gem.vecs.has(i)), queries: gold.filter((q) => gem.vecs.has(q.i)) } : null,
  subpool: subset ? { candidates: subset, queries: gold } : null,
};

const out = { k: K, pool: pool.length, views: {}, perQuery: {} };
for (const [view, spec] of Object.entries(views)) {
  if (!spec) continue;
  out.views[view] = { candidates: spec.candidates.length, arms: {} };
  for (const arm of arms) {
    // An arm without every candidate's vector is only scored in a view it covers.
    // (`gemini` alone is scored on `full` partially, by design: it is what production holds.)
    if (arm.name !== 'gemini' && spec.candidates.some((i) => !arm.vecs.has(i))) continue;
    const ranks = spec.queries.map((q) => ({ qid: q.qid, lang: q.lang, rank: rankOf(arm, q, spec.candidates) }));
    out.views[view].arms[arm.name] = summarise(ranks);
    for (const r of ranks) (out.perQuery[r.qid] ??= {})[`${view}:${arm.name}`] = r.rank;
  }
}

// The production lane over the whole store.
const gf = path.join(DIR, 'global-gemini.json');
if (fs.existsSync(gf)) {
  const glob = JSON.parse(fs.readFileSync(gf, 'utf8'));
  const ranks = gold.map((q) => {
    const at = (glob[q.qid] || []).findIndex((h) => h.book_id === q.book_id && h.page_number === q.page_number);
    return { qid: q.qid, lang: q.lang, rank: at === -1 ? K + 1 : at + 1 };
  });
  out.views.global = { candidates: 'all of page_translations', arms: { 'gemini (match_semantic)': summarise(ranks) } };
  out.globalBookHits = gold.filter((q) => (glob[q.qid] || []).some((h) => h.book_id === q.book_id)).length;
  for (const r of ranks) (out.perQuery[r.qid] ??= {})['global:gemini'] = r.rank > K ? null : r.rank;
}

// A lane of OCR-only rows at its real size (gemini-arm.mjs --ocr-only-rank).
const of = path.join(DIR, 'ocr-only-rank-gemini.json');
if (fs.existsSync(of)) {
  const rk = JSON.parse(fs.readFileSync(of, 'utf8'));
  const ranks = gold.map((q) => ({ qid: q.qid, lang: q.lang, rank: rk[q.qid] ?? null }));
  out.views.ocr_only = { candidates: 'every OCR-only row of page_translations', arms: { 'gemini (exact)': summarise(ranks) } };
  for (const r of ranks) (out.perQuery[r.qid] ??= {})['ocr_only:gemini'] = r.rank;
}

for (const [view, v] of Object.entries(out.views)) {
  console.log(`\n${view} (${v.candidates} candidates)`);
  for (const [name, s] of Object.entries(v.arms)) {
    const langs = Object.entries(s.byLang).map(([l, x]) => `${l.slice(0, 2)} ${x.hits}/${x.n}`).join('  ');
    console.log(`  ${name.padEnd(26)} R@10 ${s.hits}/${s.n} = ${s.recall.toFixed(2)} [${s.ci[0].toFixed(2)}, ${s.ci[1].toFixed(2)}]  MRR ${s.mrr.toFixed(2)}  ${langs}`);
  }
}
if (out.globalBookHits !== undefined) console.log(`\nglobal lane: gold BOOK in top 10 for ${out.globalBookHits}/${gold.length} queries`);
const json = arg('--json');
if (json) fs.writeFileSync(json, JSON.stringify(out, null, 1));
