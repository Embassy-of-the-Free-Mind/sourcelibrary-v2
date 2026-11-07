import { describe, it, expect } from 'vitest';
import { isBrowserShaped, partnerTextAccess, ASSISTANT_PAGE_WINDOW } from '@/lib/partner-access';
import type { ApiIdentity } from '@/lib/api-auth';

/**
 * Who gets how much of a protected partner's book through the text export
 * (#8098). A person in a browser and a credential keep everything; a name alone
 * proves nothing, so a claimed crawler with no proof reads like any other script.
 */

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const anon: ApiIdentity = { kind: 'anon' };

function req(headers: Record<string, string>) {
  return new Request('https://sourcelibrary.org/api/books/b/text', { headers });
}

describe('partnerTextAccess', () => {
  it('keeps a browser whole, in a cross-site frame with few hints', () => {
    const r = req({ 'user-agent': CHROME, 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' });
    expect(partnerTextAccess(r, anon, false)).toEqual({ kind: 'full' });
  });

  it('keeps credentials whole whatever the headers look like', () => {
    const r = req({ 'user-agent': 'python-requests/2.32' });
    expect(partnerTextAccess(r, { kind: 'session', userId: 'u' }, false).kind).toBe('full');
    expect(partnerTextAccess(r, { kind: 'apikey', apiKeyId: 'k' }, false).kind).toBe('full');
  });

  it('keeps a crawler that proved itself whole, not one that only names itself', () => {
    const r = req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
    expect(partnerTextAccess(r, { kind: 'bot', bot: 'googlebot' }, false).kind).toBe('full');
    expect(partnerTextAccess(r, anon, false).kind).toBe('preview');
    // A signature nobody can prove stays a name, even though api-auth calls it a bot.
    expect(partnerTextAccess(req({ 'user-agent': 'DuckDuckBot/1.1' }), { kind: 'bot', bot: 'duckduckbot' }, false).kind).toBe('preview');
  });

  it('gives a client reading for a person a window per call', () => {
    for (const ua of ['Claude-User/1.0', 'ChatGPT-User/1.0', 'SourceLibrary-MCP/4.3']) {
      expect(partnerTextAccess(req({ 'user-agent': ua }), anon, false)).toEqual({ kind: 'window', pages: ASSISTANT_PAGE_WINDOW });
    }
  });

  it('gives scripts and declared training crawlers the preview', () => {
    for (const ua of ['python-requests/2.32', 'curl/8.5', 'Mozilla/5.0', '', CHROME]) {
      expect(partnerTextAccess(req({ 'user-agent': ua }), anon, false).kind).toBe('preview');
    }
    const declared = req({ 'user-agent': 'GPTBot/1.2', 'sec-fetch-mode': 'navigate' });
    expect(partnerTextAccess(declared, anon, true).kind).toBe('preview');
  });
});

describe('isBrowserShaped', () => {
  it('needs both a browser name and fetch metadata', () => {
    expect(isBrowserShaped(new Headers({ 'user-agent': CHROME, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isBrowserShaped(new Headers({ 'user-agent': CHROME }))).toBe(false);
    expect(isBrowserShaped(new Headers({ 'user-agent': 'curl/8', 'sec-fetch-site': 'none' }))).toBe(false);
  });
});
