/**
 * /search shows a filter control only on the lanes that apply it (#3401).
 *
 * `search-filter-support.test.ts` pins the table against the routes. This pins
 * the other half: that the page actually consults the table. It renders the
 * real page through react-dom/server (there is no DOM in this suite) at a URL
 * for each lane and reads which controls came out.
 *
 * The filter panel opens on load when the URL carries a filter, which is how
 * each case below gets it rendered without a click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEARCH_STRINGS } from '@/lib/search-i18n';

let currentSearch = '';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/search',
}));
vi.mock('@/components/layout/SiteHeader', () => ({ default: () => null }));
vi.mock('@/components/search/SearchWebMCP', () => ({ default: () => null }));
vi.mock('@/components/collections/CollectionCoverEditor', () => ({ default: () => null }));

const t = SEARCH_STRINGS.en;

const CONTROLS = {
  language: t.filterLanguage,
  category: t.filterSubject,
  collection: t.filterCollection,
  library: t.filterLibrary,
  publishedAfter: t.filterPublishedAfter,
  publishedBefore: t.filterPublishedBefore,
  hasTranslation: t.hasTranslation,
  firstTranslation: t.firstTranslation,
  hasDoi: t.hasDoi,
} as const;
type Control = keyof typeof CONTROLS;

async function render(search: string) {
  currentSearch = search;
  const { default: SearchPage } = await import('@/app/search/page');
  return renderToStaticMarkup(<SearchPage />);
}

function shown(html: string): Control[] {
  return (Object.keys(CONTROLS) as Control[]).filter((k) => html.includes(`${CONTROLS[k]}</label>`));
}

const sorts = (html: string) => ({
  search: html.includes('<option value="relevance"'),
  browse: html.includes('<option value="recent-translation"'),
});

beforeEach(() => { currentSearch = ''; });

describe('/search filter panel, per lane', () => {
  it('positive control: the panel is rendered and its labels are found', async () => {
    const html = await render('q=alchemy&mode=books&date_from=1600');
    expect(shown(html)).toContain('language');
    expect(shown(html)).toContain('publishedAfter');
  });

  it('browse (no query): the book filters, without the year range or DOI the browse route ignores', async () => {
    const html = await render('language=German');
    expect(shown(html)).toEqual(['language', 'category', 'collection', 'library', 'hasTranslation', 'firstTranslation']);
    expect(sorts(html)).toEqual({ search: false, browse: true });
  });

  it('browse images: the year range only, and no sort', async () => {
    const html = await render('mode=images&date_from=1600');
    expect(shown(html)).toEqual(['publishedAfter', 'publishedBefore']);
    expect(sorts(html)).toEqual({ search: false, browse: false });
  });

  it('All tab: no collection, no DOI, no sort', async () => {
    const html = await render('q=alchemy&date_from=1600');
    expect(shown(html)).toEqual(['language', 'category', 'library', 'publishedAfter', 'publishedBefore', 'hasTranslation', 'firstTranslation']);
    expect(sorts(html)).toEqual({ search: false, browse: false });
  });

  it('Books tab: DOI and sort come back, collection stays out', async () => {
    const html = await render('q=alchemy&mode=books&date_from=1600');
    expect(shown(html)).toEqual(['language', 'category', 'library', 'publishedAfter', 'publishedBefore', 'hasTranslation', 'firstTranslation', 'hasDoi']);
    expect(sorts(html)).toEqual({ search: true, browse: false });
  });

  it('Index tab: the year range only, and no sort', async () => {
    const html = await render('q=alchemy&mode=index&date_from=1600');
    expect(shown(html)).toEqual(['publishedAfter', 'publishedBefore']);
    expect(sorts(html)).toEqual({ search: false, browse: false });
  });

  it('Images tab: the year range only, and no sort', async () => {
    const html = await render('q=alchemy&mode=images&date_from=1600');
    expect(shown(html)).toEqual(['publishedAfter', 'publishedBefore']);
    expect(sorts(html)).toEqual({ search: false, browse: false });
  });
});

describe('/search active-filter dot', () => {
  const DOT = 'w-1.5 h-1.5 bg-accent-rust rounded-full';

  it('is lit by a filter the lane applies', async () => {
    expect(await render('q=alchemy&date_from=1600')).toContain(DOT);
  });

  it('is not lit by a filter the lane ignores', async () => {
    // A collection carried over from browse, and a DOI tick, on the All tab.
    expect(await render('q=alchemy&collection=mycology&has_doi=true')).not.toContain(DOT);
    // A language on the Index tab.
    expect(await render('q=alchemy&mode=index&language=German')).not.toContain(DOT);
  });
});
