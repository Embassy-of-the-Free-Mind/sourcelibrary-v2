import Link from 'next/link';

interface BrowsePagerProps {
  /** Path of page 1, without a query string (e.g. `/browse/titles/T`). */
  basePath: string;
  currentPage: number;
  totalPages: number;
}

/** URL of page N of a browse listing — page 1 carries no `?page=`. */
export function browsePageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

/**
 * Server-rendered, link-based pagination for the /browse listings.
 *
 * Deliberately real <a href> links rather than CatalogPagination's buttons:
 * these pages are the crawlable spine of the catalogue (#2266), and a crawler
 * only follows links. Every page number is listed — the longest listing is a
 * handful of pages, so no ellipsis is needed.
 */
export default function BrowsePager({ basePath, currentPage, totalPages }: BrowsePagerProps) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1 mt-10" aria-label="Pagination">
      {currentPage > 1 && (
        <Link
          href={browsePageHref(basePath, currentPage - 1)}
          rel="prev"
          className="px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors"
        >
          Prev
        </Link>
      )}
      {pages.map((page) => (
        <Link
          key={page}
          href={browsePageHref(basePath, page)}
          className={`min-w-[36px] text-center px-2 py-1.5 text-sm rounded-lg border transition-colors ${
            page === currentPage
              ? 'border-accent-rust bg-accent-rust/8 text-accent-rust font-medium'
              : 'border-border-light hover:bg-warm text-secondary'
          }`}
          aria-current={page === currentPage ? 'page' : undefined}
        >
          {page}
        </Link>
      ))}
      {currentPage < totalPages && (
        <Link
          href={browsePageHref(basePath, currentPage + 1)}
          rel="next"
          className="px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
