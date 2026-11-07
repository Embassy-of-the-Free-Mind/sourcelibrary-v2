/**
 * Is this request really an assistant reading for a person? (#8161)
 *
 * PRIOR ART: src/lib/crawler-verify.ts proves a crawler by reverse DNS, but these
 * operators publish address lists rather than hostnames. src/lib/client-ip.ts and
 * src/lib/blocked-networks.ts each match CIDRs for a fixed list of their own and
 * export no matcher. USER_FETCH_AGENTS in src/lib/bot-gate.ts names the same three
 * fetchers but believes the name, which is right for what it grants and wrong here.
 * Cloudflare's `cf-verified-bot` header needs an Enterprise plan.
 *
 * People using one assistant arrive from a few shared addresses. Anthropic's
 * connector is 65 addresses (2026-11-05), so an allowance keyed by address is
 * shared by strangers: 7 of those address-days reached 400 of the 500 pages, and
 * 4 reached 490. A proven fetcher therefore gets a larger allowance.
 *
 * Both halves must hold. A User-Agent can be forged by anyone, so a name alone
 * earns nothing, and an address alone would also cover the operator's other
 * clients. Anything unproven stays on the anonymous tier, and is not refused.
 */
import RANGES from '@/lib/assistant-fetcher-ranges.json';

export type AssistantOperator = 'anthropic' | 'openai' | 'perplexity';

const NAMES: ReadonlyArray<readonly [string, AssistantOperator]> = [
  ['claude-user', 'anthropic'],
  ['chatgpt-user', 'openai'],
  ['perplexity-user', 'perplexity'],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

const SPANS = Object.fromEntries(
  (Object.keys(RANGES) as AssistantOperator[]).map((operator) => [
    operator,
    RANGES[operator].prefixes.map((cidr) => {
      const [base, bits] = cidr.split('/');
      const start = ipv4ToInt(base)!;
      return { start, end: start + 2 ** (32 - Number(bits)) - 1 };
    }),
  ]),
) as Record<AssistantOperator, { start: number; end: number }[]>;

/**
 * The operator, when the User-Agent names its fetcher AND the address is on that
 * operator's published list. Otherwise null. The name is checked first, so an
 * ordinary request costs one substring scan.
 */
export function verifiedAssistantFetcher(
  userAgent: string | null | undefined,
  ip: string | null | undefined,
): AssistantOperator | null {
  if (!userAgent || !ip) return null;
  const ua = userAgent.toLowerCase();
  const operator = NAMES.find(([name]) => ua.includes(name))?.[1];
  if (!operator) return null;
  const addr = ipv4ToInt(ip.trim().replace(/^::ffff:/i, ''));
  if (addr === null) return null;
  return SPANS[operator].some((s) => addr >= s.start && addr <= s.end) ? operator : null;
}
