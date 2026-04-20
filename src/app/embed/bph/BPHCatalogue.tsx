'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';

interface Book {
  id: string;
  slug: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  year: number;
  pages_count: number;
  pages_translated: number;
  thumbnail: string | null;
  catalogue_number: string | null;
  categories: string[];
  url: string;
}

interface BooksResponse {
  books: Book[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 24;

export default function BPHCatalogue() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';
  const initialSort = searchParams.get('sort') || 'title';
  const initialPage = parseInt(searchParams.get('page') || '1');

  const [query, setQuery] = useState(initialQuery);
  const [inputValue, setInputValue] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [data, setData] = useState<BooksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('sort', sort);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((currentPage - 1) * PAGE_SIZE));

    try {
      const res = await fetch(`/api/embed/bph/books?${params}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch books:', err);
    } finally {
      setLoading(false);
    }
  }, [query, sort, currentPage]);

  useEffect(() => { fetchBooks(); }, [fetchBooks]);

  // Notify parent iframe of navigation state
  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({ type: 'sl-navigate', path: '/catalogue', query }, '*');
  }, [query, currentPage]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(inputValue);
    setCurrentPage(1);
    // Update URL without full navigation
    const params = new URLSearchParams();
    if (inputValue) params.set('q', inputValue);
    if (sort !== 'title') params.set('sort', sort);
    router.replace(`/embed/bph?${params}`, { scroll: false });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handleBookClick = (book: Book) => {
    // Navigate to book detail within embed
    router.push(`/embed/bph/book/${book.slug}`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-serif font-medium text-stone-900">
            Digital Catalogue
          </h1>
          {data && !loading && (
            <p className="text-sm text-stone-500 mt-1">
              {data.total.toLocaleString()} {query ? 'results' : 'items'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded ${view === 'grid' ? 'bg-stone-200' : 'hover:bg-stone-100'}`}
            title="Grid view"
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded ${view === 'list' ? 'bg-stone-200' : 'hover:bg-stone-100'}`}
            title="List view"
          >
            <ListIcon />
          </button>
        </div>
      </div>

      {/* Search + Sort */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search by title, author, or subject..."
            className="w-full px-4 py-2.5 border border-stone-300 rounded-lg bg-white
                       text-stone-900 placeholder:text-stone-400
                       focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => { setInputValue(''); setQuery(''); setCurrentPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              ✕
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setCurrentPage(1); }}
          className="px-3 py-2.5 border border-stone-300 rounded-lg bg-white text-sm"
        >
          <option value="title">A–Z</option>
          <option value="date_asc">Oldest first</option>
          <option value="date_desc">Newest first</option>
          <option value="recent">Recently added</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 bg-stone-900 text-white rounded-lg hover:bg-stone-800 text-sm font-medium"
        >
          Search
        </button>
      </form>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
          ))}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {data?.books.map((book) => (
            <button
              key={book.id}
              onClick={() => handleBookClick(book)}
              className="group text-left flex flex-col"
            >
              <div className="aspect-[3/4] bg-stone-100 rounded overflow-hidden mb-2 relative">
                {book.thumbnail ? (
                  <img
                    src={book.thumbnail}
                    alt={book.display_title || book.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs p-2 text-center">
                    {book.display_title || book.title}
                  </div>
                )}
                {book.pages_translated > 0 && (
                  <div className="absolute top-1.5 right-1.5 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                    Translated
                  </div>
                )}
              </div>
              <h3 className="text-xs font-medium leading-tight line-clamp-2 group-hover:text-stone-600">
                {book.display_title || book.title}
              </h3>
              <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">
                {book.author}{book.published ? `, ${book.published}` : ''}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-stone-200">
          {data?.books.map((book) => (
            <button
              key={book.id}
              onClick={() => handleBookClick(book)}
              className="w-full text-left flex items-center gap-4 py-3 hover:bg-stone-50 px-2 rounded"
            >
              <div className="w-12 h-16 flex-shrink-0 bg-stone-100 rounded overflow-hidden">
                {book.thumbnail && (
                  <img
                    src={book.thumbnail}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium truncate">
                  {book.display_title || book.title}
                </h3>
                <p className="text-xs text-stone-500">
                  {book.author}{book.published ? ` · ${book.published}` : ''} · {book.language}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-stone-400">{book.pages_count} pp.</p>
                {book.pages_translated > 0 && (
                  <p className="text-[11px] text-emerald-600">
                    {Math.round((book.pages_translated / book.pages_count) * 100)}% translated
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded disabled:opacity-30 hover:bg-stone-100"
          >
            ← Prev
          </button>
          <span className="text-sm text-stone-500 px-3">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded disabled:opacity-30 hover:bg-stone-100"
          >
            Next →
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && data?.books.length === 0 && (
        <div className="text-center py-16">
          <p className="text-stone-500 text-lg">No results found</p>
          {query && (
            <button
              onClick={() => { setInputValue(''); setQuery(''); setCurrentPage(1); }}
              className="mt-3 text-sm text-stone-600 underline hover:text-stone-900"
            >
              Clear search
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="2.5" rx="1" />
      <rect x="1" y="6.75" width="14" height="2.5" rx="1" />
      <rect x="1" y="11.5" width="14" height="2.5" rx="1" />
    </svg>
  );
}
