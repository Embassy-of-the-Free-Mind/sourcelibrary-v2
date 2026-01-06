'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Search, Book, Lightbulb, User, MapPin, BookOpen, Loader2, X, ChevronRight } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';

interface BookResult {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  translation_percent?: number;
}

interface IndexResult {
  type: 'concept' | 'person' | 'place' | 'keyword';
  term: string;
  book_id: string;
  book_title: string;
  pages?: number[];
}

interface SearchResults {
  query: string;
  books: { results: BookResult[]; total: number };
  index: { results: IndexResult[]; total: number };
}

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  concept: Lightbulb,
  person: User,
  place: MapPin,
  keyword: BookOpen
};

export default function UnifiedSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
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
      const response = await fetch(`/api/search/unified?q=${encodeURIComponent(searchQuery)}&limit=5`);
      if (response.ok) {
        const data = await response.json();
        setResults(data);
      }
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

  const hasResults = results && (results.books.total > 0 || results.index.total > 0);
  const noResults = results && !hasResults && query.length >= 2;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results && setIsOpen(true)}
          placeholder="Search books, concepts, people..."
          className="w-full pl-12 pr-12 py-4 bg-white/95 backdrop-blur border border-white/20 rounded-2xl text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-lg shadow-lg"
        />
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 animate-spin" />
        )}
        {query && !loading && (
          <button
            onClick={clearSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (hasResults || noResults) && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50 max-h-[60vh] overflow-y-auto">
          {noResults ? (
            <div className="p-6 text-center">
              <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500">No results for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {/* Books */}
              {results && results.books.total > 0 && (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2 px-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Books ({results.books.total})
                    </span>
                    {results.books.total > 5 && (
                      <Link
                        href={`/search?q=${encodeURIComponent(query)}`}
                        className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-0.5"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  {results.books.results.map((book) => (
                    <Link
                      key={book.id}
                      href={`/book/${book.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-amber-50 transition-colors"
                    >
                      <Book className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">
                          {book.display_title || book.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {book.author}
                        </p>
                      </div>
                      {book.translation_percent !== undefined && book.translation_percent > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                          {book.translation_percent}%
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}

              {/* Index */}
              {results && results.index.total > 0 && (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2 px-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Index ({results.index.total})
                    </span>
                    {results.index.total > 5 && (
                      <Link
                        href={`/search?q=${encodeURIComponent(query)}&mode=index`}
                        className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-0.5"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  {results.index.results.map((item, idx) => {
                    const Icon = TYPE_ICONS[item.type] || Lightbulb;
                    return (
                      <Link
                        key={`${item.book_id}-${item.type}-${idx}`}
                        href={item.pages?.[0]
                          ? `/book/${item.book_id}/guide?page=${item.pages[0]}`
                          : `/book/${item.book_id}`
                        }
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-purple-50 transition-colors"
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${
                          item.type === 'concept' ? 'text-purple-500' :
                          item.type === 'person' ? 'text-blue-500' :
                          item.type === 'place' ? 'text-green-500' :
                          'text-gray-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{item.term}</p>
                          <p className="text-xs text-gray-500 truncate">{item.book_title}</p>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          item.type === 'concept' ? 'bg-purple-100 text-purple-700' :
                          item.type === 'person' ? 'bg-blue-100 text-blue-700' :
                          item.type === 'place' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {item.type}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Full search link */}
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center gap-2 p-3 bg-gray-50 text-gray-600 hover:text-gray-900 text-sm font-medium"
              >
                <Search className="w-4 h-4" />
                Full search for &ldquo;{query}&rdquo;
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
