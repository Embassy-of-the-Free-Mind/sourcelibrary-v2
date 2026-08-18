'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import CollectionBookCard from '@/components/CollectionBookCard';
import { bookUrl } from '@/lib/slugify';
import { resolveImprintPlace } from '@/lib/imprint';
import { firstTranslationBadge } from '@/lib/first-translation-labels';

type ViewMode = 'grid' | 'list';

const STORAGE_KEY = 'sl-browse-view';

interface AuthorBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  year?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
  pages_count?: number;
  pages_translated?: number;
  pages_ocr?: number;
  pages_blank?: number;
  translation_percent?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_claim?: 'confirmed' | 'candidate';
  publisher?: string;
  place_of_publication?: string;
  publication_place?: string;
  place_published?: string;
  place?: string;
}

export default function AuthorBibliography({ books }: { books: AuthorBook[] }) {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xs uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
          Bibliography
        </h2>
        <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-light)' }}>
          <button
            onClick={() => handleToggle('grid')}
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
            onClick={() => handleToggle('list')}
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
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide" style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}>
                <th className="pb-3 pr-4 font-medium">Title</th>
                <th className="pb-3 pr-4 font-medium w-16">Year</th>
                <th className="pb-3 pr-4 font-medium hidden md:table-cell w-24">Language</th>
                <th className="pb-3 pr-4 font-medium hidden lg:table-cell">Publisher</th>
                <th className="pb-3 font-medium hidden sm:table-cell w-20 text-right">Pages</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
              {books.map(book => {
                const pct = book.translation_percent ?? 0;
                const hasOriginalTitle = book.display_title && book.title !== book.display_title;
                const publisher = book.publisher?.split('|')[0]?.trim();
                const place = resolveImprintPlace(book)?.display; // family resolver, #4043

                return (
                  <tr key={book.id} className="group hover:bg-warm/50 transition-colors">
                    <td className="py-3 pr-4">
                      <Link href={bookUrl(book)} className="block">
                        <span
                          className="text-sm font-medium line-clamp-1"
                          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-serif)' }}
                        >
                          {book.display_title || book.title}
                        </span>
                        {book.is_first_translation && (
                          <span className="inline-block ml-2 bg-accent-gold/15 text-[10px] px-1.5 py-0.5 rounded-full font-medium align-middle" style={{ color: 'var(--accent-gold-dark)' }}>
                            {firstTranslationBadge(book.ft_disposition, book.language, undefined, book.ft_claim)}
                          </span>
                        )}
                        {hasOriginalTitle && (
                          <span className="block text-xs mt-0.5 line-clamp-1 italic" style={{ color: 'var(--text-faint)' }}>
                            {book.title}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      <Link href={bookUrl(book)} className="block">
                        {book.year || book.published || '—'}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <Link href={bookUrl(book)} className="block">
                        <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-warm)' }}>
                          {book.language || '—'}
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-4 hidden lg:table-cell">
                      <Link href={bookUrl(book)} className="block text-xs line-clamp-1" style={{ color: 'var(--text-faint)' }}>
                        {publisher || '—'}
                        {place && publisher && <span className="text-[10px]"> ({place})</span>}
                      </Link>
                    </td>
                    <td className="py-3 hidden sm:table-cell text-right">
                      <Link href={bookUrl(book)} className="block text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {book.pages_count || '—'}
                        {pct > 0 && pct < 95 && (
                          <span className="text-[10px] ml-1" style={{ color: 'var(--accent-gold-dark)' }}>{pct}%</span>
                        )}
                        {pct >= 95 && (
                          <span className="text-[10px] ml-1" style={{ color: 'var(--status-success)' }}>done</span>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
