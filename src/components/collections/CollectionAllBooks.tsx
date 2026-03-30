'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowRight, Search, X, LayoutGrid, List } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import { bookTitle } from '@/lib/collections-utils';

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
  pages_blank?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

interface CollectionAllBooksProps {
  collectionId: string;
  /** First 14 books from server render (compact view) */
  compactBooks: BookItem[];
  total: number;
  languages: { lang: string; count: number }[];
  /** 'visual_art' collections use "works" instead of "books" */
  collectionType?: string;
}

type ViewMode = 'grid' | 'list';

function getStoredView(): ViewMode | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sl-collection-view') as ViewMode | null;
}

export default function CollectionAllBooks({
  collectionId,
  compactBooks,
  total,
  languages,
  collectionType,
}: CollectionAllBooksProps) {
  const itemLabel = collectionType === 'visual_art' ? 'works' : 'books';
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL params
  const urlSort = searchParams.get('sort') || 'relevance';
  const urlLang = searchParams.get('language') || '';
  const urlQ = searchParams.get('q') || '';
  const urlPage = parseInt(searchParams.get('page') || '0');
  const urlView = searchParams.get('view') as ViewMode | null;
  const hasUrlParams = searchParams.has('sort') || searchParams.has('page') || searchParams.has('view');

  // Default to list for large collections (200+)
  const sizeDefault: ViewMode = total > 200 ? 'list' : 'grid';
  const initialView = urlView || getStoredView() || sizeDefault;

  const [expanded, setExpanded] = useState(hasUrlParams);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedTotal, setFetchedTotal] = useState(total);
  const [sort, setSort] = useState(urlSort);
  const [language, setLanguage] = useState(urlLang);
  const [query, setQuery] = useState(urlQ);
  const [offset, setOffset] = useState(urlPage * PER_PAGE);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch on mount if URL had params
  useEffect(() => {
    if (hasUrlParams && !initialFetchDone) {
      setInitialFetchDone(true);
      fetchBooks(sort, language, offset, query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateUrl = useCallback((s: string, lang: string, off: number, q: string, view: ViewMode) => {
    const params = new URLSearchParams();
    if (s !== 'relevance') params.set('sort', s);
    if (lang) params.set('language', lang);
    if (q) params.set('q', q);
    if (off > 0) params.set('page', String(Math.floor(off / PER_PAGE)));
    if (view !== sizeDefault) params.set('view', view);
    const qs = params.toString();
    const url = `/collections/${collectionId}${qs ? `?${qs}` : ''}`;
    router.replace(url, { scroll: false });
  }, [collectionId, sizeDefault, router]);

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
    updateUrl('relevance', '', 0, '', viewMode);
  }, [fetchBooks, updateUrl, viewMode]);

  const handleSort = useCallback((newSort: string) => {
    fetchBooks(newSort, language, 0, query);
    updateUrl(newSort, language, 0, query, viewMode);
  }, [fetchBooks, language, query, updateUrl, viewMode]);

  const handleLanguage = useCallback((newLang: string) => {
    fetchBooks(sort, newLang, 0, query);
    updateUrl(sort, newLang, 0, query, viewMode);
  }, [fetchBooks, sort, query, updateUrl, viewMode]);

  const debouncedSearch = useDebouncedCallback((q: string) => {
    fetchBooks(sort, language, 0, q);
    updateUrl(sort, language, 0, q, viewMode);
  }, 300);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    debouncedSearch(value);
  }, [debouncedSearch]);

  const handlePage = useCallback((page: number) => {
    const newOffset = (page - 1) * PER_PAGE;
    fetchBooks(sort, language, newOffset, query);
    updateUrl(sort, language, newOffset, query, viewMode);
    document.getElementById('collection-all-books')?.scrollIntoView({ behavior: 'smooth' });
  }, [fetchBooks, sort, language, query, updateUrl, viewMode]);

  const handleViewToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('sl-collection-view', mode);
    if (expanded) {
      updateUrl(sort, language, offset, query, mode);
    }
  }, [expanded, sort, language, offset, query, updateUrl]);

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
            All {collectionType === 'visual_art' ? 'Works' : 'Books'}
          </h2>
          <p className="text-sm text-muted mt-1">
            {(expanded ? fetchedTotal : total).toLocaleString()} {itemLabel} in this collection
          </p>
        </div>

        {expanded && (
          <div className="flex flex-wrap items-center gap-3">
            {/* View toggle */}
            <div className="flex items-center border border-border-light rounded-lg overflow-hidden">
              <button
                onClick={() => handleViewToggle('grid')}
                className={`p-1.5 transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-accent-rust/10 text-accent-rust'
                    : 'text-muted hover:text-primary'
                }`}
                aria-label="Grid view"
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleViewToggle('list')}
                className={`p-1.5 transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-accent-rust/10 text-accent-rust'
                    : 'text-muted hover:text-primary'
                }`}
                aria-label="List view"
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
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

            {/* Sort dropdown */}
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
              <option value="author">{collectionType === 'visual_art' ? 'Artist' : 'Author'} A-Z</option>
              <option value="last_translated">Recently Translated</option>
              <option value="recent">Recently Added</option>
            </select>

            {/* Language filter */}
            {languages.length > 1 && (
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

      {/* Books — Grid or List */}
      {viewMode === 'list' && expanded ? (
        <CollectionListView
          books={displayBooks}
          sort={sort}
          onSort={handleSort}
          loading={loading}
          collectionType={collectionType}
        />
      ) : (
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
                thumbnail_blob: book.thumbnail_blob,
                language: book.language,
                published: book.published,
                translation_percent: book.pages_ocr && book.pages_translated
                  ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
                  : 0,
              }}
              priority={!expanded && i < 4}
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
                <span className="text-xs text-muted">{itemLabel}</span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Pagination */}
      {expanded && (
        <CatalogPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePage}
        />
      )}

      {/* Collapse back to compact */}
      {expanded && (
        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setExpanded(false);
              setOffset(0);
              router.replace(`/collections/${collectionId}`, { scroll: false });
            }}
            className="text-sm text-muted hover:text-accent-rust transition-colors cursor-pointer"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}
