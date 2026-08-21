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
import blockedAsnPrefixes from '../../src/lib/blocked-asn-prefixes.json' with { type: 'json' };

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

// The same threshold one level up. On 2026-08-06 this detector fired on exactly
// ONE network — 180.153.197.0, the only member of a four-ASN fleet careless
// enough to use a single address. The rest read 137,000 pages in four days from
// 612 rotating /24s, every one of them under the 2,000 bar, and the /24 check
// could not see any of it. That is the "per-IP rate limits cannot see a fleet"
// lesson this file was written to encode, reappearing one level up inside the
// detector itself: a threshold on a unit the attacker can subdivide is a
// threshold the attacker chooses. Grouping by /16 does not fix that in general
// (nothing on a single axis does), but it raises the cost of hiding by ~256x.
// Sized against what is left AFTER the 2026-08-06 block: with the fleet gone,
// the largest remaining /16 in a 24h window read 938 pages, and it did so at 27
// pages per book — a person, which the shape filter below excludes anyway. So
// 1,500 sits in real space between the loudest genuine network and the quietest
// fleet /16 (2,287), rather than being a round number someone liked.
export const PREFIX16_THRESHOLD = 1500;

// A proxy pool's signature, sized off the 2026-08-06 measurement: a /16 in
// which many distinct /24s each contribute almost nothing. Real traffic from a
// consumer /16 does not look like this — a person reads several pages, so their
// /24 carries more than a couple of reads. The measured pool ran 5,366 /24s at
// 1.45 reads each; the busiest genuine /16 in the same window (31.223.x.x) ran
// 8 /24s at 51 reads each and 22.8 pages per book.
export const SPRAY_MIN_NETS = 25;
export const SPRAY_MAX_READS_PER_NET = 3;

// The pool is only worth waking someone for once it is a real share of traffic.
// Both floors must clear: a percentage alone fires on quiet nights, a count
// alone fires on busy ones.
export const SPRAY_MIN_READS = 2000;
export const SPRAY_MIN_SHARE = 0.05;

// Pages-per-book is what separates a fleet from a devoted reader, and it is a
// far better discriminator than volume. The 2026-08-06 fleet read ~1.4-1.8
// pages from each of thousands of books — enumeration. In the same window
// 31.223.11.0 (TurkNet, consumer) read 2,170 pages across just 68 books, ~32
// each: a person, and one who would have been blocked by a volume-only rule.
// Above this ratio we report the network but do NOT call it a fleet.
export const ENUMERATION_PAGES_PER_BOOK = 5;

// Hostnames allowed to serve reader traffic. Anything else answering content
// is either a new alias nobody scoped, or a bypass. Both want a human look.
export const EXPECTED_HOSTS = new Set([
  'sourcelibrary.org',
  'bph.sourcelibrary.org',
  'ficinosociety.org', // scoped to the society surface since #3438 — see below
]);

// Networks we believe are refused. If these still produce events, a control
// that is supposed to be working is not.
//
// Read from the SAME generated file the app blocks from, so the detector cannot
// quietly watch a stale list and report reassuring silence. The five consumer
// /24s are hand-maintained in src/lib/blocked-networks.ts and are the only part
// duplicated here; tests/unit/traffic-anomaly-alert.test.ts pins the union of
// this list against what the app actually enforces.
export const BLOCKED_CONSUMER_CIDRS = [
  '180.153.197.0/24', // China Telecom Shanghai (AS4811)
  '140.206.235.0/24', // China Unicom Shanghai (AS17621)
  '140.206.236.0/24', // China Unicom Shanghai (AS17621)
  '112.65.211.0/24', // China Unicom Shanghai (AS17621)
  '112.65.212.0/24', // China Unicom Shanghai (AS17621)
];

export const SHOULD_BE_BLOCKED = [
  ...blockedAsnPrefixes.groups.map((g) => ({ label: `AS${g.asn} ${g.name}`, cidrs: g.prefixes })),
  { label: 'consumer /24s reading as enumeration', cidrs: BLOCKED_CONSUMER_CIDRS },
];

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

/** CIDR strings → [start, end] integer ranges. */
function toRanges(cidrs) {
  return cidrs.map((cidr) => {
    const [base, bits] = cidr.split('/');
    const size = 2 ** (32 - Number(bits));
    const start = ipv4ToInt(base);
    return { start, end: start + size - 1 };
  });
}

function inRanges(ip, ranges) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return ranges.some((r) => n >= r.start && n <= r.end);
}

const CDN_RANGES = toRanges(CDN_EGRESS_CIDRS);
const BLOCKED_RANGES = SHOULD_BE_BLOCKED.map((n) => ({ ...n, ranges: toRanges(n.cidrs) }));

/**
 * Is this address a CDN edge node rather than a caller? Anonymized IPs (last
 * octet zeroed) still fall inside their own /24, so truncation is harmless.
 */
export function isCdnEgress(ip) {
  return inRanges(ip, CDN_RANGES);
}

/** A hostname serving reader traffic that we did not expect. */
export function isUnexpectedHost(host) {
  return Boolean(host) && !EXPECTED_HOSTS.has(host);
}

/** Is this client IP in a network we believe is refused? */
export function isSupposedlyBlocked(ip) {
  return Boolean(ip) && BLOCKED_RANGES.some((n) => inRanges(ip, n.ranges));
}

/** The /16 an address sits in, as a display string ("116.204.x.x"). */
export function prefix16(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(String(ip));
  return m ? `${m[1]}.${m[2]}.x.x` : null;
}

/**
 * Does this network's reading LOOK like enumeration rather than reading?
 * A fleet touches thousands of books a page or two deep; a reader goes deep in
 * a few. Volume alone cannot tell them apart and blocking on volume alone
 * eventually blocks a person.
 */
/**
 * Does this /16's traffic look like a proxy pool rather than a network of
 * readers? Many /24s, each contributing almost nothing. Deliberately says
 * nothing about volume: the pool's defining property is that its per-unit
 * volume is ~1 at every unit you might threshold.
 */
export function looksLikeSpray(reads, nets) {
  if (!nets || nets < SPRAY_MIN_NETS) return false;
  return reads / nets <= SPRAY_MAX_READS_PER_NET;
}

export function looksLikeEnumeration(reads, books) {
  if (!books || books < 20) return false; // too few books to judge the shape
  return reads / books < ENUMERATION_PAGES_PER_BOOK;
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

  // One pass over every /24 that read anything, reused by the /24 check, the
  // /16 check and the blocked-network leak check below. Grouping is done once
  // because the fleet is only visible when you can look at the SAME numbers at
  // more than one scale — the 2026-08-06 fleet was invisible per-/24 and
  // obvious per-/16, and a second aggregation would have made that comparison
  // expensive enough to skip.
  const perNet = await ev.aggregate([
    { $match: { ...classified, traffic_class: 'human' } },
    { $group: { _id: '$ip', n: { $sum: 1 }, books: { $addToSet: '$book_id' }, hosts: { $addToSet: '$host' } } },
    { $project: { n: 1, books: { $size: '$books' }, hosts: 1 } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();

  // ── 1. Concentration, per /24 ─────────────────────────────────────────────
  const heavy = perNet.filter((h) => h.n > CONCENTRATION_THRESHOLD).slice(0, 20);

  // A CDN edge node is not an actor. Split before alerting: a heavy hitter that
  // is really Cloudflare says the WRITE PATH is broken, not that a fleet is
  // reading — and those two findings need opposite responses.
  const heavyReal = heavy.filter((h) => !isCdnEgress(h._id));
  const heavyCdn = heavy.filter((h) => isCdnEgress(h._id));

  // Volume says "look"; pages-per-book says what you are looking at. Reporting
  // a devoted reader as a fleet is how a volume-only rule eventually blocks a
  // person — 31.223.11.0 read 2,170 pages in one such window, all from 68 books.
  const heavyEnum = heavyReal.filter((h) => looksLikeEnumeration(h.n, h.books));
  const heavyDeep = heavyReal.filter((h) => !looksLikeEnumeration(h.n, h.books));

  if (heavyEnum.length) {
    const worst = heavyEnum[0];
    const sum = heavyEnum.reduce((s, h) => s + h.n, 0);
    alerts.push({
      level: 'critical',
      check: 'traffic_concentration',
      message: `${heavyEnum.length} network(s) each read >${CONCENTRATION_THRESHOLD} pages in ${HOURS}h while classified HUMAN — ${sum.toLocaleString()} events total. Worst: ${worst._id} with ${worst.n.toLocaleString()} reads across ${worst.books.toLocaleString()} books (${(worst.n / worst.books).toFixed(1)} pages/book) via ${(worst.hosts || []).join(',') || '?'}. A person does not read at this rate, and reading one or two pages each from thousands of books is enumeration, not reading. Confirm with: whois -h whois.cymru.com " -v ${String(worst._id).replace(/0$/, '1')}" — then consider a network block in src/lib/blocked-networks.ts. Networks: ${heavyEnum.slice(0, 8).map(h => `${h._id}(${h.n})`).join(' ')}`,
    });
  }

  if (heavyDeep.length) {
    alerts.push({
      level: 'warning',
      check: 'heavy_reader_networks',
      message: `${heavyDeep.length} network(s) read >${CONCENTRATION_THRESHOLD} pages in ${HOURS}h but went DEEP rather than wide (>=${ENUMERATION_PAGES_PER_BOOK} pages per book): ${heavyDeep.slice(0, 6).map(h => `${h._id}(${h.n} reads/${h.books} books)`).join(' ')}. Reported, not flagged: this is the shape of a shared NAT, a research group, or one very engaged reader. Do NOT add these to blocked-networks.ts without looking at what they actually read — a volume-only rule blocks this person eventually.`,
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

  // ── 1b. Concentration, per /16 — the distributed case ─────────────────────
  // The check above asks "is any single /24 too loud?". A fleet answers that by
  // spreading. On 2026-08-06 four cloud ASNs read 137,000 pages from 612 /24s
  // in four days and not one /24 crossed the bar. Rolling the SAME rows up to
  // /16 made it unmissable: 116.204.x.x alone was 28,595 reads from 90 /24s.
  //
  // Distinct books are counted by a SEPARATE aggregation rather than by summing
  // the per-/24 counts. Summing double-counts every book that more than one /24
  // touched, which inflates the book count and therefore DEFLATES pages-per-book
  // — pushing legitimate networks toward the enumeration verdict. The first cut
  // of this check made that mistake (#3658); on the fleet it did not matter
  // (~1.0 either way), on a busy consumer /16 it would have.
  const books16raw = await ev.aggregate([
    { $match: { ...classified, traffic_class: 'human' } },
    { $addFields: { p16: { $regexFind: { input: '$ip', regex: /^\d{1,3}\.\d{1,3}/ } } } },
    { $match: { 'p16.match': { $ne: null } } },
    { $group: { _id: { p: '$p16.match', b: '$book_id' } } },
    { $group: { _id: '$_id.p', books: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
  const books16 = new Map(books16raw.map((r) => [`${r._id}.x.x`, r.books]));

  const nets16 = new Map();
  for (const h of perNet) {
    if (isCdnEgress(h._id)) continue; // our own CDN is not an actor
    const p = prefix16(h._id);
    if (!p) continue;
    const cur = nets16.get(p) || { n: 0, nets: 0 };
    cur.n += h.n;
    cur.nets += 1;
    nets16.set(p, cur);
  }
  for (const [p, v] of nets16) v.books = books16.get(p) ?? 0;

  // A /16 is only interesting if the volume is spread across many /24s — a
  // single loud /24 is check 1's job and would otherwise be reported twice.
  const spread = [...nets16.entries()]
    .map(([p, v]) => ({ p, ...v }))
    .filter((v) => v.n > PREFIX16_THRESHOLD && v.nets >= 4 && looksLikeEnumeration(v.n, v.books))
    .sort((a, b) => b.n - a.n);

  if (spread.length) {
    const sum = spread.reduce((s, v) => s + v.n, 0);
    const worst = spread[0];
    alerts.push({
      level: 'critical',
      check: 'distributed_fleet',
      message: `${spread.length} /16 network(s) read >${PREFIX16_THRESHOLD} pages in ${HOURS}h spread across many /24s, all classified HUMAN — ${sum.toLocaleString()} events total. Worst: ${worst.p} with ${worst.n.toLocaleString()} reads from ${worst.nets} distinct /24s at ${(worst.n / worst.books).toFixed(1)} pages per book. Rotating /24s is how a fleet stays under a per-/24 threshold, so treat the /24 numbers as meaningless here. Resolve the OPERATOR, not the address: whois -h whois.cymru.com " -v ${worst.p.replace(/x\.x$/, '1.1')}" — and block the operator's measured allocations, because blocking one allocation just moves the fleet to the next (AS132203 → AS45090 did exactly that). Networks: ${spread.slice(0, 8).map(v => `${v.p}(${v.n}/${v.nets} nets)`).join(' ')}`,
    });
  }

  // ── 1c. Spray — a pool too diffuse for ANY per-network threshold ──────────
  // Third iteration of the same lesson. Check 1 asks whether a /24 is too loud;
  // check 1b asks whether a /16 is. Hours after the 2026-08-06 cloud block, ~26%
  // of reads were arriving from China Mobile provincial ASNs as 5,366 distinct
  // /24s averaging 1.45 reads each — 24,044 addresses in 12h, of which 20,643
  // made EXACTLY ONE read. No /16 came near PREFIX16_THRESHOLD (the loudest was
  // 253). A residential/mobile proxy pool defeats every per-unit threshold by
  // construction, because the per-unit volume is ~1 by design.
  //
  // So this check does not threshold a network at all. It identifies the SHAPE
  // — many /24s inside one /16, each contributing almost nothing — and then sums
  // across every /16 with that shape, because the whole point is that no single
  // one is alarming. Measure the aggregate, not the loudest member.
  const sprayed = [...nets16.entries()]
    .map(([p, v]) => ({ p, ...v }))
    .filter((v) => looksLikeSpray(v.n, v.nets))
    .sort((a, b) => b.n - a.n);

  const sprayReads = sprayed.reduce((s, v) => s + v.n, 0);
  const sprayNets = sprayed.reduce((s, v) => s + v.nets, 0);
  const sprayShare = classifiedCount ? sprayReads / classifiedCount : 0;

  if (sprayed.length && sprayReads >= SPRAY_MIN_READS && sprayShare >= SPRAY_MIN_SHARE) {
    alerts.push({
      level: 'critical',
      check: 'distributed_proxy_pool',
      message: `${sprayReads.toLocaleString()} reads in ${HOURS}h (${(sprayShare * 100).toFixed(1)}% of classified traffic) arrived as a SPRAY: ${sprayed.length} /16 networks, ${sprayNets.toLocaleString()} distinct /24s, averaging ${(sprayReads / sprayNets).toFixed(2)} reads per /24. That is a residential/mobile proxy pool, not a datacenter fleet — each exit address is used once and discarded, so no per-IP, per-/24 or per-/16 threshold can see it. **Do NOT add these to blocked-networks.ts**: measured 2026-08-06 they were China Mobile provincial ASNs (Hebei, Hunan, Heilongjiang, Jilin, Henan), consumer mobile space where real readers live, and an app-layer block would refuse them along with the pool. The lever that fits this shape is a Cloudflare managed challenge scoped to the offending ASNs (real browsers pass, headless pool clients mostly do not) — a decision with a real blast radius, so it wants a human. Top: ${sprayed.slice(0, 6).map(v => `${v.p}(${v.n}/${v.nets} nets)`).join(' ')}`,
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
  // Matched in JS against CIDR ranges rather than in Mongo: the blocked set is
  // now 74 prefixes across five operators, and a regex over dotted-quad text
  // cannot express a /17. `allNets` is every /24 seen in the window, from one
  // grouping — cheaper than 74 collection scans and, more importantly, it
  // cannot silently disagree with what the checks above measured.
  const allNets = await ev.aggregate([
    { $match: base },
    { $group: { _id: { ip: '$ip', host: '$host' }, n: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();

  for (const net of BLOCKED_RANGES) {
    const hits = allNets.filter((r) => inRanges(r._id.ip, net.ranges));
    const n = hits.reduce((s, r) => s + r.n, 0);
    const byHost = new Map();
    for (const h of hits) byHost.set(h._id.host ?? '?', (byHost.get(h._id.host ?? '?') || 0) + h.n);
    const leaked = [...byHost.entries()].map(([host, count]) => ({ _id: host, n: count })).sort((a, b) => b.n - a.n);
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
