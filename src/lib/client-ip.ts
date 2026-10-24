/**
 * The caller's IP address, from headers we can actually trust.
 *
 * PRIOR ART: src/lib/rate-limit.ts getClientIp, src/proxy.ts getClientIp and
 * src/lib/analytics-ingest.ts clientIpFromHeaders each read `cf-connecting-ip`
 * first, unconditionally. They now all resolve through this file.
 *
 * Why `cf-connecting-ip` cannot be read unconditionally: it is a plain request
 * header. On sourcelibrary.org Cloudflare sets it and refuses a client-supplied
 * one (error 1000), so it is the reader's address. But the project also answers
 * on hosts OUTSIDE Cloudflare (*.vercel.app branch aliases and deployment URLs),
 * and there the client writes it. A scraper that rotated a fake value on every
 * request got a fresh per-IP page budget each time, and could dodge the network
 * blocks in blocked-networks.ts by claiming any address it liked (#7155).
 *
 * What we can trust is the address that connected to Vercel: Vercel overwrites
 * `x-forwarded-for` with it and does not forward a client-supplied value. Behind
 * the CDN that peer is a Cloudflare edge node, which is exactly why the old code
 * preferred `cf-connecting-ip` (#3487, #3491). So: if the peer is a Cloudflare
 * edge node, the request came through the CDN and `cf-connecting-ip` is real;
 * otherwise the peer IS the caller, and every client-supplied header is ignored.
 */

// https://www.cloudflare.com/ips-v4 and /ips-v6 (fetched 2026-10-23). The same
// v4 list is mirrored in scripts/workers/traffic-anomaly-alert.mjs.
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** IPv6 literal → 8 hextets, or null. Handles `::` compression. */
function ipv6ToHextets(ip: string): number[] | null {
  if (!ip.includes(':') || ip.includes('.')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

const V4_RANGES = CLOUDFLARE_V4.map((cidr) => {
  const [base, bits] = cidr.split('/');
  const start = ipv4ToInt(base)!;
  return { start, end: start + 2 ** (32 - Number(bits)) - 1 };
});

const V6_PREFIXES = CLOUDFLARE_V6.map((cidr) => {
  const [base, bits] = cidr.split('/');
  return { hextets: ipv6ToHextets(base)!, bits: Number(bits) };
});

/** Is this address one of Cloudflare's edge nodes? */
export function isCloudflareEdge(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const addr = ip.trim().replace(/^::ffff:/i, '');
  const v4 = ipv4ToInt(addr);
  if (v4 !== null) return V4_RANGES.some((r) => v4 >= r.start && v4 <= r.end);
  const v6 = ipv6ToHextets(addr);
  if (!v6) return false;
  return V6_PREFIXES.some(({ hextets, bits }) => {
    for (let i = 0, left = bits; left > 0; i++, left -= 16) {
      const mask = left >= 16 ? 0xffff : (0xffff << (16 - left)) & 0xffff;
      if ((v6[i] & mask) !== (hextets[i] & mask)) return false;
    }
    return true;
  });
}

/**
 * The caller's raw IP (not anonymized), or 'unknown'.
 *
 * With no `x-forwarded-for` / `x-real-ip` at all (local dev, unit tests) there
 * is no peer to check against, so `cf-connecting-ip` is used as before. On
 * Vercel the peer header is always present, so that branch is unreachable in
 * production.
 */
export function trustedClientIp(headers: Headers): string {
  const peer =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    '';
  const viaCdn = headers.get('cf-connecting-ip')?.trim() || headers.get('true-client-ip')?.trim() || '';
  if (!peer) return viaCdn || 'unknown';
  if (isCloudflareEdge(peer)) return viaCdn || peer;
  return peer;
}
