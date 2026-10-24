import { describe, expect, it } from 'vitest';
import { isForgedChrome } from '@/lib/client-hint-gate';

// UA strings as observed in analytics_pageviews, 2026-10-22 (#4476).
const LINUX_149 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const MAC_145 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const WIN_155 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/155.0.0.0 Safari/537.36';
const EDGE = WIN_155 + ' Edg/155.0.0.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const OUR_AUDIT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 sourcelibrary-audit';

const REAL_HINTS = { 'sec-ch-ua': '"Google Chrome";v="155", "Chromium";v="155", "Not.A/Brand";v="24"', 'sec-ch-ua-platform': '"macOS"' };

function h(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe('isForgedChrome', () => {
  it('blocks desktop Chrome with no sec-ch-ua (the Linux/149 pool)', () => {
    expect(isForgedChrome('/book/abc', h({ 'user-agent': LINUX_149 }))).toBe(true);
  });

  it('blocks an unquoted platform hint (the Mac/145 pool)', () => {
    expect(isForgedChrome('/book/abc', h({
      'user-agent': MAC_145,
      'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-platform': 'Mac OS X',
    }))).toBe(true);
  });

  it('passes real Chrome with its hints', () => {
    expect(isForgedChrome('/book/abc', h({ 'user-agent': WIN_155, ...REAL_HINTS }))).toBe(false);
  });

  it('passes real Chrome that sends sec-ch-ua but no platform hint', () => {
    expect(isForgedChrome('/book/abc', h({ 'user-agent': WIN_155, 'sec-ch-ua': REAL_HINTS['sec-ch-ua'] }))).toBe(false);
  });

  it.each([
    ['Googlebot (Chrome version, no hints)', GOOGLEBOT],
    ['Edge', EDGE],
    ['Android Chrome', ANDROID],
    ['Safari', SAFARI],
    ['our own audit scripts', OUR_AUDIT],
  ])('never blocks %s, even without hints', (_label, ua) => {
    expect(isForgedChrome('/book/abc', h({ 'user-agent': ua }))).toBe(false);
  });

  it.each(['/book/abc', '/work/xyz', '/api/pages/123', '/api/image', '/api/image/foo'])('covers reader path %s', (p) => {
    expect(isForgedChrome(p, h({ 'user-agent': LINUX_149 }))).toBe(true);
  });

  it.each(['/', '/developers', '/licensing', '/feedback', '/api/mcp', '/api/books/abc', '/workshop', '/bookshelf'])('leaves %s alone', (p) => {
    expect(isForgedChrome(p, h({ 'user-agent': LINUX_149 }))).toBe(false);
  });
});
