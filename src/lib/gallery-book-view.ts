/**
 * The addresses of one book's pictures: /gallery?bookId=<id>&page=<n>.
 *
 * A crawler reaches a book's gallery pages through this view, so it needs its own
 * canonical (it used to declare /gallery, which called it a duplicate of a page with
 * none of the same links) and real links to its later pages (the client's pagination
 * is buttons). Without them, a book with 661 pictures exposed 48 of them.
 *
 * PRIOR ART: GalleryClient already reads `page` and fetches that page in the browser,
 * so these are the same addresses, and this only makes the server agree with it.
 * src/lib/gallery-query.ts parses the API's filters, which is a different job.
 */

/** Pictures on one page. GalleryClient must use the same number, or `page` means two things. */
export const BOOK_VIEW_PAGE_SIZE = 100;

/** Page links printed for one book. Past this, a crawler walks on from the last one. */
const MAX_PAGE_LINKS = 100;

/** The `page` parameter as a page number; anything else is page 1. */
export function parseBookViewPage(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) return 1;
  return Number(value);
}

/** Address of one page, without a host, so it stays right on any domain. */
export function bookViewHref(bookId: string, page: number): string {
  const q = `bookId=${encodeURIComponent(bookId)}`;
  return `/gallery?${q}${page > 1 ? `&page=${page}` : ''}`;
}

/** The pages to link from `page`, in order, around it when the list is capped. */
export function bookViewPageLinks(total: number, page: number): number[] {
  const pages = Math.ceil(total / BOOK_VIEW_PAGE_SIZE);
  if (pages <= 1) return [];
  const count = Math.min(pages, MAX_PAGE_LINKS);
  const first = Math.max(1, Math.min(page - Math.floor(count / 2), pages - count + 1));
  return Array.from({ length: count }, (_, i) => first + i);
}
