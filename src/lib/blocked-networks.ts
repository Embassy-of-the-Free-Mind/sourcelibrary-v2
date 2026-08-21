/**
 * Datacenter networks refused at the application layer, on every hostname.
 *
 * Cloudflare already blocks AS132203 on the reader and image paths, but a
 * Cloudflare rule protects a *zone*, and this project answers on hostnames
 * outside it (`ficinosociety.org`, `sourcelibrary-v2.vercel.app`). The fleet
 * found that: on 2026-07-29, minutes after `host` was added to read events,
 * 3,791 of ~6,276 `page_read` events were the fleet arriving via
 * ficinosociety.org and **zero** were the fleet via sourcelibrary.org.
 *
 * This is the same lesson the crawler gate already records — a control applied
 * at one layer is silently defeated by the others — so the durable version of
 * the block lives here, where every host and every route passes through it.
 *
 * Scope is deliberately narrow: only ranges where sustained automated abuse has
 * been measured and no plausible reader exists. Every prefix below is an
 * allocation the abusive traffic was actually *observed* in, resolved to its
 * announced BGP prefix and then collapsed where allocations are adjacent — not
 * a whole-ASN sweep. AS45090 announces 2,255 prefixes; 102 of them appear here,
 * because those are the ones that read the library.
 *
 * A person on a VPN does not browse from a Tencent Cloud VM at 1,575 pages a
 * day. If that ever stops being true, this list is one line to change.
 *
 * ── 2026-08-06: the fleet came back through the front door ──────────────────
 *
 * The July fleet was caught because it bypassed Cloudflare, which is what
 * caused its real addresses to be written down. Its successor arrived on
 * `sourcelibrary.org` instead — invisible to every IP check until #3487 made
 * the analytics writers read `cf-connecting-ip` rather than the CDN's own
 * address. With that fixed, four days of reads (2026-08-02 → 08-06) resolve to:
 *
 *     AS55990   Huawei Cloud            61,439 reads   164 /24s
 *     AS45090   Tencent Cloud           34,522 reads   371 /24s
 *     AS150436  Byteplus / ByteDance    22,997 reads    27 /24s
 *     AS136907  Huawei Clouds HK        17,919 reads    50 /24s
 *
 * — 87.6% of all traffic from networks reading >60 pages, forging Chrome UAs
 * across versions 103–150 on both Mac and Windows, at ~1.8 pages per book
 * across thousands of books. Note AS45090: `43.172.0.0/15` (AS132203) has been
 * refused since #3438 and the fleet simply moved to Tencent's other prefixes.
 * Blocking one allocation of a cloud provider relocates the traffic; it does
 * not stop it. That is why the entries below are grouped by operator.
 *
 * **The discriminator is pages-per-book, not volume.** The same measurement
 * flagged `31.223.11.0` (TurkNet, consumer) at 2,170 reads — but across only 68
 * books, ~32 pages each. That is a *reader*, and it is deliberately not listed.
 * Enumeration reads a page or two from thousands of books; a person reads many
 * pages from few. Apply that test before adding anything here.
 */

import blockedAsnPrefixes from './blocked-asn-prefixes.json';

/**
 * Individual /24s on CONSUMER ISPs, listed as bare /24s rather than as their
 * announced allocations — these sit in address space where a real reader
 * plausibly lives, so the block is kept as narrow as the measurement.
 *
 * Each read 700–6,000 pages across 600–3,300 distinct books in four days:
 * ~1.4 pages per book, the enumeration signature, not a person. If a reader
 * ever reports a block from one of these, delete that line. The cost of being
 * wrong here is one person, and that is worth reverting for.
 */
const BLOCKED_CONSUMER_CIDRS: string[] = [
  '180.153.197.0/24', // China Telecom Shanghai (AS4811) — 6,032 reads / 3,331 books
  '140.206.235.0/24', // China Unicom Shanghai (AS17621) — 1,766 reads / 1,260 books
  '140.206.236.0/24', // China Unicom Shanghai (AS17621) —   898 reads /   718 books
  '112.65.211.0/24', // China Unicom Shanghai (AS17621) — 1,511 reads / 1,098 books
  '112.65.212.0/24', // China Unicom Shanghai (AS17621) —   773 reads /   639 books
];

/**
 * Refused networks: every prefix the blocked cloud operators announce, plus the
 * consumer /24s above.
 *
 * The operator prefixes are GENERATED — see
 * `scripts/maintenance/refresh-blocked-asn-prefixes.mjs` for the ASN list, the
 * evidence behind each entry, and why the unit of blocking is the operator
 * rather than the ranges we happened to observe. Short version: a four-day
 * sample of a rotating fleet tells you where it has been, never where it can go
 * next, and the first draft of this list — 74 hand-resolved prefixes at 94.6%
 * coverage — already had traffic arriving from allocations just outside it.
 */
const BLOCKED_CIDRS: string[] = [
  ...blockedAsnPrefixes.groups.flatMap((g) => g.prefixes),
  ...BLOCKED_CONSUMER_CIDRS,
];

export const BLOCKED_NETWORK_RESPONSE =
  'Automated bulk access from this network is not permitted. ' +
  'Source Library is free to read and the full corpus is available under licence — see https://sourcelibrary.org/licensing.';

/** Dotted-quad → 32-bit integer, or null if it is not an IPv4 literal. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    // Reject empty, non-numeric, and zero-padded forms ('01' parses as 1 in
    // Number() but is a different address to some parsers — refuse ambiguity).
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/**
 * The CIDRs above as sorted [start, end] ranges, built once at module load.
 * Sorted so the lookup can binary-search: this runs at the top of `proxy()`,
 * on every request, before anything else.
 */
const BLOCKED_RANGES: ReadonlyArray<{ start: number; end: number }> = (() => {
  const parsed = BLOCKED_CIDRS.map((cidr) => {
    const [base, bits] = cidr.split('/');
    const start = ipv4ToInt(base);
    const width = Number(bits);
    if (start === null || !Number.isInteger(width) || width < 0 || width > 32) {
      throw new Error(`blocked-networks: malformed CIDR ${cidr}`);
    }
    return { start, end: start + 2 ** (32 - width) - 1 };
  }).sort((a, b) => a.start - b.start);

  // Merge overlapping and adjacent ranges. Binary search below is only correct
  // over disjoint ranges, and the list is hand-edited during an incident — the
  // moment someone adds a /16 that swallows a /24 already listed, an unmerged
  // search can land on the wrong entry and return false. Merge, don't assume.
  const merged: { start: number; end: number }[] = [];
  for (const r of parsed) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
})();

/**
 * Is this client IP inside a refused network?
 * Takes the raw address; the caller extracts it from the proxy headers — which
 * must read `cf-connecting-ip` first, or this measures the CDN (see #3487).
 *
 * IPv6 callers are never blocked: the fleet is v4-only and inventing v6 rules
 * from no measurement is how you block a reader. ~5% of reads are v6 and that
 * gap is known, not overlooked.
 */
export function isBlockedNetwork(ip: string | null | undefined): boolean {
  if (!ip) return false;
  // Normalise the IPv4-mapped form (`::ffff:1.2.3.4`) some proxies emit.
  const addr = ip.trim().replace(/^::ffff:/i, '');
  const n = ipv4ToInt(addr);
  if (n === null) return false;

  let lo = 0;
  let hi = BLOCKED_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = BLOCKED_RANGES[mid];
    if (n < r.start) hi = mid - 1;
    else if (n > r.end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Exported for tests and the traffic-anomaly detector, which asserts agreement. */
export const BLOCKED_CIDR_LIST: ReadonlyArray<string> = BLOCKED_CIDRS;
