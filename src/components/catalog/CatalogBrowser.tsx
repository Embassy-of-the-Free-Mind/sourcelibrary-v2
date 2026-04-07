'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, LayoutGrid, List, Download } from 'lucide-react';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';

const PER_PAGE = 60;

interface BookItem {
  id: string;
  slug?: string | null;
  title: string;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  language?: string | null;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  photo?: string | null;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  published?: string | null;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

type ViewMode = 'grid' | 'list';

function getStoredView(): ViewMode | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sl-catalog-view') as ViewMode | null;
}

interface CatalogBrowserProps {
  initialBooks: BookItem[];
  initialTotal: number;
  languages: { lang: string; count: number }[];
}

export default function CatalogBrowser({ initialBooks, initialTotal, languages }: CatalogBrowserProps) {
  const [books, setBooks] = useState<BookItem[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('popular');
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalPages = Math.ceil(total / PER_PAGE);

  // Fetch from API with current filters
  const fetchBooks = useCallback(async (params: {
    sort: string; language: string; query: string; page: number;
  }) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.sort !== 'popular') qs.set('sort', params.sort);
      if (params.language) qs.set('language', params.language);
      if (params.query) qs.set('q', params.query);
      if (params.page > 1) qs.set('page', String(params.page));

      const res = await fetch(`/api/catalog/browse?${qs.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setBooks(data.books || []);
      setTotal(data.total || 0);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Keep current state on error
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Initialize from URL params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlSort = params.get('sort') || 'popular';
    const urlLang = params.get('language') || '';
    const urlQ = params.get('q') || '';
    const urlPage = parseInt(params.get('page') || '1', 10);
    const urlView = params.get('view') as ViewMode | null;
    const storedView = getStoredView();

    setSort(urlSort);
    setLanguage(urlLang);
    setQuery(urlQ);
    setCurrentPage(urlPage);
    setViewMode(urlView || storedView || 'list');

    // If URL has non-default params, fetch that specific page
    const isDefault = urlSort === 'popular' && !urlLang && !urlQ && urlPage === 1;
    if (!isDefault) {
      fetchBooks({ sort: urlSort, language: urlLang, query: urlQ, page: urlPage });
    }
  }, [fetchBooks]);

  const updateUrl = useCallback((s: string, lang: string, page: number, q: string, view: ViewMode) => {
    const params = new URLSearchParams();
    if (s !== 'popular') params.set('sort', s);
    if (lang) params.set('language', lang);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', String(page));
    if (view !== 'list') params.set('view', view);
    const qs = params.toString();
    window.history.replaceState(null, '', `/catalog${qs ? `?${qs}` : ''}`);
  }, []);

  const handleSort = useCallback((newSort: string) => {
    setSort(newSort);
    setCurrentPage(1);
    updateUrl(newSort, language, 1, query, viewMode);
    fetchBooks({ sort: newSort, language, query, page: 1 });
  }, [language, query, viewMode, updateUrl, fetchBooks]);

  const handleLanguage = useCallback((newLang: string) => {
    setLanguage(newLang);
    setCurrentPage(1);
    updateUrl(sort, newLang, 1, query, viewMode);
    fetchBooks({ sort, language: newLang, query, page: 1 });
  }, [sort, query, viewMode, updateUrl, fetchBooks]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
    // Debounce API call
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateUrl(sort, language, 1, value, viewMode);
      fetchBooks({ sort, language, query: value, page: 1 });
    }, 300);
  }, [sort, language, viewMode, updateUrl, fetchBooks]);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, language, page, query, viewMode);
    fetchBooks({ sort, language, query, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sort, language, query, viewMode, updateUrl, fetchBooks]);

  const handleViewToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('sl-catalog-view', mode);
    updateUrl(sort, language, currentPage, query, mode);
  }, [sort, language, currentPage, query, updateUrl]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {query || language ? (
              `${total.toLocaleString()} of ${initialTotal.toLocaleString()} books`
            ) : (
              `${total.toLocaleString()} books`
            )}
          </p>
          <a
            href={`/api/catalog/csv${language ? `?language=${encodeURIComponent(language)}` : ''}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent-rust transition-colors"
            title="Download catalog as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </a>
        </div>

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

          {/* Sort */}
          <select
            value={sort}
            onChange={e => handleSort(e.target.value)}
            className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-accent-rust cursor-pointer"
          >
            <option value="popular">Most read</option>
            <option value="recent">Recently added</option>
            <option value="last_translated">Recently translated</option>
            <option value="title">Title A-Z</option>
            <option value="author">Author A-Z</option>
            <option value="year_asc">Year (oldest)</option>
            <option value="year_desc">Year (newest)</option>
          </select>

          {/* Language filter */}
          <select
            value={language}
            onChange={e => handleLanguage(e.target.value)}
            className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-accent-rust cursor-pointer"
          >
            <option value="">All languages</option>
            {languages.map(l => (
              <option key={l.lang} value={l.lang}>
                {l.lang} ({l.count})
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search titles, authors..."
              className="text-sm border border-border-light rounded-lg pl-8 pr-8 py-1.5 bg-white text-primary placeholder:text-muted/60 focus:outline-none focus:border-accent-rust w-48 sm:w-56"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setCurrentPage(1);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  updateUrl(sort, language, 1, '', viewMode);
                  fetchBooks({ sort, language, query: '', page: 1 });
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Book list/grid */}
      <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
        {books.length === 0 && !loading ? (
          <div className="py-20 text-center text-muted">
            No books match your filters.
          </div>
        ) : viewMode === 'list' ? (
          <CollectionListView
            books={books as any}
            sort={sort}
            onSort={handleSort}
            loading={loading}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {books.map(book => (
              <CollectionBookCard
                key={book.id}
                book={{
                  ...book,
                  bookId: book.id,
                  slug: book.slug || undefined,
                  author: book.author || 'Unknown',
                  year: book.year || 0,
                  pages_count: book.pages_count || 0,
                  pages_translated: book.pages_translated || 0,
                  pages_ocr: book.pages_ocr || 0,
                  thumbnail: book.thumbnail || undefined,
                  thumbnail_blob: book.thumbnail_blob || undefined,
                  language: book.language || undefined,
                  published: book.published || undefined,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <CatalogPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePage}
      />
    </div>
  );
}
