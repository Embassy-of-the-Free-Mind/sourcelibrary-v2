#!/usr/bin/env node
/**
 * Traffic anomaly detector.
 *
 * Written after a scraper fleet on Tencent Cloud (AS132203) read the library
 * for NINE WEEKS undetected — 2,043,739 page views in the final 30 days, 84
 * rotating /24s, 17,357 books. Nothing alerted. It surfaced only because
 * someone went looking at a reading-depth metric that looked wrong.
 *
 * Each check below is one of the three ways that hunt could have ended sooner,
 * and each corresponds to a real failure observed on 2026-07-28/29:
 *
 *   1. CONCENTRATION — one network doing a volume no person could.
 *      Nothing watched per-network volume, so 50K/day looked like "traffic".
 *
 *   2. UNGUARDED HOST — content served on a hostname outside the CDN.
 *      ficinosociety.org (an alias on the same project, no Cloudflare in front)
 *      served the whole library. 100% of the fleet came in that way while the
 *      edge rules sat on sourcelibrary.org doing nothing.
 *
 *   3. EDGE/APP DISAGREEMENT — traffic we believe is blocked at the edge still
 *      reaching the app. A Cloudflare block sat BELOW a managed_challenge rule
 *      for the same ASN; managed_challenge is terminating, so the block never
 *      evaluated once. It read as "enabled" in the dashboard the entire time.
 *
 * Design notes, learned the hard way:
 *
 *   - **Only classified events count.** Events without `traffic_class` predate
 *     write-time classification (#3405) and cannot be attributed; counting them
 *     would produce confident nonsense.
 *   - **Say what to DO.** The `sync_worker_missing` alarm fired daily for seven
 *     weeks and was ignored because it read as a cron nit. Every message here
 *     names the suspected cause and the next command.
 *   - **Report, don't act.** This never blocks anything. Blocking is a decision
 *     with a blast radius; the detector's job is to make the decision possible
 *     in hours instead of months.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/traffic-anomaly-alert.mjs
 *   node scripts/workers/traffic-anomaly-alert.mjs --hours 24 --json
 */

import { MongoClient } from 'mongodb';

// Same topic as uptime-monitor.mjs and daily-health-snapshot.mjs — the channel
// Derek actually reads daily. Deliberately NOT email: `sync_worker_missing`
// emailed itself every morning for seven weeks and was ignored, which is the
// failure this detector exists to avoid repeating.
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const NO_PUSH = process.argv.includes('--no-push');

async function pushNtfy(title, message, priority) {
  if (NO_PUSH) { console.log('[traffic-anomaly] --no-push: skipping ntfy'); return; }
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: priority, Tags: 'rotating_light' },
      body: message,
    });
    console.log('[traffic-anomaly] ntfy push sent');
  } catch (err) {
    console.error(`[traffic-anomaly] ntfy push failed: ${err.message}`);
  }
}

// Checked inside run(), not at module scope: the pure predicates below are
// imported by tests, and a module-level process.exit kills the test runner.
const MONGODB_URI = process.env.MONGODB_URI;

const args = process.argv.slice(2);
const HOURS = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : 24;
const JSON_OUT = args.includes('--json');

// A /24 above this in the window is not a person. Sized off measured reality:
// the fleet ran ~50,000/day per ASN across ~84 /24s (hundreds to low thousands
// each), while the busiest genuine reader network sits in the low hundreds.
// 2,000/day leaves a wide margin over a shared university NAT.
export const CONCENTRATION_THRESHOLD = 2000;

// Hostnames allowed to serve reader traffic. Anything else answering content
// is either a new alias nobody scoped, or a bypass. Both want a human look.
export const EXPECTED_HOSTS = new Set([
  'sourcelibrary.org',
  'bph.sourcelibrary.org',
  'ficinosociety.org', // scoped to the society surface since #3438 — see below
]);

// Networks we believe are refused. If these still produce events, a control
// that is supposed to be working is not.
export const SHOULD_BE_BLOCKED = [{ label: 'AS132203 Tencent Cloud (43.172.0.0/15)', re: /^43\.17[23]\./ }];

// Cloudflare's published IPv4 egress ranges. Present because the concentration
// check below is only meaningful if the stored address belongs to the CALLER.
// Until the cf-connecting-ip fix, the analytics write paths read
// `x-forwarded-for` — which Vercel sets to whatever connected to Vercel, i.e.
// Cloudflare — so every front-door request was recorded against an edge node.
// The check then flagged 14 "networks each reading >2,000 pages" that were all
// Cloudflare, and told the reader to add them to blocked-networks.ts. Following
// that advice would have taken the site down. An alarm whose remediation is
// self-harm is worse than no alarm, which is the whole point of this file.
// Source: https://www.cloudflare.com/ips-v4
export const CDN_EGRESS_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

const CDN_RANGES = CDN_EGRESS_CIDRS.map((cidr) => {
  const [base, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  const start = ipv4ToInt(base);
  return { start, end: start + size - 1 };
});

/**
 * Is this address a CDN edge node rather than a caller? Anonymized IPs (last
 * octet zeroed) still fall inside their own /24, so truncation is harmless.
 */
export function isCdnEgress(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return CDN_RANGES.some((r) => n >= r.start && n <= r.end);
}

/** A hostname serving reader traffic that we did not expect. */
export function isUnexpectedHost(host) {
  return Boolean(host) && !EXPECTED_HOSTS.has(host);
}

/** Is this client IP in a network we believe is refused? */
export function isSupposedlyBlocked(ip) {
  return Boolean(ip) && SHOULD_BE_BLOCKED.some((n) => n.re.test(ip));
}

async function run() {
  if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const ev = db.collection('analytics_events');
  const since = new Date(Date.now() - HOURS * 3600e3);
  const alerts = [];

  const base = { event: { $in: ['page_read', 'book_read'] }, timestamp: { $gte: since } };
  const classified = { ...base, traffic_class: { $exists: true } };

  const total = await ev.countDocuments(base);
  const classifiedCount = await ev.countDocuments(classified);
  const coverage = total ? classifiedCount / total : 1;

  // Guard: if most events are unclassified the rest of this is not measurable.
  if (total > 0 && coverage < 0.5) {
    alerts.push({
      level: 'warning',
      check: 'classification_coverage_low',
      message: `Only ${(coverage * 100).toFixed(1)}% of read events in the last ${HOURS}h carry traffic_class (${classifiedCount}/${total}). Anomaly checks below are unreliable until this is ~100%. If this appears after a deploy, an analytics write path is skipping classifyRequest() — see src/lib/analytics-ingest.ts (#3405).`,
    });
  }

  // ── 1. Concentration ──────────────────────────────────────────────────────
  const heavy = await ev.aggregate([
    { $match: { ...classified, traffic_class: 'human' } },
    { $group: { _id: '$ip', n: { $sum: 1 }, books: { $addToSet: '$book_id' }, hosts: { $addToSet: '$host' } } },
    { $match: { n: { $gt: CONCENTRATION_THRESHOLD } } },
    { $project: { n: 1, books: { $size: '$books' }, hosts: 1 } },
    { $sort: { n: -1 } },
    { $limit: 20 },
  ], { allowDiskUse: true }).toArray();

  // A CDN edge node is not an actor. Split before alerting: a heavy hitter that
  // is really Cloudflare says the WRITE PATH is broken, not that a fleet is
  // reading — and those two findings need opposite responses.
  const heavyReal = heavy.filter((h) => !isCdnEgress(h._id));
  const heavyCdn = heavy.filter((h) => isCdnEgress(h._id));

  if (heavyReal.length) {
    const worst = heavyReal[0];
    const sum = heavyReal.reduce((s, h) => s + h.n, 0);
    alerts.push({
      level: 'critical',
      check: 'traffic_concentration',
      message: `${heavyReal.length} network(s) each read >${CONCENTRATION_THRESHOLD} pages in ${HOURS}h while classified HUMAN — ${sum.toLocaleString()} events total. Worst: ${worst._id} with ${worst.n.toLocaleString()} reads across ${worst.books.toLocaleString()} books via ${(worst.hosts || []).join(',') || '?'}. A person does not read at this rate; a UA-based classifier cannot see a distributed fleet. Confirm with: whois -h whois.cymru.com " -v ${String(worst._id).replace(/0$/, '1')}" — then consider a network block in src/lib/blocked-networks.ts. Networks: ${heavyReal.slice(0, 8).map(h => `${h._id}(${h.n})`).join(' ')}`,
    });
  }

  // The instrument, not the readers. Fires when the top talkers are the CDN,
  // which means the caller's address was never written down and concentration
  // cannot be measured at all for front-door traffic.
  if (heavyCdn.length && !heavyReal.length) {
    const sum = heavyCdn.reduce((s, h) => s + h.n, 0);
    alerts.push({
      level: 'critical',
      check: 'client_ip_not_recorded',
      message: `${heavyCdn.length} of the top-reading "networks" in ${HOURS}h are CLOUDFLARE EDGE NODES (${heavyCdn.slice(0, 4).map(h => `${h._id}(${h.n})`).join(' ')}, ${sum.toLocaleString()} events). That is our own CDN, not a caller — do NOT block these. It means an analytics write path recorded x-forwarded-for (which Vercel sets to the Cloudflare edge) instead of cf-connecting-ip, so no front-door traffic can be attributed to a network and the concentration check above is blind. Fix at the source: clientIpFromHeaders() in src/lib/analytics-ingest.ts must read cf-connecting-ip first, and every analytics writer must use it (src/app/api/track/route.ts was the second one). Compare with src/lib/rate-limit.ts, which has always had the order right.`,
    });
  }

  // ── 2. Unguarded / unexpected host ────────────────────────────────────────
  const hosts = await ev.aggregate([
    { $match: { ...classified, host: { $exists: true, $ne: null } } },
    { $group: { _id: '$host', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();

  const unexpected = hosts.filter((h) => !EXPECTED_HOSTS.has(h._id));
  if (unexpected.length) {
    alerts.push({
      level: 'critical',
      check: 'reader_traffic_on_unexpected_host',
      message: `Reader traffic on ${unexpected.length} unexpected hostname(s): ${unexpected.map(h => `${h._id}=${h.n}`).join(' ')}. Any host outside the Cloudflare zone serves content with NO edge protection — no ASN blocks, no bot rules, no crawler gate. This is how a fleet read the corpus for nine weeks. Check with: curl -sI https://<host>/ | grep -i cf-ray — no cf-ray means the CDN is not in front of it. Fix by scoping the alias (src/lib/alias-host-scope.ts) or putting it behind Cloudflare.`,
    });
  }

  // ── 3. Edge/app disagreement ──────────────────────────────────────────────
  for (const net of SHOULD_BE_BLOCKED) {
    const leaked = await ev.aggregate([
      { $match: { ...base, ip: net.re } },
      { $group: { _id: '$host', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();
    const n = leaked.reduce((s, r) => s + r.n, 0);
    if (n > 0) {
      alerts.push({
        level: 'critical',
        check: 'blocked_network_still_reaching_app',
        message: `${net.label} is supposed to be refused, but produced ${n.toLocaleString()} read events in ${HOURS}h via ${leaked.map(r => `${r._id ?? '?'}=${r.n}`).join(' ')}. Either the app-layer block regressed (src/lib/blocked-networks.ts + the check at the top of src/proxy.ts), or traffic is arriving on a host that bypasses it. NOTE: a Cloudflare rule can read as "enabled" and never fire — a terminating action above it (managed_challenge) stops evaluation. Verify placement, don't trust the dashboard.`,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const summary = {
    window_hours: HOURS,
    read_events: total,
    classified: classifiedCount,
    classification_coverage: Number((coverage * 100).toFixed(1)),
    hosts: hosts.map((h) => ({ host: h._id, events: h.n })),
    alerts,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[traffic-anomaly] window=${HOURS}h reads=${total.toLocaleString()} classified=${(coverage * 100).toFixed(1)}%`);
    console.log(`[traffic-anomaly] hosts: ${hosts.map(h => `${h._id}=${h.n}`).join('  ') || '(none)'}`);
    if (!alerts.length) console.log('[traffic-anomaly] no anomalies');
    for (const a of alerts) console.log(`\n[${a.level.toUpperCase()}] ${a.check}\n  ${a.message}`);
  }

  // Push only when the set of firing checks CHANGES. A detector that repeats
  // the same alert every hour trains you to swipe it away — which is exactly
  // how the seven-week sync_worker_missing alarm became invisible.
  const firing = alerts.filter((a) => a.level === 'critical').map((a) => a.check).sort();
  const prev = await db.collection('system_config').findOne({ _id: 'traffic_anomaly_state' });
  const prevFiring = (prev?.firing || []).slice().sort();
  const changed = JSON.stringify(firing) !== JSON.stringify(prevFiring);

  if (changed && firing.length) {
    await pushNtfy(
      `Traffic anomaly: ${firing.length} critical`,
      alerts.filter((a) => a.level === 'critical').map((a) => `• ${a.message}`).join('\n\n').slice(0, 3500),
      'high',
    );
  } else if (changed && !firing.length && prevFiring.length) {
    await pushNtfy('Traffic anomaly cleared', `Resolved: ${prevFiring.join(', ')}. No anomalies in the last ${HOURS}h.`, 'default');
  } else if (firing.length) {
    console.log(`[traffic-anomaly] ${firing.length} critical still firing (unchanged) — no push`);
  }

  await db.collection('system_config').updateOne(
    { _id: 'traffic_anomaly_state' },
    { $set: { ...summary, firing, checked_at: new Date() } },
    { upsert: true },
  ).catch(() => {});

  await client.close();
  // Non-zero on a critical so a cron wrapper or CI can act on it.
  process.exit(alerts.some((a) => a.level === 'critical') ? 2 : 0);
}

// Only run when invoked directly — importing this module (tests) must not
// connect to Mongo or call process.exit.
if (process.argv[1] && process.argv[1].endsWith('traffic-anomaly-alert.mjs')) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
