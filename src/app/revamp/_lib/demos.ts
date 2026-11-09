import { dataFile } from './data';
import type { CollectionModel, PageItem, QuoteItem } from './types';

/*
 * No collection of pages or quotes exists yet, so these two show the format with
 * real pages and real translated sentences from one book, chosen for the demo.
 */
const blank = (slug: string, name: string): CollectionModel => ({
  slug, name, deck: '', short: '', intro: [], byline: 'Example collection', subjects: [],
  stats: { works: 0, years: null, firstTranslations: 0, images: 0 }, heroTiles: [], coverPicks: [], books: [], firstTranslations: [],
  featured: null, plates: [], platesLabel: '', platesNote: '', pages: [], quotes: [], quoteBand: null, opensOn: 'mixed', ask: null, askMedia: null, moreWorks: 0,
});

export function demoModel(slug: string): CollectionModel | null {
  const d = dataFile<{ pages: PageItem[]; quotes: QuoteItem[] }>('demos');
  if (!d) return null;
  if (slug === 'example-pages') return { ...blank(slug, 'A collection of pages'), deck: 'Pages only. Each one shows the scan beside its translation.', short: 'Pages only. Each one shows the scan beside its translation.', pages: d.pages, opensOn: 'pages', heroImage: d.pages[0].src };
  if (slug === 'example-quotes') return { ...blank(slug, 'A collection of quotes'), deck: 'Quotes only. Every passage is selected on a real page and links back to it.', short: 'Quotes only. Every passage is selected on a real page and links back to it.', quotes: d.quotes, opensOn: 'quotes', heroImage: d.pages[1].src };
  return null;
}
