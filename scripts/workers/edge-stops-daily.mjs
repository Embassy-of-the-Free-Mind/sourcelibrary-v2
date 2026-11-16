#!/usr/bin/env node
/**
 * Edge stops, daily: how many requests did Cloudflare stop before they reached the site?
 *
 * PRIOR ART: scripts/workers/edge-crawl-alert.mjs — reads the same Cloudflare
 * dataset with the same token, but hourly, for crawlers that GOT THROUGH. This
 * one keeps a daily record of what was STOPPED. Kept separate because the
 * question, the window and the output differ. Its one alarm (search crawlers
 * turned away, below) copies that file's conventions: ntfy on a change of
 * state only, and every push says where to look.
 *
 * Why it exists: on 2026-10-28 the AI-partners page wanted a monthly
 * "requests stopped at the edge" figure, and Cloudflare on our plan keeps
 * firewall events for 3 days and answers at most 1 day per query. A month can
 * therefore only be counted by saving each day as it happens.
 *
 * What it stores, one doc per UTC day in `analytics_edge_daily`:
 *   _id: 'YYYY-MM-DD', by: [{action, source, count}],
 *   stopped   = block + challenges not passed (what never reached the site),
 *   blocked   = block,
 *   challenged_unpassed = managed/js/interactive challenges issued,
 *   challenge_passed    = *_solved + *_bypassed (people who got through),
 *   decoys    = link_maze_injected,
 *   assistants = what assistants and their search crawlers asked for (#8161), or
 *                assistants_error when that query failed. App analytics cannot see
 *                these clients. One row per agent: { agent, role, requests,
 *                by_status, by_network, by_path }.
 *   engines    = the same row for each search engine's crawler (role 'engine'), or
 *                engines_error. A separate key, so `assistants` still means
 *                assistants and one query failing does not lose the other. Each
 *                row adds own_network: { asns, requests, turned_away, at_edge,
 *                by_status }, counted only over the operator's own network, or
 *                null when that network is not confirmed (counted, not alarmed).
 *   fetched_at.
 * Counts are Cloudflare's sample-adjusted estimates. "Challenged" counts
 * issues of a challenge, so a client challenged twice counts twice.
 *
 * Reading `assistants`: a user agent can be forged, and by_network is there so a
 * reader can tell. `Claude-User` includes connector calls, so `by_path.mcp` is not
 * someone reading a page. The citation benchmark (scripts/eval/citation-benchmark-8161)
 * runs from gex45, so its fetches show under AS24940 Hetzner.
 *
 * The alarm: search crawlers turned away (v3 #79). Four times an edge or proxy
 * rule written for scrapers has turned away a crawler the policy welcomes
 * (.claude/docs/invariants/crawler-access-gate.md), the last unnoticed until
 * 2026-11-12 because this table held assistants only. For a crawler with at
 * least 50 requests in the day from its own network, the job pushes ntfy when
 * more than a fifth of them ended in 403, 429 or an edge challenge. The share is
 * over the operator's own network because the names are forged every day from
 * consumer networks and those requests are rightly blocked (161 forged Googlebot
 * requests on 2026-11-11). It can be wrong in three ways, and each is reported
 * rather than read as a quiet day: the query fails, every crawler reads zero, or
 * a crawler's requests stop arriving from the network listed for it.
 * State: system_config `edge_engines_state`. Only the newest day of a normal
 * run moves it; --day and --dry-run print what would fire and push nothing.
 * Exit: 0 clean, 1 a crawler is turned away, 2 the check could not run.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN_READ, zone analytics read):
 *   node --env-file=.env.production.local scripts/workers/edge-stops-daily.mjs            # yesterday and the day before
 *   ... --day 2026-10-26      # one day (must be within the last 3 days)
 *   ... --dry-run             # print, do not write
 *   ... --no-push             # write and move the state, send nothing
 */
import { MongoClient } from 'mongodb';
import { BOOK_PATH_LIKES, STOPPED } from './edge-crawl-alert.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const ZONE = process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID || '2a9b9c5c8eaf11ed3f9279ad50a0d06c';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN_READ;
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const STATE_ID = 'edge_engines_state';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');
const NO_PUSH = args.includes('--no-push');
// A named day is a backfill, not "yesterday": it must not move the live alarm state.
const BACKFILL = Boolean(arg('--day'));

const dayStr = (d) => d.toISOString().slice(0, 10);
const days = arg('--day')
  ? [arg('--day')]
  : [1, 2].map((n) => dayStr(new Date(Date.now() - n * 864e5)));

const Q = `query($z:String!,$a:Time!,$b:Time!){viewer{zones(filter:{zoneTag:$z}){
  firewallEventsAdaptiveGroups(limit:200,filter:{datetime_geq:$a,datetime_lt:$b},orderBy:[count_DESC]){count dimensions{action source}}}}}`;

async function fetchDay(day) {
  const a = `${day}T00:00:00Z`;
  const b = `${dayStr(new Date(Date.parse(a) + 864e5))}T00:00:00Z`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: Q, variables: { z: ZONE, a, b } }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(`${day}: ${j.errors[0].message}`);
  return j.data.viewer.zones[0].firewallEventsAdaptiveGroups.map((g) => ({
    action: g.dimensions.action, source: g.dimensions.source, count: g.count,
  }));
}

function summarise(by) {
  const sum = (pred) => by.filter(pred).reduce((n, r) => n + r.count, 0);
  const blocked = sum((r) => r.action === 'block');
  const challenged_unpassed = sum((r) => /^(managed_challenge|challenge|jschallenge)$/.test(r.action));
  const challenge_passed = sum((r) => /_(solved|bypassed)$/.test(r.action));
  return {
    blocked,
    challenged_unpassed: Math.max(0, challenged_unpassed - challenge_passed),
    challenge_passed,
    decoys: sum((r) => r.action === 'link_maze_injected'),
    stopped: blocked + Math.max(0, challenged_unpassed - challenge_passed),
  };
}

// `user` fetches a page because a person asked; `search` crawls to fill an assistant's search index.
const ASSISTANT_AGENTS = [
  { agent: 'Claude-User', role: 'user' },
  { agent: 'ChatGPT-User', role: 'user' },
  { agent: 'Perplexity-User', role: 'user' },
  { agent: 'Claude-SearchBot', role: 'search' },
  { agent: 'OAI-SearchBot', role: 'search' },
  { agent: 'PerplexityBot', role: 'search' },
];

// Search engines' own crawlers, stored under `engines` with role 'engine'. `asns` is the operator's
// own network: the only requests the alarm counts. `null` means the network is not confirmed from a
// primary source, so the crawler is counted and never alarmed. Do not add a network on a guess: a
// wrong one makes the check blind to that crawler. Checked 2026-11-13 against each operator's
// published address list (resolved to its origin network) or, where none could be read, the internet
// registry's record of who holds the network plus this zone's edge log for 2026-11-12.
export const SEARCH_ENGINES = [
  { agent: 'Googlebot', asns: [15169] }, // googlebot.json: 294 of 317 ranges. The other 23 are in Google Cloud (AS396982), which anyone can rent, so it is left out.
  { agent: 'bingbot', asns: [8075] }, // bingbot.json: 27 of 29 addresses (the other 2 are Azure China)
  { agent: 'YandexBot', asns: [13238] }, // RIPE: YANDEX LLC. Edge log: every request that day.
  { agent: 'Applebot', asns: [714, 6185] }, // applebot.json: 24 of 24 ranges in AS714. AS6185 is Apple's other network (ARIN).
  { agent: 'DuckDuckBot', asns: [8075] }, // duckduckbot.json: 486 of 486 addresses are on Microsoft's network (Azure, which anyone can rent)
  { agent: 'Amzn-SearchBot', asns: [14618, 16509] }, // Amazon's searchbot list resolves to AS14618; AS16509 is Amazon's other network (ARIN). Both are AWS, which anyone can rent.
  { agent: 'Qwantbot', asns: [199064] }, // RIPE: QWANT SAS. Edge log: every request that day.
  { agent: 'SeznamBot', asns: [43037] }, // RIPE: Seznam.cz, a.s. Edge log: every request that day.
  { agent: 'ExaSearchBot', asns: null }, // publishes no addresses (it signs requests instead) and arrives from rented hosting: Leaseweb, Ace Data Centers, AWS
  { agent: 'Baiduspider', asns: null }, // no published addresses found; arrives from carrier networks (China Unicom, Chinanet), not a network Baidu holds
].map((engine) => ({ ...engine, role: 'engine' }));

export const ENGINE_MIN_REQUESTS = 50;
export const ENGINE_MAX_TURNED_AWAY = 0.2;
const REFUSED_STATUS = new Set([403, 429]);
const ZERO_ENGINES = 'every search crawler read zero requests, Googlebot and bingbot included, so the query is suspect';
const fmt = (n) => n.toLocaleString('en-US');

/**
 * What the operator's own network asked for and how much of it was turned away. `groups` are
 * Cloudflare's rows by network, status and edge action. The query already asks for these networks
 * only; filtering again here means a filter Cloudflare ignored cannot let forged requests in.
 */
export function ownNetworkCounts(groups, asns) {
  const own = { requests: 0, turned_away: 0, at_edge: 0, by_status: {} };
  for (const { count, dimensions: d } of groups) {
    if (!asns.includes(Number(d.clientAsn))) continue;
    own.requests += count;
    own.by_status[d.edgeResponseStatus] = (own.by_status[d.edgeResponseStatus] || 0) + count;
    // A challenge is a 403 from the edge; a 403 or 429 the edge let through came from the site.
    const atEdge = STOPPED.has(d.securityAction);
    if (atEdge) own.at_edge += count;
    if (atEdge || REFUSED_STATUS.has(Number(d.edgeResponseStatus))) own.turned_away += count;
  }
  return own;
}

/**
 * The day's findings, one line each. `key` is what the alarm state remembers: a crawler's name, or
 * 'instrument' / 'network:<crawler>' when the check itself is in doubt.
 */
export function checkEngines(day, rows, error) {
  if (error) return [{ key: 'instrument', line: `The search-crawler check could not run for ${day}: ${error}` }];
  // Googlebot and bingbot crawl every day, so all zeros is the instrument failing, not a quiet day.
  if (!rows?.some((row) => row.requests > 0)) return [{ key: 'instrument', line: `The search-crawler check could not run for ${day}: ${ZERO_ENGINES}` }];
  const firing = [];
  for (const row of rows) {
    const own = row.own_network;
    if (!own) continue;
    if (own.requests === 0 && row.requests >= ENGINE_MIN_REQUESTS) {
      firing.push({ key: `network:${row.agent}`, line: `${row.agent}: ${fmt(row.requests)} requests carried the name on ${day} and none came from ${own.asns.map((n) => `AS${n}`).join(' or ')}. Either the network listed for it is out of date or every request was forged: read by_network.` });
      continue;
    }
    const share = own.requests ? own.turned_away / own.requests : 0;
    if (own.requests < ENGINE_MIN_REQUESTS || share <= ENGINE_MAX_TURNED_AWAY) continue;
    const bySite = own.turned_away - own.at_edge;
    const where = !bySite ? 'all at the Cloudflare edge'
      : !own.at_edge ? 'all by the site (proxy or app), not the edge'
        : `${fmt(own.at_edge)} at the Cloudflare edge, ${fmt(bySite)} by the site (proxy or app)`;
    const percent = share < 0.25 ? (share * 100).toFixed(1) : Math.round(share * 100);
    firing.push({ key: row.agent, line: `${row.agent}: ${fmt(own.turned_away)} of ${fmt(own.requests)} requests from its own network were turned away on ${day} (${percent}%), ${where}.` });
  }
  return firing;
}

/** Push on a change of state only: a detector that repeats itself trains people to ignore it. */
export function alarmChange(prevKeys, firing) {
  const prev = new Set(prevKeys || []);
  const keys = firing.map((f) => f.key).sort();
  return {
    keys,
    fresh: firing.filter((f) => !prev.has(f.key)),
    standing: firing.filter((f) => prev.has(f.key)),
    cleared: [...prev].filter((key) => !keys.includes(key)).sort(),
  };
}

const isInstrument = (finding) => finding.key === 'instrument' || finding.key.startsWith('network:');

/** The ntfy message for a change of state, or null when there is nothing new to say. */
export function alarmMessage({ fresh, standing, cleared }) {
  if (fresh.length) {
    const crawlers = fresh.filter((f) => !isInstrument(f));
    const lines = fresh.map((f) => `• ${f.line}`);
    if (standing.length) lines.push(`Unchanged since the last report: ${standing.map((f) => f.key).join(', ')}.`);
    const where = [];
    if (crawlers.length) where.push('Where to look: three layers can each turn a crawler away, and they must agree. (1) Cloudflare custom rules: is the crawler named in the skip rule, and is that rule above the challenge rule? (2) src/proxy.ts BLOCKED_BOT_PATTERNS. (3) src/lib/bot-gate.ts, and robots.txt, which a Cloudflare managed rule enforces. Start at .claude/docs/invariants/crawler-access-gate.md (three-layer gate).');
    if (crawlers.length < fresh.length) where.push('For the check itself: CLOUDFLARE_API_TOKEN_READ on this box, then the query and SEARCH_ENGINES in scripts/workers/edge-stops-daily.mjs. No conclusion about that crawler or day until it runs.');
    return {
      title: crawlers.length ? `Search crawler turned away: ${crawlers.map((f) => f.key).join(', ')}` : 'Search-crawler check is blind',
      priority: crawlers.length ? 'high' : 'default',
      body: `${lines.join('\n')}\n\n${where.join('\n\n')}\n\nRows: analytics_edge_daily.engines`.slice(0, 3500),
    };
  }
  if (cleared.length && !standing.length) {
    return { title: 'Search crawlers: cleared', priority: 'low', body: `No longer firing: ${cleared.join(', ')}. In the newest day checked, no crawler with a confirmed network had more than ${ENGINE_MAX_TURNED_AWAY * 100}% of its requests turned away.` };
  }
  return null;
}
const PATH_CLASSES = {
  book: BOOK_PATH_LIKES,
  short_link: ['/q/%'],
  search: ['/search%', '/api/search%'],
  quote: ['/api/books/%/quote%'],
  book_text: ['/api/books/%/text%'],
  mcp: ['/api/mcp%'],
  llms: ['/llms%'],
  robots: ['/robots.txt'],
};

const cfQuery = async (query) => {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data.viewer.zones[0];
};

async function fetchAgents(day, agents) {
  const a = `${day}T00:00:00Z`;
  const b = `${dayStr(new Date(Date.parse(a) + 864e5))}T00:00:00Z`;
  const window = `datetime_geq:"${a}", datetime_lt:"${b}"`;
  const rows = [];
  // One request per agent: several in one request exceeds Cloudflare's limit on nodes per query.
  for (const { agent, role, asns } of agents) {
    const ua = `userAgent_like:"%${agent}%"`;
    // `total` has no dimensions, so it is one group and cannot be cut off by the limit on `all`.
    const parts = [
      `total: httpRequestsAdaptiveGroups(limit:1, filter:{${window}, ${ua}}) { count }`,
      `all: httpRequestsAdaptiveGroups(limit:100, filter:{${window}, ${ua}}, orderBy:[count_DESC]) {
      count dimensions { clientAsn clientASNDescription edgeResponseStatus } }`,
    ];
    // Asked for separately, so that forged requests from a hundred other networks cannot push the
    // operator's own rows past the limit on `all`.
    if (asns) {
      parts.push(`own: httpRequestsAdaptiveGroups(limit:100, filter:{${window}, ${ua}, clientAsn_in:[${asns.map((n) => `"${n}"`).join(', ')}]}, orderBy:[count_DESC]) {
      count dimensions { clientAsn edgeResponseStatus securityAction } }`);
    }
    for (const [name, likes] of Object.entries(PATH_CLASSES)) {
      const paths = `OR:[${likes.map((p) => `{clientRequestPath_like:"${p}"}`).join(', ')}]`;
      parts.push(`${name}: httpRequestsAdaptiveGroups(limit:1, filter:{${window}, ${ua}, ${paths}}) { count }`);
    }
    const zone = await cfQuery(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){${parts.join('\n')}}}}`);
    const by_status = {};
    const networks = {};
    const requests = zone.total[0]?.count ?? 0;
    for (const { count, dimensions: d } of zone.all) {
      by_status[d.edgeResponseStatus] = (by_status[d.edgeResponseStatus] || 0) + count;
      const network = `AS${d.clientAsn} ${d.clientASNDescription}`;
      networks[network] = (networks[network] || 0) + count;
    }
    const by_path = {};
    for (const name of Object.keys(PATH_CLASSES)) by_path[name] = zone[name][0]?.count ?? 0;
    by_path.other = Math.max(0, requests - Object.values(by_path).reduce((n, c) => n + c, 0));
    const by_network = Object.entries(networks).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([network, count]) => ({ network, count }));
    const row = { agent, role, requests, by_status, by_network, by_path };
    if (role === 'engine') row.own_network = asns ? { asns, ...ownNetworkCounts(zone.own, asns) } : null;
    rows.push(row);
  }
  return rows;
}

async function pushNtfy({ title, priority, body }) {
  if (NO_PUSH) { console.log('[edge-stops] --no-push: skipping ntfy'); return; }
  try {
    await ntfyPost(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'mag' }, body });
    console.log('[edge-stops] ntfy push sent');
  } catch (err) {
    console.error(`[edge-stops] ntfy push failed: ${err.message}`);
  }
}

async function run() {
  if (!TOKEN) { console.error('CLOUDFLARE_API_TOKEN_READ is not set'); return 2; }

  const docs = [];
  for (const day of days) {
    const by = await fetchDay(day);
    // An empty day is an instrument failure (token scope, dataset change), not a quiet day.
    if (!by.length) throw new Error(`${day}: Cloudflare returned no firewall events`);
    const doc = { _id: day, by, ...summarise(by), fetched_at: new Date() };
    // The stops total is the job's first duty; a failure in either table must not lose it.
    try {
      doc.assistants = await fetchAgents(day, ASSISTANT_AGENTS);
      if (!doc.assistants.some((row) => row.requests > 0)) doc.assistants_error = 'every assistant agent read zero, so the query is suspect';
    } catch (e) {
      doc.assistants_error = String(e.message || e);
    }
    try {
      doc.engines = await fetchAgents(day, SEARCH_ENGINES);
      if (!doc.engines.some((row) => row.requests > 0)) doc.engines_error = ZERO_ENGINES;
    } catch (e) {
      doc.engines_error = String(e.message || e);
    }
    docs.push(doc);
  }

  const findings = new Map();
  for (const d of docs) {
    console.log(`${d._id} stopped=${d.stopped} blocked=${d.blocked} challenged_unpassed=${d.challenged_unpassed} passed=${d.challenge_passed} decoys=${d.decoys}`);
    if (d.assistants_error) console.error(`${d._id} assistants: ${d.assistants_error}`);
    for (const row of d.assistants || []) {
      console.log(`  ${row.agent.padEnd(17)} ${String(row.requests).padStart(7)}  ${JSON.stringify(row.by_path)}  ${row.by_network.slice(0, 2).map((n) => `${n.network.slice(0, 24)}=${n.count}`).join(' | ')}`);
    }
    for (const row of d.engines || []) {
      const own = row.own_network;
      console.log(`  ${row.agent.padEnd(17)} ${String(row.requests).padStart(7)}  ${own ? `own network ${own.requests}, turned away ${own.turned_away} (${own.at_edge} at the edge)` : 'counted, not alarmed: network not confirmed'}`);
    }
    findings.set(d._id, checkEngines(d._id, d.engines, d.engines_error));
    for (const f of findings.get(d._id)) console.error(`  CHECK ${f.line}`);
  }

  // Only the newest day speaks for "now"; the older one is re-read because Cloudflare's counts settle.
  const firing = findings.get(docs[0]._id);
  const exit = firing.some(isInstrument) ? 2 : firing.length ? 1 : 0;
  if (DRY) return exit;

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('analytics_edge_daily');
  // A later run for the same day replaces it: Cloudflare's counts settle within hours.
  for (const d of docs) await col.replaceOne({ _id: d._id }, d, { upsert: true });
  console.log(`wrote ${docs.length} day(s) to analytics_edge_daily`);

  if (!BACKFILL) {
    const state = db.collection('system_config');
    const prev = await state.findOne({ _id: STATE_ID });
    const change = alarmChange(prev?.firing, firing);
    const message = alarmMessage(change);
    if (message) await pushNtfy(message);
    else if (firing.length) console.log('[edge-stops] same findings as the last run: no push');
    await state.updateOne({ _id: STATE_ID }, { $set: { firing: change.keys, lines: firing.map((f) => f.line), day: docs[0]._id, checked_at: new Date() } }, { upsert: true });
  }
  await client.close();
  return exit;
}

// Only run when invoked directly: importing this module (tests) must not call Cloudflare or Mongo.
if (process.argv[1] && process.argv[1].endsWith('edge-stops-daily.mjs')) {
  // A crash is the instrument failing (2), never a finding (1).
  run().then((code) => process.exit(code)).catch((err) => { console.error(`[edge-stops] FAILED: ${err.message}`); process.exit(2); });
}
