'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen, TableProperties } from 'lucide-react';

interface Props {
  basePath: string;
  catalogTotal: number;
  booksTotal: number;
}

export default function LibraryViewTabs({ basePath, catalogTotal, booksTotal }: Props) {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'books';

  return (
    <div className="flex gap-1 border-b border-border-light mb-6">
      <Link
        href={basePath}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
          view !== 'catalog'
            ? 'border-accent-rust text-primary'
            : 'border-transparent text-muted hover:text-secondary'
        }`}
      >
        <BookOpen className="w-4 h-4" />
        Translated Books
        <span className="text-xs text-muted">({booksTotal.toLocaleString()})</span>
      </Link>
      <Link
        href={`${basePath}?view=catalog`}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
          view === 'catalog'
            ? 'border-accent-rust text-primary'
            : 'border-transparent text-muted hover:text-secondary'
        }`}
      >
        <TableProperties className="w-4 h-4" />
        Full Catalog
        <span className="text-xs text-muted">({catalogTotal.toLocaleString()})</span>
      </Link>
    </div>
  );
}
