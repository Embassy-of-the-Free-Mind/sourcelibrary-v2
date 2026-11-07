import { describe, it, expect, vi, afterEach } from 'vitest';
import { outboundFetch, SOURCE_LIBRARY_USER_AGENT } from '@/lib/outbound-fetch';

// #7771: every request to another institution's server names Source Library and a contact.
describe('outboundFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    return spy;
  }
  const sentHeaders = (spy: ReturnType<typeof stubFetch>) => new Headers((spy.mock.calls[0] as unknown as [string, RequestInit])[1].headers);

  it('sends the Source Library identity with a contact address', async () => {
    const spy = stubFetch();
    await outboundFetch('https://example.org/manifest');
    expect(sentHeaders(spy).get('User-Agent')).toBe(SOURCE_LIBRARY_USER_AGENT);
    expect(SOURCE_LIBRARY_USER_AGENT).toMatch(/SourceLibrary\/.*sourcelibrary\.org.*derek@sourcelibrary\.org/);
  });

  it('replaces a caller-set User-Agent and keeps the other headers and options', async () => {
    const spy = stubFetch();
    const signal = AbortSignal.timeout(1000);
    await outboundFetch('https://example.org/x', { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal });
    const h = sentHeaders(spy);
    expect(h.get('User-Agent')).toBe(SOURCE_LIBRARY_USER_AGENT);
    expect(h.get('Accept')).toBe('application/json');
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(signal);
  });
});
