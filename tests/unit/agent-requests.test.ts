import { describe, it, expect } from 'vitest';
import { operatorFor, classifyAgentRequest } from '@/lib/agent-requests';

// Guards #3519: `analytics_traffic_class` read `ai_agent: 2` over 30 days while
// curl proved OAI-SearchBot and ChatGPT-User were both being served full 330KB
// book pages. The beacon cannot see bots; this counter runs in the proxy, which
// can. The two properties that make it useful are (a) per-operator attribution
// and (b) counting refusals — neither is answerable from a single class bucket.

const req = (ua: string) =>
  ({ headers: new Headers({ 'user-agent': ua }) }) as unknown as Parameters<typeof classifyAgentRequest>[0];

describe('operatorFor', () => {
  it.each([
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'openai'],
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'openai'],
    ['Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.1; +https://openai.com/gptbot', 'openai'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'anthropic'],
    ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'perplexity'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'google'],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'other'],
  ])('maps %s → %s', (ua, expected) => {
    expect(operatorFor(ua)).toBe(expected);
  });
});

describe('classifyAgentRequest', () => {
  it('returns null for humans so the beacon series is never double-counted', () => {
    expect(classifyAgentRequest(req('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36'), 'served')).toBeNull();
  });

  it('records OpenAI assistant fetches as ai_agent — the traffic the beacon misses', () => {
    expect(classifyAgentRequest(req('Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)'), 'served'))
      .toEqual({ cls: 'ai_agent', operator: 'openai', outcome: 'served' });
  });

  it('records OpenAI search crawling separately from its training crawler', () => {
    expect(classifyAgentRequest(req('Mozilla/5.0 (compatible; OAI-SearchBot/1.0)'), 'served')?.cls).toBe('ai_agent');
    expect(classifyAgentRequest(req('compatible; GPTBot/1.1; +https://openai.com/gptbot'), 'refused')?.cls).toBe('ai_trainer');
  });

  it('records a refusal, because attempts against the block are licence demand', () => {
    expect(classifyAgentRequest(req('compatible; GPTBot/1.1'), 'refused'))
      .toEqual({ cls: 'ai_trainer', operator: 'openai', outcome: 'refused' });
  });
});
