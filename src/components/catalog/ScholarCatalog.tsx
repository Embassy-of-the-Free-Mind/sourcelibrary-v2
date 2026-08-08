'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Search, X, Download, Copy, Check, Filter,
  ArrowUpDown, ArrowUp, ArrowDown, FileText, ChevronDown,
} from 'lucide-react';
import AuthorName from '@/components/AuthorName';
import { isPublishedFirstTranslation } from '@/lib/book';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import { ftRenderProps } from '@/lib/first-translation/render';
import CatalogPagination from '@/components/collections/CatalogPagination';

const PER_PAGE = 60;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const CENTURIES = [
  { label: 'Ancient', min: -5000, max: 499 },
  { label: 'Medieval', min: 500, max: 1399 },
  { label: '15th c.', min: 1400, max: 1499 },
  { label: '16th c.', min: 1500, max: 1599 },
  { label: '17th c.', min: 1600, max: 1699 },
  { label: '18th c.', min: 1700, max: 1799 },
  { label: '19th c.', min: 1800, max: 1899 },
  { label: '20th c.', min: 1900, max: 1999 },
];

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
  published?: string | null;
  is_first_translation?: boolean;
  ft_disposition?: string;
  // Raw graded-verdict projections from books_catalog (#3726 Tier 3);
  // ftRenderProps resolves them into the badge register at render time.
  ft_verdict?: string | null;
  ft_evidence_strength?: string | null;
  ft_our_completeness?: string | null;
  ft_source_screen?: string | null;
  ft_translator_screen?: string | null;
  image_source_provider?: string | null;
}

interface ContentMatch {
  book_id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  page_number?: number;
  snippet?: string;
  snippet_type?: string;
}

interface ScholarCatalogProps {
  initialBooks: BookItem[];
  initialTotal: number;
  languages: { lang: string; count: number }[];
}

function SortIcon({ column, currentSort }: { column: string; currentSort: string }) {
  const mapping: Record<string, string[]> = {
    title: ['title'],
    author: ['author'],
    year: ['year_asc', 'year_desc'],
  };
  const isActive = mapping[column]?.includes(currentSort);
  if (!isActive) return <ArrowUpDown className="w-3 h-3 text-muted/50" />;
  if (currentSort === 'year_desc') return <ArrowDown className="w-3 h-3 text-accent-rust" />;
  return <ArrowUp className="w-3 h-3 text-accent-rust" />;
}

function CopyPermalink({ slug, id }: { slug?: string | null; id: string }) {
  const [copied, setCopied] = useState(false);
  const url = `https://sourcelibrary.org/book/${slug || id}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      title={`Copy permalink: ${url}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Link'}
    </button>
  );
}

interface Filters {
  language: string;
  yearMin: string;
  yearMax: string;
  firstTranslation: boolean;
  hasTranslation: boolean;
}

export default function ScholarCatalog({ initialBooks, initialTotal, languages }: ScholarCatalogProps) {
  const [books, setBooks] = useState<BookItem[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('title');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [titlePrefix, setTitlePrefix] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    language: '',
    yearMin: '',
    yearMax: '',
    firstTranslation: false,
    hasTranslation: false,
  });

  // Full-text search state
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentLoading, setContentLoading] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentAbortRef = useRef<AbortController | null>(null);

  const totalPages = Math.ceil(total / PER_PAGE);
  const hasActiveFilters = filters.language || filters.yearMin || filters.yearMax || filters.firstTranslation || filters.hasTranslation;

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const buildQueryString = useCallback((params: {
    sort: string; query: string; page: number; filters: Filters;
  }) => {
    const qs = new URLSearchParams();
    if (params.sort !== 'popular') qs.set('sort', params.sort);
    if (params.filters.language) qs.set('language', params.filters.language);
    if (params.query) qs.set('q', params.query);
    if (params.page > 1) qs.set('page', String(params.page));
    if (params.filters.yearMin) qs.set('year_min', params.filters.yearMin);
    if (params.filters.yearMax) qs.set('year_max', params.filters.yearMax);
    if (params.filters.firstTranslation) qs.set('first_translation', '1');
    if (params.filters.hasTranslation) qs.set('has_translation', '1');
    return qs;
  }, []);

  const fetchBooks = useCallback(async (params: {
    sort: string; query: string; page: number; filters: Filters;
  }) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const qs = buildQueryString(params);
      const res = await fetch(`/api/catalog/browse?${qs.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setBooks(data.books || []);
      setTotal(data.total || 0);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [buildQueryString]);

  const fetchContentMatches = useCallback(async (q: string, lang: string) => {
    if (contentAbortRef.current) contentAbortRef.current.abort();
    if (!q || q.length < 3) {
      setContentMatches([]);
      setContentTotal(0);
      return;
    }
    const controller = new AbortController();
    contentAbortRef.current = controller;
    setContentLoading(true);
    try {
      const qs = new URLSearchParams({ q, limit: '10', search_content: '1' });
      if (lang) qs.set('language', lang);
      const res = await fetch(`/api/search?${qs.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error('search failed');
      const data = await res.json();
      const pageResults = (data.results || []).filter((r: any) => r.type === 'page');
      setContentMatches(pageResults);
      setContentTotal(data.total || 0);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      if (!controller.signal.aborted) setContentLoading(false);
    }
  }, []);

  // Initialize from URL params
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlSort = params.get('sort') || 'title';
    const urlQ = params.get('q') || '';
    const urlPage = parseInt(params.get('page') || '1', 10);
    const urlFilters: Filters = {
      language: params.get('language') || '',
      yearMin: params.get('year_min') || '',
      yearMax: params.get('year_max') || '',
      firstTranslation: params.get('first_translation') === '1',
      hasTranslation: params.get('has_translation') === '1',
    };
    setSort(urlSort);
    setQuery(urlQ);
    setCurrentPage(urlPage);
    setFilters(urlFilters);
    if (urlFilters.yearMin || urlFilters.yearMax || urlFilters.firstTranslation || urlFilters.hasTranslation) {
      setFiltersOpen(true);
    }
    const isDefault = urlSort === 'title' && !urlFilters.language && !urlQ && urlPage === 1 && !urlFilters.yearMin && !urlFilters.yearMax && !urlFilters.firstTranslation && !urlFilters.hasTranslation;
    if (!isDefault) {
      fetchBooks({ sort: urlSort, query: urlQ, page: urlPage, filters: urlFilters });
      if (urlQ && urlQ.length >= 3) fetchContentMatches(urlQ, urlFilters.language);
    }
  }, [fetchBooks, fetchContentMatches]);

  const updateUrl = useCallback((s: string, page: number, q: string, f: Filters) => {
    const params = new URLSearchParams();
    if (s !== 'title') params.set('sort', s);
    if (f.language) params.set('language', f.language);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', String(page));
    if (f.yearMin) params.set('year_min', f.yearMin);
    if (f.yearMax) params.set('year_max', f.yearMax);
    if (f.firstTranslation) params.set('first_translation', '1');
    if (f.hasTranslation) params.set('has_translation', '1');
    const qs = params.toString();
    window.history.replaceState(null, '', `/catalog/scholar${qs ? `?${qs}` : ''}`);
  }, []);

  const doFetch = useCallback((newSort: string, newQuery: string, newPage: number, newFilters: Filters) => {
    updateUrl(newSort, newPage, newQuery, newFilters);
    fetchBooks({ sort: newSort, query: newQuery, page: newPage, filters: newFilters });
  }, [updateUrl, fetchBooks]);

  const handleSort = useCallback((newSort: string) => {
    setSort(newSort);
    setCurrentPage(1);
    doFetch(newSort, query, 1, filters);
  }, [query, filters, doFetch]);

  const handleColumnSort = (column: string) => {
    if (column === 'year') handleSort(sort === 'year_asc' ? 'year_desc' : 'year_asc');
    else if (column === 'title') handleSort('title');
    else if (column === 'author') handleSort('author');
  };

  const handleFilterChange = useCallback((key: keyof Filters, value: string | boolean) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    setCurrentPage(1);
    setTitlePrefix('');
    doFetch(sort, query, 1, newFilters);
    if (key === 'language' && query.length >= 3) fetchContentMatches(query, newFilters.language);
  }, [sort, query, filters, doFetch, fetchContentMatches]);

  const handleCenturyClick = useCallback((min: number, max: number) => {
    const newFilters = { ...filters, yearMin: String(min), yearMax: String(max) };
    setFilters(newFilters);
    setCurrentPage(1);
    setTitlePrefix('');
    doFetch(sort, query, 1, newFilters);
  }, [sort, query, filters, doFetch]);

  const clearDateFilter = useCallback(() => {
    const newFilters = { ...filters, yearMin: '', yearMax: '' };
    setFilters(newFilters);
    setCurrentPage(1);
    doFetch(sort, query, 1, newFilters);
  }, [sort, query, filters, doFetch]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
    setTitlePrefix('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doFetch(sort, value, 1, filters);
      fetchContentMatches(value, filters.language);
    }, 300);
  }, [sort, filters, doFetch, fetchContentMatches]);

  const handleLetterFilter = useCallback((letter: string) => {
    const newPrefix = titlePrefix === letter ? '' : letter;
    setTitlePrefix(newPrefix);
    setCurrentPage(1);
    const q = newPrefix || '';
    setQuery(q);
    setContentMatches([]);
    setContentTotal(0);
    doFetch(sort, q, 1, filters);
  }, [titlePrefix, sort, filters, doFetch]);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, page, query, filters);
    fetchBooks({ sort, query, page, filters });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sort, query, filters, updateUrl, fetchBooks]);

  const clearAll = useCallback(() => {
    const defaultFilters: Filters = { language: '', yearMin: '', yearMax: '', firstTranslation: false, hasTranslation: false };
    setQuery('');
    setTitlePrefix('');
    setCurrentPage(1);
    setFilters(defaultFilters);
    setContentMatches([]);
    setContentTotal(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doFetch(sort, '', 1, defaultFilters);
    searchRef.current?.focus();
  }, [sort, doFetch]);

  const csvUrl = `/api/catalog/csv${filters.language ? `?language=${encodeURIComponent(filters.language)}` : ''}`;

  // Display year or published field
  const displayYear = (book: BookItem) => {
    if (book.year) return book.year;
    if (book.published) return book.published;
    return '—';
  };

  return (
    <div>
      {/* Search bar — prominent */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search titles, authors, and page content...  (press /)"
          className="w-full text-base border border-border-light rounded-xl pl-12 pr-10 py-3 bg-white text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-rust focus:ring-1 focus:ring-accent-rust/20"
        />
        {query && (
          <button
            onClick={clearAll}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {query || hasActiveFilters
              ? `${total.toLocaleString('en-US')} of ${initialTotal.toLocaleString('en-US')} books`
              : `${total.toLocaleString('en-US')} books`}
          </p>
          <a
            href={csvUrl}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent-rust transition-colors"
            title="Download catalog as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </a>
          <Link href="/catalog" className="text-xs text-muted hover:text-accent-rust transition-colors">
            Grid view
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Sort */}
          <select
            value={sort}
            onChange={e => handleSort(e.target.value)}
            className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-accent-rust cursor-pointer"
          >
            <option value="title">Title A-Z</option>
            <option value="author">Author A-Z</option>
            <option value="year_asc">Year (oldest)</option>
            <option value="year_desc">Year (newest)</option>
            <option value="popular">Most read</option>
            <option value="recent">Recently added</option>
            <option value="last_translated">Recently translated</option>
          </select>

          {/* Language filter */}
          <select
            value={filters.language}
            onChange={e => handleFilterChange('language', e.target.value)}
            className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-accent-rust cursor-pointer"
          >
            <option value="">All languages</option>
            {languages.map(l => (
              <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
            ))}
          </select>

          {/* Filters toggle */}
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 cursor-pointer transition-colors ${
              hasActiveFilters
                ? 'border-accent-rust bg-accent-rust/5 text-accent-rust'
                : 'border-border-light text-secondary hover:border-accent-rust'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-accent-rust" />}
            <ChevronDown className={`w-3 h-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded filters */}
      {filtersOpen && (
        <div className="mb-6 p-4 rounded-lg border border-border-light bg-warm/30">
          <div className="flex flex-wrap items-end gap-4">
            {/* Date range */}
            <div>
              <label className="block text-xs text-muted mb-1">Publication period</label>
              <div className="flex flex-wrap gap-1.5">
                {CENTURIES.map(c => {
                  const isActive = filters.yearMin === String(c.min) && filters.yearMax === String(c.max);
                  return (
                    <button
                      key={c.label}
                      onClick={() => isActive ? clearDateFilter() : handleCenturyClick(c.min, c.max)}
                      className={`text-xs px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                        isActive ? 'bg-accent-rust/10 text-accent-rust font-medium' : 'text-muted hover:text-primary hover:bg-warm'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom year range */}
            <div>
              <label className="block text-xs text-muted mb-1">Year range</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={filters.yearMin}
                  onChange={e => handleFilterChange('yearMin', e.target.value)}
                  placeholder="From"
                  className="w-20 text-xs border border-border-light rounded-lg px-2 py-1.5 bg-white text-primary focus:outline-none focus:border-accent-rust"
                />
                <span className="text-muted text-xs">—</span>
                <input
                  type="number"
                  value={filters.yearMax}
                  onChange={e => handleFilterChange('yearMax', e.target.value)}
                  placeholder="To"
                  className="w-20 text-xs border border-border-light rounded-lg px-2 py-1.5 bg-white text-primary focus:outline-none focus:border-accent-rust"
                />
              </div>
            </div>

            {/* Boolean filters */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.hasTranslation}
                  onChange={e => handleFilterChange('hasTranslation', e.target.checked)}
                  className="rounded border-border-light accent-accent-rust"
                />
                Has translation
              </label>
              <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.firstTranslation}
                  onChange={e => handleFilterChange('firstTranslation', e.target.checked)}
                  className="rounded border-border-light accent-accent-rust"
                />
                First English translation
              </label>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearAll}
                className="text-xs text-accent-rust hover:underline cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Alphabetical quick-jump */}
      <div className="flex flex-wrap gap-1 mb-6">
        <button
          onClick={() => handleLetterFilter('')}
          className={`px-2.5 py-1 text-xs rounded-lg cursor-pointer transition-colors ${
            !titlePrefix ? 'bg-accent-rust/10 text-accent-rust font-medium' : 'text-muted hover:text-primary'
          }`}
        >
          All
        </button>
        {LETTERS.map(letter => (
          <button
            key={letter}
            onClick={() => handleLetterFilter(letter)}
            className={`w-7 h-7 text-xs rounded-lg cursor-pointer transition-colors ${
              titlePrefix === letter ? 'bg-accent-rust/10 text-accent-rust font-medium' : 'text-muted hover:text-primary'
            }`}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Content matches (when searching 3+ chars) */}
      {contentMatches.length > 0 && (
        <div className="mb-8 p-4 rounded-lg border border-border-light bg-warm/30">
          <h3 className="text-xs uppercase tracking-wide text-muted font-medium mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Content matches ({contentTotal.toLocaleString('en-US')} results)
          </h3>
          <div className="space-y-2">
            {contentMatches.map((match, i) => {
              const href = match.page_number
                ? `/book/${match.slug || match.book_id}/page/${match.page_number}`
                : `/book/${match.slug || match.book_id}`;
              return (
                <div key={`${match.book_id}-${match.page_number}-${i}`} className="text-sm">
                  <Link href={href} className="hover:text-accent-rust transition-colors">
                    <span className="font-medium text-primary" style={{ fontFamily: 'var(--font-serif)' }}>
                      {match.display_title || match.title}
                    </span>
                    {match.page_number && <span className="text-muted ml-1">p. {match.page_number}</span>}
                    {match.author && <span className="text-secondary ml-2">— {match.author}</span>}
                  </Link>
                  {match.snippet && (
                    <p className="text-xs text-muted mt-0.5 line-clamp-2 pl-4 border-l-2 border-border-light">
                      ...{match.snippet}...
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {contentTotal > 10 && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}${filters.language ? `&language=${filters.language}` : ''}`}
              className="inline-block mt-3 text-xs text-accent-rust hover:underline"
            >
              See all {contentTotal.toLocaleString('en-US')} content matches →
            </Link>
          )}
        </div>
      )}
      {contentLoading && query.length >= 3 && (
        <div className="mb-8 p-4 rounded-lg border border-border-light bg-warm/30">
          <p className="text-xs text-muted">Searching page content...</p>
        </div>
      )}

      {/* Book table */}
      <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
        {books.length === 0 && !loading ? (
          <div className="py-20 text-center text-muted">No books match your filters.</div>
        ) : (
          <>
          {/* Mobile (<md): stacked list + a sort control, since a table reads
              cramped on a phone. Desktop keeps the sortable table below. */}
          <div className="md:hidden">
            <div className="mb-3 flex items-center gap-2">
              <label htmlFor="mobile-sort" className="text-xs text-muted uppercase tracking-wide">Sort</label>
              <select
                id="mobile-sort"
                value={sort}
                onChange={(e) => handleSort(e.target.value)}
                className="text-sm border border-border-medium rounded px-2 py-1 bg-white text-primary"
              >
                <option value="title">Title</option>
                <option value="year_asc">Year (oldest first)</option>
                <option value="year_desc">Year (newest first)</option>
                <option value="author">Author</option>
                <option value="popular">Most read</option>
                <option value="recent">Recently added</option>
              </select>
            </div>
            <ul className="divide-y divide-border-light">
              {books.map((book) => {
                const href = `/book/${book.slug || book.id}`;
                return (
                  <li key={book.id}>
                    <Link href={href} className="block py-3 active:bg-warm/50 transition-colors">
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-medium text-primary line-clamp-2 flex-1" style={{ fontFamily: 'var(--font-serif)' }}>
                          {book.display_title || book.title}
                        </span>
                        {isPublishedFirstTranslation(book) && (
                          <span className="shrink-0 inline-block bg-accent-gold/15 text-accent-gold-dark text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                            {(() => { const ft = ftRenderProps(book); return firstTranslationBadge(ft.disposition, book.language ?? undefined, undefined, ft.claim); })()}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-1.5">
                        <AuthorName author={book.author} fallback="—" />
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{displayYear(book)}</span>
                        {book.language && (<><span aria-hidden>·</span><span>{book.language}</span></>)}
                        {book.pages_count ? (<><span aria-hidden>·</span><span className="tabular-nums">{book.pages_count} pp</span></>) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          {/* Desktop (md+): sortable table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-medium text-xs text-muted uppercase tracking-wide">
                  <th className="pb-3 pr-4 font-medium w-[45%]">
                    <button onClick={() => handleColumnSort('title')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Title <SortIcon column="title" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium hidden sm:table-cell">
                    <button onClick={() => handleColumnSort('author')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Author <SortIcon column="author" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium w-20">
                    <button onClick={() => handleColumnSort('year')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Year <SortIcon column="year" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium hidden md:table-cell w-24">Language</th>
                  <th className="pb-3 font-medium hidden lg:table-cell w-20 text-right">Pages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {books.map((book) => {
                  const href = `/book/${book.slug || book.id}`;
                  return (
                    <tr key={book.id} className="group hover:bg-warm/50 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Link href={href} className="block">
                            <span className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors line-clamp-1" style={{ fontFamily: 'var(--font-serif)' }}>
                              {book.display_title || book.title}
                            </span>
                          </Link>
                          {isPublishedFirstTranslation(book) && (
                            <span className="shrink-0 inline-block bg-accent-gold/15 text-accent-gold-dark text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                              {(() => { const ft = ftRenderProps(book); return firstTranslationBadge(ft.disposition, book.language ?? undefined, undefined, ft.claim); })()}
                            </span>
                          )}
                          <CopyPermalink slug={book.slug} id={book.id} />
                        </div>
                        <span className="block sm:hidden text-xs text-muted mt-0.5 line-clamp-1">
                          <AuthorName author={book.author} fallback="" />
                          {book.year ? `, ${book.year}` : ''}
                        </span>
                      </td>
                      <td className="py-3 pr-4 hidden sm:table-cell">
                        <Link href={href} className="text-sm text-secondary line-clamp-1 block">
                          <AuthorName author={book.author} fallback="—" />
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-sm text-muted tabular-nums">
                        <Link href={href} className="block">
                          {displayYear(book)}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 hidden md:table-cell">
                        <Link href={href} className="block">
                          <span className="text-xs text-muted bg-warm px-2 py-0.5 rounded">{book.language || '—'}</span>
                        </Link>
                      </td>
                      <td className="py-3 hidden lg:table-cell text-right">
                        <Link href={href} className="block text-sm text-muted tabular-nums">{book.pages_count || '—'}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <CatalogPagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePage} />
    </div>
  );
}
