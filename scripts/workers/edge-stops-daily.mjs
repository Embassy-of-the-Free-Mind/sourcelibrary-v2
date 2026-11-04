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
 *   fetched_at.
 * Counts are Cloudflare's sample-adjusted estimates. "Challenged" counts
 * issues of a challenge, so a client challenged twice counts twice.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN_READ, zone analytics read):
 *   node --env-file=.env.production.local scripts/workers/edge-stops-daily.mjs            # yesterday and the day before
 *   ... --day 2026-10-26      # one day (must be within the last 3 days)
 *   ... --dry-run             # print, do not write
 */
import { MongoClient } from 'mongodb';

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

if (!TOKEN) { console.error('CLOUDFLARE_API_TOKEN_READ is not set'); process.exit(2); }

const docs = [];
for (const day of days) {
  const by = await fetchDay(day);
  // An empty day is an instrument failure (token scope, dataset change), not a quiet day.
  if (!by.length) throw new Error(`${day}: Cloudflare returned no firewall events`);
  docs.push({ _id: day, by, ...summarise(by), fetched_at: new Date() });
}

for (const d of docs) console.log(`${d._id} stopped=${d.stopped} blocked=${d.blocked} challenged_unpassed=${d.challenged_unpassed} passed=${d.challenge_passed} decoys=${d.decoys}`);

if (!DRY) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('bookstore').collection('analytics_edge_daily');
  // A later run for the same day replaces it: Cloudflare's counts settle within hours.
  for (const d of docs) await col.replaceOne({ _id: d._id }, d, { upsert: true });
  await client.close();
  console.log(`wrote ${docs.length} day(s) to analytics_edge_daily`);
}
