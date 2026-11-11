// The small, client-safe half of the Articles list: the categories, the post
// type, bylines and the link helper. Client components import from HERE, not
// from ./posts — importing ./posts (or ./listing) into a 'use client' file
// ships the whole ~90 KB article list to every visitor of that page. Before
// this split the homepage downloaded it through ArticleCard (2026-11-10).
// posts.ts and listing.ts re-export everything here, so server code may keep
// importing from them.
//
// PRIOR ART: src/app/articles/posts.ts — this is its first 90 lines, moved out unchanged.

export const BLOG_KINDS = ['stories', 'tours', 'research', 'interactive', 'library'] as const;
export type BlogKind = (typeof BLOG_KINDS)[number];

export const KIND_INFO: Record<BlogKind, { label: string; definition: string; lead: string }> = {
  stories: {
    label: 'Stories',
    definition: 'A person, an idea or a practice followed through the books that record it.',
    lead: 'nature-of-harmony',
  },
  tours: {
    label: 'Reading tours',
    definition: 'A walk through the library’s books on one subject, quoting the originals beside their translations.',
    lead: 'techniques-of-the-body',
  },
  research: {
    label: 'Research notes',
    definition: 'Counting what was written and what is translated, and testing the AI that reads the pages: where it is accurate and where it invents.',
    lead: 'the-giants-werent-translated',
  },
  interactive: {
    label: 'Interactive',
    definition: 'Instruments, charts, maps and games built from the books, to play with in the browser.',
    lead: 'sound-laboratory',
  },
  library: {
    label: 'From the library',
    definition: 'Where Source Library came from, how it is built and run, and the people behind it.',
    lead: 'origin-story',
  },
};

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  // The card text on /articles and the page's meta description (og and
  // twitter too, via withArticleMeta): 155 characters at most, facts from the
  // article only (tests/blog-posts.test.ts).
  summary: string;
  date: string;
  readTime: string;
  kind: BlogKind;
  // Every post needs an image: any post can become a lead or the Latest card,
  // where the title is set over the picture (tests/blog-posts.test.ts).
  // Choosing one: the rules in .claude/skills/quote-background-image (calm area
  // where the words land, no printed text there, nothing grim). Then check it
  // with scripts/audit/blog-card-legibility.ts, which renders every lead crop.
  // Where to look, in order: a plate or woodcut from a book the post is about
  // (open the leaf: gallery records can be a leaf off); the ~24K museum works
  // already mirrored under images.sourcelibrary.org/artwork/ (search_images);
  // a new public-domain work brought in with scripts/import-*-artworks.mjs
  // (Met, Rijks, AIC, Cleveland, NGA, Getty, Commons), never a hotlink.
  // A printed text page only when the page is the post's evidence. Real works
  // only: no generated pictures in a library of primary sources.
  image: string;
  imageAlt?: string;
  // CSS object-position for the crop, e.g. 'center 30%'. Set it when the
  // default centre crop cuts off what the picture is of.
  imagePosition?: string;
  // Only on LINKED_PAGES: the page lives at its own address, outside /articles.
  href?: string;
  // An offline edition: the article with every page it cites (text and scan) at the back, built by
  // scripts/articles/article-epub. ArticleEnd shows the download link.
  epub?: { href: string; mb: number };
}

// Articles written by a person rather than drafted by AI. Their footer note is a
// byline (NoteFooter) instead of the AI disclosure. Name, role and photo as the
// founder's letter already gives them.
export interface ArticleAuthor {
  name: string;
  bio: string;
  photo: string;
}

const DEREK_LOMAS: ArticleAuthor = {
  name: 'Derek Lomas',
  bio: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
  photo: '/founder-derek.jpg',
};

export const AUTHORED_ARTICLES: Record<string, ArticleAuthor> = {
  vision: DEREK_LOMAS,
  'in-memoriam': DEREK_LOMAS,
};

export function postHref(post: BlogPost): string {
  return post.href ?? `/articles/${post.slug}`;
}

// Listing helpers that need no article data (listing.ts re-exports them).
export const PAGE_SIZE = 30;

export type Listing = BlogKind | 'all';

export function listingHref(kind: Listing, page = 1): string {
  const base = kind === 'all' ? '/articles' : `/articles/${kind}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

export function isKind(value: string): value is BlogKind {
  return (BLOG_KINDS as readonly string[]).includes(value);
}
