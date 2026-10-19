import type { Metadata } from 'next';
import { posts, LINKED_PAGES, BLOG_KINDS, KIND_INFO, type BlogKind, type BlogPost } from './posts';

// What the /articles index and its category and page routes list, and their
// metadata. The client list (BlogIndex) pages the same way, so page N of a
// route here is the page N a reader sees before searching or sorting.

export const PAGE_SIZE = 30;

export type Listing = BlogKind | 'all';

export const ALL_ARTICLES: BlogPost[] = [...posts, ...LINKED_PAGES];

const newestFirst = (a: BlogPost, b: BlogPost) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);

export function listed(kind: Listing): BlogPost[] {
  return ALL_ARTICLES.filter((p) => kind === 'all' || p.kind === kind).sort(newestFirst);
}

export function pageCount(kind: Listing): number {
  return Math.max(1, Math.ceil(listed(kind).length / PAGE_SIZE));
}

export function listingHref(kind: Listing, page = 1): string {
  const base = kind === 'all' ? '/articles' : `/articles/${kind}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

export function isKind(value: string): value is BlogKind {
  return (BLOG_KINDS as readonly string[]).includes(value);
}

const DESCRIPTIONS: Record<Listing, string> = {
  all: 'Stories followed through the books, reading tours, research notes and things to try. Every claim is grounded in primary sources from the collection.',
  stories: 'Stories from Source Library: a person, an idea or a practice followed through the rare books that record it, quoted in the original and in translation.',
  tours: 'Reading tours from Source Library: a walk through the library’s books on one subject, quoting the originals beside their English translations.',
  research: 'Research notes from Source Library: counting what was written and translated, and testing where the AI that reads old books is accurate and where it invents.',
  interactive: 'Interactive pieces from Source Library: instruments, charts, maps and games built from rare books, to play with in the browser.',
  library: 'From the library: where Source Library came from, how its digitised collection of rare books is built and run, and the people behind it.',
};

// The share picture for every listing: the /articles page above the fold,
// 1200 x 630, taken at 1440 wide
// with no cookie banner. Re-take it when the page changes look.
const SHARE_IMAGE = { url: '/articles/og-articles.jpg', width: 1200, height: 630, alt: 'The Source Library Articles page' };

export function listingMetadata(kind: Listing, page = 1): Metadata {
  const name = kind === 'all' ? 'Articles' : `${KIND_INFO[kind].label} - Articles`;
  const title = `${name}${page > 1 ? `, page ${page}` : ''} - Source Library`;
  const url = listingHref(kind, page);
  const description = DESCRIPTIONS[kind];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'Source Library', title, description, url, images: [SHARE_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SHARE_IMAGE.url] },
  };
}
