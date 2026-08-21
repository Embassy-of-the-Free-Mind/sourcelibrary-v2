import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { looksLikeBot } from '@/proxy';

// Regression guard for the "can't read more than 2 pages" report.
//
// The soft bot rate-limiter (src/proxy.ts) 429s any request looksLikeBot()
// flags on /api/*. One of its signals is "missing BOTH accept-language AND
// sec-fetch-mode" — a decent bot tell, but privacy browsers, in-app webviews,
// and some corporate proxies strip those from real people too. The reader fans
// out to /api/books/* per page, so a misclassified human hit the 10-req/60s cap
// after ~2 pages. Content-read GETs are already protected at the app layer
// (api-budget + bot page-gate), so that header heuristic is now skipped there.
//
// These assertions pin the fix: real readers pass on content GETs, while
// obvious bots and any non-content / write traffic stay classified.

function req(
  pathname: string,
  { method = 'GET', ua = 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0', headers = {} as Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`https://sourcelibrary.org${pathname}`, {
    method,
    headers: { 'user-agent': ua, ...headers },
  });
}

describe('looksLikeBot — content-read exemption', () => {
  it('does NOT flag a header-stripped real browser on a content-read GET', () => {
    // No accept-language, no sec-fetch-mode, but a normal browser UA.
    expect(looksLikeBot(req('/api/books/abc123'))).toBe(false);
    expect(looksLikeBot(req('/api/pages/xyz/revisions'))).toBe(false);
  });

  it('still flags header-stripped traffic on non-content paths', () => {
    expect(looksLikeBot(req('/api/search'))).toBe(true);
    expect(looksLikeBot(req('/api/collections'))).toBe(true);
  });

  it('still flags writes to content paths (exemption is GET-only)', () => {
    expect(looksLikeBot(req('/api/books/abc123/dedicate', { method: 'POST' }))).toBe(true);
  });

  it('still flags an obvious bot UA even on a content-read GET', () => {
    expect(looksLikeBot(req('/api/books/abc123', { ua: 'curl/8.4.0' }))).toBe(true);
    expect(looksLikeBot(req('/api/books/abc123', { ua: 'python-requests/2.31' }))).toBe(true);
    expect(looksLikeBot(req('/api/books/abc123', { ua: 'GPTBot/1.0' }))).toBe(true);
  });

  it('does not flag a normal browser with full headers anywhere', () => {
    const full = { 'accept-language': 'en-US,en;q=0.9', 'sec-fetch-mode': 'navigate' };
    expect(looksLikeBot(req('/api/search', { headers: full }))).toBe(false);
    expect(looksLikeBot(req('/api/books/abc123', { headers: full }))).toBe(false);
  });
});
