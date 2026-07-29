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
 * been measured and no plausible reader exists. 43.172.0.0/15 is Tencent Cloud
 * Singapore (Aceville Pte Ltd, abuse@tencent.com), observed as 37 distinct /24s
 * rotating 16 user-agents, 354,997 page-reads in 7 days across 8,047 books, and
 * 57% of all 404s from enumerating guessed URLs. Alibaba (AS45102) was measured
 * at 179/day and is deliberately NOT listed — it does not clear the bar.
 *
 * A person on a VPN does not browse from a Tencent Cloud VM at 1,575 pages a
 * day. If that ever stops being true, this list is one line to change.
 */

/** CIDR-ish prefixes, matched on the leading octets of the client IP. */
const BLOCKED_PREFIXES: string[] = [
  // 43.172.0.0/15 — covers 43.172.x.x and 43.173.x.x
  '43.172.',
  '43.173.',
];

export const BLOCKED_NETWORK_RESPONSE =
  'Automated bulk access from this network is not permitted. ' +
  'Source Library is free to read and the full corpus is available under licence — see https://sourcelibrary.org/licensing.';

/**
 * Is this client IP inside a refused network?
 * Takes the raw address; the caller extracts it from the proxy headers.
 */
export function isBlockedNetwork(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const addr = ip.trim();
  return BLOCKED_PREFIXES.some((prefix) => addr.startsWith(prefix));
}
