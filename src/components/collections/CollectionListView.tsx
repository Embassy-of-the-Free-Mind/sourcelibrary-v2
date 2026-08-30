'use client';

import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import AuthorName from '@/components/AuthorName';
import { getEffectiveByline } from '@/lib/byline';

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  editor?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_claim?: 'confirmed' | 'candidate';
  resource_type?: string;
}

type SortKey = 'title' | 'author' | 'year_asc' | 'year_desc' | 'recent' | 'popular' | 'relevance';

interface CollectionListViewProps {
  books: BookItem[];
  sort: string;
  onSort: (sort: string) => void;
  loading?: boolean;
  collectionType?: string;
  /** Collection slug carried on artwork links (?from=) so prev/next walks this collection. */
  fromCollection?: string;
}

function SortIcon({ column, currentSort }: { column: string; currentSort: string }) {
  const isActive =
    (column === 'year' && (currentSort === 'year_asc' || currentSort === 'year_desc')) ||
    (column === 'title' && currentSort === 'title') ||
    (column === 'author' && currentSort === 'author');

  if (!isActive) return <ArrowUpDown className="w-3 h-3 text-muted/50" />;

  if (column === 'year' && currentSort === 'year_desc') {
    return <ArrowDown className="w-3 h-3 text-accent-rust" />;
  }
  return <ArrowUp className="w-3 h-3 text-accent-rust" />;
}

function translationPercent(book: BookItem): number {
  const denom = Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1);
  return book.pages_translated ? Math.round((book.pages_translated / denom) * 100) : 0;
}

export default function CollectionListView({
  books,
  sort,
  onSort,
  loading,
  collectionType,
  fromCollection,
}: CollectionListViewProps) {
  const handleColumnSort = (column: string) => {
    if (column === 'year') {
      onSort(sort === 'year_asc' ? 'year_desc' : 'year_asc');
    } else if (column === 'title') {
      onSort('title');
    } else if (column === 'author') {
      onSort('author');
    }
  };

  const isArt = collectionType === 'visual_art';

  return (
    <div className={`overflow-x-auto ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border-medium text-xs text-muted uppercase tracking-wide">
            <th className="pb-3 pr-4 font-medium w-[45%]">
              <button
                onClick={() => handleColumnSort('title')}
                className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
              >
                Title
                <SortIcon column="title" currentSort={sort} />
              </button>
            </th>
            <th className="pb-3 pr-4 font-medium hidden sm:table-cell">
              <button
                onClick={() => handleColumnSort('author')}
                className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
              >
                {isArt ? 'Artist' : 'Author'}
                <SortIcon column="author" currentSort={sort} />
              </button>
            </th>
            <th className="pb-3 pr-4 font-medium w-20">
              <button
                onClick={() => handleColumnSort('year')}
                className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
              >
                Year
                <SortIcon column="year" currentSort={sort} />
              </button>
            </th>
            <th className="pb-3 pr-4 font-medium hidden md:table-cell w-24">Language</th>
            <th className="pb-3 font-medium hidden lg:table-cell w-20 text-right">Pages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {books.map((book) => {
            const pct = translationPercent(book);
            const href = book.resource_type
              ? `/artwork/${book.slug || book.id}${fromCollection ? `?from=${fromCollection}` : ''}`
              : `/book/${book.slug || book.id}`;
            const byline = getEffectiveByline(book);
            const bylineNode = byline.role === 'editor'
              ? <span>ed. <AuthorName author={byline.editor} /></span>
              : <AuthorName author={book.author} fallback="Unknown" />;
            return (
              <tr key={book.id} className="group hover:bg-warm/50 transition-colors">
                <td className="py-3 pr-4">
                  <Link href={href} className="block">
                    <span
                      className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors line-clamp-1"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {book.display_title || book.title}
                    </span>
                    {book.is_first_translation && (
                      <span className="inline-block ml-2 bg-accent-gold/15 text-accent-gold-dark text-[10px] px-1.5 py-0.5 rounded-full font-medium align-middle">
                        {firstTranslationBadge(book.ft_disposition, book.language, undefined, book.ft_claim)}
                      </span>
                    )}
                    {/* Author on mobile (hidden on sm+) */}
                    <span className="block sm:hidden text-xs text-muted mt-0.5 line-clamp-1">
                      {bylineNode}
                    </span>
                  </Link>
                </td>
                <td className="py-3 pr-4 hidden sm:table-cell">
                  <Link href={href} className="text-sm text-secondary line-clamp-1 block">
                    {bylineNode}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-sm text-muted tabular-nums">
                  <Link href={href} className="block">
                    {book.year || '—'}
                  </Link>
                </td>
                <td className="py-3 pr-4 hidden md:table-cell">
                  <Link href={href} className="block">
                    <span className="text-xs text-muted bg-warm px-2 py-0.5 rounded">
                      {book.language || '—'}
                    </span>
                  </Link>
                </td>
                <td className="py-3 hidden lg:table-cell text-right">
                  <Link href={href} className="block text-sm text-muted tabular-nums">
                    {book.pages_count || '—'}
                    {pct > 0 && pct < 100 && (
                      <span className="text-[10px] text-accent-gold-dark ml-1">{pct}%</span>
                    )}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
