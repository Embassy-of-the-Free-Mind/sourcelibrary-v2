import type { Metadata } from 'next';

/**
 * Feed autodiscovery <link> tags, in one place.
 *
 * These live here rather than inline in the root layout because Next.js does
 * NOT deep-merge `alternates`: a route that declares its own `alternates` (for
 * a canonical URL or hreflang `languages`) replaces the layout's entire object,
 * silently dropping every feed link. That is how the homepage — the most-linked
 * page on the site — ended up advertising no feeds at all while /podcast
 * advertised three.
 *
 * So any route that sets `alternates` must spread `FEED_TYPES` into its own
 * `types`, and adding a feed means editing this list only.
 */
export const FEED_TYPES: NonNullable<NonNullable<Metadata['alternates']>['types']> = {
  'application/atom+xml': [
    { url: '/api/feed/books', title: 'Source Library - New Books' },
    { url: '/api/feed/gallery', title: 'Source Library Gallery' },
    { url: '/api/feed/blog', title: 'Source Library - Research Notes' },
  ],
  // RSS 2.0, not Atom — these are podcast feeds with enclosures, and that is
  // what Apple and Spotify expect.
  'application/rss+xml': [
    { url: '/api/podcast/feed.xml', title: 'Source Library - Deep Dive Podcast' },
    { url: '/api/podcast/feed.es.xml', title: 'Source Library - Pódcast en español' },
  ],
};
