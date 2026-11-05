#!/usr/bin/env node
/**
 * Edge stops, daily: how many requests did Cloudflare stop before they reached the site?
 *
 * PRIOR ART: scripts/workers/edge-crawl-alert.mjs — reads the same Cloudflare
 * dataset with the same token, but hourly, for crawlers that GOT THROUGH, and
 * it alerts. This one keeps a daily total of what was STOPPED, and never
 * alerts. Kept separate because the question, the window and the output differ.
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
 *   fetched_at.
 * Counts are Cloudflare's sample-adjusted estimates. "Challenged" counts
 * issues of a challenge, so a client challenged twice counts twice.
 *
 * Reading `assistants`: a user agent can be forged, and by_network is there so a
 * reader can tell. `Claude-User` includes connector calls, so `by_path.mcp` is not
 * someone reading a page. The citation benchmark (scripts/eval/citation-benchmark-8161)
 * runs from gex45, so its fetches show under AS24940 Hetzner.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN_READ, zone analytics read):
 *   node --env-file=.env.production.local scripts/workers/edge-stops-daily.mjs            # yesterday and the day before
 *   ... --day 2026-10-26      # one day (must be within the last 3 days)
 *   ... --dry-run             # print, do not write
 */
import { MongoClient } from 'mongodb';
import { BOOK_PATH_LIKES } from './edge-crawl-alert.mjs';

const ZONE = process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID || '2a9b9c5c8eaf11ed3f9279ad50a0d06c';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN_READ;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');

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

async function fetchAssistants(day) {
  const a = `${day}T00:00:00Z`;
  const b = `${dayStr(new Date(Date.parse(a) + 864e5))}T00:00:00Z`;
  const window = `datetime_geq:"${a}", datetime_lt:"${b}"`;
  const rows = [];
  // One request per agent: all six in one request exceeds Cloudflare's limit on nodes per query.
  for (const { agent, role } of ASSISTANT_AGENTS) {
    const ua = `userAgent_like:"%${agent}%"`;
    const parts = [`all: httpRequestsAdaptiveGroups(limit:100, filter:{${window}, ${ua}}, orderBy:[count_DESC]) {
      count dimensions { clientAsn clientASNDescription edgeResponseStatus } }`];
    for (const [name, likes] of Object.entries(PATH_CLASSES)) {
      const paths = `OR:[${likes.map((p) => `{clientRequestPath_like:"${p}"}`).join(', ')}]`;
      parts.push(`${name}: httpRequestsAdaptiveGroups(limit:1, filter:{${window}, ${ua}, ${paths}}) { count }`);
    }
    const zone = await cfQuery(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){${parts.join('\n')}}}}`);
    const by_status = {};
    const networks = {};
    let requests = 0;
    for (const { count, dimensions: d } of zone.all) {
      requests += count;
      by_status[d.edgeResponseStatus] = (by_status[d.edgeResponseStatus] || 0) + count;
      const network = `AS${d.clientAsn} ${d.clientASNDescription}`;
      networks[network] = (networks[network] || 0) + count;
    }
    const by_path = {};
    for (const name of Object.keys(PATH_CLASSES)) by_path[name] = zone[name][0]?.count ?? 0;
    by_path.other = Math.max(0, requests - Object.values(by_path).reduce((n, c) => n + c, 0));
    const by_network = Object.entries(networks).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([network, count]) => ({ network, count }));
    rows.push({ agent, role, requests, by_status, by_network, by_path });
  }
  return rows;
}

if (!TOKEN) { console.error('CLOUDFLARE_API_TOKEN_READ is not set'); process.exit(2); }

const docs = [];
for (const day of days) {
  const by = await fetchDay(day);
  // An empty day is an instrument failure (token scope, dataset change), not a quiet day.
  if (!by.length) throw new Error(`${day}: Cloudflare returned no firewall events`);
  const doc = { _id: day, by, ...summarise(by), fetched_at: new Date() };
  // The stops total is the job's first duty; a failure here must not lose it.
  try {
    doc.assistants = await fetchAssistants(day);
    if (!doc.assistants.some((row) => row.requests > 0)) doc.assistants_error = 'every assistant agent read zero, so the query is suspect';
  } catch (e) {
    doc.assistants_error = String(e.message || e);
  }
  docs.push(doc);
}

for (const d of docs) {
  console.log(`${d._id} stopped=${d.stopped} blocked=${d.blocked} challenged_unpassed=${d.challenged_unpassed} passed=${d.challenge_passed} decoys=${d.decoys}`);
  if (d.assistants_error) console.error(`${d._id} assistants: ${d.assistants_error}`);
  for (const row of d.assistants || []) {
    console.log(`  ${row.agent.padEnd(17)} ${String(row.requests).padStart(7)}  ${JSON.stringify(row.by_path)}  ${row.by_network.slice(0, 2).map((n) => `${n.network.slice(0, 24)}=${n.count}`).join(' | ')}`);
  }
}

if (!DRY) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('bookstore').collection('analytics_edge_daily');
  // A later run for the same day replaces it: Cloudflare's counts settle within hours.
  for (const d of docs) await col.replaceOne({ _id: d._id }, d, { upsert: true });
  await client.close();
  console.log(`wrote ${docs.length} day(s) to analytics_edge_daily`);
}
