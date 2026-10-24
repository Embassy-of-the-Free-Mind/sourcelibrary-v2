import { describe, it, expect, vi, beforeEach } from 'vitest';

// #4309: the bot gate enforced the 20% clamp but recorded nothing, so "how many
// pages has GPTBot read from book X since June" had no first-party answer.
// These pin the shape of the bot_reads row and that humans never write one.

const updateOne = vi.fn().mockResolvedValue({});
const createIndex = vi.fn().mockResolvedValue('ok');
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: () => ({ updateOne, createIndex }) }),
}));

import { botReadUpdate, logBotRead, bookSegmentFromPath } from '@/lib/bot-reads';
import { botNameFor, isTrustedByUserAgent } from '@/lib/bot-gate';

const req = (ua: string) => new Request('https://sourcelibrary.org/x', { headers: { 'user-agent': ua } });
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.1; +https://openai.com/gptbot';
const HUMAN = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const NOW = new Date('2026-10-12T08:00:00Z');

describe('botNameFor', () => {
  it('names the KNOWN_BOTS token', () => {
    expect(botNameFor(req(GPTBOT))).toBe('gptbot');
    expect(botNameFor(req('Mozilla/5.0 (compatible; ClaudeBot/1.0)'))).toBe('claudebot');
  });
  it('is null for humans and for our own MCP server (logged in mcp_usage)', () => {
    expect(botNameFor(req(HUMAN))).toBeNull();
    expect(botNameFor(req('sourcelibrary-mcp/1.0 claudebot'))).toBeNull();
  });
});

describe('isTrustedByUserAgent', () => {
  it('trusts search crawlers and user fetches, not training crawlers', () => {
    expect(isTrustedByUserAgent(req('Mozilla/5.0 (compatible; Googlebot/2.1)'))).toBe(true);
    expect(isTrustedByUserAgent(req('Mozilla/5.0 (compatible; ChatGPT-User/1.0)'))).toBe(true);
    expect(isTrustedByUserAgent(req(GPTBOT))).toBe(false);
  });
});

describe('botReadUpdate', () => {
  it('keys one row per day/bot/book/route/trust — aggregate, not per hit', () => {
    const { filter } = botReadUpdate('gptbot', { route: 'quote', book: 'b1', trusted: false, pageFrom: 3, maxPage: 20, clamped: false }, NOW);
    expect(filter._id).toBe('2026-10-12|gptbot|b1|quote|gated');
  });

  it('caps the served span at the ceiling for gated bots and counts the clamp', () => {
    const { update } = botReadUpdate('gptbot', { route: 'text', book: 'b1', trusted: false, pageFrom: 1, pageTo: 400, maxPage: 80, clamped: true }, NOW);
    expect(update.$inc).toEqual({ reads: 1, clamped: 1 });
    expect(update.$min).toEqual({ page_min: 1 });
    expect(update.$max).toEqual({ page_max_served: 80 });
    expect(update.$setOnInsert).toMatchObject({ day: '2026-10-12', bot: 'gptbot', book: 'b1', route: 'text', trusted: false });
  });

  it('does not cap trusted bots, and omits page ops when the route has no span', () => {
    const trusted = botReadUpdate('googlebot', { route: 'text', book: 'b1', trusted: true, pageFrom: 1, pageTo: 400, clamped: false }, NOW);
    expect(trusted.update.$max).toEqual({ page_max_served: 400 });
    const html = botReadUpdate('gptbot', { route: 'html', book: 'some-slug', bookIsUrlSegment: true, trusted: false, clamped: false }, NOW);
    expect(html.update.$min).toBeUndefined();
    expect(html.update.$max).toBeUndefined();
    expect(html.update.$setOnInsert).toMatchObject({ book_is_url_segment: true });
  });
});

describe('logBotRead', () => {
  beforeEach(() => updateOne.mockClear());

  it('upserts for a known crawler', async () => {
    logBotRead(req(GPTBOT), { route: 'quote', book: 'b1', trusted: false, pageFrom: 2, maxPage: 20, clamped: false });
    await vi.waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    expect(updateOne.mock.calls[0][2]).toEqual({ upsert: true });
  });

  it('writes nothing for a human', async () => {
    logBotRead(req(HUMAN), { route: 'quote', book: 'b1', trusted: false, clamped: false });
    await new Promise(r => setTimeout(r, 10));
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('bookSegmentFromPath', () => {
  it.each([
    ['/book/the-emerald-tablet', 'the-emerald-tablet'],
    ['/book/abc123/page/6a58f512', 'abc123'],
    ['/book/%E2%9C%93', '✓'],
    ['/book/%E2%9C', '%E2%9C'],
    ['/books', null],
    ['/collection/x', null],
  ])('%s → %s', (path, expected) => {
    expect(bookSegmentFromPath(path)).toBe(expected);
  });
});
