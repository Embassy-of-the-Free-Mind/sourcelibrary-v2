/**
 * Candidate URLs for the page scan an MCP quote tool attaches inline (#3937).
 *
 * PRIOR ART: src/lib/page-image-url.ts — it resolves a page DOCUMENT to a
 * browser-facing URL, and that is the problem here, not the answer: its
 * `display` tier is allowed to return a same-origin `/api/image?…` path, which
 * an <img> resolves and a server-side `fetch()` cannot. This module takes the
 * URL the quote API already chose and makes it fetchable from a server.
 *
 * Measured 2026-10-12 on 40 books from `list_books`: 39 had a relative
 * `page_image_url`, so `get_quote` with `include_image: true` attached nothing
 * and said nothing — `fetch('/api/image?…')` throws, and the fetch helper turns
 * a throw into a silent skip. The 40th resolved to a pre-sized R2 variant, and
 * a pre-sized variant is bounded in pixels, not bytes: Atalanta fugiens p. 20
 * is 1,068,625 bytes at display size, 7% over the 1 MB inline cap, and was
 * dropped the same way. Hence two candidates, not one.
 */

const SITE_ORIGIN = 'https://sourcelibrary.org';

/** Second-try size: a leaf stays legible at 1000px and lands well under 1 MB. */
const FALLBACK_WIDTH = 1000;
const FALLBACK_QUALITY = 70;

/** Make a same-origin path absolute; leave anything already absolute alone. */
export function absoluteImageUrl(url: string, origin: string = SITE_ORIGIN): string {
  return url.startsWith('/') && !url.startsWith('//') ? `${origin}${url}` : url;
}

/**
 * URLs to try, in order, for one leaf: the display image itself, then a smaller
 * re-encode through the `/api/image` proxy for a scan over the inline byte cap.
 * The proxy refuses hosts off its allowlist; the caller treats that like any
 * other failed fetch.
 */
export function leafImageCandidates(pageImageUrl: string, origin: string = SITE_ORIGIN): string[] {
  const primary = absoluteImageUrl(pageImageUrl, origin);
  let parsed: URL;
  try {
    parsed = new URL(primary);
  } catch {
    return [primary];
  }
  let fallback: string;
  if (parsed.origin === origin && parsed.pathname === '/api/image') {
    // Already a proxy URL: keep its source and crop, ask for less of it.
    parsed.searchParams.set('w', String(FALLBACK_WIDTH));
    parsed.searchParams.set('q', String(FALLBACK_QUALITY));
    fallback = parsed.toString();
  } else {
    fallback = `${origin}/api/image?url=${encodeURIComponent(primary)}&w=${FALLBACK_WIDTH}&q=${FALLBACK_QUALITY}`;
  }
  return fallback === primary ? [primary] : [primary, fallback];
}
