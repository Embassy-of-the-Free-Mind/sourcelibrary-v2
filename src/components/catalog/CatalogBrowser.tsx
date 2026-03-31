'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Search, X, LayoutGrid, List } from 'lucide-react';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';

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
  created_at?: string;
  last_translation_at?: string;
}

type ViewMode = 'grid' | 'list';

function getStoredView(): ViewMode | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sl-catalog-view') as ViewMode | null;
}

function sortBooks(books: BookItem[], sort: string): BookItem[] {
  const sorted = [...books];
  switch (sort) {
    case 'year_asc':
      return sorted.sort((a, b) => (a.year || 9999) - (b.year || 9999) || (a.title || '').localeCompare(b.title || ''));
    case 'year_desc':
      return sorted.sort((a, b) => (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || ''));
    case 'title':
      return sorted.sort((a, b) => (a.display_title || a.title || '').localeCompare(b.display_title || b.title || ''));
    case 'author':
      return sorted.sort((a, b) => (a.author || 'zzz').localeCompare(b.author || 'zzz') || (a.title || '').localeCompare(b.title || ''));
    case 'recent':
      return sorted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    case 'last_translated':
      return sorted.sort((a, b) => (b.last_translation_at || '').localeCompare(a.last_translation_at || ''));
    case 'popular':
      return sorted.sort((a, b) => (b.read_count || 0) - (a.read_count || 0) || (a.title || '').localeCompare(b.title || ''));
    default:
      return sorted.sort((a, b) => (b.read_count || 0) - (a.read_count || 0));
  }
}

function filterBooks(books: BookItem[], query: string, language: string): BookItem[] {
  let result = books;
  if (language) {
    result = result.filter(b => b.language === language);
  }
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.display_title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q)
    );
  }
  return result;
}

export default function CatalogBrowser() {
  const [allBooks, setAllBooks] = useState<BookItem[]>([]);
  const [languages, setLanguages] = useState<{ lang: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('popular');
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // Fetch manifest on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Read URL state
    const params = new URLSearchParams(window.location.search);
    const urlSort = params.get('sort');
    const urlLang = params.get('language');
    const urlQ = params.get('q');
    const urlPage = params.get('page');
    const urlView = params.get('view') as ViewMode | null;
    const storedView = getStoredView();

    if (urlSort) setSort(urlSort);
    if (urlLang) setLanguage(urlLang);
    if (urlQ) setQuery(urlQ);
    if (urlPage) setCurrentPage(parseInt(urlPage));
    setViewMode(urlView || storedView || 'list');

    fetch('/api/catalog/browse')
      .then(res => res.json())
      .then(data => {
        setAllBooks(data.books || []);
        setLanguages(data.languages || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Client-side filter → sort → paginate
  const filtered = useMemo(() => filterBooks(allBooks, query, language), [allBooks, query, language]);
  const sorted = useMemo(() => sortBooks(filtered, sort), [filtered, sort]);
  const totalPages = Math.ceil(sorted.length / PER_PAGE);
  const safePage = Math.min(currentPage, Math.max(1, totalPages));
  const pageBooks = useMemo(
    () => sorted.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE),
    [sorted, safePage],
  );

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
  }, [language, query, updateUrl, viewMode]);

  const handleLanguage = useCallback((newLang: string) => {
    setLanguage(newLang);
    setCurrentPage(1);
    updateUrl(sort, newLang, 1, query, viewMode);
  }, [sort, query, updateUrl, viewMode]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
  }, []);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, language, page, query, viewMode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sort, language, query, updateUrl, viewMode]);

  const handleViewToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('sl-catalog-view', mode);
    updateUrl(sort, language, currentPage, query, mode);
  }, [sort, language, currentPage, query, updateUrl]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-muted">
            {loading ? (
              'Loading catalog...'
            ) : query || language ? (
              `${sorted.length.toLocaleString()} of ${allBooks.length.toLocaleString()} books`
            ) : (
              `${allBooks.length.toLocaleString()} books`
            )}
          </p>
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
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
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
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Book list/grid */}
      {loading ? (
        <div className="py-20 text-center text-muted">Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="py-20 text-center text-muted">
          No books match your filters.
        </div>
      ) : viewMode === 'list' ? (
        <CollectionListView
          books={pageBooks}
          sort={sort}
          onSort={handleSort}
          loading={loading}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
          {pageBooks.map(book => (
            <CollectionBookCard
              key={book.id}
              book={{
                ...book,
                bookId: book.id,
                author: book.author || 'Unknown',
                year: book.year || 0,
                pages_count: book.pages_count || 0,
                pages_translated: book.pages_translated || 0,
                pages_ocr: book.pages_ocr || 0,
              }}
            />
          ))}
        </div>
      )}

      <CatalogPagination
        currentPage={safePage}
        totalPages={totalPages}
        onPageChange={handlePage}
      />
    </div>
  );
}
