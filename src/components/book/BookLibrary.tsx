'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import BookCard from '@/components/book/BookCard';
import { Book } from '@/lib/types';
import { bookUrl } from '@/lib/slugify';

import { Search, Loader2, ExternalLink, BookOpen, Plus, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { catalog, importBooks, type CatalogResult } from '@/lib/api-client';

interface CollectionInfo {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
}

export interface CollectionForGrid {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
  hero_image: string | null;
  languages?: string[];
}

interface BookLibraryProps {
  initialBooks: Book[];
  totalBooks: number;
  languages: string[];
  collections?: CollectionForGrid[];
  recentlyTranslated?: Book[];
  newArrivals?: Book[];
}

type SortOption = 'recent-translation' | 'recent' | 'title-asc' | 'title-desc';

const DISPLAY_INCREMENT = 50;
const API_PAGE_SIZE = 100;

export default function BookLibrary({ initialBooks, totalBooks, languages, collections = [], recentlyTranslated = [], newArrivals = [] }: BookLibraryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedCollection, setSelectedCollection] = useState(() => {
    return searchParams.get('collection') || '';
  });
  const [collectionInfo, setCollectionInfo] = useState<CollectionInfo | null>(() => {
    const col = searchParams.get('collection');
    if (col) {
      const match = collections.find(c => c.slug === col);
      if (match) return { slug: match.slug, name: match.name, subtitle: match.subtitle, description: match.description, book_count: match.book_count };
    }
    return null;
  });
  const [introExpanded, setIntroExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('recent-translation');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_INCREMENT);
  const [browseAll, setBrowseAll] = useState(false);

  // API-fetched books state
  const [apiBooks, setApiBooks] = useState<Book[] | null>(null); // null = using initialBooks
  const [apiTotal, setApiTotal] = useState(totalBooks);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Sync collection from URL on back/forward navigation (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const col = new URLSearchParams(window.location.search).get('collection') || '';
      setSelectedCollection(prev => {
        if (prev === col) return prev;
        setIntroExpanded(false);
        if (col) {
          const match = collections.find(c => c.slug === col);
          if (match) setCollectionInfo({ slug: match.slug, name: match.name, subtitle: match.subtitle, description: match.description, book_count: match.book_count });
          else setCollectionInfo({ slug: col, name: col.replace(/-/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()), subtitle: '', description: '', book_count: 0 });
          // Show skeleton while loading collection books
          setApiBooks([]);
          setLoading(true);
        } else {
          setCollectionInfo(null);
        }
        return col;
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [collections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether we're in "browse" mode (no filters) or "search/filter" mode
  const isFiltered = searchQuery.trim() !== '' || selectedLanguage !== '' || selectedCategory !== '' || selectedCollection !== '' || sortBy !== 'recent-translation';
  const needsBrowseFetch = browseAll || isFiltered;
  const showCollections = !isFiltered && !selectedCollection && !browseAll && collections.length > 0;

  // The books we're working with
  const allLoadedBooks = apiBooks ?? initialBooks;
  const currentTotal = apiBooks !== null ? apiTotal : totalBooks;

  // Catalog search state
  const [catalogResults, setCatalogResults] = useState<CatalogResult[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [hasSearchedCatalog, setHasSearchedCatalog] = useState(false);
  const [showCatalogResults, setShowCatalogResults] = useState(false);

  // Import state
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedBooks, setImportedBooks] = useState<Record<string, string>>({});

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch books from API
  const fetchBooks = useCallback(async (params: {
    search?: string;
    language?: string;
    category?: string;
    collection?: string;
    sort?: SortOption;
    skip?: number;
    append?: boolean;
  }) => {
    const { search = '', language = '', category = '', collection = '', sort = 'recent-translation', skip = 0, append = false } = params;

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(API_PAGE_SIZE));
      qs.set('skip', String(skip));
      if (search) qs.set('search', search);
      if (language) qs.set('language', language);
      if (category) qs.set('category', category);
      if (collection) qs.set('collection', collection);
      qs.set('sort', sort);

      const res = await fetch(`/api/books/library?${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (append) {
        setApiBooks(prev => [...(prev ?? initialBooks), ...data.books]);
      } else {
        setApiBooks(data.books);
      }
      setApiTotal(data.total);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to fetch books:', error);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [initialBooks]);

  // When filters change or browse mode entered, fetch from API
  useEffect(() => {
    // Reset display limit
    setDisplayLimit(DISPLAY_INCREMENT);

    if (!needsBrowseFetch) {
      // Collections view — no books needed
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      setApiBooks(null);
      setApiTotal(totalBooks);
      setLoading(false);
      return;
    }

    // Debounce only for search typing — discrete filter changes (collection, language, category, sort, browseAll) fetch immediately
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const doFetch = () => fetchBooks({
      search: searchQuery.trim(),
      language: selectedLanguage,
      category: selectedCategory,
      collection: selectedCollection,
      sort: sortBy,
    });
    if (searchQuery.trim()) {
      debounceRef.current = setTimeout(doFetch, 300);
    } else {
      doFetch();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedLanguage, selectedCategory, selectedCollection, sortBy, needsBrowseFetch, totalBooks, fetchBooks]);

  const filteredBrowseBooks = useMemo(() => {
    return allLoadedBooks;
  }, [allLoadedBooks]);

  // Books to display (limited for performance)
  const displayedBooks = useMemo(() => {
    return filteredBrowseBooks.slice(0, displayLimit);
  }, [filteredBrowseBooks, displayLimit]);

  const hasMoreBooks = isFiltered
    ? allLoadedBooks.length < currentTotal || filteredBrowseBooks.length > displayLimit
    : currentTotal > displayLimit;
  const remainingBooks = currentTotal - Math.min(displayLimit, filteredBrowseBooks.length);

  const loadMore = () => {
    if (displayLimit < allLoadedBooks.length) {
      // We have more loaded books to show
      setDisplayLimit(prev => prev + DISPLAY_INCREMENT);
    } else if (allLoadedBooks.length < currentTotal) {
      // Need to fetch more from API
      setDisplayLimit(prev => prev + DISPLAY_INCREMENT);
      fetchBooks({
        search: searchQuery.trim(),
        language: selectedLanguage,
        category: selectedCategory,
        collection: selectedCollection,
        sort: sortBy,
        skip: allLoadedBooks.length,
        append: true,
      });
    }
  };

  // Search external catalogs
  const searchCatalogs = useCallback(async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;

    setCatalogSearching(true);
    setHasSearchedCatalog(true);
    setShowCatalogResults(true);

    try {
      const data = await catalog.search(searchQuery, { limit: 10 });
      setCatalogResults(data.results || []);
    } catch (error) {
      console.error('Catalog search failed:', error);
      setCatalogResults([]);
    } finally {
      setCatalogSearching(false);
    }
  }, [searchQuery]);

  // Handle search submission
  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchQuery.trim().length >= 2) {
      searchCatalogs();
    }
  };

  // Handle key press in search input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setCatalogResults([]);
    setHasSearchedCatalog(false);
    setShowCatalogResults(false);
  };

  // Get source label
  const getSourceLabel = (source: CatalogResult['source']) => {
    switch (source) {
      case 'ia': return 'Internet Archive';
      case 'gallica': return 'Gallica (BnF)';
      case 'mdz': return 'MDZ München';
      case 'bph': return 'Embassy of the Free Mind';
      case 'ustc': return 'USTC';
      default: return source;
    }
  };

  // Import book from IA
  const importFromIA = async (item: CatalogResult) => {
    if (!item.iaIdentifier || importingIds.has(item.id)) return;

    setImportingIds(prev => new Set(prev).add(item.id));

    try {
      const data = await importBooks.fromIA({
        ia_identifier: item.iaIdentifier,
        title: item.title,
        author: item.author || 'Unknown',
        original_language: item.language || 'Unknown',
        year: item.year ? parseInt(item.year) : undefined,
      });

      setImportedBooks(prev => ({ ...prev, [item.id]: data.book_id }));
      router.refresh();
    } catch (error: any) {
      console.error('Import error:', error);
      const errorMessage = error.message || 'Import failed. Please try again.';

      if (errorMessage.includes('already exists')) {
        toast.error('This book already exists in the library.');
      } else {
        toast.error(`Import failed: ${errorMessage}`);
      }
    } finally {
      setImportingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <>
      {/* Back to collections */}
      {(browseAll || selectedCollection) && collections.length > 0 && (
        <button
          onClick={() => {
            if (selectedCollection) {
              setSelectedCollection('');
              setCollectionInfo(null);
              setIntroExpanded(false);
              const url = new URL(window.location.href);
              url.searchParams.delete('collection');
              window.history.pushState({}, '', url.pathname + url.search);
            }
            setBrowseAll(false);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          All collections
        </button>
      )}

      {/* Section Heading */}
      <div className="mb-8">
        <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 italic font-display">
          {showCollections ? 'Explore the Library' : 'Library'}
        </h2>
        {showCollections && (
          <p className="text-stone-500 mt-2">
            {totalBooks.toLocaleString()} texts across {collections.length} collections
          </p>
        )}
      </div>


      {showCollections ? (
        <>
          {/* Collections Grid — 3 rows of 4, last slot is "see all" link */}
          {(() => {
            const MAX_SHOWN = 11; // 3 rows × 4 cols - 1 for "see all"
            const shown = collections.slice(0, MAX_SHOWN);
            const remaining = collections.length - shown.length;
            return (
              <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shown.map((col, i) => {
                  const heroUrl = col.hero_image;
                  const topLangs = (col.languages || []).join(', ');
                  return (
                    <Link
                      key={col.slug}
                      href={`/collections/${col.slug}`}
                      className="group relative block overflow-hidden rounded-lg aspect-[4/3] text-left"
                    >
                      {heroUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={heroUrl}
                          alt={`Illustration from ${col.name}`}
                          loading={i < 8 ? 'eager' : 'lazy'}
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-warm" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.4)] to-transparent" />
                      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2.5 py-0.5 text-xs text-white/80 bg-white/15 backdrop-blur-sm rounded-full">
                            {col.book_count.toLocaleString()} books
                          </span>
                          {topLangs && (
                            <span className="text-xs text-white/50">{topLangs}</span>
                          )}
                        </div>
                        <h3 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight">
                          {col.name}
                        </h3>
                        {col.subtitle && (
                          <p className="mt-1 text-sm text-white/70 line-clamp-2 leading-snug">
                            {col.subtitle}
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })}

                {/* "See all collections" card */}
                {remaining > 0 && (
                  <Link
                    href="/collections"
                    className="group relative block overflow-hidden rounded-lg aspect-[4/3] bg-gradient-to-br from-stone-800 to-stone-900 hover:from-stone-700 hover:to-stone-800 transition-all duration-300"
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center mb-4 group-hover:border-white/40 transition-colors">
                        <svg className="w-5 h-5 text-white/60 group-hover:text-white/90 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </div>
                      <span className="font-serif text-lg text-white/90 font-semibold leading-tight">
                        See all {collections.length} collections
                      </span>
                      <span className="mt-2 text-sm text-white/50">
                        {remaining} more to explore
                      </span>
                    </div>
                  </Link>
                )}
              </div>
            );
          })()}

          {/* New Arrivals */}
          {newArrivals.length > 0 && (
            <div className="mt-12">
              <h3 className="text-xl md:text-2xl text-gray-900 mb-4 font-display">
                New to the Library
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                {newArrivals.map((book) => (
                  <BookCard key={book.id} book={book} priority={false} />
                ))}
              </div>
            </div>
          )}

          {/* Recently Translated */}
          {recentlyTranslated.length > 0 && (
            <div className="mt-12">
              <h3 className="text-xl md:text-2xl text-gray-900 mb-4 font-display">
                Recently Translated
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                {recentlyTranslated.map((book) => (
                  <BookCard key={book.id} book={book} priority={false} />
                ))}
              </div>
            </div>
          )}

          {/* Browse all link */}
          <div className="mt-8 text-center">
            <button
              onClick={() => setBrowseAll(true)}
              className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
            >
              Browse all {totalBooks.toLocaleString()} books
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        <>
      {/* Active Collection Intro */}
      {selectedCollection && collectionInfo && (
        <div className="mb-8 bg-white border border-stone-200 rounded-xl p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-xl sm:text-2xl font-serif font-semibold text-stone-900">
                  {collectionInfo.name}
                </h3>
                <button
                  onClick={() => {
                    setSelectedCollection('');
                    setCollectionInfo(null);
                    setIntroExpanded(false);
                    setBrowseAll(false);
                    const url = new URL(window.location.href);
                    url.searchParams.delete('collection');
                    window.history.pushState({}, '', url.pathname + url.search);
                  }}
                  className="shrink-0 p-1 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                  title="Clear collection filter"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {collectionInfo.subtitle && (
                <p className="text-sm text-stone-500 mb-2">{collectionInfo.subtitle}</p>
              )}
              {collectionInfo.description && (
                <div>
                  <p className={`text-sm text-stone-600 leading-relaxed ${!introExpanded ? 'line-clamp-2' : ''}`}>
                    {collectionInfo.description}
                  </p>
                  {collectionInfo.description.length > 150 && (
                    <button
                      onClick={() => setIntroExpanded(!introExpanded)}
                      className="mt-1 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      {introExpanded ? (<>Less <ChevronUp className="w-3 h-3" /></>) : (<>More <ChevronDown className="w-3 h-3" /></>)}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Book Count */}
      <div className="mb-8 text-stone-700">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-stone-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching...
          </span>
        ) : (
          <>
            <span className="font-semibold">{currentTotal}</span>
            {' '}book{currentTotal !== 1 ? 's' : ''} in library
            {searchQuery && <span className="text-stone-500"> matching &ldquo;{searchQuery}&rdquo;</span>}
            {selectedLanguage && <span className="text-stone-500"> in {selectedLanguage}</span>}
            {selectedCategory && (
              <span className="text-stone-500">
                {' '}in {selectedCategory}
              </span>
            )}
            {selectedCollection && (
              <span className="text-stone-500">
                {' '}in {collectionInfo?.name || selectedCollection}
              </span>
            )}
          </>
        )}
      </div>

      {/* Library Results */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-3 animate-pulse">
              <div className="aspect-[3/4] bg-white/60 rounded-lg" />
              <div className="space-y-2">
                <div className="h-4 bg-white/60 rounded w-4/5" />
                <div className="h-3 bg-white/60 rounded w-3/5" />
              </div>
            </div>
          ))}
        </div>
      ) : displayedBooks.length === 0 && !hasSearchedCatalog ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-xl text-stone-700 mb-2">No books found in library</h3>
          <p className="text-stone-500 mb-4">
            {searchQuery
              ? 'Click Search to also check Internet Archive and Embassy of the Free Mind catalogs.'
              : 'Books will appear here once added to the library.'}
          </p>
          {searchQuery && searchQuery.length >= 2 && (
            <button
              onClick={handleSearch}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-rust text-white rounded-full text-sm font-medium hover:bg-accent-rust/90 transition-colors"
            >
              <Search className="w-4 h-4" />
              Search External Catalogs
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8">
          {displayedBooks.map((book, index) => (
            <BookCard key={book.id} book={book} priority={index < 5} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {displayedBooks.map((book) => (
            <Link
              key={book.id}
              href={bookUrl(book)}
              className="flex items-center gap-4 p-4 bg-white rounded-lg border border-stone-200 hover:shadow-md transition-shadow"
            >
              {/* Thumbnail */}
              <div className="w-16 h-20 bg-stone-100 rounded overflow-hidden flex-shrink-0">
                {(book.thumbnail || book.thumbnail_blob) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={book.thumbnail || book.thumbnail_blob}
                    alt={book.title || ''}
                    loading="lazy"
                    decoding="async"
                    width={64}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-stone-900 truncate">{book.display_title || book.title}</h3>
                {book.author && <p className="text-sm text-stone-500 truncate">{book.author}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-stone-400">
                  {book.language && <span>{book.language.startsWith('Multiple') ? 'Multiple' : book.language}</span>}
                  {book.pages_count && <span>{book.pages_count} pages</span>}
                  {book.pages_count && book.pages_count > 0 && (() => {
                    const ocrPercent = Math.round(((book.pages_ocr || 0) / book.pages_count) * 100);
                    return (
                      <span className={ocrPercent === 100 ? 'text-accent-sage-dark' : ocrPercent > 0 ? 'text-accent-sage' : 'text-stone-400'}>
                        {ocrPercent === 100 ? '✓ OCR' : ocrPercent > 0 ? `${ocrPercent}% OCR` : 'No OCR'}
                      </span>
                    );
                  })()}
                  {book.translation_percent !== undefined && (
                    <span className={book.translation_percent === 100 ? 'text-accent-rust' : 'text-accent-rust'}>
                      {book.translation_percent === 100 ? '✓ Translated' : `${book.translation_percent}% translated`}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-5 h-5 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {!loading && hasMoreBooks && remainingBooks > 0 && (
        <div className="mt-10 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full text-sm font-medium hover:bg-stone-50 hover:border-stone-400 transition-colors shadow-sm disabled:opacity-50"
          >
            {loadingMore ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
            {loadingMore ? 'Loading...' : `Load more (${remainingBooks} remaining)`}
          </button>
        </div>
      )}

      {/* External Catalog Results */}
      {showCatalogResults && (
        <div className="mt-12 pt-8 border-t border-stone-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-stone-900 font-display">
                Discover More
              </h3>
              <p className="text-sm text-stone-500 mt-1">
                Results from Internet Archive & Embassy of the Free Mind
              </p>
            </div>
            {catalogResults.length > 0 && (
              <span className="text-sm text-stone-500">
                {catalogResults.length} result{catalogResults.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {catalogSearching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-accent-rust" />
              <span className="ml-3 text-stone-500">Searching catalogs...</span>
            </div>
          ) : catalogResults.length === 0 ? (
            <div className="text-center py-12 bg-stone-50 rounded-xl">
              <BookOpen className="w-12 h-12 mx-auto text-stone-300 mb-3" />
              <p className="text-stone-500">No matching books found in external catalogs.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {catalogResults.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 p-4 bg-white rounded-lg border border-stone-200 hover:border-accent-gold/20 transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-20 bg-stone-100 rounded overflow-hidden flex-shrink-0">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        width={64}
                        height={80}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-stone-300" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-stone-900 line-clamp-2">{item.title}</h4>
                    {item.author && <p className="text-sm text-stone-500">{item.author}</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.source === 'ia'
                          ? 'bg-accent-sage/12 text-accent-sage-dark'
                          : 'bg-accent-violet/8 text-accent-violet'
                      }`}>
                        <ExternalLink className="w-3 h-3" />
                        {getSourceLabel(item.source)}
                      </span>
                      {item.year && item.year !== 'Unknown' && (
                        <span className="text-xs text-stone-400">{item.year}</span>
                      )}
                      {item.language && item.language !== 'Unknown' && (
                        <span className="text-xs text-stone-400">{item.language}</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-sm text-stone-500 mt-2 line-clamp-2">{item.description}</p>
                    )}
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0 flex flex-col gap-2">
                    {item.source === 'ia' && item.iaIdentifier ? (
                      <>
                        {importedBooks[item.id] ? (
                          <Link
                            href={`/book/${importedBooks[item.id]}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-status-success text-white rounded-lg hover:bg-status-success/90 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Open
                          </Link>
                        ) : (
                          <button
                            onClick={() => importFromIA(item)}
                            disabled={importingIds.has(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {importingIds.has(item.id) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Plus className="w-3.5 h-3.5" />
                            )}
                            {importingIds.has(item.id) ? 'Importing...' : 'Import'}
                          </button>
                        )}
                        <a
                          href={`https://archive.org/details/${item.iaIdentifier}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700 hover:bg-stone-50 rounded-lg transition-colors"
                        >
                          View on IA
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </>
                    ) : (
                      <span className="text-xs text-stone-400">Catalog entry</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </>
  );
}
