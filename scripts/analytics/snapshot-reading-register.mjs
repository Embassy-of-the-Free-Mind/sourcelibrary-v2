#!/usr/bin/env node
// Reading Register snapshot writer.
//
// Computes an EXTERNAL-ONLY view of who reads and consults the library: which
// specific books people open, which books external AI agents fetch, what gets
// searched (and what search fails to surface), and which agents call the MCP
// endpoint. Writes ONE document to system_config.reading_register. The protected
// admin page at /platform/(protected)/admin/reading-register reads it and renders
// instantly — it never runs these aggregations on page load.
//
// "External-only" is the point: our own dev CLIs, edge functions, audit probes,
// and `test` queries are filtered out (INTERNAL_RE) so the numbers reflect real
// outside readers and agents, not us. Purely read-only against Mongo `bookstore`.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/snapshot-reading-register.mjs [--days N]
//
// Cron (Hetzner, daily): see scripts/workers/crontab.production.

import { withMongo } from '../lib/mongo.mjs';

const DAYS = (() => { const i = process.argv.indexOf('--days'); return i > -1 ? Number(process.argv[i + 1]) : 30; })();

// Our own traffic — dev CLIs, edge runtime, audit/probe scripts. Excluded everywhere.
const INTERNAL_RE = /claude-code|Deno|SupabaseEdgeRuntime|SaSame-MCP-Audit|Codex local catalog|metadata check|^node$|python-httpx|^curl/i;
// Non-content / noise queries never counted as real search intent.
const NOISE_Q = new Set(['test', '', ' ', 'it', 'wrap', 'ja', 'bvva']);

const PROVIDER_PREFIXES = new Set([
  'internet-archive', 'gallica', 'bavarian-state-library', 'e-codices', 'bodleian',
  'manchester', 'laurenziana', 'e-rara', 'library-of-congress', 'vatican-library',
  'wellcome-collection', 'bdrc', 'kloss-collection', 'allard-pierson', 'cambridge',
  'leiden', 'google-books', 'qatar-digital-library', 'oraec',
  'bibliotheca-philosophica-hermetica', 'tu-delft', 'kyoto', 'british-library',
]);

// Collapse a raw pageview path to a canonical book slug (mirrors snapshot-metrics.mjs).
function bookSlug(raw) {
  if (!raw) return '';
  const parts = raw.split('?')[0].split('/').filter(Boolean);
  if (parts.length && PROVIDER_PREFIXES.has(parts[0])) parts.shift();
  if (parts[0] === 'embed' && parts.length > 2) return parts[2] === 'book' ? (parts[3] || '') : '';
  if (parts[0] === 'book' && parts.length === 2) return parts[1] || ''; // /book/<slug> only, not /page/...
  return '';
}

await withMongo(async (db) => {
  const now = Date.now();
  const SINCE = new Date(now - DAYS * 864e5);
  const books = db.collection('books');
  const pv = db.collection('analytics_pageviews');
  const mc = db.collection('mcp_tool_calls');
  const sq = db.collection('search_queries');

  // Resolve a set of book _id/id/slug values → display titles.
  async function titlesByIdOrSlug(vals, key) {
    const clean = [...new Set(vals)].filter(Boolean);
    if (!clean.length) return {};
    const q = key === 'slug'
      ? { slug: { $in: clean } }
      : { $or: [{ _id: { $in: clean } }, { id: { $in: clean } }] };
    const bs = await books.find(q, { projection: { title: 1, author: 1, id: 1, slug: 1 } }).toArray();
    const m = {};
    for (const b of bs) {
      const rec = { title: b.title || '', author: b.author || '', slug: b.slug || '' };
      if (key === 'slug') { if (b.slug) m[b.slug] = rec; }
      else { m[String(b._id)] = rec; if (b.id) m[b.id] = rec; }
    }
    return m;
  }

  // ---- data span ----
  const [mcMin] = await mc.find({}).sort({ ts: 1 }).limit(1).project({ ts: 1 }).toArray();
  const logsSince = mcMin?.ts ? new Date(mcMin.ts).toISOString().slice(0, 10) : null;

  // ---- readers: specific books opened (human page views) ----
  // Group by path in Mongo (fast, indexed prefix) rather than streaming ~400K
  // docs into Node. Counts landing views on /book/<slug> (not /page/ subpaths),
  // matching the artifact semantics; provider/embed book URLs are a small tail
  // folded elsewhere (top-books here is the canonical-URL ranking).
  const readerAgg = await pv.aggregate([
    { $match: { timestamp: { $gte: SINCE }, path: { $regex: '^/book/[^/]+$' } } },
    { $group: { _id: '$path', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 20 },
  ]).toArray();
  const readerTop = readerAgg.map((r) => [bookSlug(r._id), r.n]).filter(([s]) => s);
  const rMap = await titlesByIdOrSlug(readerTop.map(([s]) => s), 'slug');
  const readerBooks = readerTop.map(([slug, hits]) => ({
    slug, hits, title: rMap[slug]?.title || slug, author: rMap[slug]?.author || '',
  }));

  // ---- agents: specific books consulted (external MCP) ----
  const agentBookAgg = await mc.aggregate([
    { $match: { ts: { $gte: SINCE }, 'args.book_id': { $exists: true }, user_agent: { $not: INTERNAL_RE } } },
    { $group: { _id: '$args.book_id', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 15 },
  ]).toArray();
  const aMap = await titlesByIdOrSlug(agentBookAgg.map((r) => r._id), 'id');
  const agentBooks = agentBookAgg.map((r) => ({
    n: r.n, title: aMap[r._id]?.title || String(r._id), author: aMap[r._id]?.author || '',
  }));

  // ---- external MCP: totals, clients, breakdown ----
  const mcpTotal = await mc.countDocuments({ ts: { $gte: SINCE } });
  const mcpExternal = await mc.countDocuments({ ts: { $gte: SINCE }, user_agent: { $not: INTERNAL_RE } });
  const mcpInternal = mcpTotal - mcpExternal;
  const extClients = (await mc.distinct('ip_hash', { ts: { $gte: SINCE }, user_agent: { $not: INTERNAL_RE } })).length;
  const claudeUser = await mc.countDocuments({ ts: { $gte: SINCE }, user_agent: /Claude-User/i });
  const byUAraw = await mc.aggregate([
    { $match: { ts: { $gte: SINCE }, user_agent: { $not: INTERNAL_RE } } },
    { $group: { _id: '$user_agent', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 30 },
  ]).toArray();
  // fold near-identical browser UAs into one bucket
  let browserBucket = 0;
  const clientRows = [];
  for (const r of byUAraw) {
    const ua = r._id || '';
    if (/^Mozilla/.test(ua)) { browserBucket += r.n; continue; }
    clientRows.push({ client: ua.slice(0, 48), n: r.n });
  }
  if (browserBucket) clientRows.push({ client: 'browser-based agents · misc', n: browserBucket });
  clientRows.sort((a, b) => b.n - a.n);

  // ---- external MCP queries ----
  const extQ = await mc.aggregate([
    { $match: { ts: { $gte: SINCE }, 'args.query': { $exists: true }, user_agent: { $not: INTERNAL_RE } } },
    { $group: { _id: '$args.query', n: { $sum: 1 }, tools: { $addToSet: '$tool' } } },
    { $sort: { n: -1 } }, { $limit: 30 },
  ]).toArray();
  const agentQueries = extQ
    .filter((r) => r._id && !NOISE_Q.has(String(r._id).toLowerCase()))
    .map((r) => ({ query: String(r._id).slice(0, 80), n: r.n, tools: r.tools }))
    .slice(0, 18);

  // ---- human web search ----
  const humanSearchers = (await sq.distinct('ip_hash', { ts: { $gte: SINCE }, user_agent: /^Mozilla/ })).length;
  const humanSearches = await sq.countDocuments({ ts: { $gte: SINCE }, user_agent: /^Mozilla/, query: { $nin: [...NOISE_Q] } });
  const topQ = await sq.aggregate([
    { $match: { ts: { $gte: SINCE }, user_agent: /^Mozilla/, query: { $nin: [...NOISE_Q] } } },
    { $group: { _id: { $toLower: '$query' }, n: { $sum: 1 }, avg: { $avg: '$total' } } },
    { $sort: { n: -1 } }, { $limit: 15 },
  ]).toArray();
  const topQueries = topQ.filter((r) => r._id).map((r) => ({ query: r._id, n: r.n, avgResults: Math.round(r.avg || 0) }));
  const zeroQ = await sq.aggregate([
    { $match: { ts: { $gte: SINCE }, total: 0, query: { $nin: [...NOISE_Q] } } },
    { $group: { _id: { $toLower: '$query' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 15 },
  ]).toArray();
  // annotate zero-result queries with whether we actually hold matches (recall-bug vs true gap)
  const zeroQueries = [];
  for (const r of zeroQ) {
    const q = String(r._id || '').trim();
    if (!q || q.length < 4) continue; // skip typeahead fragments
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const held = await books.countDocuments({ $or: [{ title: rx }, { author: rx }] });
    const visible = held ? await books.countDocuments({ $or: [{ title: rx }, { author: rx }], visible: true }) : 0;
    zeroQueries.push({ query: q, n: r.n, held, visible });
  }

  const snapshot = {
    _id: 'reading_register',
    schemaVersion: 1,
    generatedAt: new Date(),
    windowDays: DAYS,
    since: SINCE,
    logsSince,
    headline: {
      readerViews: 0, // set below
      humanSearchers,
      humanSearches,
      mcpExternal,
      mcpInternal,
      extClients,
      claudeUser,
    },
    readerBooks,
    agentBooks,
    mcp: { total: mcpTotal, external: mcpExternal, internal: mcpInternal, clients: extClients, claudeUser, clientRows: clientRows.slice(0, 8) },
    agentQueries,
    search: { humanSearchers, humanSearches, topQueries, zeroQueries },
  };

  // total reader views over the window (all book page views, for the headline)
  snapshot.headline.readerViews = await pv.countDocuments({ timestamp: { $gte: SINCE }, path: /^\/(book|embed)\// });

  const res = await db.collection('system_config').updateOne(
    { _id: 'reading_register' },
    { $set: snapshot },
    { upsert: true },
  );
  console.log(`reading_register written (matched=${res.matchedCount} upserted=${res.upsertedCount ? 1 : 0}). generatedAt=${snapshot.generatedAt.toISOString()} window=${DAYS}d`);
  console.log(`  readers: ${snapshot.headline.readerViews.toLocaleString()} views · agents: ${mcpExternal} external calls / ${extClients} clients (${mcpInternal} internal excluded) · searchers: ${humanSearchers}`);
});
