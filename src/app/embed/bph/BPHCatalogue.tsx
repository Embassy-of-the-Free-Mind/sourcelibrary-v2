'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Book, LayoutGrid, List, ChevronLeft, ChevronRight } from 'lucide-react';
import AuthorName from '@/components/AuthorName';

interface BookItem {
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
  books: BookItem[];
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

  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({ type: 'sl-navigate', path: '/catalogue', query }, '*');
  }, [query, currentPage]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(inputValue);
    setCurrentPage(1);
    const params = new URLSearchParams();
    if (inputValue) params.set('q', inputValue);
    if (sort !== 'title') params.set('sort', sort);
    router.replace(`/embed/bph?${params}`, { scroll: false });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const tp = (b: BookItem) => b.pages_count > 0 ? Math.round((b.pages_translated / b.pages_count) * 100) : 0;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Hero header — matches ContentHeader from main site */}
      <div className="relative overflow-hidden text-white py-12 md:py-16">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-2">Digital Catalogue</h1>
          <p className="text-base text-stone-300 max-w-2xl font-body leading-relaxed">
            Browse the digitized collection of the Bibliotheca Philosophica Hermetica
          </p>
          {data && !loading && (
            <p className="text-sm text-stone-500 mt-2">
              {data.total.toLocaleString()} {query ? 'results' : 'texts'}
            </p>
          )}
        </div>
      </div>

      <main className="max-w-[var(--container-wide)] mx-auto px-6 py-8">
        {/* Search + controls — matches main search page style */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search by title, author, or subject..."
              className="w-full pl-12 pr-10 py-3 border border-medium rounded-xl bg-white
                         text-primary placeholder:text-muted
                         focus:outline-none focus:ring-2 focus:ring-accent-rust/40 focus:border-accent-rust/50"
            />
            {inputValue && (
              <button type="button" onClick={() => { setInputValue(''); setQuery(''); setCurrentPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary text-lg">&times;</button>
            )}
          </div>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setCurrentPage(1); }}
            className="px-4 py-3 border border-medium rounded-xl bg-white text-sm text-secondary">
            <option value="title">A&ndash;Z</option>
            <option value="date_asc">Oldest first</option>
            <option value="date_desc">Newest first</option>
            <option value="recent">Recently added</option>
          </select>
          <div className="flex gap-1">
            <button type="button" onClick={() => setView('grid')}
              className={`p-3 rounded-xl border ${view === 'grid' ? 'bg-dark text-white border-dark' : 'border-medium text-muted hover:bg-warm'}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setView('list')}
              className={`p-3 rounded-xl border ${view === 'list' ? 'bg-dark text-white border-dark' : 'border-medium text-muted hover:bg-warm'}`}>
              <List className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Loading shimmer — matches BookCard shimmer pattern */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <div key={i} className="bg-white border border-light rounded-lg overflow-hidden">
                <div className="aspect-[3/4] bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-stone-200 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-stone-100 rounded w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : view === 'grid' ? (
          /* Grid — replicates BookCard from src/components/book/BookCard.tsx */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {data?.books.map((book) => (
              <Link key={book.id} href={`/embed/bph/book/${book.slug}`} className="group">
                <div className="bg-white border border-light rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200 h-full flex flex-col">
                  <div className="aspect-[3/4] relative bg-stone-100 overflow-hidden flex-shrink-0">
                    {book.thumbnail ? (
                      <img src={book.thumbnail} alt={book.display_title || book.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Book className="w-16 h-16 text-stone-300" />
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <h3 className="font-serif font-semibold text-primary line-clamp-2 group-hover:text-accent-rust transition-colors text-sm">
                      {book.display_title || book.title}
                    </h3>
                    <p className="text-sm text-secondary mt-1 line-clamp-1"><AuthorName author={book.author} /></p>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2 text-xs text-muted">
                      <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
                      {book.published && <span>{book.published}</span>}
                    </div>
                    {book.pages_count > 0 && (
                      <div className="mt-auto pt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={tp(book) >= 95 ? 'text-status-success font-medium' : 'text-muted'}>
                            {tp(book) >= 95 ? '✓ Translated' : `${tp(book)}% Translated`}
                          </span>
                        </div>
                        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                          <div className={`h-full transition-all duration-300 ${tp(book) >= 95 ? 'bg-status-success' : tp(book) > 0 ? 'bg-accent-gold/80' : 'bg-stone-200'}`}
                            style={{ width: `${Math.min(tp(book), 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          /* List view */
          <div className="bg-white border border-light rounded-lg divide-y divide-stone-100">
            {data?.books.map((book) => (
              <Link key={book.id} href={`/embed/bph/book/${book.slug}`}
                className="flex items-center gap-4 p-4 hover:bg-warm transition-colors group">
                <div className="w-12 h-16 flex-shrink-0 bg-stone-100 rounded overflow-hidden">
                  {book.thumbnail ? (
                    <img src={book.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Book className="w-6 h-6 text-stone-300" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif font-semibold text-primary truncate group-hover:text-accent-rust transition-colors">
                    {book.display_title || book.title}
                  </h3>
                  <p className="text-sm text-muted"><AuthorName author={book.author} />{book.published ? ` · ${book.published}` : ''} · {book.language}</p>
                </div>
                <div className="text-right flex-shrink-0 hidden sm:block">
                  <p className="text-xs text-faint">{book.pages_count} pp.</p>
                  {tp(book) >= 95 ? (
                    <p className="text-xs text-status-success font-medium">✓ Translated</p>
                  ) : tp(book) > 0 ? (
                    <p className="text-xs text-accent-gold">{tp(book)}%</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-10">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm border border-medium rounded-lg disabled:opacity-30 hover:bg-warm transition-colors">
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <span className="text-sm text-muted">Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm border border-medium rounded-lg disabled:opacity-30 hover:bg-warm transition-colors">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {!loading && data?.books.length === 0 && (
          <div className="text-center py-20">
            <Book className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-muted text-lg font-serif">No results found</p>
            {query && (
              <button onClick={() => { setInputValue(''); setQuery(''); setCurrentPage(1); }}
                className="mt-3 text-sm text-accent-rust hover:underline">Clear search</button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
