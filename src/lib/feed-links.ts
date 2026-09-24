import type { Metadata } from 'next';

/**
 * Feed autodiscovery <link> tags, in one place.
 *
 * These live here rather than inline in the root layout because Next.js does
 * NOT deep-merge `alternates`: a route that declares its own `alternates` (for
 * a canonical URL or hreflang `languages`) replaces the layout's entire object,
 * silently dropping every feed link. That is how the homepage — the most-linked
 * page on the site — once ended up advertising no feeds at all.
 *
 * The podcast RSS feeds are no longer advertised: the podcast is retired and
 * archived (#5007). The feeds still serve, marked complete, for existing
 * subscribers.
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
};
