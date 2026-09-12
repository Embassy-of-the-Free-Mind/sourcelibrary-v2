'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Search, Book, Lightbulb, User, MapPin, BookOpen, Loader2, X, ChevronRight, ImageIcon, MessageCircle } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { search as searchApi } from '@/lib/api-client';
import { bookUrl } from '@/lib/slugify';
import type { UnifiedSearchResponse } from '@/lib/api-client';
import { getBookThumbnailUrl } from '@/lib/utils';
import { getEffectiveByline } from '@/lib/byline';
import HighlightedText from './HighlightedText';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';
import { useLocalePath, canonicalPath } from '@/lib/i18n';

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  concept: Lightbulb,
  person: User,
  place: MapPin,
  keyword: BookOpen
};

interface NavigableItem {
  type: 'book' | 'index' | 'gallery' | 'full-search';
  href: string;
  id: string;
}

// Client-side LRU cache for unified search results
const RESULT_CACHE_MAX = 50;
const resultCache = new Map<string, UnifiedSearchResponse>();

function getCachedResult(key: string): UnifiedSearchResponse | undefined {
  const val = resultCache.get(key);
  if (val) {
    // Move to end (most recently used)
    resultCache.delete(key);
    resultCache.set(key, val);
  }
  return val;
}

function setCachedResult(key: string, value: UnifiedSearchResponse) {
  resultCache.delete(key);
  resultCache.set(key, value);
  if (resultCache.size > RESULT_CACHE_MAX) {
    // Delete oldest entry
    const first = resultCache.keys().next().value;
    if (first !== undefined) resultCache.delete(first);
  }
}

// Vocabulary for ghost text autocomplete (loaded once on first focus)
let vocabularyPromise: Promise<string[]> | null = null;
let vocabularyCache: string[] | null = null;

function loadVocabulary(): Promise<string[]> {
  if (vocabularyCache) return Promise.resolve(vocabularyCache);
  if (!vocabularyPromise) {
    vocabularyPromise = searchApi.vocabulary()
      .then(v => { vocabularyCache = v; return v; })
      .catch(() => { vocabularyPromise = null; return []; });
  }
  return vocabularyPromise;
}

function findCompletion(input: string, vocab: string[]): string | null {
  if (input.length < 2) return null;
  const lower = input.toLowerCase();
  for (const term of vocab) {
    if (term.toLowerCase().startsWith(lower) && term.length > input.length) {
      return term;
    }
  }
  return null;
}

interface UnifiedSearchProps {
  /** Where the results dropdown opens. 'top' (default) opens upward — matches
   *  the global hero where the search sits at the bottom of the viewport.
   *  'bottom' opens downward — use when the input has content beneath it. */
  dropdownPosition?: 'top' | 'bottom';
}

export default function UnifiedSearch({ dropdownPosition = 'top' }: UnifiedSearchProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [ghostText, setGhostText] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Segment 0 can be a TENANT slug or a LOCALE prefix, and the two need
  // OPPOSITE treatment: a tenant prefix is carried verbatim onto every link the
  // component writes, while a locale prefix belongs only on the paths that
  // actually have a twin. Deriving one prefix for both made `/es` look like a
  // tenant, so the Spanish homepage's typeahead emitted `/es/gallery/image/…`
  // — a 404, since the gallery has no Spanish route (measured: `/gallery` 200,
  // `/es/gallery` 404). Strip the locale first, then re-apply it per link via
  // the registry (i18n.md rule 5, "prefer the registry to a per-item ternary").
  const lp = useLocalePath();
  const pathParts = canonicalPath(pathname).split('/').filter(Boolean);
  const tenantPrefix = pathParts[0] && pathParts[0] !== 'search' ? `/${pathParts[0]}` : '';

  // Preload vocabulary on first focus
  const handleFocus = useCallback(() => {
    loadVocabulary();
    if (results) setIsOpen(true);
  }, [results]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    // Check client-side cache first
    const cacheKey = searchQuery.toLowerCase().trim();
    const cached = getCachedResult(cacheKey);
    if (cached) {
      setResults(cached);
      setIsOpen(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setIsOpen(true);

    try {
      const data = await searchApi.unified(searchQuery, { limit: 8 });
      setCachedResult(cacheKey, data);
      setResults(data);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback(performSearch, 300);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    debouncedSearch(value);

    // Update ghost text from vocabulary
    if (vocabularyCache) {
      setGhostText(findCompletion(value, vocabularyCache));
    } else {
      loadVocabulary().then(vocab => {
        setGhostText(findCompletion(value, vocab));
      });
    }
  }, [debouncedSearch]);

  const clearSearch = () => {
    setQuery('');
    setResults(null);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const galleryResults = (results as any)?.gallery?.results || [];
  const semanticResults = results?.semantic?.results || [];
  const hasResults = results && (results.books.total > 0 || results.index.total > 0 || galleryResults.length > 0 || semanticResults.length > 0);
  const noResults = results && !hasResults && query.length >= 2;

  // Fetch suggestions on zero results
  useEffect(() => {
    if (!noResults || query.length < 3) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    searchApi.suggest(query).then(data => {
      if (!cancelled) setSuggestion(data.suggestions?.[0] || null);
    }).catch(() => {
      if (!cancelled) setSuggestion(null);
    });
    return () => { cancelled = true; };
  }, [noResults, query]);

  // Build flat navigable list for keyboard nav
  const navigableItems = useMemo((): NavigableItem[] => {
    if (!results || !hasResults) return [];
    const items: NavigableItem[] = [];
    for (const book of results.books.results) {
      items.push({ type: 'book', href: lp(bookUrl(book)), id: `book-${book.id}` });
    }
    for (let i = 0; i < results.index.results.length; i++) {
      const item = results.index.results[i];
      const bookPath = item.book_slug || item.book_id;
      const href = lp(item.pages?.[0]
        ? `${tenantPrefix}/book/${bookPath}/guide?page=${item.pages[0]}`
        : `${tenantPrefix}/book/${bookPath}`);
      items.push({ type: 'index', href, id: `index-${item.book_id}-${item.type}-${i}` });
    }
    for (const sem of semanticResults) {
      items.push({ type: 'book', href: lp(`${tenantPrefix}/book/${sem.book_id}`), id: `semantic-${sem.book_id}` });
    }
    for (const img of galleryResults) {
      // The gallery has no localized twin, so lp() leaves this alone — which is
      // the point: an English gallery page beats a prefixed 404.
      items.push({ type: 'gallery', href: lp(`${tenantPrefix}/gallery/image/${img.id}`), id: `gallery-${img.id}` });
    }
    items.push({ type: 'full-search', href: lp(`${tenantPrefix}/search?q=${encodeURIComponent(query)}`), id: 'full-search' });
    return items;
  }, [results, hasResults, query, galleryResults, semanticResults, tenantPrefix, lp]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Tab to accept ghost text completion
    if (e.key === 'Tab' && ghostText && !isOpen) {
      e.preventDefault();
      setQuery(ghostText);
      setGhostText(null);
      debouncedSearch(ghostText);
      return;
    }
    if (e.key === 'Tab' && ghostText && isOpen && activeIndex < 0) {
      e.preventDefault();
      setQuery(ghostText);
      setGhostText(null);
      debouncedSearch(ghostText);
      return;
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < navigableItems.length) {
        // Navigate to selected item
        e.preventDefault();
        setIsOpen(false);
        router.push(navigableItems[activeIndex].href);
      } else if (query.length >= 2) {
        // No item selected — go to full search page
        e.preventDefault();
        setIsOpen(false);
        router.push(lp(`${tenantPrefix}/search?q=${encodeURIComponent(query)}`));
      }
      return;
    }

    if (!isOpen || navigableItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % navigableItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev <= 0 ? navigableItems.length - 1 : prev - 1));
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && navigableItems[activeIndex]) {
      const el = containerRef.current?.querySelector(`[data-search-index="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, navigableItems]);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" aria-hidden="true" />
        {/* Ghost text overlay for autocomplete */}
        {ghostText && query.length >= 2 && (
          <div
            className="absolute left-12 top-1/2 -translate-y-1/2 text-lg pointer-events-none select-none text-stone-300"
            aria-hidden="true"
          >
            <span className="invisible">{query}</span>
            <span>{ghostText.slice(query.length)}</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Search books, concepts, people..."
          aria-label="Search the library"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `search-item-${activeIndex}` : undefined}
          role="combobox"
          aria-controls="search-results"
          className="w-full pl-12 pr-12 py-4 bg-white/95 backdrop-blur border border-white/20 rounded-2xl text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus-visible:ring-accent-rust/50 text-lg shadow-lg"
        />
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 animate-spin" />
        )}
        {query && !loading && (
          <button
            onClick={clearSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            aria-label="Clear search"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (hasResults || noResults) && (
        <div id="search-results" role="listbox" className={`absolute ${dropdownPosition === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} left-0 right-0 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden z-50 max-h-[60vh] overflow-y-auto`}>
          {noResults ? (
            <div className="p-6 text-center">
              <Search className="w-8 h-8 text-stone-300 mx-auto mb-2" />
              <p className="text-stone-500">No results for &ldquo;{query}&rdquo;</p>
              {suggestion && (
                <p className="text-sm text-stone-600 mt-2">
                  Did you mean{' '}
                  <button
                    onClick={() => {
                      setQuery(suggestion);
                      performSearch(suggestion);
                    }}
                    className="font-medium text-accent-rust hover:text-accent-gold-dark underline underline-offset-2"
                  >
                    {suggestion}
                  </button>
                  ?
                </p>
              )}
              <Link
                href={lp(`/search?q=${encodeURIComponent(query)}`)}
                onClick={() => setIsOpen(false)}
                className="inline-flex items-center gap-2 mt-3 text-sm text-accent-rust hover:text-accent-rust"
              >
                <Search className="w-4 h-4" />
                Try full search
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {/* Books */}
              {results && results.books.total > 0 && (() => {
                const bookStartIndex = 0;
                return (
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
                        Books{results.books.hasMore ? '' : ` (${results.books.total})`}
                      </span>
                      {results.books.hasMore && (
                        <Link
                          href={lp(`/search?q=${encodeURIComponent(query)}`)}
                          className="text-xs text-accent-rust hover:text-accent-rust flex items-center gap-0.5"
                          onClick={() => setIsOpen(false)}
                        >
                          See all <ChevronRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                    {results.books.results.map((book, i) => {
                      const itemIndex = bookStartIndex + i;
                      return (
                        <Link
                          key={book.id}
                          id={`search-item-${itemIndex}`}
                          href={bookUrl(book)}
                          onClick={() => setIsOpen(false)}
                          role="option"
                          aria-selected={activeIndex === itemIndex}
                          data-search-index={itemIndex}
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${activeIndex === itemIndex ? 'bg-accent-gold/8' : 'hover:bg-accent-gold/8'
                            }`}
                        >
                          {getBookThumbnailUrl(book, 'thumb') ? (
                            <div className="w-8 h-10 rounded overflow-hidden flex-shrink-0 bg-stone-100">
                              <Image
                                src={getBookThumbnailUrl(book, 'thumb')!}
                                alt={book.display_title || book.title}
                                width={32}
                                height={40}
                                sizes="32px"
                                className="w-full h-full object-cover"
                                unoptimized
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
                          ) : (
                            <Book className="w-4 h-4 text-accent-rust flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 truncate text-sm">
                              <HighlightedText text={book.display_title || book.title} query={query} />
                            </p>
                            <p className="text-xs text-stone-500 truncate">
                              {(() => {
                                const byline = getEffectiveByline(book);
                                if (byline.role === 'editor') {
                                  return <>ed. <HighlightedText text={byline.editor} query={query} /></>;
                                }
                                return <HighlightedText text={book.author} query={query} />;
                              })()}
                            </p>
                          </div>
                          {book.translation_percent !== undefined && book.translation_percent > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                              {book.translation_percent}%
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Index */}
              {results && results.index.total > 0 && (() => {
                const indexStartIndex = results.books.results.length;
                return (
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
                        Index{results.index.hasMore ? '' : ` (${results.index.total})`}
                      </span>
                      {results.index.hasMore && (
                        <Link
                          href={lp(`/search?q=${encodeURIComponent(query)}&mode=index`)}
                          className="text-xs text-accent-rust hover:text-accent-rust flex items-center gap-0.5"
                          onClick={() => setIsOpen(false)}
                        >
                          See all <ChevronRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                    {results.index.results.map((item, idx) => {
                      const itemIndex = indexStartIndex + idx;
                      const Icon = TYPE_ICONS[item.type] || Lightbulb;
                      return (
                        <Link
                          key={`${item.book_id}-${item.type}-${idx}`}
                          id={`search-item-${itemIndex}`}
                          href={item.pages?.[0]
                            ? `/book/${item.book_slug || item.book_id}/guide?page=${item.pages[0]}`
                            : `/book/${item.book_slug || item.book_id}`
                          }
                          onClick={() => setIsOpen(false)}
                          role="option"
                          aria-selected={activeIndex === itemIndex}
                          data-search-index={itemIndex}
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${activeIndex === itemIndex ? 'bg-accent-violet/[0.06]' : 'hover:bg-accent-violet/[0.06]'
                            }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${ENTITY_TYPE_STYLES[item.type as EntityType]?.iconColor ?? 'text-stone-500'
                            }`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 text-sm">
                              <HighlightedText text={item.term} query={query} />
                            </p>
                            <p className="text-xs text-stone-500 truncate">{item.book_title}</p>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${ENTITY_TYPE_STYLES[item.type as EntityType]?.badge ?? 'bg-stone-100 text-stone-700'
                            }`}>
                            {item.type}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Semantic — conceptually related books */}
              {semanticResults.length > 0 && (() => {
                const semStartIndex = results!.books.results.length + results!.index.results.length;
                return (
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
                        Related
                      </span>
                    </div>
                    {semanticResults.slice(0, 4).map((sem, idx) => {
                      const itemIndex = semStartIndex + idx;
                      return (
                        <Link
                          key={sem.book_id}
                          id={`search-item-${itemIndex}`}
                          href={`/book/${sem.book_id}`}
                          onClick={() => setIsOpen(false)}
                          role="option"
                          aria-selected={activeIndex === itemIndex}
                          data-search-index={itemIndex}
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${activeIndex === itemIndex ? 'bg-violet-50' : 'hover:bg-violet-50'
                            }`}
                        >
                          <Lightbulb className="w-4 h-4 text-violet-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 text-sm truncate">
                              {sem.title}
                            </p>
                            <p className="text-xs text-stone-500 truncate">
                              {(() => {
                                const byline = getEffectiveByline({ author: sem.author, editor: sem.editor });
                                if (byline.role === 'editor') return `ed. ${byline.editor}`;
                                return sem.author || '';
                              })()}{sem.year ? ` · ${sem.year}` : ''}
                              {sem.relevance_hint ? ` · ${sem.relevance_hint}` : ''}
                            </p>
                            {sem.summary_snippet && (
                              <p className="text-xs text-stone-400 truncate mt-0.5">
                                {sem.summary_snippet}
                              </p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                    <Link
                      href={`/librarian?q=${encodeURIComponent(query)}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-2 px-2 py-2 mt-1 rounded-lg text-xs text-violet-600 hover:bg-violet-50 transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Ask the Librarian about this
                    </Link>
                  </div>
                );
              })()}

              {/* Gallery Images */}
              {galleryResults.length > 0 && (() => {
                const galStartIndex = results!.books.results.length + results!.index.results.length + semanticResults.length;
                return (
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
                        Images ({galleryResults.length})
                      </span>
                      <Link
                        href={`${tenantPrefix}/gallery?q=${encodeURIComponent(query)}`}
                        className="text-xs text-accent-rust hover:text-accent-rust flex items-center gap-0.5"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                    {galleryResults.map((img: any, idx: number) => {
                      const itemIndex = galStartIndex + idx;
                      return (
                        <Link
                          key={img.id}
                          id={`search-item-${itemIndex}`}
                          href={`${tenantPrefix}/gallery/image/${img.id}`}
                          onClick={() => setIsOpen(false)}
                          role="option"
                          aria-selected={activeIndex === itemIndex}
                          data-search-index={itemIndex}
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${activeIndex === itemIndex ? 'bg-rose-50' : 'hover:bg-rose-50'
                            }`}
                        >
                          {img.imageUrl ? (
                            <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0 bg-stone-100">
                              <Image
                                src={img.imageUrl}
                                alt={img.description || ''}
                                width={32}
                                height={32}
                                sizes="32px"
                                className="w-full h-full object-cover"
                                unoptimized
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
                          ) : (
                            <ImageIcon className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 text-sm truncate">
                              <HighlightedText text={img.description || 'Gallery image'} query={query} />
                            </p>
                            <p className="text-xs text-stone-500 truncate">{img.bookTitle}</p>
                          </div>
                          {img.type && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded">
                              {img.type}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Full search link */}
              {(() => {
                const fullSearchIndex = navigableItems.length - 1;
                return (
                  <Link
                    id={`search-item-${fullSearchIndex}`}
                    href={lp(`/search?q=${encodeURIComponent(query)}`)}
                    onClick={() => setIsOpen(false)}
                    role="option"
                    aria-selected={activeIndex === fullSearchIndex}
                    data-search-index={fullSearchIndex}
                    className={`flex items-center justify-center gap-2 p-3 text-sm font-medium transition-colors ${activeIndex === fullSearchIndex
                      ? 'bg-accent-gold/8 text-accent-gold-dark'
                      : 'bg-stone-50 text-stone-600 hover:text-stone-900'
                      }`}
                  >
                    <Search className="w-4 h-4" />
                    Full search for &ldquo;{query}&rdquo;
                  </Link>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
