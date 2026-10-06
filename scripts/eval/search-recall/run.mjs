#!/usr/bin/env node
/**
 * Site-search recall eval (#5905): 30 fixed queries against /api/search,
 * scored on whether the books that print the name or concept most come back.
 *
 * PRIOR ART: scripts/eval/librarian-search/run.mjs — runs Librarian tool
 * variants in-process against hand labels; this one scores the public route's
 * response (prod, a preview, or a saved file) against expected.json.
 * scripts/eval/search-quality-eval.mjs — pass/fail assertions, no recall.
 *
 *   node scripts/eval/search-recall/run.mjs                          # prod
 *   node scripts/eval/search-recall/run.mjs --base-url <preview> --out after.json
 *   node scripts/eval/search-recall/run.mjs --ranking rrf            # force a strategy
 *   node scripts/eval/search-recall/run.mjs --from raw.json          # score saved responses
 *   node scripts/eval/search-recall/run.mjs --compare before.json after.json
 *
 * recall@k = expected works in the top k results / min(k, expected works).
 * The route collapses to one row per work, so a result is a work.
 *
 * What this cannot tell you: expected.json ranks books by how many pages print
 * the term. A lane that orders by that same count scores well by construction;
 * read a few result lists by eye before believing a gain.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const load = f => JSON.parse(readFileSync(f, 'utf8'));
const { queries } = load(path.join(DIR, 'queries.json'));
const expectedById = new Map(load(path.join(DIR, 'expected.json')).queries.map(q => [q.id, q]));
const KINDS = ['name', 'variant', 'concept-modern', 'concept-period'];

export function recallAtK(results, expected, k) {
  if (expected.length === 0) return null;
  const top = new Set(results.slice(0, k).map(r => r.book_id));
  const found = expected.filter(g => g.book_ids.some(id => top.has(id))).length;
  return found / Math.min(k, expected.length);
}

function score(responses) {
  return queries.map(q => {
    const res = responses[q.id] || {};
    const results = res.results || [];
    const expected = expectedById.get(q.id).expected;
    return {
      id: q.id, kind: q.kind, query: q.query,
      r10: recallAtK(results, expected, 10),
      r20: recallAtK(results, expected, 20),
      total: res.total ?? null,
      ranking: res.ranking ?? null,
      degraded: res.degraded_lanes || [],
      error: res.error || null,
      top: results.slice(0, 20).map(r => r.book_id),
    };
  });
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const f = x => (x == null || Number.isNaN(x) ? '  –  ' : x.toFixed(2).padStart(5));

function summarize(rows) {
  const by = {};
  for (const kind of [...KINDS, 'all']) {
    const sel = rows.filter(r => kind === 'all' || r.kind === kind);
    by[kind] = { n: sel.length, r10: mean(sel.map(r => r.r10)), r20: mean(sel.map(r => r.r20)) };
  }
  return by;
}

function print(rows) {
  console.log(`${'query'.padEnd(32)} ${'ranking'.padEnd(20)} total   R@10  R@20  degraded`);
  for (const r of rows) {
    console.log(`${r.query.slice(0, 31).padEnd(32)} ${String(r.ranking).padEnd(20)} ${String(r.total).padStart(5)}  ${f(r.r10)} ${f(r.r20)}  ${r.error || r.degraded.join(',')}`);
  }
  for (const [kind, s] of Object.entries(summarize(rows))) {
    console.log(`MEAN ${kind.padEnd(16)} n=${String(s.n).padStart(2)}  R@10 ${f(s.r10)}  R@20 ${f(s.r20)}`);
  }
}

const cmp = process.argv.indexOf('--compare');
if (cmp > -1) {
  const [a, b] = [load(process.argv[cmp + 1]).rows, load(process.argv[cmp + 2]).rows];
  const bById = new Map(b.map(r => [r.id, r]));
  console.log('| query | kind | total | R@10 | R@20 | |');
  console.log('|---|---|---|---|---|---|');
  for (const r of a) {
    const s = bById.get(r.id);
    const worse = s.r10 < r.r10 - 1e-9 || s.r20 < r.r20 - 1e-9;
    const better = !worse && (s.r10 > r.r10 + 1e-9 || s.r20 > r.r20 + 1e-9);
    console.log(`| ${r.query} | ${r.kind} | ${r.total} → ${s.total} | ${f(r.r10).trim()} → ${f(s.r10).trim()} | ${f(r.r20).trim()} → ${f(s.r20).trim()} | ${worse ? '**worse**' : better ? 'better' : ''} |`);
  }
  const [sa, sb] = [summarize(a), summarize(b)];
  for (const kind of [...KINDS, 'all']) {
    console.log(`| **mean, ${kind}** (n=${sa[kind].n}) | | | **${f(sa[kind].r10).trim()} → ${f(sb[kind].r10).trim()}** | **${f(sa[kind].r20).trim()} → ${f(sb[kind].r20).trim()}** | |`);
  }
  process.exit(0);
}

let responses = {};
const from = arg('from');
const base = arg('base-url', 'https://sourcelibrary.org');
const ranking = arg('ranking');
if (from) {
  responses = load(from);
} else {
  for (const q of queries) {
    // `limit=20` is the route's default page; `_` defeats the 60 s edge cache
    // so a degraded response is this run's, not a neighbour's.
    const url = `${base}/api/search?q=${encodeURIComponent(q.query)}&limit=20${ranking ? `&ranking=${ranking}` : ''}&_=${Date.now()}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      responses[q.id] = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    } catch (e) {
      responses[q.id] = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}
const rows = score(responses);
print(rows);
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), source: from || base, ranking: ranking || 'default', rows }, null, 1) + '\n');
