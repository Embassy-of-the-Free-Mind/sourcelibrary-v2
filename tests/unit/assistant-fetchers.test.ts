import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: async () => 0, logApiUsage: () => {} }));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/dataset/api-keys', () => ({ validateApiKey: async () => null, checkKeyRequestRate: () => ({ allowed: true }) }));

import { NextRequest } from 'next/server';
import { requireApiAccess } from '@/lib/api-auth';
import { verifiedAssistantFetcher } from '@/lib/assistant-fetchers';
import { pickLimit } from '@/lib/api-budget';
import { API_LIMITS } from '@/lib/api-limits';
import RANGES from '@/lib/assistant-fetcher-ranges.json';

/**
 * A larger allowance for an assistant reading for a person, with no new way to
 * scrape (#8161). So the cases that matter most are the forgeries: anyone can
 * write "Claude-User" in a header, and only the published address proves it.
 */
const CONNECTOR_IP = '160.79.104.10';
const OPENAI_IP = RANGES.openai.prefixes[0].split('/')[0];
const PERPLEXITY_IP = RANGES.perplexity.prefixes[0].split('/')[0];
const CLAUDE = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const CHATGPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';

describe('verifiedAssistantFetcher', () => {
  it('accepts a name on its own operator\'s address', () => {
    expect(verifiedAssistantFetcher(CLAUDE, CONNECTOR_IP)).toBe('anthropic');
    expect(verifiedAssistantFetcher(CHATGPT, OPENAI_IP)).toBe('openai');
    expect(verifiedAssistantFetcher('Perplexity-User/1.0', PERPLEXITY_IP)).toBe('perplexity');
  });

  it('refuses a forged name from any other address', () => {
    expect(verifiedAssistantFetcher(CLAUDE, '203.0.113.7')).toBeNull();
    expect(verifiedAssistantFetcher(CHATGPT, '203.0.113.7')).toBeNull();
  });

  it('refuses one operator\'s name on another operator\'s address', () => {
    expect(verifiedAssistantFetcher(CHATGPT, CONNECTOR_IP)).toBeNull();
    expect(verifiedAssistantFetcher(CLAUDE, OPENAI_IP)).toBeNull();
  });

  it('refuses the operator\'s address without the fetcher\'s name', () => {
    // Training crawlers and API customers can share these addresses.
    expect(verifiedAssistantFetcher('ClaudeBot/1.0', CONNECTOR_IP)).toBeNull();
    expect(verifiedAssistantFetcher('python-requests/2.32', CONNECTOR_IP)).toBeNull();
    expect(verifiedAssistantFetcher('', CONNECTOR_IP)).toBeNull();
  });

  it('stays inside the published range at both edges', () => {
    expect(verifiedAssistantFetcher(CLAUDE, '160.79.104.0')).toBe('anthropic');
    expect(verifiedAssistantFetcher(CLAUDE, '160.79.111.255')).toBe('anthropic');
    expect(verifiedAssistantFetcher(CLAUDE, '160.79.103.255')).toBeNull();
    expect(verifiedAssistantFetcher(CLAUDE, '160.79.112.0')).toBeNull();
  });

  it('reads a mapped IPv4 address and refuses anything it cannot parse', () => {
    expect(verifiedAssistantFetcher(CLAUDE, '::ffff:160.79.104.10')).toBe('anthropic');
    expect(verifiedAssistantFetcher(CLAUDE, 'unknown')).toBeNull();
    expect(verifiedAssistantFetcher(CLAUDE, '2607:6bc0::1')).toBeNull();
    expect(verifiedAssistantFetcher(CLAUDE, null)).toBeNull();
  });
});

describe('the gate', () => {
  const request = (ua: string, ip: string) =>
    new NextRequest('https://sourcelibrary.org/api/search?q=archeus', {
      headers: { 'user-agent': ua, 'x-forwarded-for': ip },
    });

  it('marks a proven assistant, and lets it past the anonymous hourly limit', async () => {
    let last = await requireApiAccess(request(CLAUDE, '160.79.104.77'));
    for (let i = 0; i < API_LIMITS.anon.requestsPerHour + 5; i++) {
      last = await requireApiAccess(request(CLAUDE, '160.79.104.77'));
    }
    expect(last.allowed).toBe(true);
    expect(last.identity).toEqual({ kind: 'anon', assistantFetcher: 'anthropic' });
  });

  it('still stops it at its own limit, with no advice to sign in', async () => {
    let last = await requireApiAccess(request(CLAUDE, '160.79.104.78'));
    for (let i = 0; i < API_LIMITS.assistantFetcher.requestsPerHour + 1; i++) {
      last = await requireApiAccess(request(CLAUDE, '160.79.104.78'));
    }
    expect(last.allowed).toBe(false);
    expect(last.status).toBe(429);
    expect(last.reason).toBe('assistant_rate_limit');
  });

  it('holds a forged name to the anonymous limit', async () => {
    let last = await requireApiAccess(request(CLAUDE, '203.0.113.9'));
    expect(last.identity.assistantFetcher).toBeUndefined();
    for (let i = 0; i < API_LIMITS.anon.requestsPerHour + 1; i++) {
      last = await requireApiAccess(request(CLAUDE, '203.0.113.9'));
    }
    expect(last.allowed).toBe(false);
    expect(last.status).toBe(401);
  });
});

describe('page budget', () => {
  it('gives a proven assistant the larger allowance, still finite', () => {
    const { limit } = pickLimit({ kind: 'anon', assistantFetcher: 'anthropic' });
    expect(limit).toBe(API_LIMITS.assistantFetcher.pagesPerDay);
    expect(Number.isFinite(limit)).toBe(true);
  });

  it('leaves every other anonymous caller where it was', () => {
    expect(pickLimit({ kind: 'anon' }).limit).toBe(API_LIMITS.anon.pagesPerDay);
  });
});
