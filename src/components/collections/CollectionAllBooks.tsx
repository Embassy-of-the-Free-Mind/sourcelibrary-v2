'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ArrowRight, Search, X, LayoutGrid, List } from 'lucide-react';
import Link from 'next/link';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import { bookTitle } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';

const PER_PAGE = 60;

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  editor?: string;
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
  relevance?: number;
  created_at?: string;
  last_translation_at?: string;
  resource_type?: string;
  commons_width?: number;
  commons_height?: number;
}

interface CollectionAllBooksProps {
  collectionId: string;
  compactBooks: BookItem[];
  total: number;
  languages: { lang: string; count: number }[];
  collectionType?: string;
  /** Tenant provider filter (e.g. "bph") — restricts books to a specific library */
  provider?: string;
  /**
   * Curated override for the size-based view default (#4350): a collection
   * whose covers carry the meaning — the cuneiform tablet corpora, for one —
   * leads with the grid however many books it holds. From the collection
   * doc's `all_books_default_view`; the reader's own toggle still wins.
   */
  defaultView?: 'grid' | 'list';
}

type ViewMode = 'grid' | 'list';

function getStoredView(): ViewMode | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sl-collection-view') as ViewMode | null;
}

// Client-side sort comparators
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
    case 'relevance':
    default:
      return sorted.sort((a, b) => (b.relevance || 0) - (a.relevance || 0) || (b.read_count || 0) - (a.read_count || 0));
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

export default function CollectionAllBooks({
  collectionId,
  compactBooks,
  total,
  languages,
  collectionType,
  provider,
  defaultView,
}: CollectionAllBooksProps) {
  const isArt = collectionType === 'visual_art';
  const itemLabel = isArt ? 'works' : 'books';
  // Art collections always lead with the image grid — the pictures ARE the
  // point. The list default (below) is a readability aid for long *book*
  // catalogues only; on a visual-art collection it renders as a text list and
  // reads as "a catalogue, not pictures" (user feedback on ficinos-florence).
  // A curated defaultView (tablet corpora, #4350) outranks the size rule.
  const sizeDefault: ViewMode = defaultView ?? (isArt ? 'grid' : (total > 200 ? 'list' : 'grid'));

  const [expanded, setExpanded] = useState(false);
  const [allBooks, setAllBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('relevance');
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>(sizeDefault);
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // Fetch all books on expand (manifest mode — one request, then all client-side)
  const fetchManifest = useCallback(async () => {
    setLoading(true);
    try {
      const providerParam = provider ? `&provider=${provider}` : '';
      const res = await fetch(`/api/collections/${collectionId}?mode=manifest${providerParam}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      // For book collections, filter out artworks — they have their own section.
      // For art collections, keep everything (all items have resource_type).
      const isArt = collectionType === 'visual_art';
      const books = isArt
        ? (data.books || [])
        : (data.books || []).filter((b: BookItem & { resource_type?: string }) => !b.resource_type);
      setAllBooks(books);
    } catch {
      // Manifest failed (timeout, etc.) — fall back to server-rendered compact books
      // so the page still shows something rather than "0 books"
      setAllBooks(prev => prev.length === 0 ? compactBooks : prev);
    } finally {
      setLoading(false);
    }
  }, [collectionId, compactBooks]);

  // Auto-expand and fetch manifest on mount.
  // Read URL params for deep-linked state (avoids useSearchParams SSR bailout).
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
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
    setViewMode(urlView || storedView || sizeDefault);

    setExpanded(true);
    fetchManifest();
  }, [fetchManifest, sizeDefault]);

  // Client-side filter → sort → paginate (instant, no network)
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
    if (s !== 'relevance') params.set('sort', s);
    if (lang) params.set('language', lang);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', String(page));
    if (view !== sizeDefault) params.set('view', view);
    const qs = params.toString();
    window.history.replaceState(null, '', `/collections/${collectionId}${qs ? `?${qs}` : ''}`);
  }, [collectionId, sizeDefault]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    fetchManifest();
    updateUrl('relevance', '', 1, '', viewMode);
  }, [fetchManifest, updateUrl, viewMode]);

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
    // URL update on every keystroke would be noisy — skip for search
  }, []);

  const handlePage = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl(sort, language, page, query, viewMode);
    document.getElementById('collection-all-books')?.scrollIntoView({ behavior: 'smooth' });
  }, [sort, language, query, updateUrl, viewMode]);

  const handleViewToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('sl-collection-view', mode);
    if (expanded) {
      updateUrl(sort, language, currentPage, query, mode);
    }
  }, [expanded, sort, language, currentPage, query, updateUrl]);

  const showSeeAllCard = !expanded && total > compactBooks.length;
  const displayBooks = expanded ? pageBooks : compactBooks;

  return (
    <div id="collection-all-books">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-baseline gap-4">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">
              All {isArt ? 'Works' : 'Books'}
            </h2>
            {isArt ? (
              <Link
                href="/artwork"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-accent-rust/30 text-accent-rust hover:bg-accent-rust hover:text-white transition-colors"
              >
                All Art Collections
                <span>&rarr;</span>
              </Link>
            ) : !expanded ? (
              <button
                type="button"
                onClick={() => { setExpanded(true); handleViewToggle('list'); }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-accent-rust/30 text-accent-rust hover:bg-accent-rust hover:text-white transition-colors cursor-pointer"
              >
                Browse Catalog
                <span>&rarr;</span>
              </button>
            ) : null}
          </div>
          <p className="text-sm text-muted mt-1">
            {expanded ? (
              loading
                ? `Loading ${total.toLocaleString('en-US')} ${itemLabel}…`
                : query || language
                  ? `${sorted.length.toLocaleString('en-US')} of ${allBooks.length.toLocaleString('en-US')} ${itemLabel}`
                  : `${allBooks.length.toLocaleString('en-US')} ${itemLabel} in this collection`
            ) : (
              `${total.toLocaleString('en-US')} ${itemLabel} in this collection`
            )}
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

            {/* Search — instant client-side filtering */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search title or author..."
                className="text-sm border border-border-light rounded-lg pl-8 pr-8 py-1.5 bg-white text-primary w-52 focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
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
              <option value="author">{isArt ? 'Artist' : 'Author'} A-Z</option>
              {!isArt && <option value="last_translated">Recently Translated</option>}
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
          fromCollection={collectionId}
        />
      ) : isArt ? (
        /* Art gallery grid — CSS grid with fixed row height for row-first loading.
           CSS columns fill top→bottom per column, so column 2-3 items load after
           all of column 1 — bad for above-the-fold performance. Grid fills
           left→right, top→bottom, matching natural DOM/loading order. */
        <div className={`bg-stone-950 -mx-4 sm:-mx-6 md:-mx-8 px-1 pt-1 pb-4 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 auto-rows-auto">
            {displayBooks.map((book, i) => {
              const thumb = getBookThumbnailUrl(book, 'thumb') || book.photo;
              const title = bookTitle(book);
              // For artworks, book.published is often the Wikimedia upload date (e.g. 2014),
              // not the creation date. Only use book.year (set by enrichment) for artworks.
              const isArtwork = !!book.resource_type;
              const year = isArtwork
                ? (book.year || 0)
                : (book.year || parseInt(book.published || '', 10) || 0);
              const isPortrait = (book as any).commons_height > (book as any).commons_width;
              return (
                <Link
                  key={book.id}
                  href={`/artwork/${book.slug || book.id}?from=${collectionId}`}
                  className="group block relative"
                >
                  <div className={`relative ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'} bg-stone-900`}>
                    {thumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumb}
                        alt={title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90 transition-opacity duration-300"
                        loading={i < 10 ? 'eager' : 'lazy'}
                        decoding="async"
                        fetchPriority={i < 5 ? 'high' : 'auto'}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <LayoutGrid className="w-8 h-8 text-stone-700" />
                      </div>
                    )}
                  </div>
                  <div className="px-1.5 py-1.5 bg-stone-950">
                    <h3
                      className="text-xs font-medium text-stone-300 leading-tight line-clamp-1"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {title}
                    </h3>
                    <p className="text-[10px] text-stone-500 line-clamp-1 mt-0.5">
                      {book.author}{year > 0 ? `, ${year}` : ''}
                    </p>
                  </div>
                </Link>
              );
            })}

            {/* "See all" card in compact view */}
            {showSeeAllCard && (
              <button
                onClick={handleExpand}
                className="group block aspect-[3/4] bg-stone-900 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-stone-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <ArrowRight className="w-5 h-5 text-stone-400" />
                </div>
                <span className="text-sm font-medium text-stone-300 group-hover:text-white transition-colors">
                  See all {total.toLocaleString('en-US')}
                </span>
                <span className="text-xs text-stone-500">{itemLabel}</span>
              </button>
            )}
          </div>
        </div>
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
                editor: book.editor,
                year: book.year || parseInt(book.published || '', 10) || 0,
                pages_count: book.pages_count,
                pages_ocr: book.pages_ocr,
                pages_translated: book.pages_translated,
                thumbnail: getBookThumbnailUrl(book) || book.photo || undefined,
                thumbnail_blob: book.thumbnail_blob,
                language: book.language,
                published: book.published,
                translation_percent: book.pages_ocr && book.pages_translated
                  ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
                  : 0,
                resource_type: book.resource_type,
              }}
              priority={!expanded && i < 4}
            />
          ))}

          {/* "See all" card in compact view — shows preview thumbnails */}
          {showSeeAllCard && (
            <button
              onClick={handleExpand}
              className="group flex flex-col items-center justify-center gap-3 rounded-xl border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all aspect-[3/4] cursor-pointer relative overflow-hidden"
            >
              {/* Mini thumbnail preview strip */}
              {compactBooks.length > 0 && (
                <div className="absolute top-0 left-0 right-0 flex">
                  {compactBooks.slice(0, 5).map((b) => (
                    <div key={b.id} className="flex-1 aspect-square relative opacity-15 group-hover:opacity-25 transition-opacity">
                      {getBookThumbnailUrl(b) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getBookThumbnailUrl(b)!}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="relative z-10 w-12 h-12 rounded-full bg-accent-rust/8 flex items-center justify-center group-hover:bg-accent-rust/15 transition-colors">
                <ArrowRight className="w-5 h-5 text-accent-rust" />
              </div>
              <div className="relative z-10 text-center px-3">
                <span className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors block">
                  See all {total.toLocaleString('en-US')}
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
          currentPage={safePage}
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
              setCurrentPage(1);
              setQuery('');
              setLanguage('');
              setSort('relevance');
              window.history.replaceState(null, '', `/collections/${collectionId}`);
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
