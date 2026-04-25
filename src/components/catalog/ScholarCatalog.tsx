'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Search, X, Download, Copy, Check, ChevronLeft, ChevronRight,
  BookOpen, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import AuthorName from '@/components/AuthorName';
import { firstTranslationBadge } from '@/lib/first-translation-labels';

const PER_PAGE = 60;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
  published?: string | null;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  image_source_provider?: string | null;
  categories?: string[];
  collections?: string[];
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
    language: ['language'],
    pages: ['pages'],
  };
  const isActive = mapping[column]?.includes(currentSort);
  if (!isActive) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
  if (currentSort === 'year_desc') return <ArrowDown className="w-3 h-3" />;
  return <ArrowUp className="w-3 h-3" />;
}

function translationPercent(book: BookItem): number {
  const denom = Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1);
  return book.pages_translated ? Math.round((book.pages_translated / denom) * 100) : 0;
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
      className="inline-flex items-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      style={{ color: 'var(--text-muted)' }}
      title={`Copy permalink: ${url}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Link'}
    </button>
  );
}

export default function ScholarCatalog({ initialBooks, initialTotal, languages }: ScholarCatalogProps) {
  const [books, setBooks] = useState<BookItem[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('title');
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [titlePrefix, setTitlePrefix] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalPages = Math.ceil(total / PER_PAGE);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
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

  const fetchBooks = useCallback(async (params: {
    sort: string; language: string; query: string; page: number;
  }) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('sort', params.sort);
      if (params.language) qs.set('language', params.language);
      if (params.query) qs.set('q', params.query);
      if (params.page > 1) qs.set('page', String(params.page));
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
  }, []);

  // Initialize from URL params
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlSort = params.get('sort') || 'title';
    const urlLang = params.get('language') || '';
    const urlQ = params.get('q') || '';
    const urlPage = parseInt(params.get('page') || '1', 10);
    setSort(urlSort);
    setLanguage(urlLang);
    setQuery(urlQ);
    setCurrentPage(urlPage);
    const isDefault = urlSort === 'title' && !urlLang && !urlQ && urlPage === 1;
    if (!isDefault) {
      fetchBooks({ sort: urlSort, language: urlLang, query: urlQ, page: urlPage });
    }
  }, [fetchBooks]);

  const updateUrl = useCallback((s: string, lang: string, page: number, q: string) => {
    const params = new URLSearchParams();
    if (s !== 'title') params.set('sort', s);
    if (lang) params.set('language', lang);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    window.history.replaceState(null, '', `/catalog/scholar${qs ? `?${qs}` : ''}`);
  }, []);

  const handleSort = useCallback((newSort: string) => {
    setSort(newSort);
    setCurrentPage(1);
    updateUrl(newSort, language, 1, query);
    fetchBooks({ sort: newSort, language, query, page: 1 });
  }, [language, query, updateUrl, fetchBooks]);

  const handleColumnSort = (column: string) => {
    if (column === 'year') {
      handleSort(sort === 'year_asc' ? 'year_desc' : 'year_asc');
    } else if (column === 'title') {
      handleSort('title');
    } else if (column === 'author') {
      handleSort('author');
    }
  };

  const handleLanguage = useCallback((newLang: string) => {
    setLanguage(newLang);
    setCurrentPage(1);
    setTitlePrefix('');
    updateUrl(sort, newLang, 1, query);
    fetchBooks({ sort, language: newLang, query, page: 1 });
  }, [sort, query, updateUrl, fetchBooks]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
    setTitlePrefix('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateUrl(sort, language, 1, value);
      fetchBooks({ sort, language, query: value, page: 1 });
    }, 300);
  }, [sort, language, updateUrl, fetchBooks]);

  const handleLetterFilter = useCallback((letter: string) => {
    const newPrefix = titlePrefix === letter ? '' : letter;
    setTitlePrefix(newPrefix);
    setCurrentPage(1);
    const q = newPrefix ? `${newPrefix}` : '';
    setQuery(q);
    updateUrl(sort, language, 1, q);
    fetchBooks({ sort, language, query: q, page: 1 });
  }, [titlePrefix, sort, language, updateUrl, fetchBooks]);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, language, page, query);
    fetchBooks({ sort, language, query, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sort, language, query, updateUrl, fetchBooks]);

  const csvUrl = `/api/catalog/csv${language ? `?language=${encodeURIComponent(language)}` : ''}`;

  return (
    <div className="min-h-screen" style={{ background: '#fff' }}>
      {/* Minimal header */}
      <header className="border-b" style={{ borderColor: '#e5e5e5' }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <BookOpen className="w-5 h-5" style={{ color: '#8B4513' }} />
              <span className="text-lg font-semibold tracking-tight" style={{ color: '#1a1a1a' }}>
                Source Library
              </span>
            </Link>
            <span style={{ color: '#ccc' }}>/</span>
            <span className="text-sm" style={{ color: '#666' }}>Scholar Catalog</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm" style={{ color: '#666' }}>
            <Link href="/catalog" className="hover:underline">Standard view</Link>
            <Link href="/browse" className="hover:underline">Browse indexes</Link>
            <Link href="/search" className="hover:underline">Full-text search</Link>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Title area */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: '#1a1a1a' }}>
            Catalog
          </h1>
          <p className="text-sm" style={{ color: '#888' }}>
            {total.toLocaleString()} works.{' '}
            Bibliographic records with permalinks, OCR status, and translation coverage.
          </p>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b" style={{ borderColor: '#e5e5e5' }}>
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#999' }} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search by title or author...  (press /)"
              className="w-full text-sm border rounded-md pl-9 pr-8 py-2 focus:outline-none focus:ring-1"
              style={{
                borderColor: '#ddd',
                color: '#1a1a1a',
                background: '#fafafa',
              }}
              onFocus={e => (e.target.style.borderColor = '#8B4513')}
              onBlur={e => (e.target.style.borderColor = '#ddd')}
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setTitlePrefix('');
                  setCurrentPage(1);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  updateUrl(sort, language, 1, '');
                  fetchBooks({ sort, language, query: '', page: 1 });
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                style={{ color: '#999' }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Language */}
          <select
            value={language}
            onChange={e => handleLanguage(e.target.value)}
            className="text-sm border rounded-md px-3 py-2 cursor-pointer focus:outline-none focus:ring-1"
            style={{ borderColor: '#ddd', color: '#333', background: '#fafafa' }}
          >
            <option value="">All languages</option>
            {languages.map(l => (
              <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => handleSort(e.target.value)}
            className="text-sm border rounded-md px-3 py-2 cursor-pointer focus:outline-none focus:ring-1"
            style={{ borderColor: '#ddd', color: '#333', background: '#fafafa' }}
          >
            <option value="title">Title A-Z</option>
            <option value="author">Author A-Z</option>
            <option value="year_asc">Year (oldest first)</option>
            <option value="year_desc">Year (newest first)</option>
            <option value="popular">Most read</option>
            <option value="recent">Recently added</option>
            <option value="last_translated">Recently translated</option>
          </select>

          {/* Export */}
          <div className="flex items-center gap-2 ml-auto">
            <a
              href={csvUrl}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border rounded-md hover:bg-gray-50 transition-colors"
              style={{ borderColor: '#ddd', color: '#666' }}
              title="Download as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </a>
          </div>
        </div>

        {/* Alphabetical quick-jump */}
        <div className="flex flex-wrap gap-1 mb-5">
          <button
            onClick={() => handleLetterFilter('')}
            className={`px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
              !titlePrefix ? 'font-semibold' : ''
            }`}
            style={{
              color: !titlePrefix ? '#fff' : '#666',
              background: !titlePrefix ? '#8B4513' : 'transparent',
            }}
          >
            All
          </button>
          {LETTERS.map(letter => (
            <button
              key={letter}
              onClick={() => handleLetterFilter(letter)}
              className={`w-7 h-7 text-xs rounded cursor-pointer transition-colors ${
                titlePrefix === letter ? 'font-semibold' : ''
              }`}
              style={{
                color: titlePrefix === letter ? '#fff' : '#666',
                background: titlePrefix === letter ? '#8B4513' : 'transparent',
              }}
            >
              {letter}
            </button>
          ))}
        </div>

        {/* Results table */}
        <div className={`${loading ? 'opacity-50' : ''} transition-opacity`}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs uppercase tracking-wider border-b" style={{ color: '#888', borderColor: '#e5e5e5' }}>
                <th className="pb-2 pr-3 font-medium w-[40%]">
                  <button onClick={() => handleColumnSort('title')} className="flex items-center gap-1 cursor-pointer hover:opacity-70">
                    Title <SortIcon column="title" currentSort={sort} />
                  </button>
                </th>
                <th className="pb-2 pr-3 font-medium hidden sm:table-cell w-[20%]">
                  <button onClick={() => handleColumnSort('author')} className="flex items-center gap-1 cursor-pointer hover:opacity-70">
                    Author <SortIcon column="author" currentSort={sort} />
                  </button>
                </th>
                <th className="pb-2 pr-3 font-medium w-16">
                  <button onClick={() => handleColumnSort('year')} className="flex items-center gap-1 cursor-pointer hover:opacity-70">
                    Year <SortIcon column="year" currentSort={sort} />
                  </button>
                </th>
                <th className="pb-2 pr-3 font-medium hidden md:table-cell w-24">Language</th>
                <th className="pb-2 pr-3 font-medium hidden lg:table-cell w-16 text-right">Pages</th>
                <th className="pb-2 font-medium hidden lg:table-cell w-20 text-right">Translated</th>
                <th className="pb-2 font-medium hidden xl:table-cell w-28">Source</th>
              </tr>
            </thead>
            <tbody>
              {books.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm" style={{ color: '#999' }}>
                    No results found.
                  </td>
                </tr>
              ) : (
                books.map((book) => {
                  const pct = translationPercent(book);
                  const href = `/book/${book.slug || book.id}`;
                  const fullUrl = `https://sourcelibrary.org${href}`;
                  return (
                    <tr
                      key={book.id}
                      className="group border-b hover:bg-gray-50/50 transition-colors"
                      style={{ borderColor: '#f0f0f0' }}
                    >
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={href}
                            className="text-sm hover:underline decoration-1 underline-offset-2 line-clamp-1"
                            style={{ color: '#1a1a1a' }}
                          >
                            {book.display_title || book.title}
                          </Link>
                          {book.is_first_translation && (
                            <span
                              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: '#f5e6d3', color: '#8B6914' }}
                            >
                              {firstTranslationBadge(book.ft_disposition, book.language)}
                            </span>
                          )}
                          <CopyPermalink slug={book.slug} id={book.id} />
                        </div>
                        {/* Author on mobile */}
                        <span className="block sm:hidden text-xs mt-0.5" style={{ color: '#888' }}>
                          <AuthorName author={book.author} fallback="" />
                          {book.year ? `, ${book.year}` : ''}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 hidden sm:table-cell">
                        <span className="text-sm line-clamp-1" style={{ color: '#555' }}>
                          <AuthorName author={book.author} fallback="--" />
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-sm tabular-nums" style={{ color: '#666' }}>
                        {book.year || '--'}
                      </td>
                      <td className="py-2.5 pr-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#f5f5f5', color: '#666' }}>
                          {book.language || '--'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 hidden lg:table-cell text-right text-sm tabular-nums" style={{ color: '#666' }}>
                        {book.pages_count || '--'}
                      </td>
                      <td className="py-2.5 hidden lg:table-cell text-right">
                        {pct > 0 ? (
                          <span className="text-sm tabular-nums" style={{ color: pct === 100 ? '#16a34a' : '#888' }}>
                            {pct}%
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: '#ccc' }}>--</span>
                        )}
                      </td>
                      <td className="py-2.5 hidden xl:table-cell">
                        {book.image_source_provider ? (
                          <span className="text-[11px] truncate block max-w-[100px]" style={{ color: '#999' }} title={book.image_source_provider}>
                            {book.image_source_provider}
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: '#ccc' }}>--</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t" style={{ borderColor: '#e5e5e5' }}>
            <p className="text-xs" style={{ color: '#888' }}>
              Page {currentPage} of {totalPages} ({total.toLocaleString()} works)
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {/* Page numbers */}
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (currentPage <= 4) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = currentPage - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePage(pageNum)}
                    className={`w-8 h-8 text-xs rounded cursor-pointer transition-colors ${
                      pageNum === currentPage ? 'font-semibold' : 'hover:bg-gray-100'
                    }`}
                    style={{
                      color: pageNum === currentPage ? '#fff' : '#666',
                      background: pageNum === currentPage ? '#8B4513' : 'transparent',
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => handlePage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t text-xs" style={{ borderColor: '#e5e5e5', color: '#aaa' }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              Source Library — {total.toLocaleString()} digitized primary sources with OCR and English translation.
            </div>
            <div className="flex items-center gap-4">
              <a href="/api/catalog/csv" className="hover:underline">Full CSV export</a>
              <Link href="/catalog" className="hover:underline">Standard catalog</Link>
              <Link href="/browse" className="hover:underline">Browse indexes</Link>
              <Link href="/search" className="hover:underline">Search</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
