#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/score.mjs — the same rank-by-cosine
 * recall@10 over pool A, with arm names hard-wired (gemini/e5/bge-m3) and a
 * one-page relevant set; this scorer adds book-grain relevance (gold set B),
 * max-score fusion of two vectors per page (arm C), MRL truncation, and paired
 * discordance against the reference arm. Intervals from lib/agreement-stats.mjs.
 *
 * score — #6172. Three gold sets, one table each:
 *   A  orig-lang-recall/gold.json over pool A (DIR_A, 8,576 pages; `sub` = the
 *      fixed 3,000-page sub-pool, subset.json). Reference arm: gemini-full.
 *   B  librarian-search/golden-set.json over pool T (DIR). A hit = any top-10
 *      page from an expected book (page range honoured if the entry has one).
 *      Reference arm: gemini-trans (the stored vectors).
 *   C  embed-models/gold-c.json over pool T. One relevant page.
 *
 * Arms are discovered from files: vec-{a,t}-<arm>.jsonl + q-{a,t}-<arm>.json in
 * DIR (Qwen: written by qwen-embed.py). Every arm with more than 768 dims is
 * also scored truncated to 768 and re-normalised (`<arm>@768`).
 *
 *   node scripts/eval/embed-models/score.mjs --dir /root/claude-jobs/embed-models-eval \
 *     --dir-a /root/claude-jobs/librarian-orig-5867 [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/agreement-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const DIR = arg('--dir');
const DIR_A = arg('--dir-a', '/root/claude-jobs/librarian-orig-5867');
const K = 10;
const here = path.dirname(fileURLToPath(import.meta.url));
const jsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function loadVecs(files) {
  const m = new Map();
  for (const f of files) for (const { i, v } of jsonl(f)) m.set(i, norm(v));
  return m;
}
function truncated(arm, d) {
  const cut = (m) => new Map([...m].map(([i, v]) => [i, norm(v.subarray(0, d))]));
  return { name: `${arm.name}@${d}`, vecs: arm.vecs.map(cut), q: Object.fromEntries(Object.entries(arm.q).map(([k, v]) => [k, norm(v.subarray(0, d))])) };
}

/** Score of page i for query vector qv: max over the arm's vector sets (one set = plain cosine). */
function score(arm, qv, i) {
  let best = -Infinity;
  for (const m of arm.vecs) { const v = m.get(i); if (v) { const s = dot(qv, v); if (s > best) best = s; } }
  return best;
}

/** Top-K pool indices for one query. */
function topK(arm, qv, candidates) {
  const s = candidates.map((i) => [i, score(arm, qv, i)]);
  s.sort((a, b) => b[1] - a[1]);
  return s;
}

function summarise(rows) {
  const hits = rows.filter((r) => r.rank !== null && r.rank <= K).length;
  const [lo, hi] = wilson(hits, rows.length);
  const mrr = rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / (rows.length || 1);
  return { n: rows.length, hits, recall: hits / (rows.length || 1), ci: [lo, hi], mrr };
}

function discord(ref, other) {
  let win = 0; let loss = 0;
  for (const qid of Object.keys(ref)) {
    const a = ref[qid] !== null && ref[qid] <= K; const b = other[qid] !== null && other[qid] <= K;
    if (b && !a) win++; if (a && !b) loss++;
  }
  return { win, loss };
}

const out = { k: K, sets: {} };
function runSet(name, { arms, candidates, queries, isRel, ref, groupBy }) {
  const res = { candidates: candidates.length, arms: {}, perQuery: {} };
  for (const arm of arms) {
    // An arm is scored only on a pool it fully covers.
    if (candidates.some((i) => !arm.vecs.some((m) => m.has(i)))) continue;
    const ranks = {};
    const rows = [];
    for (const q of queries) {
      const qv = arm.q[q.qid];
      if (!qv) { ranks[q.qid] = null; continue; }
      const ranked = topK(arm, qv, candidates);
      const at = ranked.findIndex(([i]) => isRel(q, i));
      ranks[q.qid] = at === -1 ? null : at + 1;
      rows.push({ qid: q.qid, group: groupBy(q), rank: ranks[q.qid] });
    }
    const s = summarise(rows);
    s.groups = {};
    for (const r of rows) { const g = (s.groups[r.group] ??= { n: 0, hits: 0 }); g.n++; if (r.rank && r.rank <= K) g.hits++; }
    res.arms[arm.name] = s;
    res.perQuery[arm.name] = ranks;
  }
  if (res.perQuery[ref]) for (const a of Object.keys(res.arms)) if (a !== ref) res.arms[a].vsRef = discord(res.perQuery[ref], res.perQuery[a]);
  out.sets[name] = res;
  console.log(`\n${name} (${candidates.length} candidates, ${queries.length} queries; reference ${ref})`);
  const refR = res.arms[ref]?.recall;
  for (const [a, s] of Object.entries(res.arms)) {
    const g = Object.entries(s.groups).map(([k, x]) => `${k} ${x.hits}/${x.n}`).join('  ');
    const d = s.vsRef ? `  Δ ${(s.recall - refR >= 0 ? '+' : '')}${(s.recall - refR).toFixed(2)} (+${s.vsRef.win}/−${s.vsRef.loss})` : '';
    console.log(`  ${a.padEnd(28)} R@10 ${s.hits}/${s.n} = ${s.recall.toFixed(2)} [${s.ci[0].toFixed(2)}, ${s.ci[1].toFixed(2)}]  MRR ${s.mrr.toFixed(2)}${d}  | ${g}`);
  }
}

function discoverArms(dir, prefix) {
  const arms = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(new RegExp(`^vec-${prefix}-(qwen3-[\\w.-]+)\\.jsonl$`));
    if (!m || !fs.existsSync(path.join(dir, `q-${prefix}-${m[1]}.json`))) continue;
    const q = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(dir, `q-${prefix}-${m[1]}.json`), 'utf8'))).map(([k, v]) => [k, norm(v)]));
    const arm = { name: m[1], vecs: [loadVecs([path.join(dir, f)])], q };
    arms.push(arm);
    const dims = Object.values(q)[0].length;
    if (dims > 768) arms.push(truncated(arm, 768));
  }
  return arms;
}

// ── Gold set A over pool A ────────────────────────────────────────────
{
  const poolA = jsonl(path.join(DIR_A, 'pool.jsonl'));
  const idx = new Map(poolA.map((r, i) => [`${r.book_id}:${r.page_number}`, i]));
  const gold = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries;
  for (const q of gold) q.i = idx.get(`${q.book_id}:${q.page_number}`);
  const gq = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(DIR_A, 'q-gemini.json'), 'utf8'))).map(([k, v]) => [k, norm(v)]));
  const gem = { name: 'gemini-full', vecs: [loadVecs([path.join(DIR_A, 'vec-gemini.jsonl'), path.join(DIR_A, 'vec-gemini-fill.jsonl')])], q: gq };
  const arms = [gem, ...discoverArms(DIR, 'a')];
  const subset = JSON.parse(fs.readFileSync(path.join(DIR_A, 'subset.json'), 'utf8'));
  const spec = { arms, queries: gold, isRel: (q, i) => i === q.i, ref: 'gemini-full', groupBy: (q) => q.lang.slice(0, 2) };
  runSet('A-sub (3,000)', { ...spec, candidates: subset });
  runSet('A-full (8,576)', { ...spec, candidates: poolA.map((_, i) => i) });
}

// ── Gold sets B and C over pool T ─────────────────────────────────────
{
  const poolT = jsonl(path.join(DIR, 'pool-t.jsonl'));
  const q = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(DIR, 'q-t-gemini.json'), 'utf8'))).map(([k, v]) => [k, norm(v)]));
  const trans = loadVecs([path.join(DIR, 'vec-t-gemini-trans.jsonl')]);
  const ocrOnly = loadVecs([path.join(DIR, 'vec-t-gemini-ocr.jsonl')]);
  // The original-text vector of an untranslated page IS its stored vector.
  const ocr = new Map([...trans].map(([i, v]) => [i, ocrOnly.get(i) ?? v]));
  const arms = [
    { name: 'gemini-trans', vecs: [trans], q },
    { name: 'gemini-orig', vecs: [ocr], q },
    { name: 'gemini-fuse', vecs: [trans, ocr], q },
  ];
  // Control: the same model re-embedding exactly the stored text (gemini-dual.mjs --fresh).
  const freshFile = path.join(DIR, 'vec-t-gemini-fresh.jsonl');
  if (fs.existsSync(freshFile)) {
    const fresh = loadVecs([freshFile]);
    arms.push({ name: 'gemini-fresh', vecs: [fresh], q }, { name: 'gemini-fresh+orig', vecs: [fresh, ocr], q });
    const cos = [...trans].map(([i, v]) => dot(v, fresh.get(i))).sort((a, b) => a - b);
    const below = (t) => cos.filter((c) => c < t).length;
    out.storedVsFresh = { n: cos.length, p01: cos[Math.floor(cos.length * 0.01)], median: cos[Math.floor(cos.length / 2)], below099: below(0.99), below09: below(0.9), below05: below(0.5) };
    console.log(`\nstored vs fresh Gemini vector of the same text: n ${cos.length}, median ${out.storedVsFresh.median.toFixed(4)}, p1 ${out.storedVsFresh.p01.toFixed(3)}, <0.99: ${below(0.99)}, <0.9: ${below(0.9)}, <0.5: ${below(0.5)}`);
  }
  arms.push(...discoverArms(DIR, 't'));
  const all = poolT.map((_, i) => i);

  const golden = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries;
  const slugs = new Set(poolT.map((r) => r.slug));
  const gB = golden.filter((g) => g.expected.some((e) => slugs.has(e.book_slug))).map((g) => ({ ...g, qid: g.id }));
  const relB = (g, i) => g.expected.some((e) => e.book_slug === poolT[i].slug
    && (e.page_min == null || poolT[i].page_number >= e.page_min) && (e.page_max == null || poolT[i].page_number <= e.page_max));
  runSet('B (librarian golden set, pool T)', { arms, candidates: all, queries: gB, isRel: relB, ref: 'gemini-trans', groupBy: (g) => g.category });

  const idx = new Map(poolT.map((r, i) => [`${r.book_id}:${r.page_number}`, i]));
  const gC = JSON.parse(fs.readFileSync(path.join(here, 'gold-c.json'), 'utf8')).queries;
  for (const g of gC) { g.i = idx.get(`${g.book_id}:${g.page_number}`); if (g.i === undefined) throw new Error(`${g.qid} not in pool T`); }
  runSet('C (20 queries, translated pages, pool T)', { arms, candidates: all, queries: gC, isRel: (g, i) => i === g.i, ref: 'gemini-trans', groupBy: (g) => g.form });
}

const json = arg('--json');
if (json) fs.writeFileSync(json, JSON.stringify(out, null, 1));
