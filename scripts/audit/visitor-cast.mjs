#!/usr/bin/env node
/**
 * Who visits the library (#312): every kind of visitor in the last 24 h — readers,
 * proxy pools, walkers, declared crawlers, and the fleets Cloudflare turns away —
 * described as a person: how many, who they claim to be, what they read, how they
 * read, and what we do about them. Writes ONE ops_reports document; /admin/visitors
 * renders it and computes nothing.
 *
 * PRIOR ART: scripts/workers/traffic-anomaly-alert.mjs DETECTS pools and walkers and
 * is the only writer of their verdicts; this script only READS them
 * (scripts/lib/suspected-pool.mjs, walker_observations), so a reader here is a reader
 * there. src/lib/traffic-classification.ts names the declared bots. /admin/bots lists
 * bot hits by name, and /admin/traffic counts humans; neither says what a kind of
 * visitor reads or how. scripts/workers/edge-crawl-alert.mjs reads the same Cloudflare
 * GraphQL dataset for alarms, with the same CLOUDFLARE_API_TOKEN_READ.
 *
 *   node --env-file=.env.production.local scripts/audit/visitor-cast.mjs            # dry run: prints the cast
 *   ... --apply                         write ops_reports/visitor-cast
 *   ... --edge-json <file>              edge numbers from a file (same shape as edgeFromCloudflare())
 *
 * Edge numbers need CLOUDFLARE_API_TOKEN_READ (zone analytics read). Without it, and
 * without --edge-json, the edge section is written as `null` and the page says
 * "not measured" — never zero.
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { activePoolFingerprints } from '../lib/suspected-pool.mjs';
import { classifyTraffic, TRAFFIC_CLASS_LABELS } from '../../src/lib/traffic-classification.ts';

// The laptop's resolver has refused Atlas SRV lookups (2026-11-13); public resolvers do not.
if (process.env.VISITOR_CAST_PUBLIC_DNS !== '0') dns.setServers(['1.1.1.1', '8.8.8.8']);

const REPORT_ID = 'visitor-cast';
const HOURS = 24;
const ZONE = process.env.CF_ZONE_ID || '2a9b9c5c8eaf11ed3f9279ad50a0d06c';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EDGE_JSON = args.includes('--edge-json') ? args[args.indexOf('--edge-json') + 1] : null;

const BOOK_RE = /^\/(?:(?:es|la|nl|zh)\/)?book\/([^/?#]+)(\/page\/[^/?#]+)?/;

/** Address bucket: IPv4 /24, IPv6 /48 — the unit walker_observations keys on. */
export function bucket24(ip) {
  if (!ip) return 'unknown';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : ip;
}

/** "Windows Chrome 154" from a UA string, for naming a crowd. */
export function describeUa(ua) {
  if (!ua) return 'no browser name';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const named = ua.match(/compatible; ([A-Za-z][\w.-]*bot|[A-Za-z][\w.-]*Bot)\//);
  if (named) return named[1];
  const chrome = ua.match(/Chrome\/(\d+)/);
  const ff = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+)[\d.]* (?:Mobile\/\w+ )?Safari\//);
  const name = chrome ? `Chrome ${chrome[1]}` : ff ? `Firefox ${ff[1]}` : safari ? `Safari ${safari[1]}` : ua.split(/[ /]/)[0];
  return [os, name].filter(Boolean).join(' ');
}

function referrerKind(r) {
  if (!r || r === 'direct') return 'typed or no referrer';
  if (/google\.|bing\.|duckduckgo|yandex|ecosia|baidu|search\.brave/.test(r)) return 'a search engine';
  if (/chatgpt|openai|perplexity|claude\.ai|gemini/.test(r)) return 'an AI assistant';
  if (/sourcelibrary\.org/.test(r)) return 'another Source Library page';
  return r.replace(/^https?:\/\//, '').split('/')[0];
}

/** analytics_bot_access `bot` keys (src/proxy.ts) as a reader would name them. */
const BOT_NAMES = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google (incl. forged)', bing: 'Bing',
  'unknown-bot': 'Unnamed bots', 'other-bot': 'Other named bots', script: 'Scripts (curl, Python…)',
  ratelimit: 'Rate-limited clients',
};

const top = (map, n, total) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([key, count]) => ({ key, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }));
const inc = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

function newGroup(key, kind, name) {
  return {
    key, kind, name, reads: 0, addrs: new Set(), uas: new Map(), hints: new Map(), countries: new Map(),
    referrers: new Map(), hours: Array(24).fill(0), deep: 0, root: 0, other: 0, books: new Map(),
    addrBook: new Set(), slugsAll: new Set(),
  };
}

function addView(g, v) {
  g.reads++;
  const addr = v.ip || 'unknown';
  g.addrs.add(addr);
  inc(g.uas, v.userAgent || '');
  if (v.ch_ua) inc(g.hints, v.ch_ua);
  inc(g.countries, v.country || '??');
  inc(g.referrers, referrerKind(v.referrer));
  g.hours[new Date(v.timestamp).getUTCHours()]++;
  const m = (v.path || '').match(BOOK_RE);
  if (m) {
    if (m[2]) g.deep++; else g.root++;
    inc(g.books, m[1]);
    g.addrBook.add(addr + '|' + m[1]);
    g.slugsAll.add(m[1]);
  } else g.other++;
}

/** Fold a group into the stored card. `bookInfo` maps slug → {title, language, year}. */
function finish(g, total, bookInfo) {
  const addrs = g.addrs.size;
  const bookReads = g.deep + g.root;
  const lang = new Map(), century = new Map();
  for (const [slug, n] of g.books) {
    const b = bookInfo.get(slug);
    inc(lang, b?.language || 'unknown', n);
    const c = b?.year && b.year < 2100 ? `${Math.floor(b.year / 100) + 1}th c.` : 'undated';
    inc(century, c, n);
  }
  return {
    key: g.key, kind: g.kind, name: g.name,
    reads: g.reads, share_pct: total ? Math.round((g.reads / total) * 1000) / 10 : 0,
    addresses: addrs,
    reads_per_address: addrs ? Math.round((g.reads / addrs) * 100) / 100 : 0,
    pages_per_book: g.addrBook.size ? Math.round((bookReads / g.addrBook.size) * 100) / 100 : 0,
    books_touched: g.books.size,
    where: { deep_page: g.deep, book_root: g.root, elsewhere: g.other },
    claims: top(g.uas, 3, g.reads).map(x => ({ ...x, label: describeUa(x.key) })),
    hints: top(g.hints, 2, g.reads),
    countries: top(g.countries, 5, g.reads),
    arrives_from: top(g.referrers, 4, g.reads),
    hours_utc: g.hours,
    top_books: top(g.books, 6, bookReads).map(x => ({
      slug: x.key, reads: x.count, pct: x.pct,
      title: bookInfo.get(x.key)?.title || x.key, language: bookInfo.get(x.key)?.language || null,
      year: bookInfo.get(x.key)?.year || null,
    })),
    languages: top(lang, 5, bookReads),
    centuries: top(century, 5, bookReads),
  };
}

async function bookLookup(db, slugs) {
  const out = new Map();
  const list = [...slugs];
  for (let i = 0; i < list.length; i += 5000) {
    const docs = await db.collection('books').find(
      { slug: { $in: list.slice(i, i + 5000) } },
      { projection: { slug: 1, title: 1, display_title: 1, language: 1, year: 1 } },
    ).toArray();
    for (const d of docs) out.set(d.slug, { title: d.display_title || d.title, language: d.language, year: d.year });
  }
  return out;
}

/** Firewall events per custom rule, last 24 h, from Cloudflare GraphQL. */
export async function edgeFromCloudflare(token, since) {
  const gql = async (query) => {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const j = await r.json();
    if (j.errors) throw new Error(j.errors.map(e => e.message).join('; '));
    return j.data.viewer.zones[0];
  };
  const f = `datetime_geq:"${since}",source:"firewallCustom"`;
  const base = await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){g:firewallEventsAdaptiveGroups(limit:100,filter:{${f}},orderBy:[count_DESC]){count dimensions{ruleId action description}}}}}`);
  const rules = new Map();
  for (const row of base.g) {
    const d = row.dimensions;
    if (d.action === 'skip' || d.action === 'log') continue;
    const r = rules.get(d.ruleId) || { id: d.ruleId, description: d.description || '', events: {} };
    r.events[d.action] = (r.events[d.action] || 0) + row.count;
    rules.set(d.ruleId, r);
  }
  for (const r of rules.values()) {
    const rf = `${f},ruleId:"${r.id}"`;
    const z = await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){
      asn:firewallEventsAdaptiveGroups(limit:4,filter:{${rf}},orderBy:[count_DESC]){count dimensions{clientASNDescription}}
      ua:firewallEventsAdaptiveGroups(limit:3,filter:{${rf}},orderBy:[count_DESC]){count dimensions{userAgent}}
      path:firewallEventsAdaptiveGroups(limit:4,filter:{${rf}},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
      ips:firewallEventsAdaptiveGroups(limit:1000,filter:{${rf}},orderBy:[count_DESC]){count dimensions{clientIP}}
    }}}`);
    r.asns = z.asn.map(x => ({ name: x.dimensions.clientASNDescription, count: x.count }));
    r.uas = z.ua.map(x => ({ ua: x.dimensions.userAgent, count: x.count }));
    r.paths = z.path.map(x => ({ path: x.dimensions.clientRequestPath, count: x.count }));
    r.addresses_at_least = z.ips.length;
  }
  return { since, rules: [...rules.values()] };
}

/** One edge card per rule that turned anyone away. */
function edgeCards(edge) {
  if (!edge) return null;
  return edge.rules.map(r => {
    const turned = (r.events.block || 0) + (r.events.managed_challenge || 0) + (r.events.jschallenge || 0);
    const solved = (r.events.managed_challenge_non_interactive_solved || 0) + (r.events.managed_challenge_interactive_solved || 0);
    return {
      key: 'edge:' + r.id, kind: 'edge', rule_id: r.id,
      name: r.description.replace(/\s*\(#?\d+\)\s*$/, '').slice(0, 120),
      action: r.events.block ? 'block' : 'challenge',
      turned_away: turned, solved, passed_with_cookie: r.events.managed_challenge_bypassed || 0,
      solve_rate_pct: r.events.managed_challenge ? Math.round((solved / r.events.managed_challenge) * 1000) / 10 : null,
      addresses_at_least: r.addresses_at_least ?? null,
      networks: r.asns || [], tried: r.paths || [],
      claims: (r.uas || []).map(u => ({ ua: u.ua, count: u.count, label: u.ua ? describeUa(u.ua) : 'no browser name' })),
    };
  }).sort((a, b) => b.turned_away - a.turned_away);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const now = new Date();
  const since = new Date(now.getTime() - HOURS * 3600e3);

  const views = await db.collection('analytics_pageviews').find(
    { timestamp: { $gte: since } },
    { projection: { _id: 0, path: 1, referrer: 1, country: 1, userAgent: 1, ch_ua: 1, ip: 1, timestamp: 1 } },
  ).toArray();

  const pools = await activePoolFingerprints(db, { staleDays: 14 });
  const days = [now.toISOString().slice(0, 10), since.toISOString().slice(0, 10)];
  const walkerKeys = new Set((await db.collection('walker_observations')
    .find({ day: { $in: days } }, { projection: { ip: 1, user_agent: 1 } }).toArray())
    .map(w => `${w.ip}|${w.user_agent}`));

  const groups = new Map();
  const groupFor = (key, kind, name) => groups.get(key) || groups.set(key, newGroup(key, kind, name)).get(key);
  for (const v of views) {
    const ua = v.userAgent || '';
    const cls = classifyTraffic(ua);
    let g;
    if (cls !== 'human') g = groupFor('declared:' + cls, 'declared', TRAFFIC_CLASS_LABELS[cls]);
    else if (pools.has(ua)) g = groupFor('pool:' + ua, 'pool', `The ${describeUa(ua)} crowd`);
    else if (walkerKeys.has(`${bucket24(v.ip)}|${ua}`)) g = groupFor('walker', 'walker', 'Wide-shallow walkers');
    else g = groupFor('readers', 'readers', 'Readers');
    addView(g, v);
  }

  const allSlugs = new Set();
  for (const g of groups.values()) for (const s of g.slugsAll) allSlugs.add(s);
  const bookInfo = await bookLookup(db, allSlugs);
  const total = views.length;
  const cast = [...groups.values()].map(g => finish(g, total, bookInfo)).sort((a, b) => b.reads - a.reads);

  // Declared and app-detected bots: they run no JavaScript, so they are never page
  // views. analytics_bot_access is a per-(day, bot, path) tally kept by src/proxy.ts.
  const botRows = await db.collection('analytics_bot_access').find(
    { date: { $in: days } },
    { projection: { _id: 0, bot: 1, path_prefix: 1, actions: 1, hits: 1, ips: 1, last_ua: 1 } },
  ).toArray();
  const bots = new Map();
  for (const r of botRows) {
    const b = bots.get(r.bot) || { bot: r.bot, hits: 0, ips: new Set(), actions: new Map(), paths: new Map(), uas: new Map(), slugs: new Map() };
    b.hits += r.hits || 0;
    for (const ip of r.ips || []) b.ips.add(ip);
    for (const a of r.actions || []) inc(b.actions, a, r.hits || 0);
    inc(b.paths, (r.path_prefix || '').replace(/\/page\/[^/]+$/, '/page/…'), r.hits || 0);
    if (r.last_ua) inc(b.uas, r.last_ua, r.hits || 0);
    const m = (r.path_prefix || '').match(/\/book\/([^/?#]+)/);
    if (m) inc(b.slugs, m[1], r.hits || 0);
    bots.set(r.bot, b);
  }
  const botSlugs = new Set([...bots.values()].flatMap(b => top(b.slugs, 5, 0).map(x => x.key)));
  const botBooks = await bookLookup(db, botSlugs);
  const crawlers = [...bots.values()].sort((a, b) => b.hits - a.hits).slice(0, 10).map(b => ({
    key: 'bot:' + b.bot, kind: 'crawler', name: BOT_NAMES[b.bot] || b.bot, hits: b.hits, addresses_at_least: b.ips.size,
    actions: top(b.actions, 6, b.hits),
    claims: top(b.uas, 2, b.hits).map(x => ({ ...x, label: describeUa(x.key) })),
    tried: top(b.paths, 5, b.hits),
    top_books: top(b.slugs, 5, b.hits).map(x => ({ slug: x.key, reads: x.count, title: botBooks.get(x.key)?.title || x.key })),
  }));

  let edge = null, edgeError = null;
  try {
    if (EDGE_JSON) edge = JSON.parse(readFileSync(EDGE_JSON, 'utf8'));
    else if (process.env.CLOUDFLARE_API_TOKEN_READ) edge = await edgeFromCloudflare(process.env.CLOUDFLARE_API_TOKEN_READ, since.toISOString());
  } catch (e) { edgeError = String(e.message || e).slice(0, 300); }

  const doc = {
    _id: REPORT_ID,
    generated_at: now,
    generated_by: 'scripts/audit/visitor-cast.mjs',
    window: { since: since.toISOString(), until: now.toISOString(), hours: HOURS },
    page_views: total,
    cast,
    crawlers,
    crawler_days: days,
    edge: edgeCards(edge),
    edge_since: edge?.since || null,
    edge_error: edgeError,
    method: 'Page views come from the in-page beacon (analytics_pageviews), so a visitor that runs no JavaScript or is stopped at Cloudflare is not in them. Pools are the UA strings traffic-anomaly-alert.mjs flagged in the last 14 days (one exact string from more than 2,500 addresses a day); walkers are the (address /24, UA) pairs it saw open 50+ books in a day at shallow depth; declared bots are named by their own UA. Everything else is counted as a reader. Edge cards are Cloudflare firewall events per custom rule.',
  };

  for (const c of cast) {
    console.log(`${c.name.padEnd(42)} ${String(c.reads).padStart(6)} reads ${String(c.share_pct).padStart(5)}%  ${String(c.addresses).padStart(6)} addrs  ${c.reads_per_address}/addr  ${c.pages_per_book} pp/book  top: ${c.top_books[0]?.title?.slice(0, 40) || '-'}`);
  }
  for (const b of crawlers) console.log(`  bot ${b.name.padEnd(14)} ${b.hits} hits, ${b.addresses_at_least} addrs, ${b.actions.map(a => a.key + ' ' + a.count).join(', ')}`);
  console.log('edge:', doc.edge ? `${doc.edge.length} rules` : `not measured${edgeError ? ' — ' + edgeError : ''}`);
  if (APPLY) {
    await db.collection('ops_reports').replaceOne({ _id: REPORT_ID }, doc, { upsert: true });
    console.log('wrote ops_reports/' + REPORT_ID);
  } else console.log('dry run — pass --apply to write');
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
