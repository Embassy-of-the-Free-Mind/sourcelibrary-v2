/**
 * Feed autodiscovery <link> tags, in one place.
 *
 * The root layout renders these as plain <link rel="alternate"> elements in
 * <head>, NOT through `metadata.alternates.types`. Next.js does not deep-merge
 * `alternates`: a route that declares its own (for a canonical URL or hreflang
 * `languages`) replaces the layout's entire object, so feeds declared there
 * were silently dropped on every such route — 214 files by the time it was
 * fixed, the homepage among them (#3968). A <link> in the layout's <head> is
 * outside that merge and reaches every page.
 *
 * So: do NOT add `types` to a route's `alternates` for these feeds (the page
 * would advertise each one twice), and adding a feed means editing this list
 * only.
 *
 * The podcast RSS feeds are no longer advertised: the podcast is retired and
 * archived (#5007). The feeds still serve, marked complete, for existing
 * subscribers.
 */
export const FEED_LINKS: ReadonlyArray<{ type: string; href: string; title: string }> = [
  { type: 'application/atom+xml', href: 'https://sourcelibrary.org/api/feed/books', title: 'Source Library - New Books' },
  { type: 'application/atom+xml', href: 'https://sourcelibrary.org/api/feed/gallery', title: 'Source Library Gallery' },
  { type: 'application/atom+xml', href: 'https://sourcelibrary.org/api/feed/blog', title: 'Source Library - Research Notes' },
];
