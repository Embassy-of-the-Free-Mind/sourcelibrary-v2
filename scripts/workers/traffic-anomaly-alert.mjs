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
const BACKFILL_DAYS = args.includes('--backfill') ? Number(args[args.indexOf('--backfill') + 1]) : 0;
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

// ── The fingerprint axis (added 2026-09-20, #4947) ────────────────────────
// Every check above thresholds a NETWORK, and the 2026-09-20 pool showed what
// that costs. It read 149,296 pages over three weeks from 63,599 addresses in
// 11,437 distinct /16 blocks, and the operators resolved to T-Mobile, Comcast,
// Verizon, Cox, Charter, AT&T, Starlink and a long tail of Latin American
// consumer ISPs — the single loudest was 2.5% of the traffic. There is no
// network to threshold and there never will be: that is what a rented
// residential pool is FOR. Both network checks stayed silent (spray reached
// 4.2% against its 5% floor; 75% of the reads sat in /16s too thin for the
// shape test to examine at all) while the pool ran at 87% of site traffic.
//
// So this check thresholds the thing the operator cannot subdivide: the
// DISGUISE. To pass as a browser they must send a coherent UA string, and one
// string across tens of thousands of addresses is not a population. Rotating
// the string is the evasion, and it is not free — it is the one axis where
// hiding costs them the realism they are paying the pool for.
//
// Sizing, measured on this corpus rather than chosen (the Lightpanda rows
// before 2026-09-01 are excluded — they were bot traffic stored as human, and
// including them would have set the bar at 27,000 and hidden everything):
//   widest GENUINE single-UA fan-out, per 24h, Sep 1-20 ....... 220-1,292 addrs
//   the pool, same windows ............ 861 (Sep 2) -> 45,054 (Sep 18) addrs
// 2,500 sits above the widest real day with room to spare, and would have
// fired on 2026-09-09 at 3,198 — ten days before the spike anyone noticed.
// Between ~1,300 and 2,500 the two populations genuinely overlap; a lower bar
// buys a few days at the cost of flagging real browsers, which is the trade
// that turns a detector into noise.
//
// NOTE the reads-per-address trap. The obvious discriminator — "a pool reads
// once per address, a person reads several" — is BACKWARDS here: site bounce
// rate is 92.8%, so genuine UA strings run 1.01-1.26 reads/address while the
// pool ran 1.77. Do not reintroduce it. Same shape as the pages-per-book trap
// below, which this pool also defeats by reading 10.95 pages/book against a
// human baseline of 3.83.
export const UA_FANOUT_ADDRESSES = 2500;
// A wide string is only interesting if it is also carrying real volume — a
// long tail of one-hit strings is what a normal day looks like.
export const UA_FANOUT_MIN_READS = 2000;
export const UA_FANOUT_MIN_SHARE = 0.15;

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
  const s = String(ip);
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(s);
  if (m) return `${m[1]}.${m[2]}.x.x`;
  // IPv6. Until 2026-09-20 this returned null, and every v6 address was dropped
  // from nets16 before any /16 or spray check ran — silently, because the
  // checks only ever saw a smaller map. The 2026-09-20 pool exited heavily via
  // LACNIC mobile v6 (2800::/2804:: ranges, Brazil/Ecuador/Colombia): 5,857
  // addresses carrying 11,430 reads in one 24h window, 17.5% of classified
  // traffic, invisible to the instrument that exists to see exactly this.
  // Two hextets is the v6 analogue of a /16 by ROLE, not by mask width — it is
  // the coarse allocation unit, the level at which a pool's spread shows up.
  if (s.includes(':')) {
    const h = s.split(':').filter(Boolean).slice(0, 2);
    if (h.length === 2) return `${h[0]}:${h[1]}::x`;
  }
  return null;
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

/**
 * One exact user-agent string spread across more addresses than any real
 * browser population reaches, while carrying a meaningful share of traffic.
 * See the UA_FANOUT_* constants for why these numbers and not others.
 *
 * `share` is this string's share of classified reads in the window.
 */
export function looksLikeSharedFingerprint(addrs, reads, share) {
  if (addrs < UA_FANOUT_ADDRESSES) return false;
  if (reads < UA_FANOUT_MIN_READS) return false;
  return share >= UA_FANOUT_MIN_SHARE;
}

/**
 * Walk back N days and record the pool fingerprints active on each one.
 *
 * The hourly run only ever sees a 24h window, so on the day this check shipped
 * the fingerprint collection knew about exactly one string — today's. Every
 * metric with a longer window (MAU is 30 days) stayed contaminated by strings
 * that had already stopped. Backfilling is how a 30-day figure becomes true on
 * the day the detector lands rather than a month later.
 *
 * Each day is scored on its OWN share of that day's traffic, not the window's,
 * so a pool that ran for three days in a quiet week is still caught.
 */
export async function backfillFingerprints(db, days) {
  const ev = db.collection('analytics_events');
  const found = new Map();
  for (let d = days; d >= 1; d--) {
    const from = new Date(Date.now() - d * 864e5);
    const to = new Date(Date.now() - (d - 1) * 864e5);
    // Same event filter as run(), so a day's share is measured against the
    // same denominator the live check uses. A backfill scored on a different
    // population would flag different strings than the hourly run.
    const dayMatch = {
      event: { $in: ['page_read', 'book_read'] },
      timestamp: { $gte: from, $lt: to },
      traffic_class: { $exists: true },
    };
    const dayTotal = await ev.countDocuments(dayMatch);
    if (!dayTotal) continue;
    const rows = await ev.aggregate([
      { $match: { ...dayMatch, traffic_class: 'human' } },
      { $group: { _id: { ua: '$user_agent', ip: '$ip' }, n: { $sum: 1 } } },
      { $group: { _id: '$_id.ua', addrs: { $sum: 1 }, reads: { $sum: '$n' } } },
      { $sort: { addrs: -1 } }, { $limit: 25 },
    ], { allowDiskUse: true }).toArray();

    for (const r of rows) {
      const share = r.reads / dayTotal;
      if (!looksLikeSharedFingerprint(r.addrs, r.reads, share)) continue;
      const ua = r._id || '(empty)';
      const prev = found.get(ua);
      // last_seen must be the LATEST day the string was flagged, because that
      // is what the staleness window in scripts/lib/suspected-pool.mjs reads.
      if (!prev || to > prev.last_seen) {
        found.set(ua, { last_seen: to, addrs: r.addrs, reads: r.reads, share, days: (prev?.days || 0) + 1 });
      } else {
        prev.days += 1;
      }
      console.log(`  ${to.toISOString().slice(0, 10)}  ${String(r.addrs).padStart(6)} addrs  ${String(r.reads).padStart(6)} reads  ${(share * 100).toFixed(1)}%  "${ua.slice(0, 60)}"`);
    }
  }

  if (!found.size) { console.log('[backfill] no historical pool fingerprints found'); return 0; }
  await db.collection('suspected_pool_fingerprints').bulkWrite(
    [...found.entries()].map(([ua, v]) => ({
      updateOne: {
        filter: { _id: ua },
        update: {
          $max: { last_seen: v.last_seen },
          $setOnInsert: { first_seen: v.last_seen },
          $set: { last_addrs: v.addrs, last_reads: v.reads, last_share: Number((v.share * 100).toFixed(1)) },
          $inc: { windows_flagged: v.days },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  console.log(`[backfill] recorded ${found.size} fingerprint(s) over ${days} days`);
  return found.size;
}

async function run() {
  if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const ev = db.collection('analytics_events');
  const since = new Date(Date.now() - HOURS * 3600e3);
  const alerts = [];

  // One-shot maintenance mode: record historical pool fingerprints so the
  // longer-window metrics (MAU is 30 days) are correct immediately rather than
  // once the contaminated days age out. Exits without alerting.
  if (BACKFILL_DAYS > 0) {
    console.log(`[traffic-anomaly] backfilling pool fingerprints over ${BACKFILL_DAYS} days`);
    await backfillFingerprints(db, BACKFILL_DAYS);
    await client.close();
    return;
  }

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

  // ── 1d. Shared fingerprint — the axis the pool cannot subdivide ───────────
  // Checks 1, 1b and 1c all threshold a network. This one thresholds the
  // disguise. See the UA_FANOUT_* block above for the measurement this is
  // sized on and for the two discriminators (reads-per-address,
  // pages-per-book) that this pool inverts.
  const perUa = await ev.aggregate([
    { $match: { ...classified, traffic_class: 'human' } },
    { $group: { _id: { ua: '$user_agent', ip: '$ip' }, n: { $sum: 1 } } },
    {
      $group: {
        _id: '$_id.ua',
        addrs: { $sum: 1 },
        reads: { $sum: '$n' },
      },
    },
    { $sort: { addrs: -1 } },
    { $limit: 50 },
  ], { allowDiskUse: true }).toArray();

  const fingerprints = perUa
    .map((u) => ({
      ua: u._id || '(empty)',
      addrs: u.addrs,
      reads: u.reads,
      share: classifiedCount ? u.reads / classifiedCount : 0,
    }))
    .filter((u) => looksLikeSharedFingerprint(u.addrs, u.reads, u.share))
    .sort((a, b) => b.reads - a.reads);

  if (fingerprints.length) {
    const worst = fingerprints[0];
    const sum = fingerprints.reduce((s, u) => s + u.reads, 0);
    alerts.push({
      level: 'critical',
      check: 'shared_fingerprint_pool',
      message: `${fingerprints.length} user-agent string(s) each arrived from more than ${UA_FANOUT_ADDRESSES.toLocaleString()} distinct addresses in ${HOURS}h — ${sum.toLocaleString()} reads, all classified HUMAN. Worst: ${worst.addrs.toLocaleString()} addresses, ${worst.reads.toLocaleString()} reads (${(worst.share * 100).toFixed(1)}% of classified traffic) for the single exact string "${worst.ua.slice(0, 90)}". A real browser population does not share one byte-identical UA across that many addresses; the widest genuine string measured on this corpus was 1,292/day. This is a rented residential proxy pool, so do NOT reach for blocked-networks.ts — measured 2026-09-20 the operators were T-Mobile, Comcast, Verizon, Cox, Charter, AT&T and Starlink, consumer space full of real readers, and the loudest was 2.5% of the traffic. The lever that fits is a Cloudflare MANAGED CHALLENGE scoped to the UA string (real browsers pass silently, pool clients mostly do not) — a decision with a real blast radius, so it wants a human. Expect the string to rotate once challenged: that is this check re-firing on a new string, not the problem going away. Strings: ${fingerprints.slice(0, 4).map(u => `"${u.ua.slice(0, 44)}"(${u.addrs} addrs/${u.reads} reads)`).join(' ')}`,
    });
  }

  // Record the flagged fingerprints so the ANALYTICS scripts stop reporting
  // them as audience. This is the durable half of the fix: the alert tells a
  // human, but `audience-metrics` and `usage-deepdive` are read far more often
  // than any alert, and for three weeks they reported a proxy pool as record
  // traffic (78,353 pageviews on 2026-09-19, 87% of it one string). Storing
  // the verdict — rather than hardcoding a UA into classifyTraffic() — is what
  // makes this survive the rotation, and it avoids libelling the real Chrome
  // users who share that string. See scripts/lib/suspected-pool.mjs.
  if (fingerprints.length) {
    const now = new Date();
    await db.collection('suspected_pool_fingerprints').bulkWrite(
      fingerprints.map((u) => ({
        updateOne: {
          filter: { _id: u.ua },
          update: {
            $set: { last_seen: now, last_addrs: u.addrs, last_reads: u.reads, last_share: Number((u.share * 100).toFixed(1)) },
            $setOnInsert: { first_seen: now },
            $inc: { windows_flagged: 1 },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    ).catch((err) => console.error(`[traffic-anomaly] fingerprint write failed: ${err.message}`));
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
