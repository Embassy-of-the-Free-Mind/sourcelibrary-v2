/**
 * Is this client the crawler it says it is? (#8098)
 *
 * PRIOR ART: src/lib/api-auth.ts verifyBotByRdns, which this was moved out of so
 * that the page gate (bot-gate.ts) asks the same question as the budget. It
 * answered yes or no; the page gate needs a third answer, because a resolver that
 * timed out says nothing about the client and must not cost a real crawler the
 * index. src/lib/agent-requests.ts reads Cloudflare's verified-bot header for
 * analytics, which is absent off the edge and so cannot be the only proof here.
 *
 * Forward-confirmed reverse DNS is the check Google and Microsoft publish for
 * their crawlers. Lazy-imports node:dns, so nothing here loads on the edge until a
 * claim actually arrives.
 */

// Claims with published hostnames. A signature not listed here cannot be proven
// this way, and bot-gate keeps taking its word (low volume, accepted risk).
const PROVABLE_CLAIMS: Record<string, string[]> = {
  googlebot: ['.googlebot.com', '.google.com'],
  bingbot: ['.search.msn.com'],
  msnbot: ['.search.msn.com'],
  applebot: ['.applebot.apple.com'],
};

/** The provable crawler this user agent names, or null. */
export function provableClaimIn(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  // applebot-extended is a training token, not the search crawler.
  if (ua.includes('applebot-extended')) return null;
  return Object.keys(PROVABLE_CLAIMS).find((sig) => ua.includes(sig)) ?? null;
}

/**
 * - `verified`: the address reverse-resolves to the crawler's domain and back.
 * - `forged`: it provably does not (no PTR, another domain, no way back).
 * - `unknown`: the resolver failed or was too slow, which says nothing about the
 *   client. A caller granting a privilege treats it as no; a caller refusing
 *   someone treats it as not proven guilty.
 */
export type CrawlerVerdict = 'verified' | 'forged' | 'unknown';

const VERDICT_TTL_MS = 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 60 * 1000;
const LOOKUP_BUDGET_MS = 800;
// An answer from the resolver: this name or address has no such record.
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA']);

const verdictCache = new Map<string, { verdict: CrawlerVerdict; exp: number }>();

/** Test seam. */
export function clearCrawlerVerdictCache(): void {
  verdictCache.clear();
}

/** One spelling per IPv6 address, so a forward lookup can be compared with the client's. */
function canonicalIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (!lower.includes(':')) return lower;
  const [head, tail] = lower.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = lower.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  return [...left, ...zeros, ...right].map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

function isNoRecord(err: unknown): boolean {
  return NO_RECORD.has((err as { code?: string } | null)?.code ?? '');
}

async function lookup(domains: string[], ip: string): Promise<CrawlerVerdict> {
  const dns = await import('node:dns/promises');
  let hosts: string[];
  try {
    hosts = await dns.reverse(ip);
  } catch (err) {
    return isNoRecord(err) ? 'forged' : 'unknown';
  }
  const host = hosts.find((h) => domains.some((d) => h.toLowerCase().endsWith(d)));
  if (!host) return 'forged';

  const family = ip.includes(':') ? dns.resolve6(host) : dns.resolve4(host);
  try {
    const want = canonicalIp(ip);
    return (await family).some((a) => canonicalIp(a) === want) ? 'verified' : 'forged';
  } catch (err) {
    return isNoRecord(err) ? 'forged' : 'unknown';
  }
}

/** The verdict on one claim from one address. Never throws. */
export async function verifyCrawlerClaim(sig: string, ip: string): Promise<CrawlerVerdict> {
  const domains = PROVABLE_CLAIMS[sig];
  if (!domains || !ip || ip === 'unknown') return 'unknown';

  const key = `${ip}|${sig}`;
  const hit = verdictCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.verdict;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<CrawlerVerdict>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), LOOKUP_BUDGET_MS);
  });
  const verdict = await Promise.race([lookup(domains, ip).catch((): CrawlerVerdict => 'unknown'), late]);
  clearTimeout(timer);
  verdictCache.set(key, { verdict, exp: Date.now() + (verdict === 'unknown' ? UNKNOWN_TTL_MS : VERDICT_TTL_MS) });
  return verdict;
}
