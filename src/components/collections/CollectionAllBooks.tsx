'use client';

import { useState, useCallback, useRef } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import CollectionBookCard from '@/components/CollectionBookCard';

const PER_PAGE = 60;

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
}

interface CollectionAllBooksProps {
  collectionId: string;
  /** First 14 books from server render (compact view) */
  compactBooks: BookItem[];
  total: number;
  languages: { lang: string; count: number }[];
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

export default function CollectionAllBooks({
  collectionId,
  compactBooks,
  total,
  languages,
}: CollectionAllBooksProps) {
  const [expanded, setExpanded] = useState(false);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedTotal, setFetchedTotal] = useState(total);
  const [sort, setSort] = useState('relevance');
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchBooks = useCallback(async (s: string, lang: string, off: number, q: string = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: s, offset: String(off), limit: String(PER_PAGE) });
      if (lang) params.set('language', lang);
      if (q) params.set('q', q);
      const res = await fetch(`/api/collections/${collectionId}?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setBooks(data.books || []);
      setFetchedTotal(data.total ?? total);
      setSort(s);
      setLanguage(lang);
      setOffset(off);
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, [collectionId, total]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    fetchBooks('relevance', '', 0);
  }, [fetchBooks]);

  const handleSort = useCallback((newSort: string) => {
    fetchBooks(newSort, language, 0, query);
  }, [fetchBooks, language, query]);

  const handleLanguage = useCallback((newLang: string) => {
    fetchBooks(sort, newLang, 0, query);
  }, [fetchBooks, sort, query]);

  const debouncedSearch = useDebouncedCallback((q: string) => {
    fetchBooks(sort, language, 0, q);
  }, 300);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    debouncedSearch(value);
  }, [debouncedSearch]);

  const handlePage = useCallback((newOffset: number) => {
    fetchBooks(sort, language, newOffset, query);
    document.getElementById('collection-all-books')?.scrollIntoView({ behavior: 'smooth' });
  }, [fetchBooks, sort, language, query]);

  const showSeeAllCard = !expanded && total > compactBooks.length;
  const displayBooks = expanded ? books : compactBooks;
  const totalPages = Math.ceil(fetchedTotal / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;

  return (
    <div id="collection-all-books">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl text-primary font-display">
            All Books
          </h2>
          <p className="text-sm text-muted mt-1">
            {(expanded ? fetchedTotal : total).toLocaleString()} books in this collection
          </p>
        </div>

        {expanded && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search within..."
                className="text-sm border border-border-light rounded-lg pl-8 pr-8 py-1.5 bg-white text-primary w-44 focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
              />
              {query && (
                <button
                  onClick={() => handleSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => handleSort(e.target.value)}
              className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary"
            >
              <option value="relevance">Most Relevant</option>
              <option value="popular">Most Popular</option>
              <option value="year_asc">Oldest First</option>
              <option value="year_desc">Newest First</option>
              <option value="title">Title A-Z</option>
              <option value="recent">Recently Added</option>
            </select>
            {languages.length > 0 && (
              <select
                value={language}
                onChange={(e) => handleLanguage(e.target.value)}
                className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary"
              >
                <option value="">All Languages</option>
                {languages.map((l) => (
                  <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Books Grid */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
        {displayBooks.map((book, i) => (
          <CollectionBookCard
            key={book.id}
            book={{
              bookId: book.id,
              id: book.id,
              slug: book.slug,
              title: bookTitle(book),
              author: book.author || '',
              year: book.year || 0,
              pages_count: book.pages_count,
              pages_ocr: book.pages_ocr,
              pages_translated: book.pages_translated,
              thumbnail: book.thumbnail || book.thumbnail_blob || book.photo,
              language: book.language,
              published: book.published,
              translation_percent: book.pages_ocr && book.pages_translated
                ? Math.round((book.pages_translated / book.pages_ocr) * 100)
                : 0,
            }}
            priority={!expanded && i < 10}
          />
        ))}

        {/* "See all" card in compact view */}
        {showSeeAllCard && (
          <button
            onClick={handleExpand}
            className="group flex flex-col items-center justify-center gap-3 rounded-xl border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all aspect-[3/4] cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-accent-rust/8 flex items-center justify-center group-hover:bg-accent-rust/15 transition-colors">
              <ArrowRight className="w-5 h-5 text-accent-rust" />
            </div>
            <div className="text-center px-3">
              <span className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors block">
                See all {total.toLocaleString()}
              </span>
              <span className="text-xs text-muted">books</span>
            </div>
          </button>
        )}
      </div>

      {/* Pagination (only in expanded view) */}
      {expanded && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-10 text-sm">
          {offset > 0 ? (
            <button
              onClick={() => handlePage(Math.max(0, offset - PER_PAGE))}
              className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors cursor-pointer"
            >
              Previous
            </button>
          ) : (
            <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
              Previous
            </span>
          )}
          <span className="text-muted">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <button
              onClick={() => handlePage(offset + PER_PAGE)}
              className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors cursor-pointer"
            >
              Next
            </button>
          ) : (
            <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
              Next
            </span>
          )}
        </div>
      )}

      {/* Collapse back to compact */}
      {expanded && (
        <div className="mt-6 text-center">
          <button
            onClick={() => { setExpanded(false); setOffset(0); }}
            className="text-sm text-muted hover:text-accent-rust transition-colors cursor-pointer"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}
