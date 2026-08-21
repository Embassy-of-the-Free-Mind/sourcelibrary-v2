import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A filter is only real if the name the client puts on the wire is the name the
// route reads. Three separate filters were inert in production because those two
// names disagreed (or because nothing was sent at all):
//
//   - /search's date range never reached /api/search/unified   (#3267)
//   - /gallery's year range was sent as yearFrom/yearTo while
//     /api/gallery reads yearStart/yearEnd — the page rendered the
//     range while the API served the whole corpus                (#3269)
//
// Each of these looked fine in a browser: results appeared, the filter chip was
// lit, and only a curl comparing filtered vs unfiltered output revealed that
// nothing had been constrained. These tests pin the wire names so the failure
// mode can't return silently.

const captured: string[] = [];

vi.mock('@/lib/api-client/client', () => ({
  apiClient: {
    get: vi.fn(async (url: string) => {
      captured.push(url);
      return {};
    }),
  },
}));

beforeEach(() => { captured.length = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('gallery api-client year range', () => {
  it('sends yearStart/yearEnd — the names /api/gallery actually reads', async () => {
    const { gallery } = await import('@/lib/api-client/gallery');
    await gallery.list({ query: 'alchemy', yearFrom: 1600, yearTo: 1700 });

    const url = captured[0];
    expect(url).toContain('yearStart=1600');
    expect(url).toContain('yearEnd=1700');
    // The old (ignored) spelling must not be what goes on the wire.
    expect(url).not.toContain('yearFrom=');
    expect(url).not.toContain('yearTo=');
  });

  it('omits the range entirely when unset', async () => {
    const { gallery } = await import('@/lib/api-client/gallery');
    await gallery.list({ query: 'alchemy' });

    expect(captured[0]).not.toContain('yearStart');
    expect(captured[0]).not.toContain('yearEnd');
  });
});

describe('search api-client date range', () => {
  it('forwards date_from/date_to to unified search', async () => {
    const { search } = await import('@/lib/api-client/search');
    await search.unified('philosopher\'s stone', {
      filters: { date_from: '1600', date_to: '1700' },
    });

    const url = captured[0];
    expect(url).toContain('/api/search/unified');
    expect(url).toContain('date_from=1600');
    expect(url).toContain('date_to=1700');
  });

  it('forwards date_from/date_to to index search', async () => {
    const { search } = await import('@/lib/api-client/search');
    await search.index('mercury', { dateFrom: '1600', dateTo: '1700' });

    const url = captured[0];
    expect(url).toContain('/api/search/index');
    expect(url).toContain('date_from=1600');
    expect(url).toContain('date_to=1700');
  });

  it('forwards date_from/date_to to keyword search', async () => {
    const { search } = await import('@/lib/api-client/search');
    await search.search('mercury', { date_from: '1600', date_to: '1700' });

    const url = captured[0];
    expect(url).toContain('date_from=1600');
    expect(url).toContain('date_to=1700');
  });
});
