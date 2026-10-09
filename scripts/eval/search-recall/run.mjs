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
 *                                  (raw.json from local/route.harness.ts: this checkout's route, prod data)
 *   node scripts/eval/search-recall/run.mjs --compare before.json after.json
 *
 * recall@k = expected works in the top k results / min(k, expected works).
 * The route collapses to one row per work, so a result is a work.
 *
 * --suite nav (#5945): 42 navigational queries (nav-queries.json: a page's name
 * → the URL it should lead to) against /api/search/unified. Scored on the
 * destinations the search page shows above the books, in the page's order: the
 * client's "go here" card (matchKnownEntity), then the collection cards and the
 * "From the site" links (a link the response marks `match: 'name'` comes before the cards).
 * recall@k = 1 if an expected URL is in the first k destinations, else 0.
 * Run it under tsx (it imports src/lib/known-entities.ts):
 *   node_modules/.bin/tsx scripts/eval/search-recall/run.mjs --suite nav [--base-url <preview>] [--out f.json]
 * Requests carry X-Warm-Ping, the internal-traffic header anon-gate.ts exempts,
 * so 42 queries do not meet the anonymous 5-searches-an-hour wall.
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
const NAV = arg('suite') === 'nav';
// --queries <file beside this script>: another query set for the same suite (nav-queries-heldout.json).
const { queries } = load(path.join(DIR, arg('queries', NAV ? 'nav-queries.json' : 'queries.json')));
const expectedById = NAV ? new Map() : new Map(load(path.join(DIR, 'expected.json')).queries.map(q => [q.id, q]));
const KINDS = NAV ? [...new Set(queries.map(q => q.kind))] : ['name', 'variant', 'concept-modern', 'concept-period'];
// The two scored cut-offs: row fields and their column headings.
const [M1, M2] = NAV ? [['r1', 'R@1'], ['r3', 'R@3']] : [['r10', 'R@10'], ['r20', 'R@20']];

export function recallAtK(results, expected, k) {
  if (expected.length === 0) return null;
  const top = new Set(results.slice(0, k).map(r => r.book_id));
  const found = expected.filter(g => g.book_ids.some(id => top.has(id))).length;
  return found / Math.min(k, expected.length);
}

/**
 * Destinations in the order /search renders them above the book results: pages
 * the query names, collection cards, then the other "From the site" links.
 * A collection card links to /collections/<slug> whoever owns the collection.
 */
export function navDestinations(res, knownHref) {
  const site = res.site?.results || [];
  const named = site.filter(r => r.match === 'name').map(r => r.url);
  const rest = site.filter(r => r.match !== 'name').map(r => r.url);
  const cols = (res.collections?.results || []).map(c => `/collections/${c.slug}`);
  return [...new Set([knownHref, ...named, ...cols, ...rest].filter(Boolean))];
}

function scoreNav(responses, knownHrefOf) {
  return queries.map(q => {
    const res = responses[q.id] || {};
    const known = knownHrefOf(q.query);
    const dest = navDestinations(res, known);
    const rank = dest.findIndex(u => q.expect.includes(u)) + 1; // 0 = not shown
    return {
      id: q.id, kind: q.kind, query: q.query,
      r1: rank === 1 ? 1 : 0,
      r3: rank >= 1 && rank <= 3 ? 1 : 0,
      total: dest.length,
      ranking: rank ? `#${rank}${known && q.expect.includes(known) ? ' card' : ''}` : 'miss',
      degraded: [],
      error: res.error || null,
      top: dest.slice(0, 6),
    };
  });
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
    by[kind] = { n: sel.length, [M1[0]]: mean(sel.map(r => r[M1[0]])), [M2[0]]: mean(sel.map(r => r[M2[0]])) };
  }
  return by;
}

function print(rows) {
  console.log(`${'query'.padEnd(32)} ${'ranking'.padEnd(20)} total   ${M1[1].padStart(4)}  ${M2[1].padStart(4)}  ${NAV ? 'shown' : 'degraded'}`);
  for (const r of rows) {
    console.log(`${r.query.slice(0, 31).padEnd(32)} ${String(r.ranking).padEnd(20)} ${String(r.total).padStart(5)}  ${f(r[M1[0]])} ${f(r[M2[0]])}  ${r.error || (NAV ? r.top.slice(0, 3).join(' ') : r.degraded.join(','))}`);
  }
  for (const [kind, s] of Object.entries(summarize(rows))) {
    console.log(`MEAN ${kind.padEnd(16)} n=${String(s.n).padStart(2)}  ${M1[1]} ${f(s[M1[0]])}  ${M2[1]} ${f(s[M2[0]])}`);
  }
}

const cmp = process.argv.indexOf('--compare');
if (cmp > -1) {
  const [a, b] = [load(process.argv[cmp + 1]).rows, load(process.argv[cmp + 2]).rows];
  const bById = new Map(b.map(r => [r.id, r]));
  const [k1, k2] = [M1[0], M2[0]];
  console.log(`| query | kind | ${NAV ? 'rank' : 'total'} | ${M1[1]} | ${M2[1]} | |`);
  console.log('|---|---|---|---|---|---|');
  for (const r of a) {
    const s = bById.get(r.id);
    const worse = s[k1] < r[k1] - 1e-9 || s[k2] < r[k2] - 1e-9;
    const better = !worse && (s[k1] > r[k1] + 1e-9 || s[k2] > r[k2] + 1e-9);
    const moved = NAV ? `${r.ranking} → ${s.ranking}` : `${r.total} → ${s.total}`;
    console.log(`| ${r.query} | ${r.kind} | ${moved} | ${f(r[k1]).trim()} → ${f(s[k1]).trim()} | ${f(r[k2]).trim()} → ${f(s[k2]).trim()} | ${worse ? '**worse**' : better ? 'better' : ''} |`);
  }
  const [sa, sb] = [summarize(a), summarize(b)];
  for (const kind of [...KINDS, 'all']) {
    console.log(`| **mean, ${kind}** (n=${sa[kind].n}) | | | **${f(sa[kind][k1]).trim()} → ${f(sb[kind][k1]).trim()}** | **${f(sa[kind][k2]).trim()} → ${f(sb[kind][k2]).trim()}** | |`);
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
    const url = NAV
      ? `${base}/api/search/unified?q=${encodeURIComponent(q.query)}`
      : `${base}/api/search?q=${encodeURIComponent(q.query)}&limit=20${ranking ? `&ranking=${ranking}` : ''}&_=${Date.now()}`;
    try {
      const res = await fetch(url, {
        headers: NAV ? { 'X-Warm-Ping': '1', 'User-Agent': 'SourceLibrary-NavEval/1.0 (+https://sourcelibrary.org)' } : {},
        signal: AbortSignal.timeout(30000),
      });
      responses[q.id] = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    } catch (e) {
      responses[q.id] = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}
let rows;
if (NAV) {
  // The "go here" card is client-side: the page matches the query against the
  // live collections list and the feature registry. Same function, same list.
  const { matchKnownEntity } = await import('../../../src/lib/known-entities.ts');
  const colRes = await fetch('https://sourcelibrary.org/api/collections', { signal: AbortSignal.timeout(30000) });
  if (!colRes.ok) throw new Error(`/api/collections: HTTP ${colRes.status}; the "go here" card cannot be scored without it`);
  const { collections } = await colRes.json();
  rows = scoreNav(responses, query => matchKnownEntity(query, { collections })?.href || null);
} else {
  rows = score(responses);
}
print(rows);
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), source: from || base, ranking: ranking || 'default', rows }, null, 1) + '\n');
