#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/score.mjs — recall@10 / MRR of the
 * #5729 arms over JSONL vectors, one gold page per query, arms fixed to
 * gemini / e5 / bge-m3. scripts/eval/librarian-search/metrics.mjs — the matcher
 * and recall over LIVE search hits. Neither takes a (query form × document form
 * × dimension) grid, a book-level gold over a local pool, or a paired comparison
 * against a baseline arm. Wilson comes from lib/agreement-stats.mjs, the sign
 * test from lib/paired-stats.mjs.
 *
 * score — recall@10 for the #6170 arms on both gold sets.
 *
 *   A hit: (A) the gold page is in the top 10 pages of the pool;
 *          (B) a page of ANY expected book is in the top 10 pages.
 *   Views: full    — every pool page (arms whose documents were embedded fresh);
 *          covered — pool pages production holds a usable vector for, and the
 *                    queries whose gold survives (every arm, stored ones included).
 *   Each arm is paired against the view's baseline: queries gained / lost at
 *   rank <= 10 and a two-sided sign test.
 *
 *   node scripts/eval/embed-format/score.mjs --dir D [--json results/2026-10-07-score.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/agreement-stats.mjs';
import { binomTwoSided } from '../lib/paired-stats.mjs';
import { arg, readJsonl, loadMatrix, FULL_DIMS } from './common.mjs';

const DIR = arg('--dir');
const K = 10;
const here = path.dirname(fileURLToPath(import.meta.url));
const Q = JSON.parse(fs.readFileSync(path.join(DIR, 'queries.json'), 'utf8'));

// arm → [query vectors, document vectors, dims]. `plain`/`prefix` documents were
// embedded with the GA model; compat.mjs shows the preview model returns the same
// numbers, so a "preview" document arm and a "GA" one differ only in the label.
const ARMS = [
  ['1 current (stored docs, plain query)', 'preview-plain', 'stored', 768],
  ['1f current, re-embedded today (plain/plain)', 'preview-plain', 'plain', 768],
  ['2 query prefix, stored docs', 'preview-search', 'stored', 768],
  ['2f query prefix, fresh plain docs', 'preview-search', 'plain', 768],
  ['2x question-answering prefix, fresh plain docs (exploratory)', 'preview-qa', 'plain', 768],
  ['2d document prefix only (exploratory)', 'preview-plain', 'prefix', 768],
  ['3 preview query prefix + prefixed docs', 'preview-search', 'prefix', 768],
  ['4 GA, prefix both sides, 768', 'ga-search', 'prefix', 768],
  ['5 GA, prefix both sides, 1536', 'ga-search', 'prefix', 1536],
  ['5 GA, prefix both sides, 3072', 'ga-search', 'prefix', 3072],
  ['5p GA, plain both sides, 1536', 'ga-plain', 'plain', 1536],
  ['5p GA, plain both sides, 3072', 'ga-plain', 'plain', 3072],
  ['6 GA plain query on stored preview docs', 'ga-plain', 'stored', 768],
];
const BASE = { full: ARMS[1][0], covered: ARMS[0][0] };

function loadSet(pool) {
  const rows = readJsonl(path.join(DIR, pool, 'pool.jsonl'));
  const docs = {
    stored: loadMatrix(path.join(DIR, pool, 'stored.f32'), 768),
    plain: loadMatrix(path.join(DIR, pool, 'doc-ga-plain.f32'), FULL_DIMS),
    prefix: loadMatrix(path.join(DIR, pool, 'doc-ga-prefix.f32'), FULL_DIMS),
  };
  const mask = JSON.parse(fs.readFileSync(path.join(DIR, pool, 'stored-mask.json'), 'utf8'));
  let queries;
  if (pool === 'A') {
    const index = new Map(rows.map((r, i) => [`${r.book_id}:${r.page_number}`, i]));
    queries = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries
      .map((q) => ({ id: q.qid, stratum: q.lang, gold: new Set([index.get(`${q.book_id}:${q.page_number}`)]) }));
  } else {
    queries = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries.map((q) => {
      const slugs = new Set(q.expected.map((e) => e.book_slug));
      return { id: q.id, stratum: q.category, gold: new Set(rows.map((r, i) => (slugs.has(r.slug) ? i : -1)).filter((i) => i >= 0)) };
    });
  }
  return { rows, docs, mask, queries };
}

/** Cosine of query (cut to d) against every row of m (cut to d). */
function scores(qv, m, d) {
  let qn = 0; for (let k = 0; k < d; k++) qn += qv[k] * qv[k];
  qn = Math.sqrt(qn) || 1;
  const out = new Float32Array(m.rows);
  for (let i = 0; i < m.rows; i++) {
    const o = i * m.dims; let s = 0, n = 0;
    for (let k = 0; k < d; k++) { const x = m.data[o + k]; s += x * qv[k]; n += x * x; }
    out[i] = n ? s / (Math.sqrt(n) * qn) : -2;
  }
  return out;
}

function summarise(per) {
  const n = per.length, hits = per.filter((r) => r.rank <= K).length;
  const strata = {};
  for (const r of per) { const s = (strata[r.stratum] ??= { n: 0, hits: 0 }); s.n++; if (r.rank <= K) s.hits++; }
  return { n, hits, recall: hits / n, ci: wilson(hits, n), mrr: per.reduce((s, r) => s + 1 / r.rank, 0) / n, top1: per.filter((r) => r.rank === 1).length, strata };
}

const out = { k: K, sets: {} };
for (const pool of ['A', 'B']) {
  const S = loadSet(pool);
  const all = S.rows.map((_, i) => i);
  const covered = all.filter((i) => S.mask[i] === 1);
  const coveredSet = new Set(covered);
  const views = {
    full: { cand: all, queries: S.queries.map((q) => ({ ...q })) },
    covered: { cand: covered, queries: S.queries.map((q) => ({ ...q, gold: new Set([...q.gold].filter((i) => coveredSet.has(i))) })).filter((q) => q.gold.size) },
  };
  out.sets[pool] = { pool: S.rows.length, views: {} };
  for (const [view, spec] of Object.entries(views)) {
    const res = { candidates: spec.cand.length, queries: spec.queries.length, arms: {}, perQuery: {} };
    for (const [name, qk, dk, d] of ARMS) {
      if (dk === 'stored' && view === 'full') continue;
      const per = spec.queries.map((q) => {
        const sc = scores(Q[pool][qk][q.id], S.docs[dk], d);
        let best = -2; for (const i of q.gold) if (sc[i] > best) best = sc[i];
        let better = 0; for (const i of spec.cand) if (!q.gold.has(i) && sc[i] > best) better++;
        return { id: q.id, stratum: q.stratum, rank: better + 1 };
      });
      res.arms[name] = summarise(per);
      for (const r of per) (res.perQuery[r.id] ??= {})[name] = r.rank;
    }
    const base = BASE[view];
    for (const [name, a] of Object.entries(res.arms)) {
      if (name === base) continue;
      let gained = 0, lost = 0, up = 0, down = 0;
      for (const ranks of Object.values(res.perQuery)) {
        if (ranks[name] <= K && ranks[base] > K) gained++;
        if (ranks[name] > K && ranks[base] <= K) lost++;
        if (ranks[name] < ranks[base]) up++; else if (ranks[name] > ranks[base]) down++;
      }
      a.vsBase = { delta: a.recall - res.arms[base].recall, gained, lost, rankBetter: up, rankWorse: down, signP: binomTwoSided(up, up + down) };
    }
    out.sets[pool].views[view] = res;
    console.log(`\n### ${pool} · ${view}: ${res.candidates} pages, ${res.queries} queries (baseline: ${base})`);
    const strata = Object.keys(Object.values(res.arms)[0].strata);
    console.log(`| arm | R@10 | 95% | MRR | top-1 | Δ R@10 | gained/lost | rank better/worse (sign p) | ${strata.join(' | ')} |`);
    console.log(`|${'---|'.repeat(8 + strata.length)}`);
    for (const [name, a] of Object.entries(res.arms)) {
      const v = a.vsBase;
      console.log(`| ${name} | ${a.recall.toFixed(2)} (${a.hits}/${a.n}) | [${a.ci.map((x) => x.toFixed(2)).join(', ')}] | ${a.mrr.toFixed(2)} | ${a.top1} | ${v ? (v.delta >= 0 ? '+' : '') + v.delta.toFixed(3) : 'base'} | ${v ? `${v.gained}/${v.lost}` : ''} | ${v ? `${v.rankBetter}/${v.rankWorse} (${v.signP.toFixed(2)})` : ''} | ${strata.map((s) => `${a.strata[s].hits}/${a.strata[s].n}`).join(' | ')} |`);
    }
  }
}
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
