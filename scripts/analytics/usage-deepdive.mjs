#!/usr/bin/env node
// Usage deep-dive over the last N days of Mongo analytics.
// Source: analytics_pageviews, analytics_events, search_queries.
// Sessionization: (ip + userAgent) within a 30-minute idle window.
//   IPs already have last-octet zeroed at ingest, so this is a coarse but
//   honest proxy. Bot-y user agents are filtered.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/usage-deepdive.mjs [--days N]

import { MongoClient } from 'mongodb';

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  return i > -1 ? Number(process.argv[i + 1]) : 30;
})();
const SINCE = new Date(Date.now() - DAYS * 86400 * 1000);
const IDLE_MS = 30 * 60 * 1000;

const BOT_RE = /(bot|crawler|spider|preview|monitor|uptime|wget|curl|python-requests|libwww|http-client|headless|chrome-lighthouse|MCP)/i;

// Tenant subdomain hosts that route through /embed/<tenant>/...
const TENANT_HOSTS = new Set(['bph', 'bhutan', 'kloss-collection', 'jung']);

// Provider prefixes that PR #2025 (merged 2026-05-26) now redirects away.
// Before that fix these served live content; we normalize them for analysis.
const PROVIDER_PREFIXES = new Set([
  'internet-archive', 'gallica', 'bavarian-state-library', 'e-codices',
  'bodleian', 'manchester', 'laurenziana', 'e-rara', 'library-of-congress',
  'vatican-library', 'wellcome-collection', 'bdrc', 'kloss-collection',
  'allard-pierson', 'cambridge', 'leiden', 'google-books', 'qatar-digital-library',
  'oraec', 'bibliotheca-philosophica-hermetica', 'tu-delft', 'kyoto',
  'british-library',
]);

function isBot(ua) {
  if (!ua) return true;
  return BOT_RE.test(ua);
}

// Collapse legacy provider-prefixed paths so /internet-archive/book/foo is
// counted as /book/foo. Also normalizes /bph/book/foo (legacy main-host
// version of BPH-prefixed URLs) and trims querystrings.
function normalizePath(p) {
  if (!p) return '';
  let s = p.split('?')[0];
  const parts = s.split('/').filter(Boolean);
  if (parts.length && PROVIDER_PREFIXES.has(parts[0])) {
    parts.shift();
    s = '/' + parts.join('/');
  } else if (parts.length && parts[0] === 'bph' && parts.length > 1) {
    // /bph/book/foo  ->  /embed/bph/book/foo (treat as tenant traffic)
    s = '/embed/bph/' + parts.slice(1).join('/');
  }
  return s || '/';
}

function pathKind(p) {
  if (!p) return { kind: 'unknown' };
  if (p.startsWith('/embed/')) {
    const parts = p.split('/').filter(Boolean); // ['embed','bph',...]
    const tenant = parts[1] || 'unknown';
    const innerKind = parts[2] || 'root';
    // Surface "book inside embed" as kind='book' so funnel works, but tag tenant
    if (innerKind === 'book') return { kind: 'book', slug: parts[3] || '', tenant };
    if (innerKind === 'collections') return { kind: 'collection', slug: parts[3] || '', tenant };
    if (innerKind === 'gallery') return { kind: 'gallery', tenant };
    if (innerKind === 'search') return { kind: 'search', tenant };
    return { kind: 'embed', tenant, sub: parts.slice(2).join('/') || '(root)' };
  }
  if (p.startsWith('/book/')) return { kind: 'book', slug: p.split('/')[2] || '' };
  if (p.startsWith('/artwork/')) return { kind: 'artwork', slug: p.split('/')[2] || '' };
  if (p.startsWith('/collections/')) return { kind: 'collection', slug: p.split('/')[2] || '' };
  if (p.startsWith('/gallery')) return { kind: 'gallery' };
  if (p.startsWith('/search')) return { kind: 'search' };
  if (p.startsWith('/libraries/') || p === '/libraries') return { kind: 'library', slug: p.split('/')[2] || '' };
  if (p === '/' || p === '') return { kind: 'home' };
  if (p.startsWith('/platform') || p.startsWith('/admin')) return { kind: 'admin' };
  if (p.startsWith('/api/')) return { kind: 'api' };
  if (p.startsWith('/q/')) return { kind: 'shortlink' };
  if (p.startsWith('/auth')) return { kind: 'auth' };
  if (p.startsWith('/blog')) return { kind: 'blog' };
  if (p.startsWith('/author/')) return { kind: 'author', slug: p.split('/')[2] || '' };
  if (p.startsWith('/podcast')) return { kind: 'podcast' };
  if (p.startsWith('/browse') || p.startsWith('/catalog') || p.startsWith('/explore')) return { kind: 'browse' };
  if (p.startsWith('/encyclopedia')) return { kind: 'encyclopedia' };
  if (p.startsWith('/timeline')) return { kind: 'timeline' };
  if (p.startsWith('/account') || p.startsWith('/favorites')) return { kind: 'account' };
  if (p.startsWith('/about') || p.startsWith('/developers') || p.startsWith('/default') || p.startsWith('/librarian')) return { kind: 'static' };
  return { kind: 'other', path: p };
}

function pct(n, total) {
  if (!total) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function topN(map, n = 20) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function table(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const fmt = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ');
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n');
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  const out = [];
  const print = (s = '') => { out.push(s); console.log(s); };

  print(`# Source Library — Usage Deep Dive`);
  print(`Window: last ${DAYS} days  (since ${SINCE.toISOString()})`);
  print(`Generated: ${new Date().toISOString()}`);
  print(``);

  // -----------------------------------------------------------------
  // SECTION 1 — Volume + traffic shape
  // -----------------------------------------------------------------
  print(`## 1. Overall traffic`);
  const pvAll = await db.collection('analytics_pageviews').countDocuments({ timestamp: { $gte: SINCE } });
  const pvCursor = db.collection('analytics_pageviews').find({ timestamp: { $gte: SINCE } });

  let humanPvs = 0;
  let botPvs = 0;
  const pageHits = new Map();        // path -> count (human)
  const kindHits = new Map();        // kind -> count (human)
  const tenantHits = new Map();      // tenant -> count (human)
  const bookHits = new Map();        // book slug -> count
  const collectionHits = new Map();
  const libraryHits = new Map();
  const referrers = new Map();
  const countries = new Map();
  const dailyHits = new Map();       // YYYY-MM-DD -> count (human)
  const sessions = new Map();        // sessionKey -> [{ts, path, kind}]

  while (await pvCursor.hasNext()) {
    const d = await pvCursor.next();
    if (isBot(d.userAgent)) { botPvs++; continue; }
    humanPvs++;
    const normPath = normalizePath(d.path);
    const k = pathKind(normPath);
    pageHits.set(normPath, (pageHits.get(normPath) || 0) + 1);
    const kindStr = typeof k === 'string' ? k : k.kind;
    kindHits.set(kindStr, (kindHits.get(kindStr) || 0) + 1);

    if (k.kind === 'embed') tenantHits.set(k.tenant, (tenantHits.get(k.tenant) || 0) + 1);
    if (k.kind === 'book' && k.slug) bookHits.set(k.slug, (bookHits.get(k.slug) || 0) + 1);
    if (k.kind === 'collection' && k.slug) collectionHits.set(k.slug, (collectionHits.get(k.slug) || 0) + 1);
    if (k.kind === 'library' && k.slug) libraryHits.set(k.slug, (libraryHits.get(k.slug) || 0) + 1);

    const refDomain = (d.referrer || 'direct').replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrers.set(refDomain, (referrers.get(refDomain) || 0) + 1);
    countries.set(d.country || 'unknown', (countries.get(d.country || 'unknown') || 0) + 1);

    const day = d.timestamp.toISOString().slice(0, 10);
    dailyHits.set(day, (dailyHits.get(day) || 0) + 1);

    const sessKey = `${d.ip}::${(d.userAgent || '').slice(0, 60)}`;
    if (!sessions.has(sessKey)) sessions.set(sessKey, []);
    sessions.get(sessKey).push({ ts: d.timestamp, path: d.path, kind: kindStr });
  }

  print(`Pageviews (raw):     ${pvAll.toLocaleString()}`);
  print(`Pageviews (human):   ${humanPvs.toLocaleString()}   (${pct(humanPvs, pvAll)})`);
  print(`Pageviews (bot/auto):${botPvs.toLocaleString()}   (${pct(botPvs, pvAll)})`);
  print(`Unique (ip+ua) fingerprints: ${sessions.size.toLocaleString()}`);
  print(``);

  // Daily trend
  print(`### Daily human pageviews`);
  const days = [...dailyHits.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  print(table(days, ['date', 'pageviews']));
  print(``);

  // -----------------------------------------------------------------
  // SECTION 2 — Who's reading what
  // -----------------------------------------------------------------
  print(`## 2. Who's reading what`);
  print(``);
  print(`### Path categories`);
  print(table(topN(kindHits, 20).map(([k, v]) => [k, v, pct(v, humanPvs)]), ['kind', 'hits', 'share']));
  print(``);

  print(`### Top 30 books visited`);
  const topBookSlugs = topN(bookHits, 30);
  // URLs may use a slug, a 24-char hex Mongo _id, or the string `id` field
  // (a DIFFERENT 24-hex value than _id) — look up hex keys by both.
  const { ObjectId } = await import('mongodb');
  const slugLike = [];
  const hexLike = [];
  for (const [s] of topBookSlugs) {
    if (/^[a-f0-9]{24}$/i.test(s)) {
      hexLike.push(s);
    } else {
      slugLike.push(s);
    }
  }
  const idLike = hexLike.map((s) => { try { return new ObjectId(s); } catch { return null; } }).filter(Boolean);
  const proj = { projection: { slug: 1, id: 1, title: 1, author: 1, language: 1, year_published: 1 } };
  const bySlug = slugLike.length
    ? await db.collection('books').find({ slug: { $in: slugLike } }, proj).toArray()
    : [];
  const byId = idLike.length
    ? await db.collection('books').find({ _id: { $in: idLike } }, proj).toArray()
    : [];
  const byIdField = hexLike.length
    ? await db.collection('books').find({ id: { $in: hexLike } }, proj).toArray()
    : [];
  const bookMeta = new Map();
  for (const b of bySlug) bookMeta.set(b.slug, b);
  for (const b of byId) bookMeta.set(b._id.toString(), b);
  for (const b of byIdField) { if (b.id) bookMeta.set(b.id, b); }
  print(table(
    topBookSlugs.map(([key, hits]) => {
      const m = bookMeta.get(key) || {};
      const title = (m.title || '').slice(0, 55);
      const author = (Array.isArray(m.author) ? m.author[0] : m.author || '').slice(0, 28);
      return [hits, key.slice(0, 32), title, author, m.language || '', m.year_published || ''];
    }),
    ['hits', 'slug/id', 'title', 'author', 'lang', 'year']
  ));
  print(``);

  print(`### Top 20 collections`);
  print(table(topN(collectionHits, 20).map(([s, h]) => [h, s]), ['hits', 'collection']));
  print(``);

  print(`### Top 20 library pages`);
  print(table(topN(libraryHits, 20).map(([s, h]) => [h, s]), ['hits', 'library']));
  print(``);

  print(`### Tenant embed traffic`);
  print(table(topN(tenantHits, 10).map(([t, h]) => [h, t]), ['hits', 'tenant']));
  print(``);

  print(`### Top 20 referrers`);
  print(table(topN(referrers, 20).map(([r, h]) => [h, r]), ['hits', 'referrer']));
  print(``);

  print(`### Countries (top 15)`);
  print(table(topN(countries, 15).map(([c, h]) => [h, c]), ['hits', 'country']));
  print(``);

  // -----------------------------------------------------------------
  // SECTION 3 — Search behavior
  // -----------------------------------------------------------------
  print(`## 3. Search behavior`);
  // Use search_queries (richer) — only ~last 90 days, has filters + latency
  const sqAll = await db.collection('search_queries').find({ ts: { $gte: SINCE } }).toArray();
  print(`Total search queries: ${sqAll.length.toLocaleString()}`);
  const sqHuman = sqAll.filter((s) => !isBot(s.user_agent));
  const sqBot = sqAll.length - sqHuman.length;
  print(`  Human:  ${sqHuman.length.toLocaleString()}`);
  print(`  Bot/MCP/curl: ${sqBot.toLocaleString()}`);
  const zero = sqHuman.filter((s) => (s.total || 0) === 0);
  print(`  Zero-result: ${zero.length}  (${pct(zero.length, sqHuman.length)})`);
  print(``);

  // Top queries
  const qCounts = new Map();
  for (const s of sqHuman) {
    const q = (s.query || '').toLowerCase().trim();
    if (!q) continue;
    qCounts.set(q, (qCounts.get(q) || 0) + 1);
  }
  print(`### Top 30 queries (human)`);
  print(table(topN(qCounts, 30).map(([q, n]) => [n, q.slice(0, 80)]), ['count', 'query']));
  print(``);

  // Zero-result queries
  const zCounts = new Map();
  for (const s of zero) {
    const q = (s.query || '').toLowerCase().trim();
    if (!q) continue;
    zCounts.set(q, (zCounts.get(q) || 0) + 1);
  }
  print(`### Top 30 zero-result queries`);
  print(table(topN(zCounts, 30).map(([q, n]) => [n, q.slice(0, 80)]), ['count', 'query']));
  print(``);

  // Latency
  const lat = sqHuman.map((s) => s.ms).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (lat.length) {
    const pct50 = lat[Math.floor(lat.length * 0.5)];
    const pct90 = lat[Math.floor(lat.length * 0.9)];
    const pct99 = lat[Math.floor(lat.length * 0.99)];
    print(`### Latency (search_queries.ms, human)`);
    print(`p50=${pct50}ms  p90=${pct90}ms  p99=${pct99}ms  max=${lat[lat.length - 1]}ms`);
    print(``);
  }

  // Filter usage
  const langs = new Map();
  for (const s of sqHuman) {
    const f = s.filters || {};
    const l = f.language || (f.languages && f.languages[0]) || '(none)';
    langs.set(l, (langs.get(l) || 0) + 1);
  }
  print(`### Language filter usage`);
  print(table(topN(langs, 15).map(([l, n]) => [n, l]), ['count', 'language']));
  print(``);

  // Refinement chains — same ip_hash within 5 min, query changed
  const byIp = new Map();
  for (const s of sqHuman) {
    if (!s.ip_hash) continue;
    if (!byIp.has(s.ip_hash)) byIp.set(s.ip_hash, []);
    byIp.get(s.ip_hash).push(s);
  }
  const chains = [];
  for (const [, list] of byIp) {
    list.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    for (let i = 1; i < list.length; i++) {
      const dt = new Date(list[i].ts) - new Date(list[i - 1].ts);
      if (dt < 5 * 60 * 1000 && list[i].query !== list[i - 1].query) {
        chains.push([list[i - 1].query, list[i].query, list[i - 1].total, list[i].total]);
      }
    }
  }
  print(`### Search refinement chains (same user, <5 min apart, query changed) — sample 25`);
  print(`Found ${chains.length} refinements.`);
  print(table(
    chains.slice(0, 25).map((c) => [c[0].slice(0, 35), c[1].slice(0, 35), c[2], c[3]]),
    ['from', 'to', 'from_n', 'to_n']
  ));
  print(``);

  // -----------------------------------------------------------------
  // SECTION 4 — User journeys / process mining
  // -----------------------------------------------------------------
  print(`## 4. User journeys (process mining)`);
  // Convert sessions map into actual sessions using 30-min idle gap
  const realSessions = [];
  for (const [, hits] of sessions) {
    hits.sort((a, b) => a.ts - b.ts);
    let cur = [];
    for (const h of hits) {
      if (cur.length === 0) cur.push(h);
      else if (h.ts - cur[cur.length - 1].ts <= IDLE_MS) cur.push(h);
      else { realSessions.push(cur); cur = [h]; }
    }
    if (cur.length) realSessions.push(cur);
  }
  print(`Sessions (30-min idle gap): ${realSessions.length.toLocaleString()}`);
  const sessLens = realSessions.map((s) => s.length).sort((a, b) => a - b);
  const oneHitRatio = sessLens.filter((n) => n === 1).length / sessLens.length;
  const median = sessLens[Math.floor(sessLens.length / 2)] || 0;
  const p90 = sessLens[Math.floor(sessLens.length * 0.9)] || 0;
  print(`Length: median=${median}  p90=${p90}  bounce(1-hit)=${(oneHitRatio * 100).toFixed(1)}%`);
  print(``);

  // Entry pages
  const entries = new Map();
  const exits = new Map();
  for (const s of realSessions) {
    const ek = s[0].kind;
    entries.set(ek, (entries.get(ek) || 0) + 1);
    const xk = s[s.length - 1].kind;
    exits.set(xk, (exits.get(xk) || 0) + 1);
  }
  print(`### Entry path kinds`);
  print(table(topN(entries, 12).map(([k, n]) => [n, k, pct(n, realSessions.length)]), ['count', 'kind', 'share']));
  print(``);
  print(`### Exit path kinds`);
  print(table(topN(exits, 12).map(([k, n]) => [n, k, pct(n, realSessions.length)]), ['count', 'kind', 'share']));
  print(``);

  // First-action transitions (kind[0] -> kind[1])
  const transitions = new Map();
  for (const s of realSessions) {
    if (s.length < 2) continue;
    const t = `${s[0].kind} -> ${s[1].kind}`;
    transitions.set(t, (transitions.get(t) || 0) + 1);
  }
  print(`### First-action transitions (kind[0] -> kind[1]) — top 25`);
  print(table(topN(transitions, 25).map(([t, n]) => [n, t]), ['count', 'transition']));
  print(``);

  // Funnel: did the session ever hit a book?  ever search?  ever land on a quote?
  let sawSearch = 0, sawBook = 0, sawCollection = 0, sawGallery = 0, sawHomeFirst = 0;
  let homeToBook = 0, searchToBook = 0;
  for (const s of realSessions) {
    const kinds = new Set(s.map((h) => h.kind));
    if (kinds.has('search')) sawSearch++;
    if (kinds.has('book')) sawBook++;
    if (kinds.has('collection')) sawCollection++;
    if (kinds.has('gallery')) sawGallery++;
    if (s[0].kind === 'home') sawHomeFirst++;
    // sequential
    const seq = s.map((h) => h.kind);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1] === 'home' && seq[i] === 'book') { homeToBook++; break; }
    }
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1] === 'search' && seq[i] === 'book') { searchToBook++; break; }
    }
  }
  print(`### Session-level funnel`);
  const N = realSessions.length;
  print(`Saw search:     ${sawSearch}  (${pct(sawSearch, N)})`);
  print(`Saw book:       ${sawBook}  (${pct(sawBook, N)})`);
  print(`Saw collection: ${sawCollection}  (${pct(sawCollection, N)})`);
  print(`Saw gallery:    ${sawGallery}  (${pct(sawGallery, N)})`);
  print(`Started on home:${sawHomeFirst}  (${pct(sawHomeFirst, N)})`);
  print(`home -> book:   ${homeToBook}  (${pct(homeToBook, N)})`);
  print(`search -> book: ${searchToBook}  (${pct(searchToBook, N)})`);
  print(``);

  // Average book pages per session that saw a book
  const bookSessions = realSessions.filter((s) => s.some((h) => h.kind === 'book'));
  const bookPageCounts = bookSessions.map((s) => s.filter((h) => h.kind === 'book').length).sort((a, b) => a - b);
  if (bookPageCounts.length) {
    const med = bookPageCounts[Math.floor(bookPageCounts.length / 2)];
    const p9 = bookPageCounts[Math.floor(bookPageCounts.length * 0.9)];
    print(`Among ${bookSessions.length} sessions that opened a book: median pages/session=${med}, p90=${p9}`);
    print(``);
  }

  // -----------------------------------------------------------------
  // SECTION 5 — Notable gaps
  // -----------------------------------------------------------------
  print(`## 5. Instrumentation gaps surfaced by this run`);

  // Shortlink arrivals come from the server-side `shortlink_visit` event
  // (#2047), not from pageviews: /q/<code> answers 302 before any page renders,
  // so the client-side /api/track call never fires and the pageview count below
  // only ever caught the handful of crawlers that log the redirect itself.
  const shortlinkVisits = await db.collection('analytics_events').aggregate([
    { $match: { event: 'shortlink_visit', timestamp: { $gte: SINCE } } },
    { $group: { _id: { $ifNull: ['$traffic_class', 'unclassified'] }, n: { $sum: 1 } } },
  ]).toArray();
  const visitsBy = new Map(shortlinkVisits.map((r) => [r._id, r.n]));
  const humanVisits = visitsBy.get('human') || 0;
  const totalVisits = shortlinkVisits.reduce((a, r) => a + r.n, 0);
  if (totalVisits === 0) {
    print(`- shortlink_visit events: 0 — either nobody opened a /q/ link in this window, or the route logging regressed (src/lib/shortlink-visit-log.ts)`);
  } else {
    const breakdown = [...visitsBy.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(', ');
    print(`- shortlink_visit events: ${totalVisits.toLocaleString()} total, ${humanVisits.toLocaleString()} human (${breakdown})`);
    const topLinks = await db.collection('analytics_events').aggregate([
      { $match: { event: 'shortlink_visit', traffic_class: 'human', timestamp: { $gte: SINCE } } },
      { $group: { _id: { book: '$book_id', page: '$page_number' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 10 },
    ]).toArray();
    if (topLinks.length) {
      print(``);
      print(table(topLinks.map((r) => [r._id.book || '(unknown)', r._id.page ?? '-', r.n]), ['book_id', 'page', 'visits']));
      print(``);
    }
  }
  const shortlinkHits = kindHits.get('shortlink') || 0;
  print(`- /q/<code> hits that also produced a pageview row: ${shortlinkHits} (expected to be ~0; the redirect fires first)`);
  const apiHits = kindHits.get('api') || 0;
  print(`- /api/* pageview hits: ${apiHits} (API endpoints are not the source of truth for usage)`);
  print(`- No client-side "quote copied" or "citation exported" events`);
  print(`- search_queries has its own ip_hash separate from analytics_events.ip — can't trivially join`);
  print(``);

  await c.close();

  // Write the report
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = `scripts/output/analytics/usage-${DAYS}d-${stamp}.md`;
  await import('node:fs').then((fs) => fs.writeFileSync(outPath, out.join('\n')));
  console.error(`\nReport written: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
