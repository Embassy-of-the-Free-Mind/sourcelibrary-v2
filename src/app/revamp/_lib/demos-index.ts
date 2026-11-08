import { demoModel } from './demos';
import type { IndexItem } from './data';

/** The two examples, so the filter has pages and quotes to find. Marked as examples on the card. */
export function demoItems(): IndexItem[] {
  return (['example-pages', 'example-quotes'] as const).flatMap((slug) => {
    const m = demoModel(slug);
    if (!m) return [];
    return [{
      slug, name: m.name, deck: m.deck, href: `/revamp/c/${slug}`, maker: 'source-library' as const,
      holds: m.pages.length ? ['pages'] : ['quotes'], books: 0, images: 0, artworks: 0, pages: m.pages.length, quotes: m.quotes.length,
      thumbs: m.pages.length ? m.pages.map((p) => p.src) : [], cover: m.pages[0]?.src, strip: m.pages.map((p) => p.src), languages: ['English'], example: true, order: 999,
    }];
  });
}
