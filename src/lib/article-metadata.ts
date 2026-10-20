import type { Metadata } from 'next';
import { posts } from '@/app/articles/posts';
import revisions from '@/generated/blog-revisions.json';
import heroes from '@/generated/article-heroes.json';

/**
 * Fills in the share-card, canonical and feed metadata an article page did not
 * set, without overriding anything it did set.
 *
 * Next.js merges page metadata shallowly per top-level key (see
 * .claude/docs/invariants/rendering-and-seo.md): a page that declares
 * `alternates` loses the layout's feed links, and one that declares
 * `openGraph` loses the layout's og:url, og:image and siteName. So every
 * article page wraps its metadata in this helper:
 *
 *   export const metadata: Metadata = withArticleMeta('<slug>', { ... });
 *
 * The slug is the folder name under src/app/articles. Dates come from the
 * post's `date` in posts.ts (published) and src/generated/blog-revisions.json
 * (revised); the share image is the article's hero (see below).
 */

type Revision = { published?: string; revised?: string };
const REVISIONS = revisions as Record<string, Revision>;
const HEROES = heroes as Record<string, string>;

function shareImage(src: string): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=1200&q=75`;
}

// Unlisted pages that are withdrawn, superseded or off topic: still served for
// old links, but kept out of search results. See UNLISTED_PAGES in posts.ts.
const NOINDEX_SLUGS = new Set([
  'autonomous-agents',
  '2000-first-translations',
  'worlds-largest-collection',
  'why-terminals-cant-edit',
]);

// Pages under /articles that are not articles: canonical and feed links only.
const NOT_ARTICLES = new Set(['how-these-are-made']);

const SITE_IMAGE = {
  url: '/og-image.jpg',
  width: 1200,
  height: 630,
  alt: 'Source Library: Digitizing and translating ancient texts',
};

// "17 October 2026" -> "2026-10-17T00:00:00.000Z", independent of the server's
// time zone (Date.parse reads that form as local midnight).
function postDateIso(date: string): string | undefined {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

function plainTitle(title: Metadata['title']): string | undefined {
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object' && 'absolute' in title) return title.absolute;
  if (title && typeof title === 'object' && 'default' in title) return title.default;
  return undefined;
}

// "X - Articles - Source Library", "X | Blog | Source Library", "X - Source Library" -> "X"
function stripSiteSuffix(title: string): string {
  return title.replace(/\s+[-|–]\s+(?:(?:Articles|Blog)\s+[-|–]\s+)?Source Library$/, '');
}

export function withArticleMeta(slug: string, meta: Metadata): Metadata {
  const path = `/articles/${slug}`;
  const alternates: NonNullable<Metadata['alternates']> = {
    ...meta.alternates,
    canonical: meta.alternates?.canonical ?? path,
  };

  if (NOT_ARTICLES.has(slug)) return { ...meta, alternates };

  const post = posts.find((p) => p.slug === slug);
  const rev = REVISIONS[slug];
  const fullTitle = plainTitle(meta.title);
  const title = plainTitle(meta.openGraph?.title as Metadata['title']) ?? (fullTitle ? stripSiteSuffix(fullTitle) : undefined);
  // A listed post's short summary wins over the page's own (often longer)
  // description, so search snippets and share cards match the /articles card.
  const description = post?.summary ?? meta.openGraph?.description ?? meta.description ?? undefined;
  // The share image is the article's hero (src/generated/article-heroes.json),
  // so a link preview shows the picture at the top of the page; then the card
  // image, then the site card. Served through the image optimiser at 1200 wide:
  // the originals are full scans, some over 8 MB, past what Facebook and X take.
  const hero = HEROES[slug] ?? post?.image;
  const images = hero
    ? [{ url: shareImage(hero), width: 1200, alt: post?.imageAlt ?? post?.title ?? plainTitle(meta.title) ?? '' }]
    : meta.openGraph?.images ?? [SITE_IMAGE];
  const publishedTime = (post && postDateIso(post.date)) ?? rev?.published;
  const modifiedTime = rev?.revised;

  const openGraph = {
    siteName: 'Source Library',
    locale: 'en_US',
    url: path,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(publishedTime ? { publishedTime } : {}),
    ...(modifiedTime ? { modifiedTime } : {}),
    type: 'article',
    ...meta.openGraph,
    ...(post?.summary ? { description: post.summary } : {}),
    images,
  } as NonNullable<Metadata['openGraph']>;

  const twitter = {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...meta.twitter,
    ...(post?.summary ? { description: post.summary } : {}),
    images,
  } as NonNullable<Metadata['twitter']>;

  const robots =
    meta.robots === undefined && NOINDEX_SLUGS.has(slug) ? { index: false, follow: true } : meta.robots;

  return {
    ...meta,
    ...(post?.summary ? { description: post.summary } : {}),
    alternates,
    openGraph,
    twitter,
    ...(robots !== undefined ? { robots } : {}),
  };
}
