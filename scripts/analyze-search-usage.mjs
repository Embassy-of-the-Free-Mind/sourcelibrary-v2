#!/usr/bin/env node
/**
 * Unified search / MCP usage report.
 *
 * Reads two collections:
 *   - mcp_tool_calls: every MCP tool invocation (incl. search_concept,
 *     search_library, search_translations, search_within_book, etc.)
 *   - search_queries: direct hits on /api/search and /api/search/semantic
 *     (filled by lib/search-log.ts — only data from after that deploy)
 *
 * Reports:
 *   1. MCP tool mix + latency + error rates
 *   2. Top search queries (MCP + web, merged)
 *   3. Top queries by route (search_concept vs search.semantic.page etc.)
 *   4. Top user-agents
 *   5. Daily volume trend
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analyze-search-usage.mjs [--days N] [--top N]
 */

import { MongoClient } from 'mongodb';

const args = {};
for (let i = 0; i < process.argv.length - 2; i++) {
  const arg = process.argv[i + 2];
  const eq = arg.match(/^--([^=]+)=(.*)$/);
  if (eq) { args[eq[1]] = eq[2]; continue; }
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = process.argv[i + 3];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else { args[key] = 'true'; }
  }
}

const DAYS = Number(args.days || 7);
const TOP = Number(args.top || 30);
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set. Source .env.production.local first.'); process.exit(1); }

function fmtNum(n) { return n.toLocaleString(); }
function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);

  console.log(`Source Library — search & MCP usage report`);
  console.log(`Window: ${since.toISOString()} → now (${DAYS} days)`);
  console.log('='.repeat(76));

  // --- 1. MCP tool mix + latency + errors ---
  const mcpCol = db.collection('mcp_tool_calls');
  const mcpTotal = await mcpCol.countDocuments({ ts: { $gte: since } });
  const byTool = await mcpCol.aggregate([
    { $match: { ts: { $gte: since } } },
    {
      $group: {
        _id: '$tool',
        n: { $sum: 1 },
        errs: { $sum: { $cond: ['$ok', 0, 1] } },
        ms_all: { $push: '$ms' },
      },
    },
    { $sort: { n: -1 } },
  ]).toArray();

  console.log(`\n[1] MCP tool calls: ${fmtNum(mcpTotal)} total\n`);
  console.log(`  ${pad('tool', 22)} ${rpad('calls', 6)}  ${rpad('errs', 5)}  ${rpad('p50ms', 7)} ${rpad('p95ms', 7)} ${rpad('p99ms', 7)}`);
  for (const t of byTool) {
    const sorted = t.ms_all.sort((a, b) => a - b);
    const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
    console.log(`  ${pad(t._id || '?', 22)} ${rpad(t.n, 6)}  ${rpad(t.errs, 5)}  ${rpad(p(50), 7)} ${rpad(p(95), 7)} ${rpad(p(99), 7)}`);
  }

  // --- 2. Web search queries (search_queries collection) ---
  const sqCol = db.collection('search_queries');
  const sqExists = await db.listCollections({ name: 'search_queries' }).hasNext();
  let webTotal = 0;
  let byRouteWeb = [];
  if (sqExists) {
    webTotal = await sqCol.countDocuments({ ts: { $gte: since } });
    byRouteWeb = await sqCol.aggregate([
      { $match: { ts: { $gte: since } } },
      {
        $group: {
          _id: '$route',
          n: { $sum: 1 },
          errs: { $sum: { $cond: ['$ok', 0, 1] } },
          mean_total: { $avg: '$total' },
        },
      },
      { $sort: { n: -1 } },
    ]).toArray();
    console.log(`\n[2] Direct (non-MCP) search calls: ${fmtNum(webTotal)} total\n`);
    console.log(`  ${pad('route', 28)} ${rpad('calls', 6)}  ${rpad('errs', 5)}  ${rpad('mean_total', 11)}`);
    for (const r of byRouteWeb) {
      console.log(`  ${pad(r._id || '?', 28)} ${rpad(r.n, 6)}  ${rpad(r.errs, 5)}  ${rpad(Math.round(r.mean_total || 0), 11)}`);
    }
  } else {
    console.log(`\n[2] Direct (non-MCP) search calls: collection does not exist yet`);
    console.log(`    (the search_queries collection is created on first write — wait for one /api/search hit after deploy)`);
  }

  // --- 3. Top queries (MCP + web, merged) ---
  // From MCP: tools whose args contain a 'query' field (all search_* + get_quote-ish)
  const mcpQueries = await mcpCol.aggregate([
    { $match: { ts: { $gte: since }, 'args.query': { $exists: true, $type: 'string', $ne: '' } } },
    { $group: { _id: { q: '$args.query', src: 'mcp' }, n: { $sum: 1 }, tools: { $addToSet: '$tool' } } },
  ]).toArray();
  let webQueries = [];
  if (sqExists) {
    webQueries = await sqCol.aggregate([
      { $match: { ts: { $gte: since }, query: { $ne: '' } } },
      { $group: { _id: { q: '$query', src: 'web' }, n: { $sum: 1 }, tools: { $addToSet: '$route' } } },
    ]).toArray();
  }

  // Merge by query string
  const merged = new Map();
  for (const r of [...mcpQueries, ...webQueries]) {
    const key = r._id.q;
    const existing = merged.get(key) || { q: key, n: 0, sources: new Set(), tools: new Set() };
    existing.n += r.n;
    existing.sources.add(r._id.src);
    for (const t of r.tools || []) existing.tools.add(t);
    merged.set(key, existing);
  }
  const sortedQueries = [...merged.values()].sort((a, b) => b.n - a.n).slice(0, TOP);

  console.log(`\n[3] Top ${TOP} queries (MCP + web merged, ${fmtNum(merged.size)} unique queries total):\n`);
  console.log(`  ${rpad('n', 4)}  ${pad('src', 8)} ${pad('routes/tools', 32)} query`);
  for (const q of sortedQueries) {
    const src = [...q.sources].join(',');
    const tools = [...q.tools].slice(0, 3).join(',');
    const qstr = JSON.stringify(q.q).slice(0, 80);
    console.log(`  ${rpad(q.n, 4)}  ${pad(src, 8)} ${pad(tools, 32)} ${qstr}`);
  }

  // --- 4. User-agent mix (MCP only — web side has it too but we keep this terse) ---
  const byUa = await mcpCol.aggregate([
    { $match: { ts: { $gte: since } } },
    { $project: { ua_stem: { $substr: ['$user_agent', 0, 40] } } },
    { $group: { _id: '$ua_stem', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 10 },
  ]).toArray();
  console.log(`\n[4] Top MCP user-agent prefixes (first 40 chars):\n`);
  for (const r of byUa) {
    console.log(`  ${pad(r._id || '(none)', 42)} ${rpad(r.n, 6)}`);
  }

  // --- 5. Daily volume trend ---
  const daily = await mcpCol.aggregate([
    { $match: { ts: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d' } },
        n: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log(`\n[5] Daily MCP call volume:\n`);
  for (const d of daily) {
    const bar = '█'.repeat(Math.min(60, Math.ceil(d.n / Math.max(1, mcpTotal / DAYS / 10))));
    console.log(`  ${d._id}  ${rpad(d.n, 5)} ${bar}`);
  }

  console.log('\n' + '='.repeat(76));

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
