'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Search, X, Download, Copy, Check,
  ArrowUpDown, ArrowUp, ArrowDown, FileText,
} from 'lucide-react';
import AuthorName from '@/components/AuthorName';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import CatalogPagination from '@/components/collections/CatalogPagination';

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
      className="inline-flex items-center gap-1 text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
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
      if (params.sort !== 'popular') qs.set('sort', params.sort);
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

  // Full-text content search (parallel to catalog search)
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
      if (urlQ && urlQ.length >= 3) fetchContentMatches(urlQ, urlLang);
    }
  }, [fetchBooks, fetchContentMatches]);

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
    if (column === 'year') handleSort(sort === 'year_asc' ? 'year_desc' : 'year_asc');
    else if (column === 'title') handleSort('title');
    else if (column === 'author') handleSort('author');
  };

  const handleLanguage = useCallback((newLang: string) => {
    setLanguage(newLang);
    setCurrentPage(1);
    setTitlePrefix('');
    updateUrl(sort, newLang, 1, query);
    fetchBooks({ sort, language: newLang, query, page: 1 });
    if (query.length >= 3) fetchContentMatches(query, newLang);
  }, [sort, query, updateUrl, fetchBooks, fetchContentMatches]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
    setTitlePrefix('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateUrl(sort, language, 1, value);
      fetchBooks({ sort, language, query: value, page: 1 });
      fetchContentMatches(value, language);
    }, 300);
  }, [sort, language, updateUrl, fetchBooks, fetchContentMatches]);

  const handleLetterFilter = useCallback((letter: string) => {
    const newPrefix = titlePrefix === letter ? '' : letter;
    setTitlePrefix(newPrefix);
    setCurrentPage(1);
    const q = newPrefix || '';
    setQuery(q);
    setContentMatches([]);
    setContentTotal(0);
    updateUrl(sort, language, 1, q);
    fetchBooks({ sort, language, query: q, page: 1 });
  }, [titlePrefix, sort, language, updateUrl, fetchBooks]);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, language, page, query);
    fetchBooks({ sort, language, query, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sort, language, query, updateUrl, fetchBooks]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setTitlePrefix('');
    setCurrentPage(1);
    setContentMatches([]);
    setContentTotal(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateUrl(sort, language, 1, '');
    fetchBooks({ sort, language, query: '', page: 1 });
    searchRef.current?.focus();
  }, [sort, language, updateUrl, fetchBooks]);

  const csvUrl = `/api/catalog/csv${language ? `?language=${encodeURIComponent(language)}` : ''}`;

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {query || language
              ? `${total.toLocaleString()} of ${initialTotal.toLocaleString()} books`
              : `${total.toLocaleString()} books`}
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
            value={language}
            onChange={e => handleLanguage(e.target.value)}
            className="text-sm border border-border-light rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-accent-rust cursor-pointer"
          >
            <option value="">All languages</option>
            {languages.map(l => (
              <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
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
              placeholder="Search titles, authors, and content...  (/)"
              className="text-sm border border-border-light rounded-lg pl-8 pr-8 py-1.5 bg-white text-primary placeholder:text-muted/60 focus:outline-none focus:border-accent-rust w-56 sm:w-72"
            />
            {query && (
              <button
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

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
            Content matches ({contentTotal.toLocaleString()} results)
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
              href={`/search?q=${encodeURIComponent(query)}${language ? `&language=${language}` : ''}`}
              className="inline-block mt-3 text-xs text-accent-rust hover:underline"
            >
              See all {contentTotal.toLocaleString()} content matches →
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
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-medium text-xs text-muted uppercase tracking-wide">
                  <th className="pb-3 pr-4 font-medium w-[40%]">
                    <button onClick={() => handleColumnSort('title')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Title <SortIcon column="title" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium hidden sm:table-cell w-[20%]">
                    <button onClick={() => handleColumnSort('author')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Author <SortIcon column="author" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium w-16">
                    <button onClick={() => handleColumnSort('year')} className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer">
                      Year <SortIcon column="year" currentSort={sort} />
                    </button>
                  </th>
                  <th className="pb-3 pr-4 font-medium hidden md:table-cell w-24">Language</th>
                  <th className="pb-3 pr-4 font-medium hidden lg:table-cell w-16 text-right">Pages</th>
                  <th className="pb-3 font-medium hidden lg:table-cell w-20 text-right">Translated</th>
                  <th className="pb-3 font-medium hidden xl:table-cell w-28">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {books.map((book) => {
                  const pct = translationPercent(book);
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
                          {book.is_first_translation && (
                            <span className="shrink-0 inline-block bg-accent-gold/15 text-accent-gold-dark text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                              {firstTranslationBadge(book.ft_disposition, book.language ?? undefined)}
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
                        <Link href={href} className="block">{book.year || '—'}</Link>
                      </td>
                      <td className="py-3 pr-4 hidden md:table-cell">
                        <Link href={href} className="block">
                          <span className="text-xs text-muted bg-warm px-2 py-0.5 rounded">{book.language || '—'}</span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4 hidden lg:table-cell text-right">
                        <Link href={href} className="block text-sm text-muted tabular-nums">{book.pages_count || '—'}</Link>
                      </td>
                      <td className="py-3 hidden lg:table-cell text-right">
                        <Link href={href} className="block text-sm tabular-nums">
                          {pct > 0 ? (
                            <span className={pct === 100 ? 'text-green-700' : 'text-muted'}>{pct}%</span>
                          ) : (
                            <span className="text-muted/40">—</span>
                          )}
                        </Link>
                      </td>
                      <td className="py-3 hidden xl:table-cell">
                        {book.image_source_provider ? (
                          <span className="text-[11px] text-muted/60 truncate block max-w-[100px]" title={book.image_source_provider}>
                            {book.image_source_provider}
                          </span>
                        ) : (
                          <span className="text-muted/40">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CatalogPagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePage} />
    </div>
  );
}
