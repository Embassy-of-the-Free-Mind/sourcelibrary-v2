import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A crawler's name is a claim (#8098). The three answers matter separately: a
 * forged claim loses its trust, and a resolver failing must never cost a real
 * crawler the index.
 */

const reverse = vi.fn<(ip: string) => Promise<string[]>>();
const resolve4 = vi.fn<(h: string) => Promise<string[]>>();
const resolve6 = vi.fn<(h: string) => Promise<string[]>>();
vi.mock('node:dns/promises', () => ({ reverse, resolve4, resolve6, default: { reverse, resolve4, resolve6 } }));
vi.mock('@/lib/dataset/api-keys', () => ({ validateApiKey: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: (r: Request) => r.headers.get('x-test-ip') || 'unknown',
}));

import { clearCrawlerVerdictCache, provableClaimIn, verifyCrawlerClaim } from '@/lib/crawler-verify';
import { isTrustedBot } from '@/lib/bot-gate';
import RANGES from '@/lib/assistant-fetcher-ranges.json';

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const err = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  clearCrawlerVerdictCache();
  reverse.mockReset();
  resolve4.mockReset();
  resolve6.mockReset();
});

describe('provableClaimIn', () => {
  it('names the crawlers with published hostnames only', () => {
    expect(provableClaimIn(GOOGLEBOT)).toBe('googlebot');
    expect(provableClaimIn('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe('bingbot');
    expect(provableClaimIn('DuckDuckBot/1.1')).toBeNull();
    expect(provableClaimIn('Applebot-Extended/0.1')).toBeNull();
  });
});

describe('verifyCrawlerClaim', () => {
  it('verified: back and forth to the crawler domain', async () => {
    reverse.mockResolvedValue(['crawl-66-249-66-1.googlebot.com']);
    resolve4.mockResolvedValue(['66.249.66.1']);
    expect(await verifyCrawlerClaim('googlebot', '66.249.66.1')).toBe('verified');
  });

  it('verified over IPv6, whatever the spelling of the address', async () => {
    reverse.mockResolvedValue(['crawl.googlebot.com']);
    resolve6.mockResolvedValue(['2001:4860:4801:10::1']);
    expect(await verifyCrawlerClaim('googlebot', '2001:4860:4801:0010:0:0:0:1')).toBe('verified');
  });

  it('forged: no PTR, another domain, a look-alike domain, or no way back', async () => {
    reverse.mockRejectedValue(err('ENOTFOUND'));
    expect(await verifyCrawlerClaim('googlebot', '198.51.100.1')).toBe('forged');
    reverse.mockReset();
    reverse.mockResolvedValue(['host.example.net']);
    expect(await verifyCrawlerClaim('googlebot', '198.51.100.2')).toBe('forged');
    reverse.mockResolvedValue(['evilgooglebot.com']);
    expect(await verifyCrawlerClaim('googlebot', '198.51.100.3')).toBe('forged');
    reverse.mockResolvedValue(['crawl.googlebot.com']);
    resolve4.mockResolvedValue(['66.249.66.1']);
    expect(await verifyCrawlerClaim('googlebot', '198.51.100.4')).toBe('forged');
  });

  it('unknown: a resolver failure or a slow one, and no address', async () => {
    reverse.mockRejectedValue(err('ESERVFAIL'));
    expect(await verifyCrawlerClaim('googlebot', '66.249.66.2')).toBe('unknown');
    reverse.mockReset();
    reverse.mockReturnValue(new Promise(() => {}));
    expect(await verifyCrawlerClaim('googlebot', '66.249.66.3')).toBe('unknown');
    expect(await verifyCrawlerClaim('googlebot', 'unknown')).toBe('unknown');
  });

  it('does not ask twice for one address', async () => {
    reverse.mockRejectedValue(err('ENOTFOUND'));
    await verifyCrawlerClaim('bingbot', '198.51.100.9');
    await verifyCrawlerClaim('bingbot', '198.51.100.9');
    expect(reverse).toHaveBeenCalledTimes(1);
  });
});

describe('isTrustedBot', () => {
  const req = (ua: string, ip: string) => new Request('https://sourcelibrary.org/x', { headers: { 'user-agent': ua, 'x-test-ip': ip } });

  it('keeps a real crawler, and one whose lookup failed', async () => {
    reverse.mockResolvedValue(['crawl.googlebot.com']);
    resolve4.mockResolvedValue(['66.249.66.1']);
    expect(await isTrustedBot(req(GOOGLEBOT, '66.249.66.1'))).toBe(true);
    reverse.mockReset();
    reverse.mockRejectedValue(err('ETIMEOUT'));
    expect(await isTrustedBot(req(GOOGLEBOT, '66.249.66.8'))).toBe(true);
  });

  it('refuses the name from an address that is not the crawler', async () => {
    reverse.mockResolvedValue(['host.example.net']);
    expect(await isTrustedBot(req(GOOGLEBOT, '198.51.100.7'))).toBe(false);
  });

  it('trusts an assistant or AI search crawler only from its published addresses (#4357)', async () => {
    const anthropicIp = RANGES.anthropic.prefixes[0].split('/')[0];
    const oaiSearchIp = RANGES['openai-search'].prefixes[0].split('/')[0];
    expect(await isTrustedBot(req('Claude-User/1.0', anthropicIp))).toBe(true);
    expect(await isTrustedBot(req('Claude-SearchBot/1.0', anthropicIp))).toBe(true);
    expect(await isTrustedBot(req('OAI-SearchBot/1.4', oaiSearchIp))).toBe(true);
    // The same names from anywhere else are forgeries.
    expect(await isTrustedBot(req('Claude-User/1.0', '198.51.100.7'))).toBe(false);
    expect(await isTrustedBot(req('OAI-SearchBot/1.4', '198.51.100.7'))).toBe(false);
    // One operator's name on another's list proves nothing.
    expect(await isTrustedBot(req('OAI-SearchBot/1.4', anthropicIp))).toBe(false);
    expect(reverse).not.toHaveBeenCalled();
  });

  it('does not trust a name it has no way to prove', async () => {
    expect(await isTrustedBot(req('DuckDuckBot/1.1', '198.51.100.7'))).toBe(false);
    expect(await isTrustedBot(req('Google-NotebookLM', '198.51.100.7'))).toBe(false);
    expect(await isTrustedBot(req('GPTBot/1.2', '198.51.100.7'))).toBe(false);
    expect(reverse).not.toHaveBeenCalled();
  });

  it('trusts our MCP server name only with its proof', async () => {
    process.env.AUTH_SECRET ??= 'test-secret';
    const { MCP_PROOF_HEADER, mintMcpProof } = await import('@/lib/mcp-self-proof');
    expect(await isTrustedBot(req('SourceLibrary-MCP/4.3', '198.51.100.7'))).toBe(false);
    const proven = new Request('https://sourcelibrary.org/x', {
      headers: { 'user-agent': 'SourceLibrary-MCP/4.3', 'x-test-ip': '198.51.100.7', [MCP_PROOF_HEADER]: mintMcpProof()! },
    });
    expect(await isTrustedBot(proven)).toBe(true);
    const wrong = new Request('https://sourcelibrary.org/x', {
      headers: { 'user-agent': 'SourceLibrary-MCP/4.3', [MCP_PROOF_HEADER]: 'a'.repeat(64) },
    });
    expect(await isTrustedBot(wrong)).toBe(false);
  });
});
