/**
 * The reader page's Schema.org JSON-LD (moved out of the route so it can be
 * tested: a Next page module may not export it).
 *
 * PRIOR ART: src/lib/json-ld.ts — serializes JSON-LD safely into a script tag;
 * it builds no schema. src/lib/jsonld.ts — the BOOK-level graph, not a page's.
 */
import type { Book, Page } from '@/lib/types';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { isEnglishOriginalBook } from '@/lib/english-original-text';
import { facingTranslationOf, leafRole } from '@/lib/facing-translation';

// Schema.org structured data for a translated page, so it surfaces as a
// citable scholarly work in web search (#2822). Only emitted for indexable
// pages (same seo_indexable gate as robots, #2688) — structured data on a
// noindex page is wasted. The excerpt is wrapper-stripped (the #2232 invariant:
// never expose editorial <meta>/<summary>/… blocks as page text).
// isPartOf carries the book's URL and a BreadcrumbList names it, so a search
// engine that indexes a page is pointed at the book's front page (contents and
// summary) as the parent: the page is the way in, the book is the place.
export function buildPageJsonLd(book: Book, page: Page, pageUrl: string, bookUrl: string): Record<string, unknown> | null {
  if ((page as unknown as { seo_indexable?: boolean }).seo_indexable !== true) return null;
  const bookTitle = book.display_title || book.title;
  const raw = page.translation?.data || page.ocr?.data || '';
  // A Loeb's English leaf (#8321) excerpts the printed English: its translator
  // is the edition's, never Source Library. `page` arrives already served, so a
  // withheld rewording has no `translation` left.
  const facing = facingTranslationOf(book);
  const printedEnglish = !!facing && !page.translation?.data && leafRole(page.ocr?.data) === 'translation';
  const clean = stripEditorialWrappers(raw).trim();
  const excerpt = clean.length > 500 ? clean.slice(0, 497) + '…' : clean;
  const work = {
    '@type': 'CreativeWork',
    name: `${bookTitle}, Page ${page.page_number}`,
    url: pageUrl,
    inLanguage: (printedEnglish ? 'en' : book.language) || undefined,
    datePublished: book.published || undefined,
    author: book.author ? { '@type': 'Person', name: book.author } : undefined,
    ...(printedEnglish
      ? (facing?.translator ? { translator: { '@type': 'Person', name: facing.translator } } : {})
      : isEnglishOriginalBook(book) ? {} : { translator: { '@type': 'Organization', name: 'Source Library' } }),
    isPartOf: {
      '@type': 'Book',
      '@id': bookUrl,
      url: bookUrl,
      name: bookTitle,
      ...(book.author ? { author: { '@type': 'Person', name: book.author } } : {}),
      ...(book.doi ? { sameAs: `https://doi.org/${book.doi}` } : {}),
    },
    license: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    isAccessibleForFree: true,
    ...(excerpt ? { text: excerpt } : {}),
  };
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Source Library', item: 'https://sourcelibrary.org' },
      { '@type': 'ListItem', position: 2, name: bookTitle, item: bookUrl },
      { '@type': 'ListItem', position: 3, name: `Page ${page.page_number}`, item: pageUrl },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [work, breadcrumb] };
}
