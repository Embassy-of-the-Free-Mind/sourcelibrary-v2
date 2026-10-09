#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/score.mjs — ranks one pool by one
 * vector set per arm and scores a single gold page; no fusion, no diversity
 * re-ranking, no query expansion. scripts/eval/librarian-search/variants.mjs —
 * variants of the Librarian's hybrid search against the live RPCs, not over a
 * fixed pool.
 *
 * Ranks the #6173 pool under every arm and writes the top 100 per query. It
 * does NOT score: score.mjs does, after the judging queue this writes has been
 * read by eye. Keeping the two apart is what lets the bar be fixed first.
 *
 * Arms (README.md has the reasoning):
 *   a        stored page vectors (production today)
 *   b        passage chunks with a book/section prefix; page score = best chunk touching it
 *   c        concept abstract per page
 *   ac_rrf   reciprocal-rank fusion of a and c
 *   a_book1  a, at most one page per book            (label-free)
 *   a_mmr    a, MMR over the top 100, lambda 0.7     (label-free)
 *   a_quota  a, at most 2 pages per tradition        (needs a tradition label per book)
 *   c_quota  c, same quota
 *   ac_quota ac_rrf, same quota
 *   e_rr     tradition-axis query expansion (#3514 fix 1): eight reformulations, one per
 *            tradition, each ranked over the WHOLE pool with a's vectors, interleaved
 *   e_rrf    the same nine lists (query + eight) fused by RRF
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/run-arms.mjs --dir DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { arg, loadPool, loadVecs, embedAll, dot, DIMS, ENDPOINT } from './lib.mjs';

const DIR = arg('--dir');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = loadPool(DIR);
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const va = loadVecs(path.join(DIR, 'vec-a.f32'));
const vb = loadVecs(path.join(DIR, 'vec-b.f32'));
const vc = loadVecs(path.join(DIR, 'vec-c.f32'));
const chunks = fs.readFileSync(path.join(DIR, 'chunks-b.jsonl'), 'utf8').trim().split('\n').map((l) => { const c = JSON.parse(l); return { pages: c.pages }; });
const hasB0 = fs.existsSync(path.join(DIR, 'vec-b0.f32'));
const vb0 = hasB0 ? loadVecs(path.join(DIR, 'vec-b0.f32')) : null;
const chunks0 = hasB0 ? fs.readFileSync(path.join(DIR, 'chunks-b0.jsonl'), 'utf8').trim().split('\n').map((l) => ({ pages: JSON.parse(l).pages })) : null;
const N = pool.length;
const K = 100;
export const TRADITIONS = ['Jewish and Kabbalistic', 'Islamic and Sufi', 'Chinese (Daoist and Confucian)', 'Buddhist', 'Hindu and Indic', 'Christian', 'Hermetic, alchemical and Western esoteric', 'Greek and Roman philosophy'];

// ── tradition-axis expansions (cached) ────────────────────────────────────
const expFile = path.join(here, 'expansions.json');
const exp = fs.existsSync(expFile) ? JSON.parse(fs.readFileSync(expFile, 'utf8')) : {};
for (const q of gold) {
  if (exp[q.qid]) continue;
  const prompt = `A reader of a library of historical primary sources searches for:\n\n"${q.query}"\n\nFor each tradition below, write ONE sentence of at most 35 words that states this idea the way a text of that tradition would itself put it, in the vocabulary its English translations use (include the key transliterated terms). If the tradition frames the matter differently, state its nearest counterpart.\n\n${TRADITIONS.map((t, k) => `[${k + 1}] ${t}`).join('\n')}\n\nAnswer with exactly eight lines, "[n] sentence".`;
  const r = await callGemini({ model: 'gemini-3.1-flash-lite', prompt, endpoint: ENDPOINT, maxOutputTokens: 700, promptVersion: 'tradition-expansion-v1', triggeredBy: 'eval' });
  const lines = [...r.text.matchAll(/^\[(\d)\]\s*(.+)$/gm)].map((m) => m[2].trim());
  if (lines.length !== 8) throw new Error(`expansion for ${q.qid}: ${lines.length} lines`);
  exp[q.qid] = lines;
  fs.writeFileSync(expFile, JSON.stringify(exp, null, 1));
}

// ── query vectors (cached) ────────────────────────────────────────────────
const qFile = path.join(DIR, 'q-vecs.json');
let qv = fs.existsSync(qFile) ? JSON.parse(fs.readFileSync(qFile, 'utf8')) : null;
if (!qv || gold.some((q) => !qv[q.qid])) {
  const texts = gold.flatMap((q) => [q.query, ...exp[q.qid]]);
  const { vecs } = await embedAll(texts, { label: 'queries' });
  qv = {};
  gold.forEach((q, k) => { qv[q.qid] = Array.from({ length: 9 }, (_, j) => Array.from(vecs.subarray((k * 9 + j) * DIMS, (k * 9 + j + 1) * DIMS))); });
  fs.writeFileSync(qFile, JSON.stringify(qv));
}

// ── ranking helpers ───────────────────────────────────────────────────────
const top = (scores, k = K) => Array.from(scores.keys()).sort((x, y) => scores[y] - scores[x]).slice(0, k);
const pageScores = (vecs, q) => { const s = new Float32Array(N); for (let i = 0; i < N; i++) s[i] = dot(vecs, i, q); return s; };
const chunkScores = (vecs, ch, q) => { const s = new Float32Array(N).fill(-1); for (let c = 0; c < ch.length; c++) { const d = dot(vecs, c, q); for (const i of ch[c].pages) if (d > s[i]) s[i] = d; } return s; };
const rrf = (lists, k = 60) => { const s = new Map(); for (const l of lists) l.forEach((i, r) => s.set(i, (s.get(i) || 0) + 1 / (k + r + 1))); return [...s.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]).slice(0, K); };
const trad = (i) => labels[pool[i].book_id];
const quota = (list, cap = 2) => { const n = {}; const out = []; const rest = []; for (const i of list) { const t = trad(i); if ((n[t] || 0) < cap) { n[t] = (n[t] || 0) + 1; out.push(i); } else rest.push(i); } return [...out, ...rest]; };
const book1 = (list) => { const seen = new Set(); const out = []; const rest = []; for (const i of list) { if (seen.has(pool[i].book_id)) rest.push(i); else { seen.add(pool[i].book_id); out.push(i); } } return [...out, ...rest]; };
const mmr = (list, scores, lambda = 0.7, n = 20) => {
  const cand = [...list]; const out = [];
  while (out.length < n && cand.length) {
    let best = -1; let bestV = -Infinity;
    for (let c = 0; c < cand.length; c++) {
      let maxSim = 0;
      for (const o of out) { const sim = dot(va, cand[c], va.subarray(o * DIMS, (o + 1) * DIMS)); if (sim > maxSim) maxSim = sim; }
      const v = lambda * scores[cand[c]] - (1 - lambda) * maxSim;
      if (v > bestV) { bestV = v; best = c; }
    }
    out.push(cand.splice(best, 1)[0]);
  }
  return [...out, ...cand];
};
const interleave = (lists) => { const out = []; const seen = new Set(); for (let r = 0; out.length < K && r < K; r++) for (const l of lists) { const i = l[r]; if (i !== undefined && !seen.has(i)) { seen.add(i); out.push(i); } } return out; };

const rankings = {};
for (const q of gold) {
  const [q0, ...qe] = qv[q.qid].map((v) => Float32Array.from(v));
  const sa = pageScores(va, q0); const a = top(sa);
  const b = top(chunkScores(vb, chunks, q0));
  const c = top(pageScores(vc, q0));
  const ac = rrf([a, c]);
  const eLists = qe.map((v) => { const s = pageScores(va, v); const l = top(s); return { l, best: s[l[0]] }; }).sort((x, y) => y.best - x.best).map((x) => x.l);
  rankings[q.qid] = {
    a, b, c, ac_rrf: ac,
    a_book1: book1(a), a_mmr: mmr(a, sa), a_quota: quota(a), c_quota: quota(c), ac_quota: quota(ac),
    e_rr: interleave(eLists), e_rrf: rrf([a, ...eLists]),
    ...(hasB0 ? { b0: top(chunkScores(vb0, chunks0, q0)) } : {}),
    _sim_a_top10: a.slice(0, 10).map((i) => Number(sa[i].toFixed(4))),
  };
}
fs.writeFileSync(path.join(DIR, 'rankings.json'), JSON.stringify(rankings));

// ── judging queue: every non-gold page in any arm's top 10, arm hidden ────
const queue = [];
for (const q of gold) {
  const g = new Set(q.passages.map((p) => p.i));
  const u = new Set();
  for (const [arm, l] of Object.entries(rankings[q.qid])) if (!arm.startsWith('_')) l.slice(0, 10).forEach((i) => { if (!g.has(i)) u.add(i); });
  // Sorted by pool index so the order says nothing about rank or arm.
  queue.push({ qid: q.qid, query: q.query, pages: [...u].sort((x, y) => x - y) });
}
fs.writeFileSync(path.join(DIR, 'judge-queue.json'), JSON.stringify(queue));
console.log(`arms: ${Object.keys(rankings[gold[0].qid]).filter((k) => !k.startsWith('_')).join(', ')}`);
console.log(`judging queue: ${queue.reduce((s, x) => s + x.pages.length, 0)} pages over ${queue.length} queries (min ${Math.min(...queue.map((x) => x.pages.length))}, max ${Math.max(...queue.map((x) => x.pages.length))})`);
