import { getShortUrl } from '@/lib/shortlinks';

/**
 * Analytics payloads and the shared link for sharing and citing from inside the reader (#76).
 *
 * PRIOR ART: src/lib/track-event.ts — the transport, reused as is; this file
 * only builds the props. src/lib/outbound-click.ts — the same pattern (a pure
 * payload builder tested against the real allowlist), but for outbound giving
 * links, so it does not fit.
 *
 * Until #76 the reader's two copy-link buttons and its cite panel sent nothing:
 * only posts to a network fired `share`. A copied link is how most pages get
 * passed on, so the `share` and `cite` counts read as "nobody shares" when the
 * truth was "that button is not wired up". Every key here must be in
 * ALLOWED_PROPS or the route drops it silently (tests/unit/reader-share-events.test.ts).
 */

/** How a reader passed a page on. A fixed English key on every locale. */
export type ReaderShareMethod = 'copy_link' | 'copy_link_ref' | 'native_share';

/** How a reader took a citation. */
export type ReaderCiteMethod = 'copy_citation';

/** Props for the `share` event when a reader copies a page link. */
export function readerSharePayload(
  method: ReaderShareMethod,
  { url, page }: { url: string; page?: number | null },
): Record<string, string | number | undefined> {
  // `channel` carries the method too, so existing share-by-channel reads count
  // copies alongside posts without a query change.
  return { method, channel: method, url, page: page ?? undefined, surface: 'reader' };
}

/** Props for the `cite` event when a reader copies the citation in the cite panel. */
export function readerCitePayload(
  method: ReaderCiteMethod,
  { bookId, page }: { bookId: string; page?: number | null },
): Record<string, string | number | undefined> {
  return { method, bookId, page: page ?? undefined, surface: 'reader' };
}

/**
 * The link a reader passes on (#76): the page's `/q/` shortlink where one can
 * be made, else the long page URL as given.
 *
 * The shortlink is computed locally (src/lib/shortlinks.ts is stateless: book
 * id + page number, base62), so there is no network call and nothing to wait
 * for. It is used only on the main site: inside a partner reading room or an
 * iframe the reader keeps the room's own long link, because `/q/` resolves to a
 * global `/book/…` URL and would take the visitor out of the room
 * (tenant-lockdown.md). A book whose id or page number cannot be encoded gets
 * the long link, never getShortUrl's id-based fallback, which is a worse URL
 * than the slug form the reader already has.
 *
 * A reader on a localized page (/es/book/…) passes on `/q/<code>?lang=es`, which
 * `/q/[code]` sends to that language's page when the book has one and to English
 * when it does not; without it a Spanish reader would hand on an English link.
 */
export function readerShareLink({
  longUrl,
  bookId,
  pageNumber,
  origin,
  embedded,
  lang,
}: {
  longUrl: string;
  bookId?: string | null;
  pageNumber?: number | null;
  origin: string;
  embedded: boolean;
  lang?: string;
}): string {
  if (embedded || !bookId || pageNumber == null) return longUrl;
  const short = getShortUrl(bookId, pageNumber, undefined, origin, lang);
  return short.includes('/q/') ? short : longUrl;
}
