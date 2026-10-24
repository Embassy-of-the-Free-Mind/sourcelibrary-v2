'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CatalogPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * 'search' is the /library and /gallery look: square, black Prev and Next,
   * plain page numbers with the current one outlined. Other surfaces keep the
   * rounded default.
   */
  variant?: 'default' | 'search';
}

/**
 * Page-number pagination with ellipsis for large collections.
 * Shows: 1 2 3 ... 78 79 80
 */
export default function CatalogPagination({
  currentPage,
  totalPages,
  onPageChange,
  variant = 'default',
}: CatalogPaginationProps) {
  if (totalPages <= 1) return null;

  // Build page number array with ellipsis gaps
  const pages: (number | 'ellipsis')[] = [];
  const delta = 2; // pages around current

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  if (variant === 'search') {
    const step = 'inline-flex items-center gap-1.5 h-10 px-4 bg-primary text-cream text-sm hover:bg-accent-rust transition-colors disabled:opacity-25 disabled:hover:bg-primary disabled:cursor-not-allowed cursor-pointer';
    return (
      <nav className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mt-12" aria-label="Pagination">
        <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1} className={`${step} mr-1 sm:mr-3`} aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Previous</span>
        </button>
        {pages.map((page, i) =>
          page === 'ellipsis' ? (
            <span key={`e${i}`} className="w-6 text-center text-sm text-muted select-none" aria-hidden>…</span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`min-w-10 h-10 px-2 text-sm tabular-nums transition-colors cursor-pointer ${
                page === currentPage
                  ? 'border border-primary text-primary font-semibold'
                  : 'border border-transparent text-secondary hover:bg-warm hover:text-primary'
              }`}
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </button>
          ),
        )}
        <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages} className={`${step} ml-1 sm:ml-3`} aria-label="Next page">
          <span className="hidden sm:inline">Next</span><ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </nav>
    );
  }

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1 mt-10" aria-label="Pagination">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-2.5 sm:px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        aria-label="Previous page"
      >
        <span className="sm:hidden" aria-hidden>‹</span><span className="hidden sm:inline">Prev</span>
      </button>

      {pages.map((page, i) =>
        page === 'ellipsis' ? (
          <span key={`e${i}`} className="px-2 py-1.5 text-sm text-muted select-none">
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`min-w-[32px] sm:min-w-[36px] px-1.5 sm:px-2 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer ${
              page === currentPage
                ? 'border-accent-rust bg-accent-rust/8 text-accent-rust font-medium'
                : 'border-border-light hover:bg-warm text-secondary'
            }`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        ),
      )}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-2.5 sm:px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        aria-label="Next page"
      >
        <span className="sm:hidden" aria-hidden>›</span><span className="hidden sm:inline">Next</span>
      </button>
    </nav>
  );
}
