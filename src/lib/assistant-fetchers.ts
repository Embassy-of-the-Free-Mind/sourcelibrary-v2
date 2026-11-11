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
/** Every published list we hold: the three fetchers' operators plus OpenAI's search crawler. */
type PublishedList = keyof typeof RANGES;

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
  (Object.keys(RANGES) as PublishedList[]).map((operator) => [
    operator,
    RANGES[operator].prefixes.map((cidr) => {
      const [base, bits] = cidr.split('/');
      const start = ipv4ToInt(base)!;
      return { start, end: start + 2 ** (32 - Number(bits)) - 1 };
    }),
  ]),
) as Record<PublishedList, { start: number; end: number }[]>;

/** The address as an integer, or null for anything that is not IPv4 (incl. ::ffff:-mapped). */
function addressOf(ip: string): number | null {
  return ipv4ToInt(ip.trim().replace(/^::ffff:/i, ''));
}

function onList(list: PublishedList, ip: string): boolean {
  const addr = addressOf(ip);
  return addr !== null && SPANS[list].some((s) => addr >= s.start && addr <= s.end);
}

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
  return onList(operator, ip) ? operator : null;
}

/**
 * Names the page wall trusts only from their operator's published addresses
 * (#4357): the three fetchers above plus the two AI search crawlers.
 * Claude-SearchBot uses Anthropic's list; OAI-SearchBot has its own.
 */
const LISTED_NAMES: ReadonlyArray<readonly [string, PublishedList]> = [
  ...NAMES,
  ['claude-searchbot', 'anthropic'],
  ['oai-searchbot', 'openai-search'],
];

/** Does the User-Agent name a client this module can prove by address? */
export function namesListedClient(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').toLowerCase();
  return LISTED_NAMES.some(([name]) => ua.includes(name));
}

/**
 * True when the User-Agent names a listed client AND the address is on that
 * client's published list. A name alone, or an address alone, is false.
 */
export function provenByPublishedList(
  userAgent: string | null | undefined,
  ip: string | null | undefined,
): boolean {
  if (!userAgent || !ip) return false;
  const ua = userAgent.toLowerCase();
  const list = LISTED_NAMES.find(([name]) => ua.includes(name))?.[1];
  return list ? onList(list, ip) : false;
}
