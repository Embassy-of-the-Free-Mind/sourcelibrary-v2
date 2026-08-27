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

// The catalogue's filters go through one module that both writes and reads the
// query string (src/lib/catalog-query.ts), so the drift these tests exist to
// catch is structurally impossible there. What still needs pinning is the two
// things a shared module cannot guarantee on its own: that the wire names are
// the ones /api/catalog/browse and ScholarCatalog already speak, and that every
// filter actually survives a round trip.
describe('catalog filter contract', () => {
  it('writes the wire names the browse route reads', async () => {
    const { buildCatalogParams, DEFAULT_FILTERS } = await import('@/lib/catalog-query');

    const qs = buildCatalogParams({
      ...DEFAULT_FILTERS,
      q: 'fludd',
      ask: 'books about angels',
      language: 'Latin',
      collection: 'alchemy',
      category: 'hermeticism',
      provider: 'bph',
      yearMin: 1600,
      yearMax: 1699,
      firstTranslation: true,
      hasTranslation: true,
      hasOcr: true,
      sort: 'year_asc',
      page: 3,
    }).toString();

    expect(qs).toContain('q=fludd');
    expect(qs).toContain('ask=books+about+angels');
    expect(qs).toContain('language=Latin');
    expect(qs).toContain('collection=alchemy');
    expect(qs).toContain('category=hermeticism');
    expect(qs).toContain('provider=bph');
    expect(qs).toContain('year_min=1600');
    expect(qs).toContain('year_max=1699');
    expect(qs).toContain('first_translation=1');
    expect(qs).toContain('has_translation=1');
    expect(qs).toContain('has_ocr=1');
    expect(qs).toContain('sort=year_asc');
    expect(qs).toContain('page=3');
    // The camelCase spellings are the ones that were inert in #3269. They must
    // never be what goes on the wire.
    expect(qs).not.toContain('yearMin');
    expect(qs).not.toContain('yearMax');
    expect(qs).not.toContain('firstTranslation');
  });

  it('round-trips every filter through build → parse', async () => {
    const { buildCatalogParams, parseCatalogParams, DEFAULT_FILTERS } = await import('@/lib/catalog-query');

    const filters = {
      ...DEFAULT_FILTERS,
      q: 'agrippa',
      ask: 'plague remedies',
      language: 'German',
      collection: 'magic',
      category: 'alchemy',
      provider: 'gallica',
      yearMin: 1500,
      yearMax: 1599,
      firstTranslation: true,
      hasTranslation: true,
      hasOcr: true,
      sort: 'relevance' as const,
      page: 2,
      view: 'list' as const,
    };

    const parsed = parseCatalogParams(buildCatalogParams(filters, { includeView: true }));
    expect(parsed).toEqual(filters);
  });

  it('omits everything that is at its default, so a clean catalogue has a clean URL', async () => {
    const { buildCatalogParams, DEFAULT_FILTERS } = await import('@/lib/catalog-query');
    expect(buildCatalogParams(DEFAULT_FILTERS, { includeView: true }).toString()).toBe('');
  });

  it('swaps a reversed year range instead of returning nothing', async () => {
    const { parseCatalogParams } = await import('@/lib/catalog-query');
    const parsed = parseCatalogParams(new URLSearchParams('year_min=1700&year_max=1500'));
    expect(parsed.yearMin).toBe(1500);
    expect(parsed.yearMax).toBe(1700);
  });

  it('counts a year range as one active filter, not two', async () => {
    const { parseCatalogParams, countActiveFilters } = await import('@/lib/catalog-query');
    expect(countActiveFilters(parseCatalogParams(new URLSearchParams('year_min=1500&year_max=1599')))).toBe(1);
    expect(countActiveFilters(parseCatalogParams(new URLSearchParams('language=Latin&first_translation=1')))).toBe(2);
  });

  it('ignores a sort it does not know', async () => {
    const { parseCatalogParams } = await import('@/lib/catalog-query');
    expect(parseCatalogParams(new URLSearchParams('sort=; DROP TABLE')).sort).toBe('popular');
  });
});
