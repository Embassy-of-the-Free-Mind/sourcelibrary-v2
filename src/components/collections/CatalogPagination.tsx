'use client';

interface CatalogPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Page-number pagination with ellipsis for large collections.
 * Shows: 1 2 3 ... 78 79 80
 */
export default function CatalogPagination({
  currentPage,
  totalPages,
  onPageChange,
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

  return (
    <nav className="flex items-center justify-center gap-1 mt-10" aria-label="Pagination">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        aria-label="Previous page"
      >
        Prev
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
            className={`min-w-[36px] px-2 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer ${
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
        className="px-3 py-1.5 text-sm rounded-lg border border-border-light hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}
