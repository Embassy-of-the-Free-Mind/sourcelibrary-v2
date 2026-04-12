'use client';

import { useState, useEffect, useRef } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import CollectionBookCard from '@/components/CollectionBookCard';
import { bookUrl } from '@/lib/slugify';
import Link from 'next/link';

type ViewMode = 'grid' | 'list';

const STORAGE_KEY = 'sl-browse-view';

interface BrowseBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  language?: string | null;
  published?: string | null;
  pages_count?: number;
  pages_translated?: number;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  is_first_translation?: boolean;
  ft_disposition?: string | null;
}

interface BrowseViewToggleProps {
  books: BrowseBook[];
  /** Render function for the list view. If not provided, uses a default list. */
  renderListItem?: (book: BrowseBook) => React.ReactNode;
}

export function ViewToggleButtons({ viewMode, onChange }: { viewMode: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-light)' }}>
      <button
        onClick={() => onChange('grid')}
        className={`p-2 transition-colors ${
          viewMode === 'grid'
            ? 'bg-[var(--accent-rust)]/10 text-[var(--accent-rust)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
        aria-label="Grid view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('list')}
        className={`p-2 transition-colors ${
          viewMode === 'list'
            ? 'bg-[var(--accent-rust)]/10 text-[var(--accent-rust)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
        aria-label="List view"
      >
        <List className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function BrowseViewToggle({ books, renderListItem }: BrowseViewToggleProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      const stored = localStorage.getItem(STORAGE_KEY) as ViewMode | null;
      if (stored === 'grid' || stored === 'list') setViewMode(stored);
      initialized.current = true;
    }
  }, []);

  const handleToggle = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  const defaultListItem = (book: BrowseBook) => (
    <Link
      key={book.id}
      href={bookUrl(book)}
      className="block py-3 hover:opacity-70 transition-opacity"
    >
      <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
        {book.display_title || book.title}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {book.author || ''}
        {book.published ? ` · ${book.published}` : ''}
        {book.language ? ` · ${book.language}` : ''}
      </p>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <ViewToggleButtons viewMode={viewMode} onChange={handleToggle} />
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book, i) => (
            <CollectionBookCard
              key={book.id}
              book={{
                bookId: book.id,
                id: book.id,
                slug: book.slug,
                title: book.display_title || book.title,
                author: book.author || '',
                year: book.year || 0,
                pages_count: book.pages_count,
                pages_translated: book.pages_translated,
                thumbnail: book.thumbnail || undefined,
                thumbnail_blob: book.thumbnail_blob || undefined,
                language: book.language || undefined,
                is_first_translation: book.is_first_translation,
                ft_disposition: book.ft_disposition || undefined,
              }}
              priority={i < 10}
            />
          ))}
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
          {books.map(book => (
            <div key={book.id}>
              {renderListItem ? renderListItem(book) : defaultListItem(book)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
