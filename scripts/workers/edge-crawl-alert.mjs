#!/usr/bin/env node
/**
 * Edge crawl detector: who read more book pages in the last hour than a person could?
 *
 * PRIOR ART: scripts/workers/traffic-anomaly-alert.mjs — same job (find a
 * scraper fast, report, never block), but it reads our own analytics, which
 * only see clients that run JavaScript or that the proxy logs. This reads
 * Cloudflare, which sees every request. Kept separate because it needs a
 * different credential and data source; it copies that file's alerting
 * conventions (state-change push, say what to do).
 *
 * Why it exists: from 2026-09-29 to 10-04 a crawler calling itself
 * "thegreeklibrary.org (accord de D. Lomas)" fetched ~500,000 reader pages
 * (56% of Vercel's origin bytes that week, roughly $60-100) from one French
 * home connection. Every defence missed it:
 *   - the Cloudflare rules target disguised scrapers on datacenter networks;
 *     this one was on a home ISP and named itself honestly;
 *   - its IPv6 privacy addresses rotated, so no single address hit the limiter;
 *   - traffic-anomaly-alert reads beacon/event collections, and a crawler that
 *     runs no JavaScript writes none; the proxy logs only blocked bots.
 * It was found six days later, by accident, in a Vercel bill review (#4753).
 *
 * What it measures: book-page requests (/book/*) in the window that REACHED
 * the site (not blocked or challenged at the edge), grouped two ways:
 *   1. one address   - more than ADDRESS_LIMIT/hour
 *   2. one user agent on one network - more than AGENT_LIMIT/hour
 * A reader turning pages fast does a few hundred an hour; a crawler does
 * thousands. Search crawlers we invite (the Cloudflare skip list) are excluded.
 * Counts are Cloudflare's sample-adjusted estimates.
 *
 * Positive control: the Greek crawl's peak hour, 2026-10-03T22:00Z, ~6,800
 * requests. Cloudflare keeps 8 days of this data, so that control expires
 * around 2026-10-11; after that, test with any hour the detector has flagged.
 *
 * Report, don't act: this never blocks. Every alert names the next step.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN_READ, zone analytics read):
 *   node --env-file=.env.production.local scripts/workers/edge-crawl-alert.mjs
 *   ... --from 2026-10-03T22:00:00Z --to 2026-10-03T23:00:00Z --no-push   (backtest)
 *   ... --json
 */
import { MongoClient } from 'mongodb';

const ZONE = process.env.CF_ZONE_ID || '2a9b9c5c8eaf11ed3f9279ad50a0d06c';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN_READ;
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';

const ADDRESS_LIMIT = 500;
const AGENT_LIMIT = 2000;

// Mirrors the Cloudflare skip rule "Allow social-card scrapers + verified
// search crawlers" plus the uptime monitor: traffic we invite.
const INVITED = /Googlebot|Google-InspectionTool|bingbot|Applebot|DuckDuckBot|YandexBot|Claude-SearchBot|Claude-User|OAI-SearchBot|ChatGPT-User|PerplexityBot|Perplexity-User|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|UptimeRobot/i;
// Edge actions that mean the request did NOT reach the site.
const STOPPED = new Set(['block', 'managed_challenge', 'challenge', 'jschallenge', 'connection_close']);

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const NO_PUSH = args.includes('--no-push');
const JSON_OUT = args.includes('--json');
const to = arg('--to') ? new Date(arg('--to')) : new Date();
const from = arg('--from') ? new Date(arg('--from')) : new Date(to.getTime() - 36e5);
const hours = (to - from) / 36e5;
// A backtest window is not "now": it must not move the live alert state.
const BACKTEST = Boolean(arg('--from') || arg('--to'));

async function gql(query) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  // Cloudflare returns quota/permission errors inside an HTTP 200. Treat any
  // error as a failed check, never as "no traffic".
  if (body.errors?.length) throw new Error(`Cloudflare GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
  return body.data.viewer.zones[0];
}

async function pushNtfy(title, message, priority) {
  if (NO_PUSH) { console.log('[edge-crawl] --no-push: skipping ntfy'); return; }
  try {
    await fetch(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'spider' }, body: message });
    console.log('[edge-crawl] ntfy push sent');
  } catch (err) {
    console.error(`[edge-crawl] ntfy push failed: ${err.message}`);
  }
}

export function findCrawlers({ byAddress, byAgent }, perHour = { address: ADDRESS_LIMIT, agent: AGENT_LIMIT }, windowHours = 1) {
  const reached = (rows) => rows.filter((r) => !STOPPED.has(r.dimensions.securityAction) && !INVITED.test(r.dimensions.userAgent || ''));
  const sum = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key(r.dimensions);
      const cur = m.get(k) || { count: 0, d: r.dimensions };
      cur.count += r.count;
      m.set(k, cur);
    }
    return [...m.values()];
  };
  const alerts = [];
  for (const { count, d } of sum(reached(byAddress), (d) => d.clientIP)) {
    if (count > perHour.address * windowHours) {
      alerts.push({ kind: 'address', key: d.clientIP, count, network: `AS${d.clientAsn} ${d.clientASNDescription}`, country: d.clientCountryName, userAgent: d.userAgent });
    }
  }
  for (const { count, d } of sum(reached(byAgent), (d) => `${d.clientAsn}|${d.userAgent}`)) {
    if (count > perHour.agent * windowHours) {
      alerts.push({ kind: 'agent', key: `AS${d.clientAsn}|${(d.userAgent || '(empty)').slice(0, 60)}`, count, network: `AS${d.clientAsn} ${d.clientASNDescription}`, country: d.clientCountryName, userAgent: d.userAgent });
    }
  }
  return alerts.sort((a, b) => b.count - a.count);
}

async function run() {
  if (!TOKEN) { console.error('[edge-crawl] CLOUDFLARE_API_TOKEN_READ is not set'); process.exit(1); }
  // eyeball = real client requests; earlyHintsCache rows are Cloudflare's own
  // bookkeeping and carry a fake "early hints" user agent. `_rsc=` requests
  // are the reader's in-app navigation and prefetch (a real browser running
  // our JavaScript); a crawler fetches whole HTML pages and never sends them,
  // so excluding them keeps a fast human reader under the limits.
  const filter = `{datetime_geq:"${from.toISOString()}", datetime_lt:"${to.toISOString()}", clientRequestPath_like:"/book/%", requestSource:"eyeball", clientRequestQuery_notlike:"%_rsc=%"}`;
  const z = await gql(`{ viewer { zones(filter:{zoneTag:"${ZONE}"}) {
    byAddress: httpRequestsAdaptiveGroups(limit:60, filter:${filter}, orderBy:[count_DESC]) {
      count dimensions { clientIP clientAsn clientASNDescription clientCountryName userAgent securityAction } }
    byAgent: httpRequestsAdaptiveGroups(limit:60, filter:${filter}, orderBy:[count_DESC]) {
      count dimensions { clientAsn clientASNDescription clientCountryName userAgent securityAction } }
  } } }`);

  const alerts = findCrawlers(z, undefined, hours);
  const summary = { window: { from: from.toISOString(), to: to.toISOString() }, alerts };

  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[edge-crawl] ${from.toISOString()} -> ${to.toISOString()}: ${alerts.length ? `${alerts.length} crawler(s)` : 'no crawlers over the limits'}`);
    for (const a of alerts) console.log(`  ${a.kind.padEnd(7)} ${String(a.count).padStart(6)}  ${a.network} ${a.country || ''}  ${(a.userAgent || '').slice(0, 80)}`);
  }

  if (BACKTEST) return alerts.length;

  // Push only when the set of flagged clients changes (same reason as
  // traffic-anomaly-alert: a repeating alarm gets ignored).
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const state = client.db('bookstore').collection('system_config');
  const keys = alerts.map((a) => a.key).sort();
  const prev = await state.findOne({ _id: 'edge_crawl_state' });
  const prevKeys = (prev?.keys || []).slice().sort();
  const fresh = alerts.filter((a) => !prevKeys.includes(a.key));
  if (fresh.length) {
    const lines = fresh.map((a) => `• ${a.count.toLocaleString()} book pages in ${hours}h from ${a.kind === 'address' ? a.key : 'one user agent'} on ${a.network} (${a.country || '?'}), UA "${(a.userAgent || '').slice(0, 100)}"`);
    await pushNtfy(
      `Crawler reading the library: ${fresh.length} new`,
      `${lines.join('\n')}\n\nNot blocked at the edge. Check it in Cloudflare (Security > Analytics), then decide: leave it, challenge it, or block it with a custom rule. Detector: scripts/workers/edge-crawl-alert.mjs`.slice(0, 3500),
      'high',
    );
  } else if (alerts.length) {
    console.log('[edge-crawl] same crawlers as last run: no push');
  }
  await state.updateOne({ _id: 'edge_crawl_state' }, { $set: { keys, alerts, window: summary.window, checked_at: new Date() } }, { upsert: true });
  await client.close();
  return alerts.length;
}

if (process.argv[1] && process.argv[1].endsWith('edge-crawl-alert.mjs')) {
  run().then((n) => process.exit(n ? 2 : 0)).catch((err) => { console.error(`[edge-crawl] FAILED: ${err.message}`); process.exit(1); });
}
