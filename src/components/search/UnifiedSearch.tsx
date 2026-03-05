'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Search, Book, Lightbulb, User, MapPin, BookOpen, Loader2, X, ChevronRight, ImageIcon } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { search as searchApi } from '@/lib/api-client';
import { bookUrl } from '@/lib/slugify';
import type { UnifiedSearchResponse } from '@/lib/api-client';
import HighlightedText from './HighlightedText';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';

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

export default function UnifiedSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    setIsOpen(true);

    try {
      const data = await searchApi.unified(searchQuery, { limit: 5 });
      setResults(data);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback(performSearch, 300);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

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
  const hasResults = results && (results.books.total > 0 || results.index.total > 0 || galleryResults.length > 0);
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
      items.push({ type: 'book', href: bookUrl(book), id: `book-${book.id}` });
    }
    for (let i = 0; i < results.index.results.length; i++) {
      const item = results.index.results[i];
      const bookPath = item.book_slug || item.book_id;
      const href = item.pages?.[0]
        ? `/book/${bookPath}/guide?page=${item.pages[0]}`
        : `/book/${bookPath}`;
      items.push({ type: 'index', href, id: `index-${item.book_id}-${item.type}-${i}` });
    }
    for (const img of galleryResults) {
      items.push({ type: 'gallery', href: `/gallery/image/${img.id}`, id: `gallery-${img.id}` });
    }
    items.push({ type: 'full-search', href: `/search?q=${encodeURIComponent(query)}`, id: 'full-search' });
    return items;
  }, [results, hasResults, query, galleryResults]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        router.push(`/search?q=${encodeURIComponent(query)}`);
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
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results && setIsOpen(true)}
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
        <div id="search-results" role="listbox" className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden z-50 max-h-[60vh] overflow-y-auto">
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
                href={`/search?q=${encodeURIComponent(query)}`}
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
                        Books ({results.books.total})
                      </span>
                      {results.books.total > 5 && (
                        <Link
                          href={`/search?q=${encodeURIComponent(query)}`}
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
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
                            activeIndex === itemIndex ? 'bg-accent-gold/8' : 'hover:bg-accent-gold/8'
                          }`}
                        >
                          <Book className="w-4 h-4 text-accent-rust flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 truncate text-sm">
                              <HighlightedText text={book.display_title || book.title} query={query} />
                            </p>
                            <p className="text-xs text-stone-500 truncate">
                              <HighlightedText text={book.author} query={query} />
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
                        Index ({results.index.total})
                      </span>
                      {results.index.total > 5 && (
                        <Link
                          href={`/search?q=${encodeURIComponent(query)}&mode=index`}
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
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
                            activeIndex === itemIndex ? 'bg-accent-violet/[0.06]' : 'hover:bg-accent-violet/[0.06]'
                          }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${
                            ENTITY_TYPE_STYLES[item.type as EntityType]?.iconColor ?? 'text-stone-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-stone-900 text-sm">
                              <HighlightedText text={item.term} query={query} />
                            </p>
                            <p className="text-xs text-stone-500 truncate">{item.book_title}</p>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            ENTITY_TYPE_STYLES[item.type as EntityType]?.badge ?? 'bg-stone-100 text-stone-700'
                          }`}>
                            {item.type}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Gallery Images */}
              {galleryResults.length > 0 && (() => {
                const galStartIndex = results!.books.results.length + results!.index.results.length;
                return (
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
                        Images ({galleryResults.length})
                      </span>
                      <Link
                        href={`/gallery?q=${encodeURIComponent(query)}`}
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
                          href={`/gallery/image/${img.id}`}
                          onClick={() => setIsOpen(false)}
                          role="option"
                          aria-selected={activeIndex === itemIndex}
                          data-search-index={itemIndex}
                          className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
                            activeIndex === itemIndex ? 'bg-rose-50' : 'hover:bg-rose-50'
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
                    href={`/search?q=${encodeURIComponent(query)}`}
                    onClick={() => setIsOpen(false)}
                    role="option"
                    aria-selected={activeIndex === fullSearchIndex}
                    data-search-index={fullSearchIndex}
                    className={`flex items-center justify-center gap-2 p-3 text-sm font-medium transition-colors ${
                      activeIndex === fullSearchIndex
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
